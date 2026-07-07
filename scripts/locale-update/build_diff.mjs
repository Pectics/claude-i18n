import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureDir, readJson, writeJson, writeJsonl } from './shared.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DEFAULT_BEFORE_DIR = path.join(ROOT_DIR, '.original');
const DEFAULT_AFTER_DIR = path.join(ROOT_DIR, '.original');
const DEFAULT_PENDING_DIR = path.join(ROOT_DIR, '.pending', 'locale-update');

function toRepoRelative(filePath) {
  return path.relative(ROOT_DIR, filePath).split(path.sep).join('/');
}

function usage() {
  throw new Error(
    'Usage: node build_diff.mjs --base-locale <locale> --metadata <path> [--before-dir <path>] [--after-dir <path>] [--pending-dir <path>]'
  );
}

function parseArgs(argv) {
  const args = {
    baseLocale: null,
    beforeDir: DEFAULT_BEFORE_DIR,
    afterDir: DEFAULT_AFTER_DIR,
    pendingDir: DEFAULT_PENDING_DIR,
    metadata: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--base-locale' && next) {
      args.baseLocale = next;
      index += 1;
    } else if (token === '--before-dir' && next) {
      args.beforeDir = path.resolve(next);
      index += 1;
    } else if (token === '--after-dir' && next) {
      args.afterDir = path.resolve(next);
      index += 1;
    } else if (token === '--pending-dir' && next) {
      args.pendingDir = path.resolve(next);
      index += 1;
    } else if (token === '--metadata' && next) {
      args.metadata = path.resolve(next);
      index += 1;
    } else {
      usage();
    }
  }

  if (!args.baseLocale) usage();
  if (!args.metadata) usage();
  return args;
}

function discoverLocaleList(dirPath, baseLocale) {
  const mainLocales = new Set();
  const dynamicLocales = new Set();
  const localePattern = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (!entry.isFile()) continue;

    const { name } = entry;
    if (name.endsWith('.dynamic.json')) {
      const locale = name.slice(0, -'.dynamic.json'.length);
      if (localePattern.test(locale)) dynamicLocales.add(locale);
    } else if (name.endsWith('.json')) {
      const locale = name.slice(0, -'.json'.length);
      if (localePattern.test(locale)) mainLocales.add(locale);
    }
  }

  const missingDynamic = [...mainLocales].filter((locale) => !dynamicLocales.has(locale)).sort();
  const missingMain = [...dynamicLocales].filter((locale) => !mainLocales.has(locale)).sort();
  const errors = [];

  if (!mainLocales.has(baseLocale)) {
    errors.push(`${dirPath}: missing base locale ${baseLocale}.json`);
  }
  if (missingDynamic.length > 0) {
    errors.push(`${dirPath}: missing dynamic files for ${missingDynamic.join(', ')}`);
  }
  if (missingMain.length > 0) {
    errors.push(`${dirPath}: missing main locale files for ${missingMain.join(', ')}`);
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  return [baseLocale, ...[...mainLocales].filter((locale) => locale !== baseLocale).sort()];
}

function readMetadata(metadataPath) {
  const metadata = readJson(metadataPath);
  return {
    successfulLocales: Array.isArray(metadata.successfulLocales) ? metadata.successfulLocales : [],
    failedLocales: Array.isArray(metadata.failedLocales) ? metadata.failedLocales : [],
    warnings: Array.isArray(metadata.warnings) ? metadata.warnings : [],
    changedFiles: Array.isArray(metadata.changedFiles) ? metadata.changedFiles : [],
  };
}

function localeFilePath(dirPath, locale, kind) {
  const suffix = kind === 'dynamic' ? '.dynamic.json' : '.json';
  return path.join(dirPath, `${locale}${suffix}`);
}

