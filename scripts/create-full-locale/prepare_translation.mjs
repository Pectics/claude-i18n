import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureDir, ensureFreshWorkDir, readJson, readLocaleObject, writeJson, writeJsonl } from './shared.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DEFAULT_PENDING_DIR = path.join(ROOT_DIR, '.pending', 'create-full-locale');
const DEFAULT_BASE_LOCALE = 'en-US';
const DEFAULT_REFERENCE_LOCALE = 'ja-JP';
const DEFAULT_CONTEXT_LOCALE = 'zh-CN';
const DEFAULT_TARGET_CHARS = 12000;
const DEFAULT_MAX_ENTRIES = 300;
const DEFAULT_MIN_ENTRIES = 50;
const DEFAULT_OUTPUT_FIELD = 'translation';
const RESERVED_OUTPUT_FIELDS = new Set([
  'context',
  'en',
  'file',
  'index',
  'ja',
  'key',
  'op',
  'reference',
]);

function usage() {
  throw new Error(
    'Usage: node prepare_translation.mjs --locale <locale> [--base-locale en-US] [--reference-locale ja-JP|none] [--context-locale zh-CN] [--pending-dir <path>] [--output-field translation] [--target-chars <n>] [--max-entries <n>] [--min-entries <n>]',
  );
}

function parseArgs(argv) {
  const args = {
    locale: null,
    baseLocale: DEFAULT_BASE_LOCALE,
    referenceLocale: DEFAULT_REFERENCE_LOCALE,
    contextLocale: DEFAULT_CONTEXT_LOCALE,
    pendingDir: DEFAULT_PENDING_DIR,
    outputField: DEFAULT_OUTPUT_FIELD,
    targetChars: DEFAULT_TARGET_CHARS,
    maxEntries: DEFAULT_MAX_ENTRIES,
    minEntries: DEFAULT_MIN_ENTRIES,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--locale' && next) {
      args.locale = next;
      index += 1;
    } else if (token === '--base-locale' && next) {
      args.baseLocale = next;
      index += 1;
    } else if (token === '--reference-locale' && next) {
      args.referenceLocale = /^none|null|false$/i.test(next) ? null : next;
      index += 1;
    } else if (token === '--context-locale' && next) {
      args.contextLocale = next;
      index += 1;
    } else if (token === '--pending-dir' && next) {
      args.pendingDir = path.resolve(next);
      index += 1;
    } else if (token === '--output-field' && next) {
      args.outputField = next;
      index += 1;
    } else if (token === '--target-chars' && next) {
      args.targetChars = Number.parseInt(next, 10);
      index += 1;
    } else if (token === '--max-entries' && next) {
      args.maxEntries = Number.parseInt(next, 10);
      index += 1;
    } else if (token === '--min-entries' && next) {
      args.minEntries = Number.parseInt(next, 10);
      index += 1;
    } else {
      usage();
    }
  }

  if (!args.locale) usage();
  validateLocaleTag(args.locale, 'target');
  validateLocaleTag(args.baseLocale, 'base');
  if (args.referenceLocale) validateLocaleTag(args.referenceLocale, 'reference');
  validateLocaleTag(args.contextLocale, 'context');
  validateOutputField(args.outputField);
  validatePositiveInteger(args.targetChars, '--target-chars');
  validatePositiveInteger(args.maxEntries, '--max-entries');
  validatePositiveInteger(args.minEntries, '--min-entries');
  return args;
}

function validatePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function validateLocaleTag(locale, role) {
  if (!/^[a-z]{2,3}-[A-Z]{2}$/.test(locale)) {
    throw new Error(`Invalid ${role} locale: ${locale}. Use canonical language-region tags like fr-FR.`);
  }
}

function validateOutputField(outputField) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(outputField)) {
    throw new Error(`Invalid output field: ${outputField}`);
  }
  if (RESERVED_OUTPUT_FIELDS.has(outputField)) {
    throw new Error(`Output field conflicts with input metadata field: ${outputField}`);
  }
}

