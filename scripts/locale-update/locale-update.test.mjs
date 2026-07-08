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

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
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

test('prepare and apply support a generic translation output field for non-Chinese target locales', () => {
  const locale = 'es-ES';
  const pendingDir = path.join(ROOT_DIR, `.tmp-locale-update-test-${process.pid}`);
  const targetDir = path.join(ROOT_DIR, locale);

  fs.rmSync(pendingDir, { recursive: true, force: true });
  fs.rmSync(targetDir, { recursive: true, force: true });

  try {
    writeJson(path.join(pendingDir, 'source', 'en-US.json'), {
      'open.projects': 'Open all recent projects',
      'unchanged.key': 'Settings',
    });
    writeJson(path.join(pendingDir, 'source', 'en-US.dynamic.json'), {
      'dynamic.added': 'Choose a plan to continue',
    });
    writeJson(path.join(pendingDir, 'source', 'ja-JP.json'), {
      'open.projects': '最近のプロジェクトをすべて開く',
    });
    writeJson(path.join(pendingDir, 'source', 'ja-JP.dynamic.json'), {
      'dynamic.added': '続行するにはプランを選択してください',
    });

    writeJson(path.join(targetDir, `${locale}.json`), {
      'open.projects': 'Open all recent projects',
      'unchanged.key': 'Configuracion',
    });
    writeJson(path.join(targetDir, `${locale}.dynamic.json`), {});

    writeJson(path.join(pendingDir, 'manifest.json'), {
      schemaVersion: 1,
      baseLocale: 'en-US',
      referenceLocale: 'ja-JP',
      source: {
        main: {
          en: path.relative(ROOT_DIR, path.join(pendingDir, 'source', 'en-US.json')),
          ja: path.relative(ROOT_DIR, path.join(pendingDir, 'source', 'ja-JP.json')),
        },
        dynamic: {
          en: path.relative(ROOT_DIR, path.join(pendingDir, 'source', 'en-US.dynamic.json')),
          ja: path.relative(ROOT_DIR, path.join(pendingDir, 'source', 'ja-JP.dynamic.json')),
        },
      },
      diffSummary: {
        main: { add: 0, update: 1, remove: 0, total: 1 },
        dynamic: { add: 1, update: 0, remove: 0, total: 1 },
      },
    });
    writeJsonl(path.join(pendingDir, 'main.diff.jsonl'), [
      {
        file: 'main',
        op: 'update',
        index: 0,
        key: 'open.projects',
        beforeEn: 'Open recent projects',
        afterEn: 'Open all recent projects',
        afterJa: '最近のプロジェクトをすべて開く',
      },
    ]);
    writeJsonl(path.join(pendingDir, 'dynamic.diff.jsonl'), [
      {
        file: 'dynamic',
        op: 'add',
        index: 0,
        key: 'dynamic.added',
        beforeEn: null,
        afterEn: 'Choose a plan to continue',
        afterJa: '続行するにはプランを選択してください',
      },
    ]);

    runNode(PREPARE_SCRIPT, ['--locale', locale, '--pending-dir', pendingDir]);

    const workManifestPath = path.join(pendingDir, 'translation', locale, 'manifest.json');
    const workManifest = JSON.parse(fs.readFileSync(workManifestPath, 'utf8'));
    assert.equal(workManifest.outputField, 'translation');

    assertFails(
      PREPARE_SCRIPT,
      ['--locale', locale, '--pending-dir', pendingDir],
      /Refusing to delete existing translation work/,
    );

    for (const chunkInfo of [...workManifest.chunks.main, ...workManifest.chunks.dynamic]) {
      const inputRows = fs
        .readFileSync(chunkInfo.inputPath, 'utf8')
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line));
      const outputRows = inputRows.map((row) => ({
        file: row.file,
        index: row.index,
        key: row.key,
        translation:
          row.file === 'main'
            ? 'Abrir todos los proyectos recientes'
            : 'Elige un plan para continuar',
      }));
      writeJsonl(chunkInfo.outputPath, outputRows);
    }

    runNode(APPLY_SCRIPT, ['--locale', locale, '--pending-dir', pendingDir]);

    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(targetDir, `${locale}.json`), 'utf8')), {
      'open.projects': 'Abrir todos los proyectos recientes',
      'unchanged.key': 'Configuracion',
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(targetDir, `${locale}.dynamic.json`), 'utf8')), {
      'dynamic.added': 'Elige un plan para continuar',
    });
    assert.equal(fs.existsSync(pendingDir), false);
  } finally {
    fs.rmSync(pendingDir, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
});

test('build diff labels non-Japanese reference locales generically', () => {
  const tempDir = path.join(ROOT_DIR, `.tmp-locale-diff-test-${process.pid}`);
  const beforeDir = path.join(tempDir, 'before');
  const afterDir = path.join(tempDir, 'after');
  const pendingDir = path.join(tempDir, 'pending');
  const metadataPath = path.join(tempDir, 'metadata.json');
  const buildDiffScript = path.join(__dirname, 'build_diff.mjs');

  fs.rmSync(tempDir, { recursive: true, force: true });

  try {
    writeJson(path.join(beforeDir, 'en-US.json'), {
      greeting: 'Hello',
    });
    writeJson(path.join(beforeDir, 'en-US.dynamic.json'), {});

    writeJson(path.join(afterDir, 'en-US.json'), {
      greeting: 'Hello there',
      farewell: 'Goodbye',
    });
    writeJson(path.join(afterDir, 'en-US.dynamic.json'), {
      'dynamic.plan': 'Choose a plan',
    });
    writeJson(path.join(afterDir, 'de-DE.json'), {
      greeting: 'Hallo zusammen',
      farewell: 'Auf Wiedersehen',
    });
    writeJson(path.join(afterDir, 'de-DE.dynamic.json'), {
      'dynamic.plan': 'Plan auswahlen',
    });
    writeJson(metadataPath, {
      successfulLocales: ['en-US', 'de-DE'],
      failedLocales: [],
      warnings: [],
      changedFiles: ['.original/en-US.json'],
    });

    runNode(buildDiffScript, [
      '--base-locale',
      'en-US',
      '--before-dir',
      beforeDir,
      '--after-dir',
      afterDir,
      '--pending-dir',
      pendingDir,
      '--metadata',
      metadataPath,
    ]);

    const manifest = JSON.parse(fs.readFileSync(path.join(pendingDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.referenceLocale, 'de-DE');
    assert.equal(
      manifest.source.main.reference,
      path.relative(ROOT_DIR, path.join(ROOT_DIR, '.original', 'de-DE.json'))
    );
    assert.equal(manifest.source.main.ja, null);

    const mainRows = readJsonl(path.join(pendingDir, 'main.diff.jsonl'));
    assert.deepEqual(
      mainRows.map((row) => ({
        key: row.key,
        afterReference: row.afterReference,
        afterJa: row.afterJa,
      })),
      [
        { key: 'greeting', afterReference: 'Hallo zusammen', afterJa: null },
        { key: 'farewell', afterReference: 'Auf Wiedersehen', afterJa: null },
      ]
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
