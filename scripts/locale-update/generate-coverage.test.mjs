import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GENERATE_SCRIPT = path.join(__dirname, 'generate_coverage.mjs');

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-coverage-'));
  const upstreamDir = path.join(root, 'upstream');
  const targetRoot = path.join(root, 'target');
  const outputDir = path.join(root, 'output');
  const curlBin = path.join(root, 'fake-curl.sh');
  fs.writeFileSync(
    curlBin,
    `#!/usr/bin/env bash
set -euo pipefail
output=""
url=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output" ]; then
    output="$2"
    shift 2
  else
    url="$1"
    shift
  fi
done
if [ "\${FAKE_CURL_FAIL:-}" = "1" ]; then
  echo "simulated curl failure" >&2
  exit 22
fi
if [ "\${FAKE_CURL_HTML:-}" = "1" ]; then
  printf '<html>not svg</html>\\n' > "$output"
else
  printf '<svg data-url="%s"></svg>\\n' "$url" > "$output"
fi
`,
    'utf8',
  );
  fs.chmodSync(curlBin, 0o755);
  return { root, upstreamDir, targetRoot, outputDir, curlBin };
}

function runGenerate(fixture, extraArgs = [], extraEnv = {}) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        GENERATE_SCRIPT,
        '--base-locale',
        'en-US',
        '--upstream-dir',
        fixture.upstreamDir,
        '--target-root',
        fixture.targetRoot,
        '--output-dir',
        fixture.outputDir,
        '--curl-bin',
        fixture.curlBin,
        ...extraArgs,
      ],
      { encoding: 'utf8', env: { ...process.env, ...extraEnv } },
    ),
  );
}