function toRepoRelative(filePath) {
  return path.relative(ROOT_DIR, filePath).split(path.sep).join('/');
}

function localeFilePath(locale, fileLabel, location) {
  const suffix = fileLabel === 'dynamic' ? '.dynamic.json' : '.json';
  if (location === 'original') {
    return path.join(ROOT_DIR, '.original', 'upstream', `${locale}${suffix}`);
  }
  return path.join(ROOT_DIR, locale, `${locale}${suffix}`);
}

function assertFileExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
}

function readSourceData(locale, fileLabel, role) {
  const location = role === 'context' ? 'root' : 'original';
  const filePath = localeFilePath(locale, fileLabel, location);
  assertFileExists(filePath, `${role} locale file`);
  return {
    filePath,
    data: readLocaleObject(filePath, `${role}:${locale}:${fileLabel}`),
  };
}

function readOptionalReferenceData(locale, fileLabel) {
  if (!locale) return { filePath: null, data: {} };
  const filePath = localeFilePath(locale, fileLabel, 'original');
  assertFileExists(filePath, 'reference locale file');
  const data = readJson(filePath);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`reference:${locale}:${fileLabel}: expected a flat JSON object`);
  }
  return { filePath, data };
}

function isJapaneseLocale(locale) {
  return typeof locale === 'string' && /^ja(?:-|$)/i.test(locale);
}

function readLocalesList() {
  const localesPath = path.join(ROOT_DIR, 'locales.json');
  assertFileExists(localesPath, 'locales.json');
  const data = readJson(localesPath);
  if (!data || typeof data !== 'object' || !Array.isArray(data.locales)) {
    throw new Error(`${localesPath}: expected an object with a locales array`);
  }
  return data.locales;
}

function assertTargetIsNew(locale) {
  const targetDir = path.join(ROOT_DIR, locale);
  if (fs.existsSync(targetDir)) {
    throw new Error(`Target locale already exists at ${targetDir}`);
  }

  if (readLocalesList().includes(locale)) {
    throw new Error(`Target locale ${locale} is already listed in locales.json`);
  }
}

function valueOrNull(data, key) {
  return typeof data[key] === 'string' ? data[key] : null;
}

function buildTasks(fileLabel, baseData, referenceData, contextData, referenceLocale) {
  return Object.keys(baseData).map((key, index) => {
    const reference = valueOrNull(referenceData, key);
    const task = {
      file: fileLabel,
      op: 'add',
      index,
      key,
      en: baseData[key],
      reference,
      context: valueOrNull(contextData, key),
    };
    if (isJapaneseLocale(referenceLocale)) {
      task.ja = reference;
    }
    return task;
  });
}

function buildChunks(fileLabel, rows, workDir, options) {
  const chunkDir = path.join(workDir, 'chunks', fileLabel);
  const outDir = path.join(workDir, 'out', fileLabel);
  ensureDir(chunkDir);
  ensureDir(outDir);

  const chunks = [];
  let currentRows = [];
  let currentChars = 0;

  function flush() {
    if (currentRows.length === 0) return;
    const chunkNumber = String(chunks.length + 1).padStart(4, '0');
    const chunkName = `chunk-${chunkNumber}.jsonl`;
    const inputPath = path.join(chunkDir, chunkName);
    const outputPath = path.join(outDir, chunkName);
    writeJsonl(inputPath, currentRows);
    chunks.push({
      file: fileLabel,
      chunk: chunks.length + 1,
      count: currentRows.length,
      sourceStart: currentRows[0].index,
      sourceEnd: currentRows[currentRows.length - 1].index,
      approxChars: currentChars,
      inputPath,
      outputPath,
    });
    currentRows = [];
    currentChars = 0;
  }

  for (const row of rows) {
    const rowChars =
      row.en.length +
      (typeof row.reference === 'string' ? row.reference.length : 0) +
      (typeof row.context === 'string' ? row.context.length : 0);
    const shouldFlush =
      currentRows.length > 0 &&
      currentRows.length >= options.minEntries &&
      (currentRows.length >= options.maxEntries || currentChars + rowChars > options.targetChars);

    if (shouldFlush) flush();
    currentRows.push(row);
    currentChars += rowChars;
  }

  flush();
  return chunks;
}

