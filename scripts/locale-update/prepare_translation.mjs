import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensureDir,
  ensureFreshWorkDir,
  readJson,
  readJsonl,
  writeJson,
  writeJsonl,
} from './shared.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DEFAULT_PENDING_DIR = path.join(ROOT_DIR, '.pending', 'locale-update');
const DEFAULT_TARGET_CHARS = 12000;
const DEFAULT_MAX_ENTRIES = 300;
const DEFAULT_MIN_ENTRIES = 50;
const DEFAULT_OUTPUT_FIELD = 'translation';
const RESERVED_OUTPUT_FIELDS = new Set([
  'beforeEn',
  'currentTarget',
  'en',
  'file',
  'index',
  'ja',
  'key',
  'op',
  'reference',
]);

function toRepoRelative(filePath) {
  return path.relative(ROOT_DIR, filePath).split(path.sep).join('/');
}

function resolveRepoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(ROOT_DIR, filePath);
}

function usage() {
  throw new Error(
    'Usage: node prepare_translation.mjs --locale <locale> [--pending-dir <path>] [--output-field <field>] [--target-chars <n>] [--max-entries <n>] [--min-entries <n>]',
  );
}

function parseArgs(argv) {
  const args = {
    locale: null,
    pendingDir: DEFAULT_PENDING_DIR,
    targetChars: DEFAULT_TARGET_CHARS,
    maxEntries: DEFAULT_MAX_ENTRIES,
    minEntries: DEFAULT_MIN_ENTRIES,
    outputField: DEFAULT_OUTPUT_FIELD,
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
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(args.outputField)) {
    throw new Error(`Invalid output field: ${args.outputField}`);
  }
  if (RESERVED_OUTPUT_FIELDS.has(args.outputField)) {
    throw new Error(`Output field conflicts with input metadata field: ${args.outputField}`);
  }
  return args;
}

function localePendingDir(pendingDir, locale) {
  return path.join(pendingDir, locale);
}

function loadPendingManifest(pendingDir, locale) {
  const manifestPath = path.join(localePendingDir(pendingDir, locale), 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing pending manifest for ${locale}: ${manifestPath}`);
  }
  const manifest = readJson(manifestPath);
  if (manifest.schemaVersion !== 2) {
    throw new Error(`${manifestPath}: unsupported schema version ${manifest.schemaVersion}`);
  }
  if (manifest.locale !== locale) {
    throw new Error(`${manifestPath}: manifest locale ${manifest.locale} does not match ${locale}`);
  }
  return { manifestPath, manifest };
}

function readTargetData(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing target locale file: ${filePath}`);
  }
  return readJson(filePath);
}

function isJapaneseLocale(locale) {
  return typeof locale === 'string' && /^ja(?:-|$)/i.test(locale);
}

function toTranslationTask(row, targetData, referenceLocale) {
  if (row.op === 'remove') return null;
  if (typeof row.afterEn !== 'string') {
    throw new Error(`${row.file}:${row.key}: add/update row is missing afterEn`);
  }
  if (typeof row.index !== 'number') {
    throw new Error(`${row.file}:${row.key}: add/update row is missing numeric index`);
  }

  const currentTarget = Object.prototype.hasOwnProperty.call(targetData, row.key)
    ? targetData[row.key]
    : null;
  const reference =
    typeof row.afterReference === 'string'
      ? row.afterReference
      : typeof row.afterJa === 'string'
        ? row.afterJa
        : null;
  const task = {
    file: row.file,
    index: row.index,
    key: row.key,
    en: row.afterEn,
    reference,
    op: row.op,
    beforeEn: typeof row.beforeEn === 'string' ? row.beforeEn : null,
    currentTarget: typeof currentTarget === 'string' ? currentTarget : null,
  };
  if (isJapaneseLocale(referenceLocale)) task.ja = reference;
  return task;
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
      (typeof row.ja === 'string' ? row.ja.length : 0) +
      (typeof row.currentTarget === 'string' ? row.currentTarget.length : 0);
    const shouldFlush =
      currentRows.length > 0 &&
      currentRows.length >= options.minEntries &&
      (currentRows.length >= options.maxEntries ||
        currentChars + rowChars > options.targetChars);
    if (shouldFlush) flush();
    currentRows.push(row);
    currentChars += rowChars;
  }

  flush();
  return chunks;
}

