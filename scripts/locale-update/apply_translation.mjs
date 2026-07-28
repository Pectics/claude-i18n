import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareMessageStructure,
  commitFileTransaction,
  hashJson,
  hasKana,
  hasObviousUntranslatedEnglish,
  readJson,
  readJsonl,
  serializeJson,
  shouldCheckObviousUntranslatedEnglish,
  shouldRejectJapaneseKana,
} from './shared.mjs';
import {
  baselineTransactionEntries,
  createVerifiedMetadata,
  readLocaleObject,
  readVerifiedBaseline,
} from './baselines.mjs';
import { buildReadmeStatsUpdates } from './update_readme_stats.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DEFAULT_PENDING_DIR = path.join(ROOT_DIR, '.pending', 'locale-update');

function resolveRepoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(ROOT_DIR, filePath);
}

function toRepoRelative(filePath) {
  return path.relative(ROOT_DIR, filePath).split(path.sep).join('/');
}

function usage() {
  throw new Error('Usage: node apply_translation.mjs --locale <locale> [--pending-dir <path>]');
}

function parseArgs(argv) {
  const args = {
    locale: null,
    pendingDir: DEFAULT_PENDING_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--locale' && next) {
      args.locale = next;
      index += 1;
    } else if (token === '--pending-dir' && next) {
      args.pendingDir = path.resolve(next);
      index += 1;
    } else {
      usage();
    }
  }

  if (!args.locale) usage();
  return args;
}

function outputFieldFor(workManifest) {
  if (typeof workManifest.outputField === 'string' && workManifest.outputField.trim() !== '') {
    return workManifest.outputField;
  }
  return 'translation';
}

function validateChunk(inputRows, outputRows, label, options) {
  if (inputRows.length !== outputRows.length) {
    throw new Error(`${label}: row count mismatch (${outputRows.length} vs ${inputRows.length})`);
  }

  for (let index = 0; index < inputRows.length; index += 1) {
    const inputRow = inputRows[index];
    const outputRow = outputRows[index];
    const rowLabel = `${label}#${index + 1} (${inputRow.key})`;
    if (
      inputRow.file !== outputRow.file ||
      inputRow.index !== outputRow.index ||
      inputRow.key !== outputRow.key
    ) {
      throw new Error(`${rowLabel}: file/index/key mismatch`);
    }

    const translated = outputRow[options.outputField];
    if (typeof translated !== 'string' || translated.trim() === '') {
      throw new Error(`${rowLabel}: ${options.outputField} is empty or not a string`);
    }
    if (translated.includes('�')) throw new Error(`${rowLabel}: contains replacement character`);
    if (/\bTODO\b/i.test(translated)) throw new Error(`${rowLabel}: contains TODO`);
    if (shouldRejectJapaneseKana(options.targetLocale) && hasKana(translated)) {
      throw new Error(`${rowLabel}: contains Japanese kana`);
    }
    if (
      shouldCheckObviousUntranslatedEnglish(options.targetLocale) &&
      hasObviousUntranslatedEnglish(translated)
    ) {
      throw new Error(`${rowLabel}: looks like untranslated English`);
    }
    compareMessageStructure(inputRow.en, translated, rowLabel);
  }
}

function collectTranslations(chunkInfos, fileLabel, options) {
  const translations = new Map();
  for (const chunkInfo of chunkInfos) {
    const inputRows = readJsonl(chunkInfo.inputPath);
    if (!fs.existsSync(chunkInfo.outputPath)) {
      throw new Error(`Missing translated chunk: ${chunkInfo.outputPath}`);
    }
    const outputRows = readJsonl(chunkInfo.outputPath);
    validateChunk(inputRows, outputRows, path.basename(chunkInfo.outputPath), options);
    for (const row of outputRows) {
      if (translations.has(row.key)) {
        throw new Error(`${fileLabel}: duplicate translated key ${row.key}`);
      }
      translations.set(row.key, row[options.outputField]);
    }
  }
  return translations;
}