function readLocaleObject(filePath, label) {
  const data = readJson(filePath);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${label}: expected a flat JSON object`);
  }
  return data;
}

function maybeReadLocaleObject(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return readLocaleObject(filePath, filePath);
}

function maybeReferenceValue(data, key) {
  const value = data[key];
  return typeof value === "string" ? value : null;
}

function isJapaneseLocale(locale) {
  return typeof locale === 'string' && /^ja(?:-|$)/i.test(locale);
}

function referenceFields(referenceData, key, referenceLocale) {
  const afterReference = maybeReferenceValue(referenceData, key);
  return {
    afterReference,
    afterJa: isJapaneseLocale(referenceLocale) ? afterReference : null,
  };
}

function buildDiffRows(fileLabel, beforeData, afterData, referenceData, referenceLocale) {
  const beforeKeys = Object.keys(beforeData);
  const afterKeys = Object.keys(afterData);
  const afterKeySet = new Set(afterKeys);
  const beforeKeySet = new Set(beforeKeys);
  const rows = [];
  const summary = { add: 0, update: 0, remove: 0, total: 0 };

  for (const key of beforeKeys) {
    if (!afterKeySet.has(key)) {
      rows.push({
        file: fileLabel,
        op: 'remove',
        index: null,
        key,
        beforeEn: beforeData[key],
        afterEn: null,
        afterReference: null,
        afterJa: null,
      });
      summary.remove += 1;
      summary.total += 1;
    }
  }

  afterKeys.forEach((key, index) => {
    const afterEn = afterData[key];
    if (typeof afterEn !== 'string') {
      throw new Error(`${fileLabel}: source en value for ${key} is not a string`);
    }

    if (!beforeKeySet.has(key)) {
      rows.push({
        file: fileLabel,
        op: 'add',
        index,
        key,
        beforeEn: null,
        afterEn,
        ...referenceFields(referenceData, key, referenceLocale),
      });
      summary.add += 1;
      summary.total += 1;
      return;
    }

    if (beforeData[key] !== afterEn) {
      rows.push({
        file: fileLabel,
        op: 'update',
        index,
        key,
        beforeEn: beforeData[key],
        afterEn,
        ...referenceFields(referenceData, key, referenceLocale),
      });
      summary.update += 1;
      summary.total += 1;
    }
  });

  return { rows, summary };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseLocale = args.baseLocale;
  const locales = discoverLocaleList(args.afterDir, baseLocale);
  const referenceLocale = locales.length > 1 ? locales[1] : null;
  const metadata = readMetadata(args.metadata);

  const beforeMain = maybeReadLocaleObject(localeFilePath(args.beforeDir, baseLocale, 'main'));
  const afterMain = readLocaleObject(localeFilePath(args.afterDir, baseLocale, 'main'), `${baseLocale}:main`);
  const beforeDynamic = maybeReadLocaleObject(localeFilePath(args.beforeDir, baseLocale, 'dynamic'));
  const afterDynamic = readLocaleObject(localeFilePath(args.afterDir, baseLocale, 'dynamic'), `${baseLocale}:dynamic`);

  const afterReferenceMain = referenceLocale
    ? maybeReadLocaleObject(localeFilePath(args.afterDir, referenceLocale, 'main'))
    : {};
  const afterReferenceDynamic = referenceLocale
    ? maybeReadLocaleObject(localeFilePath(args.afterDir, referenceLocale, 'dynamic'))
    : {};

  const mainDiff = buildDiffRows('main', beforeMain, afterMain, afterReferenceMain, referenceLocale);
  const dynamicDiff = buildDiffRows('dynamic', beforeDynamic, afterDynamic, afterReferenceDynamic, referenceLocale);
  const needsTranslation =
    mainDiff.summary.add + mainDiff.summary.update + dynamicDiff.summary.add + dynamicDiff.summary.update > 0;

  fs.rmSync(args.pendingDir, { recursive: true, force: true });
  ensureDir(args.pendingDir);

  const mainDiffPath = path.join(args.pendingDir, 'main.diff.jsonl');
  const dynamicDiffPath = path.join(args.pendingDir, 'dynamic.diff.jsonl');
  writeJsonl(mainDiffPath, mainDiff.rows);
  writeJsonl(dynamicDiffPath, dynamicDiff.rows);

  const manifestPath = path.join(args.pendingDir, 'manifest.json');
  const manifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    baseLocale,
    referenceLocale,
    cachedLocales: locales,
    successfulLocales: metadata.successfulLocales,
    failedLocales: metadata.failedLocales,
    warnings: metadata.warnings,
    changedFiles: metadata.changedFiles,
    needsTranslation,
    source: {
      main: {
        base: toRepoRelative(path.join(ROOT_DIR, '.original', `${baseLocale}.json`)),
        reference: referenceLocale ? toRepoRelative(path.join(ROOT_DIR, '.original', `${referenceLocale}.json`)) : null,
        en: toRepoRelative(path.join(ROOT_DIR, '.original', `${baseLocale}.json`)),
        ja: isJapaneseLocale(referenceLocale)
          ? toRepoRelative(path.join(ROOT_DIR, '.original', `${referenceLocale}.json`))
          : null,
      },
      dynamic: {
        base: toRepoRelative(path.join(ROOT_DIR, '.original', `${baseLocale}.dynamic.json`)),
        reference: referenceLocale ? toRepoRelative(path.join(ROOT_DIR, '.original', `${referenceLocale}.dynamic.json`)) : null,
        en: toRepoRelative(path.join(ROOT_DIR, '.original', `${baseLocale}.dynamic.json`)),
        ja: isJapaneseLocale(referenceLocale)
          ? toRepoRelative(path.join(ROOT_DIR, '.original', `${referenceLocale}.dynamic.json`))
          : null,
      },
    },
    pendingFiles: {
      manifest: toRepoRelative(manifestPath),
      mainDiff: toRepoRelative(mainDiffPath),
      dynamicDiff: toRepoRelative(dynamicDiffPath),
    },
    diffSummary: {
      main: mainDiff.summary,
      dynamic: dynamicDiff.summary,
    },
  };

  writeJson(manifestPath, manifest);

  const summary = {
    baseLocale,
    referenceLocale,
    pendingDir: toRepoRelative(args.pendingDir),
    pendingCreated: true,
    needsTranslation,
    diffSummary: manifest.diffSummary,
    pendingFiles: manifest.pendingFiles,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main();