function summarize(rows, chunks) {
  return {
    tasks: rows.length,
    chunks: chunks.length,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  assertTargetIsNew(args.locale);

  const baseMain = readSourceData(args.baseLocale, 'main', 'base');
  const baseDynamic = readSourceData(args.baseLocale, 'dynamic', 'base');
  const referenceMain = readOptionalReferenceData(args.referenceLocale, 'main');
  const referenceDynamic = readOptionalReferenceData(args.referenceLocale, 'dynamic');
  const contextMain = readSourceData(args.contextLocale, 'main', 'context');
  const contextDynamic = readSourceData(args.contextLocale, 'dynamic', 'context');

  const workDir = path.join(args.pendingDir, args.locale);
  ensureFreshWorkDir(workDir, 'create-full-locale work directory');

  const mainTasks = buildTasks('main', baseMain.data, referenceMain.data, contextMain.data, args.referenceLocale);
  const dynamicTasks = buildTasks(
    'dynamic',
    baseDynamic.data,
    referenceDynamic.data,
    contextDynamic.data,
    args.referenceLocale,
  );
  const mainChunks = buildChunks('main', mainTasks, workDir, args);
  const dynamicChunks = buildChunks('dynamic', dynamicTasks, workDir, args);

  const manifestPath = path.join(workDir, 'manifest.json');
  const manifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    root: '.',
    pendingDir: toRepoRelative(args.pendingDir),
    workDir: toRepoRelative(workDir),
    locale: args.locale,
    outputField: args.outputField,
    baseLocale: args.baseLocale,
    referenceLocale: args.referenceLocale,
    contextLocale: args.contextLocale,
    source: {
      main: {
        base: toRepoRelative(baseMain.filePath),
        reference: referenceMain.filePath ? toRepoRelative(referenceMain.filePath) : null,
        context: toRepoRelative(contextMain.filePath),
        en: toRepoRelative(baseMain.filePath),
        ja: isJapaneseLocale(args.referenceLocale) && referenceMain.filePath ? toRepoRelative(referenceMain.filePath) : null,
      },
      dynamic: {
        base: toRepoRelative(baseDynamic.filePath),
        reference: referenceDynamic.filePath ? toRepoRelative(referenceDynamic.filePath) : null,
        context: toRepoRelative(contextDynamic.filePath),
        en: toRepoRelative(baseDynamic.filePath),
        ja:
          isJapaneseLocale(args.referenceLocale) && referenceDynamic.filePath
            ? toRepoRelative(referenceDynamic.filePath)
            : null,
      },
    },
    output: {
      main: toRepoRelative(localeFilePath(args.locale, 'main', 'root')),
      dynamic: toRepoRelative(localeFilePath(args.locale, 'dynamic', 'root')),
    },
    chunkSizing: {
      targetChars: args.targetChars,
      maxEntries: args.maxEntries,
      minEntries: args.minEntries,
    },
    summary: {
      main: summarize(mainTasks, mainChunks),
      dynamic: summarize(dynamicTasks, dynamicChunks),
    },
    chunks: {
      main: mainChunks,
      dynamic: dynamicChunks,
    },
  };

  writeJson(manifestPath, manifest);
  console.log(
    JSON.stringify(
      {
        locale: args.locale,
        workDir: toRepoRelative(workDir),
        manifest: toRepoRelative(manifestPath),
        outputField: args.outputField,
        summary: manifest.summary,
      },
      null,
      2,
    ),
  );
}

main();
