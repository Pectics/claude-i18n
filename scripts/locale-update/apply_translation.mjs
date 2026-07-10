import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  compareMessageStructure,
  ensureDir,
  hasKana,
  hasObviousUntranslatedEnglish,
  readJson,
  readJsonl,
  shouldCheckObviousUntranslatedEnglish,
  shouldRejectJapaneseKana,
  writeJson,
} from './shared.mjs';
import { updateReadmeStats } from './update_readme_stats.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DEFAULT_PENDING_DIR = path.join(ROOT_DIR, '.pending', 'locale-update');
const LEGACY_OUTPUT_FIELD = 'zh';

function resolveRepoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(ROOT_DIR, filePath);
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
  return LEGACY_OUTPUT_FIELD;
}

function validateChunk(inputRows, outputRows, label, options) {
  if (inputRows.length !== outputRows.length) {
    throw new Error(`${label}: row count mismatch (${outputRows.length} vs ${inputRows.length})`);
  }

  for (let index = 0; index < inputRows.length; index += 1) {
    const inputRow = inputRows[index];
    const outputRow = outputRows[index];
    const rowLabel = `${label}#${index + 1} (${inputRow.key})`;

    if (inputRow.file !== outputRow.file || inputRow.index !== outputRow.index || inputRow.key !== outputRow.key) {
      throw new Error(`${rowLabel}: file/index/key mismatch`);
    }
    const translated = outputRow[options.outputField];
    if (typeof translated !== 'string' || translated.trim() === '') {
      throw new Error(`${rowLabel}: ${options.outputField} is empty or not a string`);
    }
    if (translated.includes('�')) {
      throw new Error(`${rowLabel}: contains replacement character`);
    }
    if (/\bTODO\b/i.test(translated)) {
      throw new Error(`${rowLabel}: contains TODO`);
    }
    if (shouldRejectJapaneseKana(options.targetLocale) && hasKana(translated)) {
      throw new Error(`${rowLabel}: contains Japanese kana`);
    }
    if (shouldCheckObviousUntranslatedEnglish(options.targetLocale) && hasObviousUntranslatedEnglish(translated)) {
      throw new Error(`${rowLabel}: looks like untranslated English`);
    }

    compareMessageStructure(inputRow.en, translated, rowLabel);
  }
}

function loadWorkManifest(pendingDir, locale) {
  const manifestPath = path.join(pendingDir, 'translation', locale, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing translation manifest: ${manifestPath}`);
  }
  return readJson(manifestPath);
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

function rebuildLocaleFile(fileLabel, baseData, currentTargetData, diffRows, translations) {
  const diffMap = new Map(diffRows.map((row) => [row.key, row]));
  const result = {};

  for (const [index, key] of Object.keys(baseData).entries()) {
    const diffRow = diffMap.get(key);
    if (diffRow) {
      if (diffRow.op === 'add' || diffRow.op === 'update') {
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
      if (diffRow.op !== 'remove') {
        throw new Error(`${fileLabel}:${key}: unsupported diff operation ${diffRow.op}`);
      }
    }

    if (!Object.prototype.hasOwnProperty.call(currentTargetData, key) || typeof currentTargetData[key] !== 'string') {
      throw new Error(`${fileLabel}:${key}: missing existing target value for unchanged key`);
    }
    result[key] = currentTargetData[key];
  }

  const expectedTranslationCount = diffRows.filter((row) => row.op === 'add' || row.op === 'update').length;
  if (translations.size !== expectedTranslationCount) {
    throw new Error(
      `${fileLabel}: translated key count mismatch (${translations.size} vs expected ${expectedTranslationCount})`
    );
  }

  return result;
}

function baseSourcePathFor(workManifest, fileLabel) {
  const sourceConfig = workManifest.source?.[fileLabel] ?? {};
  return sourceConfig.base ?? sourceConfig.en;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const pendingManifest = readJson(path.join(args.pendingDir, 'manifest.json'));
  const workManifest = loadWorkManifest(args.pendingDir, args.locale);
  const outputField = outputFieldFor(workManifest);
  const mainDiffRows = readJsonl(path.join(args.pendingDir, 'main.diff.jsonl'));
  const dynamicDiffRows = readJsonl(path.join(args.pendingDir, 'dynamic.diff.jsonl'));

  const baseMainData = readJson(resolveRepoPath(baseSourcePathFor(workManifest, 'main')));
  const baseDynamicData = readJson(resolveRepoPath(baseSourcePathFor(workManifest, 'dynamic')));
  const currentMainData = readJson(resolveRepoPath(workManifest.output.main));
  const currentDynamicData = readJson(resolveRepoPath(workManifest.output.dynamic));

  const validationOptions = {
    outputField,
    targetLocale: workManifest.locale ?? args.locale,
  };
  const mainTranslations = collectTranslations(workManifest.chunks.main, 'main', validationOptions);
  const dynamicTranslations = collectTranslations(workManifest.chunks.dynamic, 'dynamic', validationOptions);

  const nextMainData = rebuildLocaleFile(
    'main',
    baseMainData,
    currentMainData,
    mainDiffRows,
    mainTranslations
  );
  const nextDynamicData = rebuildLocaleFile(
    'dynamic',
    baseDynamicData,
    currentDynamicData,
    dynamicDiffRows,
    dynamicTranslations
  );

  const outputMainPath = resolveRepoPath(workManifest.output.main);
  const outputDynamicPath = resolveRepoPath(workManifest.output.dynamic);
  ensureDir(path.dirname(outputMainPath));
  ensureDir(path.dirname(outputDynamicPath));
  writeJson(outputMainPath, nextMainData);
  writeJson(outputDynamicPath, nextDynamicData);

  const readmeStats = updateReadmeStats(ROOT_DIR);

  fs.rmSync(args.pendingDir, { recursive: true, force: true });

  console.log(
    JSON.stringify(
      {
        locale: args.locale,
        baseLocale: pendingManifest.baseLocale,
        outputField,
        main: Object.keys(nextMainData).length,
        dynamic: Object.keys(nextDynamicData).length,
        updatedReadmes: readmeStats.changedFiles,
        clearedPendingDir: args.pendingDir,
      },
      null,
      2
    )
  );
}

main();