test('calculates each locale from upstream key intersections and ignores extra target keys', () => {
  const fixture = createFixture();
  try {
    writeJson(path.join(fixture.upstreamDir, 'en-US.json'), { a: 1, b: 2, c: 3, same: 4 });
    writeJson(path.join(fixture.upstreamDir, 'en-US.dynamic.json'), { same: 1, dynamic: 2 });
    writeJson(path.join(fixture.targetRoot, 'locales.json'), { locales: ['zh-TW', 'zh-CN'] });
    writeJson(path.join(fixture.targetRoot, 'zh-TW', 'zh-TW.json'), {
      a: 'A',
      b: 'B',
      c: 'C',
      same: 'S',
      removedUpstreamKey: 'old',
    });
    writeJson(path.join(fixture.targetRoot, 'zh-TW', 'zh-TW.dynamic.json'), {
      same: 'S',
      dynamic: 'D',
    });
    writeJson(path.join(fixture.targetRoot, 'zh-CN', 'zh-CN.json'), { a: 'A', b: 'B', same: 'S' });
    writeJson(path.join(fixture.targetRoot, 'zh-CN', 'zh-CN.dynamic.json'), { dynamic: 'D' });

    const payload = runGenerate(fixture);

    assert.deepEqual(Object.keys(payload), ['zh-TW', 'zh-CN']);
    assert.deepEqual(payload['zh-TW'], { covered: 6, total: 6, ratio: 1 });
    assert.deepEqual(payload['zh-CN'], { covered: 4, total: 6, ratio: 0.6667 });
    assert.deepEqual(readJson(path.join(fixture.outputDir, 'coverage.json')), payload);
    assert.match(
      fs.readFileSync(path.join(fixture.outputDir, 'badges', 'zh-CN.svg'), 'utf8'),
      /\/badge\/zh--CN-66\.67%25-e5534b/,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('keeps main and dynamic namespaces separate when a key exists in both', () => {
  const fixture = createFixture();
  try {
    writeJson(path.join(fixture.upstreamDir, 'en-US.json'), { duplicate: 1 });
    writeJson(path.join(fixture.upstreamDir, 'en-US.dynamic.json'), { duplicate: 2 });
    writeJson(path.join(fixture.targetRoot, 'locales.json'), { locales: ['zh-CN'] });
    writeJson(path.join(fixture.targetRoot, 'zh-CN', 'zh-CN.json'), { duplicate: 'translated' });
    writeJson(path.join(fixture.targetRoot, 'zh-CN', 'zh-CN.dynamic.json'), {});

    const payload = runGenerate(fixture);
    assert.deepEqual(payload['zh-CN'], { covered: 1, total: 2, ratio: 0.5 });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('uses green, yellow, red, and invalid badge states at the configured thresholds', () => {
  const fixture = createFixture();
  try {
    const upstream = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`key${index}`, index]));
    const targetWith = (count) => Object.fromEntries(Object.keys(upstream).slice(0, count).map((key) => [key, key]));
    writeJson(path.join(fixture.upstreamDir, 'en-US.json'), upstream);
    writeJson(path.join(fixture.upstreamDir, 'en-US.dynamic.json'), {});
    writeJson(path.join(fixture.targetRoot, 'locales.json'), {
      locales: ['ga-AA', 'ya-AA', 'ra-AA', 'ia-AA'],
    });
    for (const [locale, count] of [
      ['ga-AA', 18],
      ['ya-AA', 15],
      ['ra-AA', 14],
    ]) {
      writeJson(path.join(fixture.targetRoot, locale, `${locale}.json`), targetWith(count));
      writeJson(path.join(fixture.targetRoot, locale, `${locale}.dynamic.json`), {});
    }

    const payload = runGenerate(fixture);

    assert.match(fs.readFileSync(path.join(fixture.outputDir, 'badges', 'ga-AA.svg'), 'utf8'), /90\.00%25-4c1/);
    assert.match(fs.readFileSync(path.join(fixture.outputDir, 'badges', 'ya-AA.svg'), 'utf8'), /75\.00%25-dfb317/);
    assert.match(fs.readFileSync(path.join(fixture.outputDir, 'badges', 'ra-AA.svg'), 'utf8'), /70\.00%25-e5534b/);
    assert.match(fs.readFileSync(path.join(fixture.outputDir, 'badges', 'ia-AA.svg'), 'utf8'), /invalid-9f9f9f/);
    assert.deepEqual(payload['ia-AA'], { covered: null, total: 20, ratio: null });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('replaces generated badges while preserving unrelated output files', () => {
  const fixture = createFixture();
  try {
    writeJson(path.join(fixture.upstreamDir, 'en-US.json'), { a: 1 });
    writeJson(path.join(fixture.upstreamDir, 'en-US.dynamic.json'), {});
    writeJson(path.join(fixture.targetRoot, 'locales.json'), { locales: ['zh-CN'] });
    writeJson(path.join(fixture.targetRoot, 'zh-CN', 'zh-CN.json'), { a: 'A' });
    writeJson(path.join(fixture.targetRoot, 'zh-CN', 'zh-CN.dynamic.json'), {});
    fs.mkdirSync(path.join(fixture.outputDir, 'badges'), { recursive: true });
    fs.writeFileSync(path.join(fixture.outputDir, 'badges', 'removed-locale.json'), '{"stale":true}\n', 'utf8');
    fs.writeFileSync(path.join(fixture.outputDir, 'keep.txt'), 'keep\n', 'utf8');

    runGenerate(fixture);

    assert.deepEqual(fs.readdirSync(path.join(fixture.outputDir, 'badges')), ['zh-CN.svg']);
    assert.equal(fs.readFileSync(path.join(fixture.outputDir, 'keep.txt'), 'utf8'), 'keep\n');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('fails instead of publishing when upstream has no keys', () => {
  const fixture = createFixture();
  try {
    writeJson(path.join(fixture.upstreamDir, 'en-US.json'), {});
    writeJson(path.join(fixture.upstreamDir, 'en-US.dynamic.json'), {});
    writeJson(path.join(fixture.targetRoot, 'locales.json'), { locales: ['zh-CN'] });
    writeJson(path.join(fixture.targetRoot, 'zh-CN', 'zh-CN.json'), {});
    writeJson(path.join(fixture.targetRoot, 'zh-CN', 'zh-CN.dynamic.json'), {});

    assert.throws(() => runGenerate(fixture), /has no keys/);
    assert.equal(fs.existsSync(path.join(fixture.outputDir, 'coverage.json')), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('fails on invalid upstream JSON but renders missing target data as invalid', () => {
  const invalidFixture = createFixture();
  const missingFixture = createFixture();
  try {
    fs.mkdirSync(invalidFixture.upstreamDir, { recursive: true });
    fs.writeFileSync(path.join(invalidFixture.upstreamDir, 'en-US.json'), '{invalid', 'utf8');
    writeJson(path.join(invalidFixture.upstreamDir, 'en-US.dynamic.json'), {});
    writeJson(path.join(invalidFixture.targetRoot, 'locales.json'), { locales: ['zh-CN'] });
    assert.throws(() => runGenerate(invalidFixture), /Unexpected token|Expected property name/);

    writeJson(path.join(missingFixture.upstreamDir, 'en-US.json'), { a: 1 });
    writeJson(path.join(missingFixture.upstreamDir, 'en-US.dynamic.json'), {});
    writeJson(path.join(missingFixture.targetRoot, 'locales.json'), { locales: ['zh-CN'] });
    writeJson(path.join(missingFixture.targetRoot, 'zh-CN', 'zh-CN.json'), { a: 'A' });
    const payload = runGenerate(missingFixture);
    assert.deepEqual(payload['zh-CN'], { covered: null, total: 1, ratio: null });
    assert.match(
      fs.readFileSync(path.join(missingFixture.outputDir, 'badges', 'zh-CN.svg'), 'utf8'),
      /invalid-9f9f9f/,
    );
  } finally {
    fs.rmSync(invalidFixture.root, { recursive: true, force: true });
    fs.rmSync(missingFixture.root, { recursive: true, force: true });
  }
});

test('preserves existing artifacts when Shields download fails or returns non-SVG content', () => {
  for (const extraEnv of [{ FAKE_CURL_FAIL: '1' }, { FAKE_CURL_HTML: '1' }]) {
    const fixture = createFixture();
    try {
      writeJson(path.join(fixture.upstreamDir, 'en-US.json'), { a: 1 });
      writeJson(path.join(fixture.upstreamDir, 'en-US.dynamic.json'), {});
      writeJson(path.join(fixture.targetRoot, 'locales.json'), { locales: ['zh-CN'] });
      writeJson(path.join(fixture.targetRoot, 'zh-CN', 'zh-CN.json'), { a: 'A' });
      writeJson(path.join(fixture.targetRoot, 'zh-CN', 'zh-CN.dynamic.json'), {});
      writeJson(path.join(fixture.outputDir, 'coverage.json'), { previous: true });
      fs.mkdirSync(path.join(fixture.outputDir, 'badges'), { recursive: true });
      fs.writeFileSync(path.join(fixture.outputDir, 'badges', 'zh-CN.svg'), '<svg>previous</svg>\n', 'utf8');

      assert.throws(() => runGenerate(fixture, [], extraEnv), /Failed to download|not an SVG/);
      assert.deepEqual(readJson(path.join(fixture.outputDir, 'coverage.json')), { previous: true });
      assert.equal(
        fs.readFileSync(path.join(fixture.outputDir, 'badges', 'zh-CN.svg'), 'utf8'),
        '<svg>previous</svg>\n',
      );
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});
