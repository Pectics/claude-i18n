import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureDir, readJson, readJsonl, writeJson, writeJsonl } from './shared.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DEFAULT_PENDING_DIR = path.join(ROOT_DIR, '.pending', 'locale-update');
const DEFAULT_TARGET_CHARS = 12000;
const DEFAULT_MAX_ENTRIES = 300;
const DEFAULT_MIN_ENTRIES = 50;

function toRepoRelative(filePath) {
  return path.relative(ROOT_DIR, filePath).split(path.sep).join('/');
}

function resolveRepoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(ROOT_DIR, filePath);
}

function usage() {
  throw new Error(
    'Usage: node prepare_translation.mjs --locale <locale> [--pending-dir <path>] [--target-chars <n>] [--max-entries <n>] [--min-entries <n>]'
  );
}

function parseArgs(argv) {
  const args = {
    locale: null,
    pendingDir: DEFAULT_PENDING_DIR,
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
    } else if (token === '--pending-dir' && next) {
      args.pendingDir = path.resolve(next);
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
  return args;
}

function loadPendingManifest(pendingDir) {
  const manifestPath = path.join(pendingDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing pending manifest: ${manifestPath}`);
  }
  return readJson(manifestPath);
}

function diffPathForFile(pendingDir, fileLabel) {
  return path.join(pendingDir, `${fileLabel}.diff.jsonl`);
}

function targetPathFor(locale, fileLabel) {
  const suffix = fileLabel === 'dynamic' ? '.dynamic.json' : '.json';
  return path.join(ROOT_DIR, locale, `${locale}${suffix}`);
}

function resolveSourcePath(pendingManifest, fileLabel, kind) {
  const configuredPath = pendingManifest.source?.[fileLabel]?.[kind];
  if (configuredPath) {
    return resolveRepoPath(configuredPath);
  }

  if (kind === 'en') {
    const suffix = fileLabel === 'dynamic' ? '.dynamic.json' : '.json';
    return path.join(ROOT_DIR, '.original', `${pendingManifest.baseLocale}${suffix}`);
  }

  if (kind === 'ja' && pendingManifest.referenceLocale) {
    const suffix = fileLabel === 'dynamic' ? '.dynamic.json' : '.json';
    return path.join(ROOT_DIR, '.original', `${pendingManifest.referenceLocale}${suffix}`);
  }

  return null;
}

function readTargetData(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing target locale file: ${filePath}`);
  }
  return readJson(filePath);
}

function toTranslationTask(row, targetData) {
  if (row.op === 'remove') return null;
  if (typeof row.afterEn !== 'string') {
    throw new Error(`${row.file}:${row.key}: add/update row is missing afterEn`);
  }
  if (typeof row.index !== 'number') {
    throw new Error(`${row.file}:${row.key}: add/update row is missing numeric index`);
  }

  const currentTarget = Object.prototype.hasOwnProperty.call(targetData, row.key) ? targetData[row.key] : null;
  return {
    file: row.file,
    index: row.index,
    key: row.key,
    en: row.afterEn,
    ja: typeof row.afterJa === 'string' ? row.afterJa : null,
    op: row.op,
    beforeEn: typeof row.beforeEn === 'string' ? row.beforeEn : null,
    currentTarget: typeof currentTarget === 'string' ? currentTarget : null,
  };
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
      (typeof row.ja === 'string' ? row.ja.length : 0) +
      (typeof row.currentTarget === 'string' ? row.currentTarget.length : 0);

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

function maybeCopyPromptTemplate(workDir) {
  const sourcePath = path.join(ROOT_DIR, '.translation', 'prompt-template.txt');
  const destinationPath = path.join(workDir, 'prompt-template.txt');
  if (fs.existsSync(sourcePath)) {
    fs.copyFileSync(sourcePath, destinationPath);
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
  const pendingManifest = loadPendingManifest(args.pendingDir);
  const workDir = path.join(args.pendingDir, 'translation', args.locale);
  const mainDiffRows = readJsonl(diffPathForFile(args.pendingDir, 'main'));
  const dynamicDiffRows = readJsonl(diffPathForFile(args.pendingDir, 'dynamic'));
  const targetMainPath = targetPathFor(args.locale, 'main');
  const targetDynamicPath = targetPathFor(args.locale, 'dynamic');
  const targetMainData = readTargetData(targetMainPath);
  const targetDynamicData = readTargetData(targetDynamicPath);

  fs.rmSync(workDir, { recursive: true, force: true });
  ensureDir(workDir);
  maybeCopyPromptTemplate(workDir);

  const mainTasks = mainDiffRows.map((row) => toTranslationTask(row, targetMainData)).filter(Boolean);
  const dynamicTasks = dynamicDiffRows.map((row) => toTranslationTask(row, targetDynamicData)).filter(Boolean);

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
    baseLocale: pendingManifest.baseLocale,
    referenceLocale: pendingManifest.referenceLocale,
    source: {
      main: {
        en: toRepoRelative(resolveSourcePath(pendingManifest, 'main', 'en')),
        ja: pendingManifest.referenceLocale
          ? toRepoRelative(resolveSourcePath(pendingManifest, 'main', 'ja'))
          : null,
      },
      dynamic: {
        en: toRepoRelative(resolveSourcePath(pendingManifest, 'dynamic', 'en')),
        ja: pendingManifest.referenceLocale
          ? toRepoRelative(resolveSourcePath(pendingManifest, 'dynamic', 'ja'))
          : null,
      },
    },
    diff: {
      main: toRepoRelative(diffPathForFile(args.pendingDir, 'main')),
      dynamic: toRepoRelative(diffPathForFile(args.pendingDir, 'dynamic')),
    },
    output: {
      main: toRepoRelative(targetMainPath),
      dynamic: toRepoRelative(targetDynamicPath),
    },
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

  console.log(
    JSON.stringify(
      {
        locale: args.locale,
        workDir: toRepoRelative(workDir),
        manifest: toRepoRelative(manifestPath),
        summary: manifest.summary,
      },
      null,
      2
    )
  );
}

main();
