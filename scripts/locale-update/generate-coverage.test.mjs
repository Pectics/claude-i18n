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
  return { root, upstreamDir, targetRoot, outputDir };
}

function runGenerate(fixture, extraArgs = []) {
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
        ...extraArgs,
      ],
      { encoding: 'utf8' },
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

    assert.deepEqual(Object.keys(payload.coverage), ['zh-TW', 'zh-CN']);
    assert.deepEqual(payload.coverage['zh-TW'], { covered: 6, total: 6, ratio: 1 });
    assert.deepEqual(payload.coverage['zh-CN'], { covered: 4, total: 6, ratio: 0.6667 });
    assert.deepEqual(readJson(path.join(fixture.outputDir, 'badges', 'zh-CN.json')), {
      schemaVersion: 1,
      label: 'zh-CN',
      message: '66.67%',
      color: 'e5534b',
    });
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
    assert.deepEqual(payload.coverage['zh-CN'], { covered: 1, total: 2, ratio: 0.5 });
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
    writeJson(path.join(fixture.outputDir, 'badges', 'removed-locale.json'), { stale: true });
    fs.writeFileSync(path.join(fixture.outputDir, 'keep.txt'), 'keep\n', 'utf8');

    runGenerate(fixture);

    assert.equal(fs.existsSync(path.join(fixture.outputDir, 'badges', 'removed-locale.json')), false);
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

test('fails on invalid JSON or a missing target locale file', () => {
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
    assert.throws(() => runGenerate(missingFixture), /ENOENT/);
    assert.equal(fs.existsSync(path.join(missingFixture.outputDir, 'coverage.json')), false);
  } finally {
    fs.rmSync(invalidFixture.root, { recursive: true, force: true });
    fs.rmSync(missingFixture.root, { recursive: true, force: true });
  }
});
