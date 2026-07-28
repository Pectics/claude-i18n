import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  createVerifiedMetadata,
  readVerifiedBaseline,
} from './baselines.mjs';
import { hasObviousUntranslatedEnglish } from './shared.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const BUILD_SCRIPT = path.join(__dirname, 'build_diff.mjs');
const PREPARE_SCRIPT = path.join(__dirname, 'prepare_translation.mjs');
const APPLY_SCRIPT = path.join(__dirname, 'apply_translation.mjs');
const MIGRATE_SCRIPT = path.join(__dirname, 'migrate_baselines.mjs');

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonl(filePath) {
  const text = fs.readFileSync(filePath, 'utf8').trim();
  return text ? text.split(/\r?\n/).map((line) => JSON.parse(line)) : [];
}

function runNode(scriptPath, args) {
  return execFileSync(process.execPath, [scriptPath, ...args], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
  });
}

function runNodeJson(scriptPath, args) {
  return JSON.parse(runNode(scriptPath, args));
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

function tempDir() {
  return fs.mkdtempSync(path.join(ROOT_DIR, '.tmp-locale-update-test-'));
}

function writeBaseline(baselineDir, locale, mainData, dynamicData, baseLocale = 'en-US') {
  writeJson(path.join(baselineDir, `${baseLocale}.json`), mainData);
  writeJson(path.join(baselineDir, `${baseLocale}.dynamic.json`), dynamicData);
  writeJson(
    path.join(baselineDir, 'metadata.json'),
    createVerifiedMetadata({
      locale,
      baseLocale,
      mainData,
      dynamicData,
      updatedAt: '2026-07-28T00:00:00.000Z',
    }),
  );
}

function writeUpstream(upstreamDir, mainData, dynamicData, reference = {}) {
  writeJson(path.join(upstreamDir, 'en-US.json'), mainData);
  writeJson(path.join(upstreamDir, 'en-US.dynamic.json'), dynamicData);
  writeJson(path.join(upstreamDir, 'ja-JP.json'), reference.main ?? {});
  writeJson(path.join(upstreamDir, 'ja-JP.dynamic.json'), reference.dynamic ?? {});
}

function writeFetchMetadata(filePath) {
  writeJson(filePath, {
    successfulLocales: ['en-US', 'ja-JP'],
    failedLocales: [],
    warnings: [],
    changedFiles: ['.original/upstream/en-US.json'],
  });
}

function buildArgs({ locale, upstreamDir, baselineDir, pendingDir, metadataPath }) {
  return [
    '--locale',
    locale,
    '--base-locale',
    'en-US',
    '--upstream-dir',
    upstreamDir,
    '--baseline-dir',
    baselineDir,
    '--pending-dir',
    pendingDir,
    '--metadata',
    metadataPath,
  ];
}

function writeChunkOutputs(workManifest, translations) {
  for (const chunkInfo of [
    ...workManifest.chunks.main,
    ...workManifest.chunks.dynamic,
  ]) {
    const rows = readJsonl(chunkInfo.inputPath);
    writeJsonl(
      chunkInfo.outputPath,
      rows.map((row) => ({
        file: row.file,
        index: row.index,
        key: row.key,
        translation: translations[row.key] ?? `${row.en} traducido`,
      })),
    );
  }
}

test('untranslated-English detection allows comma-separated technical identifiers', () => {
  assert.equal(hasObviousUntranslatedEnglish('context,repos,issues,pull_requests'), false);
  assert.equal(hasObviousUntranslatedEnglish('Choose a plan to continue'), true);
});

test('per-locale baselines recover historical updates missed by only one locale', () => {
  const root = tempDir();
  try {
    const upstreamDir = path.join(root, 'upstream');
    const pendingDir = path.join(root, 'pending');
    const metadataPath = path.join(root, 'fetch.json');
    writeUpstream(
      upstreamDir,
      {
        stable: 'Stable',
        historical: 'Historical update',
        latest: 'Latest update',
      },
      {},
      {
        main: {
          stable: '安定',
          historical: '過去の更新',
          latest: '最新の更新',
        },
      },
    );
    writeFetchMetadata(metadataPath);

    const cnBaseline = path.join(root, 'baselines', 'zh-CN');
    const twBaseline = path.join(root, 'baselines', 'zh-TW');
    writeBaseline(
      cnBaseline,
      'zh-CN',
      { stable: 'Stable', historical: 'Historical update' },
      {},
    );
    writeBaseline(twBaseline, 'zh-TW', { stable: 'Stable' }, {});

    runNodeJson(
      BUILD_SCRIPT,
      buildArgs({
        locale: 'zh-CN',
        upstreamDir,
        baselineDir: cnBaseline,
        pendingDir,
        metadataPath,
      }),
    );
    runNodeJson(
      BUILD_SCRIPT,
      buildArgs({
        locale: 'zh-TW',
        upstreamDir,
        baselineDir: twBaseline,
        pendingDir,
        metadataPath,
      }),
    );

    assert.deepEqual(
      readJsonl(path.join(pendingDir, 'zh-CN', 'main.diff.jsonl')).map((row) => row.key),
      ['latest'],
    );
    assert.deepEqual(
      readJsonl(path.join(pendingDir, 'zh-TW', 'main.diff.jsonl')).map((row) => row.key),
      ['historical', 'latest'],
    );
    const twManifest = readJson(path.join(pendingDir, 'zh-TW', 'manifest.json'));
    assert.equal(twManifest.schemaVersion, 2);
    assert.equal(twManifest.locale, 'zh-TW');
    assert.match(twManifest.sourceHashes.baseline.main, /^[a-f0-9]{64}$/);
    assert.match(twManifest.sourceHashes.upstream.main, /^[a-f0-9]{64}$/);

    writeJson(path.join(pendingDir, 'zh-TW', 'translation', 'sentinel.json'), {
      preserved: true,
    });
    const reused = runNodeJson(
      BUILD_SCRIPT,
      buildArgs({
        locale: 'zh-TW',
        upstreamDir,
        baselineDir: twBaseline,
        pendingDir,
        metadataPath,
      }),
    );
    assert.equal(reused.reusedPending, true);
    assert.deepEqual(
      readJson(path.join(pendingDir, 'zh-TW', 'translation', 'sentinel.json')),
      { preserved: true },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('apply advances one locale baseline and preserves sibling pending work', () => {
  const root = tempDir();
  const locale = 'es-ES';
  const targetDir = path.join(ROOT_DIR, locale);
  try {
    const upstreamDir = path.join(root, 'upstream');
    const baselineDir = path.join(root, 'baselines', locale);
    const pendingDir = path.join(root, 'pending');
    const metadataPath = path.join(root, 'fetch.json');
    writeUpstream(
      upstreamDir,
      { keep: 'Keep', added: 'New value' },
      { dynamicOld: 'Changed dynamic', dynamicAdded: 'New dynamic' },
    );
    writeBaseline(
      baselineDir,
      locale,
      { keep: 'Keep', removed: 'Remove me' },
      { dynamicOld: 'Old dynamic' },
    );
    writeFetchMetadata(metadataPath);
    writeJson(path.join(targetDir, `${locale}.json`), {
      keep: 'Conservar',
      removed: 'Eliminar',
    });
    writeJson(path.join(targetDir, `${locale}.dynamic.json`), {
      dynamicOld: 'Dinámico anterior',
    });

    runNodeJson(
      BUILD_SCRIPT,
      buildArgs({
        locale,
        upstreamDir,
        baselineDir,
        pendingDir,
        metadataPath,
      }),
    );
    writeJson(path.join(pendingDir, 'fr-FR', 'sentinel.json'), { preserved: true });
    runNodeJson(PREPARE_SCRIPT, ['--locale', locale, '--pending-dir', pendingDir]);
    const workManifest = readJson(
      path.join(pendingDir, locale, 'translation', 'manifest.json'),
    );
    writeChunkOutputs(workManifest, {
      added: 'Valor nuevo',
      dynamicOld: 'Dinámico cambiado',
      dynamicAdded: 'Dinámico nuevo',
    });

    const applyResult = runNodeJson(APPLY_SCRIPT, [
      '--locale',
      locale,
      '--pending-dir',
      pendingDir,
    ]);
    assert.deepEqual(readJson(path.join(targetDir, `${locale}.json`)), {
      keep: 'Conservar',
      added: 'Valor nuevo',
    });
    assert.deepEqual(readJson(path.join(targetDir, `${locale}.dynamic.json`)), {
      dynamicOld: 'Dinámico cambiado',
      dynamicAdded: 'Dinámico nuevo',
    });
    assert.equal(fs.existsSync(path.join(pendingDir, locale)), false);
    assert.deepEqual(readJson(path.join(pendingDir, 'fr-FR', 'sentinel.json')), {
      preserved: true,
    });

    const baseline = readVerifiedBaseline({
      baselineDir,
      locale,
      baseLocale: 'en-US',
    });
    assert.deepEqual(baseline.mainData, readJson(path.join(upstreamDir, 'en-US.json')));
    assert.deepEqual(
      baseline.dynamicData,
      readJson(path.join(upstreamDir, 'en-US.dynamic.json')),
    );
    assert.deepEqual(applyResult.baselineHashes, baseline.hashes);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
});

test('stale upstream and baseline hashes reject apply without changing targets or pending work', async (t) => {
  function fixture() {
    const root = tempDir();
    const locale = 'es-ES';
    const targetDir = path.join(ROOT_DIR, locale);
    const upstreamDir = path.join(root, 'upstream');
    const baselineDir = path.join(root, 'baselines', locale);
    const pendingDir = path.join(root, 'pending');
    const metadataPath = path.join(root, 'fetch.json');
    writeUpstream(upstreamDir, { stable: 'Stable', added: 'Added' }, {});
    writeBaseline(baselineDir, locale, { stable: 'Stable' }, {});
    writeFetchMetadata(metadataPath);
    writeJson(path.join(targetDir, `${locale}.json`), { stable: 'Estable' });
    writeJson(path.join(targetDir, `${locale}.dynamic.json`), {});
    runNodeJson(
      BUILD_SCRIPT,
      buildArgs({
        locale,
        upstreamDir,
        baselineDir,
        pendingDir,
        metadataPath,
      }),
    );
    runNodeJson(PREPARE_SCRIPT, ['--locale', locale, '--pending-dir', pendingDir]);
    const workManifest = readJson(
      path.join(pendingDir, locale, 'translation', 'manifest.json'),
    );
    writeChunkOutputs(workManifest, { added: 'Añadido' });
    return { root, locale, targetDir, upstreamDir, baselineDir, pendingDir };
  }

  await t.test('upstream hash conflict', () => {
    const data = fixture();
    try {
      const targetBefore = fs.readFileSync(
        path.join(data.targetDir, `${data.locale}.json`),
        'utf8',
      );
      const baselineBefore = fs.readFileSync(
        path.join(data.baselineDir, 'en-US.json'),
        'utf8',
      );
      writeJson(path.join(data.upstreamDir, 'en-US.json'), {
        stable: 'Stable',
        added: 'Changed after prepare',
      });
      assertFails(
        APPLY_SCRIPT,
        ['--locale', data.locale, '--pending-dir', data.pendingDir],
        /Upstream main hash conflict/,
      );
      assert.equal(
        fs.readFileSync(path.join(data.targetDir, `${data.locale}.json`), 'utf8'),
        targetBefore,
      );
      assert.equal(
        fs.readFileSync(path.join(data.baselineDir, 'en-US.json'), 'utf8'),
        baselineBefore,
      );
      assert.equal(fs.existsSync(path.join(data.pendingDir, data.locale)), true);
    } finally {
      fs.rmSync(data.root, { recursive: true, force: true });
      fs.rmSync(data.targetDir, { recursive: true, force: true });
    }
  });

  await t.test('baseline hash conflict', () => {
    const data = fixture();
    try {
      const targetBefore = fs.readFileSync(
        path.join(data.targetDir, `${data.locale}.json`),
        'utf8',
      );
      writeJson(path.join(data.baselineDir, 'en-US.json'), {
        stable: 'Baseline changed after prepare',
      });
      assertFails(
        APPLY_SCRIPT,
        ['--locale', data.locale, '--pending-dir', data.pendingDir],
        /baseline hash or key count is stale/,
      );
      assert.equal(
        fs.readFileSync(path.join(data.targetDir, `${data.locale}.json`), 'utf8'),
        targetBefore,
      );
      assert.equal(fs.existsSync(path.join(data.pendingDir, data.locale)), true);
    } finally {
      fs.rmSync(data.root, { recursive: true, force: true });
      fs.rmSync(data.targetDir, { recursive: true, force: true });
    }
  });
});

test('baseline migration verifies complete locales and rejects incomplete or structurally invalid locales', () => {
  const verifiedRoot = tempDir();
  const incompleteRoot = tempDir();
  const invalidStructureRoot = tempDir();
  try {
    for (const root of [verifiedRoot, incompleteRoot, invalidStructureRoot]) {
      writeJson(path.join(root, 'locales.json'), { locales: ['xy-ZZ'] });
      writeUpstream(
        path.join(root, '.original', 'upstream'),
        { first: 'First', second: 'Hello {name}' },
        { dynamic: 'Dynamic' },
      );
      writeJson(path.join(root, 'xy-ZZ', 'xy-ZZ.dynamic.json'), {
        dynamic: 'Dinámico',
      });
    }
    writeJson(path.join(verifiedRoot, 'xy-ZZ', 'xy-ZZ.json'), {
      first: 'Primero',
      second: 'Segundo {name}',
    });
    writeJson(path.join(incompleteRoot, 'xy-ZZ', 'xy-ZZ.json'), {
      first: 'Primero',
    });
    writeJson(path.join(invalidStructureRoot, 'xy-ZZ', 'xy-ZZ.json'), {
      first: 'Primero',
      second: 'Hola',
    });

    const applied = runNodeJson(MIGRATE_SCRIPT, ['--apply', '--root', verifiedRoot]);
    assert.equal(applied.verified, 1);
    const checked = runNodeJson(MIGRATE_SCRIPT, ['--check', '--root', verifiedRoot]);
    assert.equal(checked.unverified, 0);
    assert.equal(
      readJson(
        path.join(
          verifiedRoot,
          '.original',
          'baselines',
          'xy-ZZ',
          'metadata.json',
        ),
      ).status,
      'verified',
    );

    assertFails(
      MIGRATE_SCRIPT,
      ['--apply', '--root', incompleteRoot],
      /One or more locale baselines are unverified/,
    );
    assert.equal(
      readJson(
        path.join(
          incompleteRoot,
          '.original',
          'baselines',
          'xy-ZZ',
          'metadata.json',
        ),
      ).status,
      'unverified',
    );

    assertFails(
      MIGRATE_SCRIPT,
      ['--apply', '--root', invalidStructureRoot],
      /One or more locale baselines are unverified/,
    );
    const invalidMetadata = readJson(
      path.join(
        invalidStructureRoot,
        '.original',
        'baselines',
        'xy-ZZ',
        'metadata.json',
      ),
    );
    assert.equal(invalidMetadata.status, 'unverified');
    assert.match(
      invalidMetadata.verification.main.structureErrors[0],
      /brace structure changed/,
    );
  } finally {
    fs.rmSync(verifiedRoot, { recursive: true, force: true });
    fs.rmSync(incompleteRoot, { recursive: true, force: true });
    fs.rmSync(invalidStructureRoot, { recursive: true, force: true });
  }
});
