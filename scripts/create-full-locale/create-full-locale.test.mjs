import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const PREPARE_SCRIPT = path.join(__dirname, 'prepare_translation.mjs');
const APPLY_SCRIPT = path.join(__dirname, 'apply_translation.mjs');
const LOCALES_PATH = path.join(ROOT_DIR, 'locales.json');

function runNode(scriptPath, args) {
  return execFileSync(process.execPath, [scriptPath, ...args], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
  });
}

function assertFails(scriptPath, args, pattern) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, pattern);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
}

function readJsonl(filePath) {
  return fs
    .readFileSync(filePath, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function backupLocales() {
  return fs.readFileSync(LOCALES_PATH, 'utf8');
}

function restoreLocales(content) {
  fs.writeFileSync(LOCALES_PATH, content, 'utf8');
}

test('prepare requires a target locale', () => {
  assertFails(PREPARE_SCRIPT, [], /Usage: node prepare_translation\.mjs --locale <locale>/);
});

test('prepare rejects non-canonical target locale tags', () => {
  assertFails(PREPARE_SCRIPT, ['--locale', 'spanish'], /Invalid target locale/);
});

test('prepare rejects an existing root target locale', () => {
  assertFails(PREPARE_SCRIPT, ['--locale', 'zh-CN'], /already exists/);
});

test('prepare rejects a target locale already listed in locales.json', () => {
  const originalLocales = backupLocales();
  try {
    const data = readJson(LOCALES_PATH);
    data.locales = [...new Set([...data.locales, 'fr-FR'])];
    fs.writeFileSync(LOCALES_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

    assertFails(PREPARE_SCRIPT, ['--locale', 'fr-FR'], /already listed in locales\.json/);
  } finally {
    restoreLocales(originalLocales);
  }
});

test('prepare rejects missing context locale files', () => {
  assertFails(
    PREPARE_SCRIPT,
    ['--locale', 'fr-FR', '--context-locale', 'de-DE'],
    /Missing context locale file/,
  );
});

test('prepare rejects malformed output field names', () => {
  assertFails(PREPARE_SCRIPT, ['--locale', 'fr-FR', '--output-field', 'bad-field'], /Invalid output field/);
});

test('prepare and apply create a full new locale and register it', () => {
  const locale = 'fr-FR';
  const targetDir = path.join(ROOT_DIR, locale);
  const pendingDir = path.join(ROOT_DIR, `.tmp-create-full-locale-test-${process.pid}`);
  const originalLocales = backupLocales();

  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.rmSync(pendingDir, { recursive: true, force: true });

  try {
    runNode(PREPARE_SCRIPT, [
      '--locale',
      locale,
      '--pending-dir',
      pendingDir,
      '--target-chars',
      '2000000',
      '--max-entries',
      '20000',
      '--min-entries',
      '1',
    ]);

    const manifestPath = path.join(pendingDir, locale, 'manifest.json');
    const manifest = readJson(manifestPath);
    assert.equal(manifest.locale, locale);
    assert.equal(manifest.outputField, 'translation');
    assert.equal(manifest.baseLocale, 'en-US');
    assert.equal(manifest.referenceLocale, 'ja-JP');
    assert.equal(manifest.contextLocale, 'zh-CN');
    assert.ok(manifest.chunks.main.length > 0);
    assert.ok(manifest.chunks.dynamic.length > 0);

    assertFails(
      PREPARE_SCRIPT,
      [
        '--locale',
        locale,
        '--pending-dir',
        pendingDir,
        '--target-chars',
        '2000000',
        '--max-entries',
        '20000',
        '--min-entries',
        '1',
      ],
      /Refusing to delete existing translation work/,
    );

    for (const chunkInfo of [...manifest.chunks.main, ...manifest.chunks.dynamic]) {
      const inputRows = readJsonl(chunkInfo.inputPath);
      const outputRows = inputRows.map((row) => ({
        file: row.file,
        index: row.index,
        key: row.key,
        translation: `${row.en.replace(/\bTODO\b/gi, 'tache')} [fr-FR]`,
      }));
      writeJsonl(chunkInfo.outputPath, outputRows);
    }

    const localesBeforeApply = readJson(LOCALES_PATH);
    localesBeforeApply.testMetadata = { preserved: true };
    fs.writeFileSync(LOCALES_PATH, `${JSON.stringify(localesBeforeApply, null, 2)}\n`, 'utf8');

    const applyOutput = JSON.parse(runNode(APPLY_SCRIPT, ['--locale', locale, '--pending-dir', pendingDir]));
    assert.equal(applyOutput.locale, locale);
    assert.equal(applyOutput.outputField, 'translation');
    assert.equal(fs.existsSync(path.join(pendingDir, locale)), false);

    const sourceMain = readJson(path.join(ROOT_DIR, '.original', 'upstream', 'en-US.json'));
    const sourceDynamic = readJson(path.join(ROOT_DIR, '.original', 'upstream', 'en-US.dynamic.json'));
    const targetMain = readJson(path.join(targetDir, `${locale}.json`));
    const targetDynamic = readJson(path.join(targetDir, `${locale}.dynamic.json`));

    assert.deepEqual(Object.keys(targetMain), Object.keys(sourceMain));
    assert.deepEqual(Object.keys(targetDynamic), Object.keys(sourceDynamic));
    assert.equal(targetMain[Object.keys(sourceMain)[0]], `${sourceMain[Object.keys(sourceMain)[0]]} [fr-FR]`);

    const locales = readJson(LOCALES_PATH);
    assert.ok(locales.locales.includes(locale));
    assert.deepEqual(locales.testMetadata, { preserved: true });
  } finally {
    restoreLocales(originalLocales);
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.rmSync(pendingDir, { recursive: true, force: true });
  }
});