function rebuildLocaleFile(fileLabel, upstreamData, currentTargetData, diffRows, translations) {
  const diffMap = new Map();
  for (const row of diffRows) {
    if (diffMap.has(row.key)) throw new Error(`${fileLabel}: duplicate diff key ${row.key}`);
    diffMap.set(row.key, row);
  }

  const result = {};
  for (const [index, key] of Object.keys(upstreamData).entries()) {
    const diffRow = diffMap.get(key);
    if (diffRow?.op === 'add' || diffRow?.op === 'update') {
      if (diffRow.index !== index) {
        throw new Error(`${fileLabel}:${key}: diff index mismatch (${diffRow.index} vs ${index})`);
      }
      const translated = translations.get(key);
      if (typeof translated !== 'string' || translated.length === 0) {
        throw new Error(`${fileLabel}:${key}: missing translated value`);
      }
      result[key] = translated;
      continue;
    }
    if (diffRow && diffRow.op !== 'remove') {
      throw new Error(`${fileLabel}:${key}: unsupported diff operation ${diffRow.op}`);
    }
    if (
      !Object.prototype.hasOwnProperty.call(currentTargetData, key) ||
      typeof currentTargetData[key] !== 'string'
    ) {
      throw new Error(`${fileLabel}:${key}: missing existing target value for unchanged key`);
    }
    result[key] = currentTargetData[key];
  }

  const expectedTranslationCount = diffRows.filter(
    (row) => row.op === 'add' || row.op === 'update',
  ).length;
  if (translations.size !== expectedTranslationCount) {
    throw new Error(
      `${fileLabel}: translated key count mismatch (${translations.size} vs expected ${expectedTranslationCount})`,
    );
  }
  return result;
}

function assertHashes(label, expected, actual) {
  for (const fileLabel of ['main', 'dynamic']) {
    if (expected?.[fileLabel] !== actual[fileLabel]) {
      throw new Error(
        `${label} ${fileLabel} hash conflict: expected ${expected?.[fileLabel] ?? 'missing'}, got ${actual[fileLabel]}`,
      );
    }
  }
}

