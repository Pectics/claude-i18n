import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPDATE_SCRIPT = path.join(__dirname, 'update_coverage.mjs');

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function runUpdateCoverage(repoRoot, sourceLocalesPath) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        UPDATE_SCRIPT,
        '--repo-root',
        repoRoot,
        '--source-locales',
        sourceLocalesPath,
        '--output-locales',
        path.join(repoRoot, 'locales.json'),
      ],
      { encoding: 'utf8' },
    ),
  );
}

test('updates locale coverage from current target counts and pending additions/deletions', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-coverage-'));
  const sourceLocalesPath = path.join(repoRoot, 'base-locales.json');

  try {
    writeJson(sourceLocalesPath, {
      version: '0000000',
      locales: ['zh-CN', 'zh-TW', 'fr-FR'],
      existing: true,
    });
    writeJson(path.join(repoRoot, 'locales.json'), {
      version: 'old',
      locales: ['zh-CN'],
    });
    writeJson(path.join(repoRoot, 'zh-CN', 'zh-CN.json'), {
      a: 'A',
      b: 'B',
      c: 'C',
    });
    writeJson(path.join(repoRoot, 'zh-CN', 'zh-CN.dynamic.json'), {
      d: 'D',
      e: 'E',
    });
    writeJson(path.join(repoRoot, 'zh-TW', 'zh-TW.json'), {
      a: 'A',
      b: 'B',
      c: 'C',
      d: 'D',
      e: 'E',
      f: 'F',
      g: 'G',
      h: 'H',
    });
    writeJson(path.join(repoRoot, 'zh-TW', 'zh-TW.dynamic.json'), {
      i: 'I',
      j: 'J',
    });
    writeJson(path.join(repoRoot, '.pending', 'locale-update', 'manifest.json'), {
      diffSummary: {
        main: { add: 2, update: 7, remove: 1, total: 10 },
        dynamic: { add: 1, update: 0, remove: 1, total: 2 },
      },
    });

    const summary = runUpdateCoverage(repoRoot, sourceLocalesPath);
    const locales = readJson(path.join(repoRoot, 'locales.json'));

    assert.deepEqual(locales.locales, ['zh-CN', 'zh-TW', 'fr-FR']);
    assert.equal(locales.existing, true);
    assert.deepEqual(locales.coverage, {
      'zh-CN': 0.5,
      'zh-TW': 0.7273,
      'fr-FR': -1,
    });
    assert.equal(summary.coverage['zh-CN'], 0.5);
    assert.equal(summary.additionTotal, 3);
    assert.equal(summary.deletionTotal, 2);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('uses perfect coverage when there is no pending entry diff', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-coverage-'));
  const sourceLocalesPath = path.join(repoRoot, 'base-locales.json');

  try {
    writeJson(sourceLocalesPath, {
      version: '0000000',
      locales: ['zh-CN'],
    });
    writeJson(path.join(repoRoot, 'zh-CN', 'zh-CN.json'), {
      a: 'A',
    });
    writeJson(path.join(repoRoot, 'zh-CN', 'zh-CN.dynamic.json'), {});

    runUpdateCoverage(repoRoot, sourceLocalesPath);
    const locales = readJson(path.join(repoRoot, 'locales.json'));

    assert.deepEqual(locales.coverage, { 'zh-CN': 1 });
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