function maybeCopyPromptTemplate(workDir) {
  const sourcePath = path.join(ROOT_DIR, '.translation', 'prompt-template.txt');
  if (fs.existsSync(sourcePath)) {
    fs.copyFileSync(sourcePath, path.join(workDir, 'prompt-template.txt'));
  }
}

function summarizeDiff(rows) {
  const summary = { add: 0, update: 0, remove: 0, total: rows.length };
  for (const row of rows) {
    if (row.op === 'add') summary.add += 1;
    else if (row.op === 'update') summary.update += 1;
    else if (row.op === 'remove') summary.remove += 1;
  }
  return summary;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { manifestPath: pendingManifestPath, manifest: pendingManifest } =
    loadPendingManifest(args.pendingDir, args.locale);
  const localeDir = localePendingDir(args.pendingDir, args.locale);
  const workDir = path.join(localeDir, 'translation');
  const mainDiffRows = readJsonl(resolveRepoPath(pendingManifest.pendingFiles.mainDiff));
  const dynamicDiffRows = readJsonl(
    resolveRepoPath(pendingManifest.pendingFiles.dynamicDiff),
  );
  const targetMainPath = resolveRepoPath(pendingManifest.output.main);
  const targetDynamicPath = resolveRepoPath(pendingManifest.output.dynamic);
  const targetMainData = readTargetData(targetMainPath);
  const targetDynamicData = readTargetData(targetDynamicPath);

  ensureFreshWorkDir(workDir, 'locale-update translation work directory');
  maybeCopyPromptTemplate(workDir);

  const mainTasks = mainDiffRows
    .map((row) => toTranslationTask(row, targetMainData, pendingManifest.referenceLocale))
    .filter(Boolean);
  const dynamicTasks = dynamicDiffRows
    .map((row) =>
      toTranslationTask(row, targetDynamicData, pendingManifest.referenceLocale),
    )
    .filter(Boolean);
  const mainChunks = buildChunks('main', mainTasks, workDir, args);
  const dynamicChunks = buildChunks('dynamic', dynamicTasks, workDir, args);
  const manifestPath = path.join(workDir, 'manifest.json');
  const manifest = {
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
    root: '.',
    pendingDir: toRepoRelative(localeDir),
    workDir: toRepoRelative(workDir),
    locale: args.locale,
    outputField: args.outputField,
    baseLocale: pendingManifest.baseLocale,
    referenceLocale: pendingManifest.referenceLocale,
    pendingManifest: toRepoRelative(pendingManifestPath),
    source: pendingManifest.source,
    sourceHashes: pendingManifest.sourceHashes,
    diff: {
      main: pendingManifest.pendingFiles.mainDiff,
      dynamic: pendingManifest.pendingFiles.dynamicDiff,
    },
    output: pendingManifest.output,
    chunkSizing: {
      targetChars: args.targetChars,
      maxEntries: args.maxEntries,
      minEntries: args.minEntries,
    },
    diffSummary: pendingManifest.diffSummary,
    summary: {
      main: {
        ...summarizeDiff(mainDiffRows),
        tasks: mainTasks.length,
        chunks: mainChunks.length,
      },
      dynamic: {
        ...summarizeDiff(dynamicDiffRows),
        tasks: dynamicTasks.length,
        chunks: dynamicChunks.length,
      },
    },
    chunks: {
      main: mainChunks,
      dynamic: dynamicChunks,
    },
  };
  writeJson(manifestPath, manifest);

  process.stdout.write(
    `${JSON.stringify(
      {
        locale: args.locale,
        pendingDir: toRepoRelative(localeDir),
        workDir: toRepoRelative(workDir),
        manifest: toRepoRelative(manifestPath),
        outputField: args.outputField,
        summary: manifest.summary,
      },
      null,
      2,
    )}\n`,
  );
}

main();