function loadManifests(pendingDir, locale) {
  const localeDir = path.join(pendingDir, locale);
  const pendingManifestPath = path.join(localeDir, 'manifest.json');
  const workManifestPath = path.join(localeDir, 'translation', 'manifest.json');
  if (!fs.existsSync(pendingManifestPath)) {
    throw new Error(`Missing pending manifest for ${locale}: ${pendingManifestPath}`);
  }
  if (!fs.existsSync(workManifestPath)) {
    throw new Error(`Missing translation manifest for ${locale}: ${workManifestPath}`);
  }

  const pendingManifest = readJson(pendingManifestPath);
  const workManifest = readJson(workManifestPath);
  for (const [label, manifest] of [
    ['pending', pendingManifest],
    ['translation', workManifest],
  ]) {
    if (manifest.schemaVersion !== 2) {
      throw new Error(`${label} manifest has unsupported schema version ${manifest.schemaVersion}`);
    }
    if (manifest.locale !== locale) {
      throw new Error(`${label} manifest locale ${manifest.locale} does not match ${locale}`);
    }
  }
  if (JSON.stringify(workManifest.sourceHashes) !== JSON.stringify(pendingManifest.sourceHashes)) {
    throw new Error('Translation manifest source hashes do not match the pending manifest');
  }

  return { localeDir, pendingManifest, workManifest };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { localeDir, pendingManifest, workManifest } = loadManifests(
    args.pendingDir,
    args.locale,
  );
  const outputField = outputFieldFor(workManifest);
  const baselineMainPath = resolveRepoPath(pendingManifest.source.baseline.main);
  const baselineDir = path.dirname(baselineMainPath);
  const baseline = readVerifiedBaseline({
    baselineDir,
    locale: args.locale,
    baseLocale: pendingManifest.baseLocale,
  });
  if (
    path.resolve(resolveRepoPath(pendingManifest.source.baseline.dynamic)) !==
      path.resolve(baseline.paths.dynamic) ||
    path.resolve(resolveRepoPath(pendingManifest.source.baseline.metadata)) !==
      path.resolve(baseline.paths.metadata)
  ) {
    throw new Error('Pending manifest baseline paths do not refer to one baseline directory');
  }
  assertHashes('Baseline', pendingManifest.sourceHashes.baseline, baseline.hashes);

  const upstreamMain = readLocaleObject(
    resolveRepoPath(pendingManifest.source.upstream.main),
    `${pendingManifest.baseLocale}:upstream:main`,
  );
  const upstreamDynamic = readLocaleObject(
    resolveRepoPath(pendingManifest.source.upstream.dynamic),
    `${pendingManifest.baseLocale}:upstream:dynamic`,
  );
  const upstreamHashes = {
    main: hashJson(upstreamMain),
    dynamic: hashJson(upstreamDynamic),
  };
  assertHashes('Upstream', pendingManifest.sourceHashes.upstream, upstreamHashes);

  const mainDiffRows = readJsonl(resolveRepoPath(pendingManifest.pendingFiles.mainDiff));
  const dynamicDiffRows = readJsonl(
    resolveRepoPath(pendingManifest.pendingFiles.dynamicDiff),
  );
  const currentMainData = readLocaleObject(
    resolveRepoPath(pendingManifest.output.main),
    `${args.locale}:target:main`,
  );
  const currentDynamicData = readLocaleObject(
    resolveRepoPath(pendingManifest.output.dynamic),
    `${args.locale}:target:dynamic`,
  );
  const validationOptions = {
    outputField,
    targetLocale: workManifest.locale,
  };
  const mainTranslations = collectTranslations(
    workManifest.chunks.main,
    'main',
    validationOptions,
  );
  const dynamicTranslations = collectTranslations(
    workManifest.chunks.dynamic,
    'dynamic',
    validationOptions,
  );
  const nextMainData = rebuildLocaleFile(
    'main',
    upstreamMain,
    currentMainData,
    mainDiffRows,
    mainTranslations,
  );
  const nextDynamicData = rebuildLocaleFile(
    'dynamic',
    upstreamDynamic,
    currentDynamicData,
    dynamicDiffRows,
    dynamicTranslations,
  );

  const nextMetadata = createVerifiedMetadata({
    locale: args.locale,
    baseLocale: pendingManifest.baseLocale,
    mainData: upstreamMain,
    dynamicData: upstreamDynamic,
    previousMetadata: baseline.metadata,
  });
  const outputMainPath = resolveRepoPath(pendingManifest.output.main);
  const outputDynamicPath = resolveRepoPath(pendingManifest.output.dynamic);
  const readmeUpdates = buildReadmeStatsUpdates(ROOT_DIR, {
    statisticsOverride: {
      [args.locale]: {
        main: Object.keys(nextMainData).length,
        dynamic: Object.keys(nextDynamicData).length,
      },
    },
  });
  const transactionEntries = [
    { filePath: outputMainPath, content: serializeJson(nextMainData) },
    { filePath: outputDynamicPath, content: serializeJson(nextDynamicData) },
    ...baselineTransactionEntries({
      baselineDir,
      baseLocale: pendingManifest.baseLocale,
      mainData: upstreamMain,
      dynamicData: upstreamDynamic,
      metadata: nextMetadata,
    }),
    ...readmeUpdates.files.map((file) => ({
      filePath: file.filePath,
      content: file.content,
    })),
  ];

  commitFileTransaction(transactionEntries);
  fs.rmSync(localeDir, { recursive: true, force: true });

  process.stdout.write(
    `${JSON.stringify(
      {
        locale: args.locale,
        baseLocale: pendingManifest.baseLocale,
        outputField,
        main: Object.keys(nextMainData).length,
        dynamic: Object.keys(nextDynamicData).length,
        baselineHashes: upstreamHashes,
        updatedReadmes: readmeUpdates.changedFiles,
        clearedPendingDir: toRepoRelative(localeDir),
      },
      null,
      2,
    )}\n`,
  );
}

main();
