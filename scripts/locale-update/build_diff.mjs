import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashJson, readJson, readJsonl, writeJson, writeJsonl } from './shared.mjs';
import {
  localeFilePath,
  readLocaleObject,
  readVerifiedBaseline,
} from './baselines.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DEFAULT_UPSTREAM_DIR = path.join(ROOT_DIR, '.original', 'upstream');
const DEFAULT_BASELINES_DIR = path.join(ROOT_DIR, '.original', 'baselines');
const DEFAULT_PENDING_DIR = path.join(ROOT_DIR, '.pending', 'locale-update');

function toRepoRelative(filePath) {
  return path.relative(ROOT_DIR, filePath).split(path.sep).join('/');
}

function usage() {
  throw new Error(
    'Usage: node build_diff.mjs --locale <locale> --base-locale <locale> --metadata <path> [--upstream-dir <path>] [--baseline-dir <path>] [--pending-dir <path>] [--reference-locale <locale|none>]',
  );
}

function parseArgs(argv) {
  const args = {
    locale: null,
    baseLocale: null,
    upstreamDir: DEFAULT_UPSTREAM_DIR,
    baselineDir: null,
    pendingDir: DEFAULT_PENDING_DIR,
    metadata: null,
    referenceLocale: undefined,
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
    } else if (token === '--upstream-dir' && next) {
      args.upstreamDir = path.resolve(next);
      index += 1;
    } else if (token === '--baseline-dir' && next) {
      args.baselineDir = path.resolve(next);
      index += 1;
    } else if (token === '--pending-dir' && next) {
      args.pendingDir = path.resolve(next);
      index += 1;
    } else if (token === '--metadata' && next) {
      args.metadata = path.resolve(next);
      index += 1;
    } else if (token === '--reference-locale' && next) {
      args.referenceLocale = /^none|null|false$/i.test(next) ? null : next;
      index += 1;
    } else {
      usage();
    }
  }

  if (!args.locale || !args.baseLocale || !args.metadata) usage();
  args.baselineDir ??= path.join(DEFAULT_BASELINES_DIR, args.locale);
  return args;
}

function discoverLocaleList(dirPath, baseLocale) {
  const mainLocales = new Set();
  const dynamicLocales = new Set();
  const localePattern = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith('.dynamic.json')) {
      const locale = entry.name.slice(0, -'.dynamic.json'.length);
      if (localePattern.test(locale)) dynamicLocales.add(locale);
    } else if (entry.name.endsWith('.json')) {
      const locale = entry.name.slice(0, -'.json'.length);
      if (localePattern.test(locale)) mainLocales.add(locale);
    }
  }

  const missingDynamic = [...mainLocales].filter((locale) => !dynamicLocales.has(locale)).sort();
  const missingMain = [...dynamicLocales].filter((locale) => !mainLocales.has(locale)).sort();
  const errors = [];
  if (!mainLocales.has(baseLocale)) errors.push(`${dirPath}: missing base locale ${baseLocale}.json`);
  if (missingDynamic.length > 0) {
    errors.push(`${dirPath}: missing dynamic files for ${missingDynamic.join(', ')}`);
  }
  if (missingMain.length > 0) {
    errors.push(`${dirPath}: missing main locale files for ${missingMain.join(', ')}`);
  }
  if (errors.length > 0) throw new Error(errors.join('\n'));

  return [baseLocale, ...[...mainLocales].filter((locale) => locale !== baseLocale).sort()];
}

function readFetchMetadata(metadataPath) {
  const metadata = readJson(metadataPath);
  return {
    successfulLocales: Array.isArray(metadata.successfulLocales) ? metadata.successfulLocales : [],
    failedLocales: Array.isArray(metadata.failedLocales) ? metadata.failedLocales : [],
    warnings: Array.isArray(metadata.warnings) ? metadata.warnings : [],
    changedFiles: Array.isArray(metadata.changedFiles) ? metadata.changedFiles : [],
  };
}

function referenceFields(referenceData, key, referenceLocale) {
  const afterReference = typeof referenceData[key] === 'string' ? referenceData[key] : null;
  return {
    afterReference,
    afterJa: /^ja(?:-|$)/i.test(referenceLocale ?? '') ? afterReference : null,
  };
}

export function buildDiffRows(fileLabel, beforeData, afterData, referenceData, referenceLocale) {
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
    } else if (beforeData[key] !== afterEn) {
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

function replaceDirectory(tempDir, targetDir) {
  const backupDir = `${targetDir}.backup-${process.pid}-${Date.now()}`;
  let backedUp = false;
  try {
    if (fs.existsSync(targetDir)) {
      fs.renameSync(targetDir, backupDir);
      backedUp = true;
    }
    fs.renameSync(tempDir, targetDir);
    if (backedUp) fs.rmSync(backupDir, { recursive: true, force: true });
  } catch (error) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    if (backedUp && fs.existsSync(backupDir)) fs.renameSync(backupDir, targetDir);
    throw error;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
}

function reusablePending(localePendingDir, expected) {
  const manifestPath = path.join(localePendingDir, 'manifest.json');
  const mainDiffPath = path.join(localePendingDir, 'main.diff.jsonl');
  const dynamicDiffPath = path.join(localePendingDir, 'dynamic.diff.jsonl');
  if (
    !fs.existsSync(manifestPath) ||
    !fs.existsSync(mainDiffPath) ||
    !fs.existsSync(dynamicDiffPath)
  ) {
    return null;
  }

  try {
    const manifest = readJson(manifestPath);
    const sameManifest =
      manifest.schemaVersion === 2 &&
      manifest.locale === expected.locale &&
      JSON.stringify(manifest.sourceHashes) === JSON.stringify(expected.sourceHashes) &&
      JSON.stringify(manifest.diffSummary) === JSON.stringify(expected.diffSummary);
    const sameRows =
      JSON.stringify(readJsonl(mainDiffPath)) === JSON.stringify(expected.mainRows) &&
      JSON.stringify(readJsonl(dynamicDiffPath)) === JSON.stringify(expected.dynamicRows);
    return sameManifest && sameRows ? manifest : null;
  } catch {
    return null;
  }
}

export function buildLocaleDiff(options) {
  const {
    locale,
    baseLocale,
    upstreamDir,
    baselineDir,
    pendingDir,
    metadata: metadataPath,
  } = options;
  const locales = discoverLocaleList(upstreamDir, baseLocale);
  const referenceLocale =
    options.referenceLocale === undefined
      ? locales.find((candidate) => candidate !== baseLocale) ?? null
      : options.referenceLocale;
  if (referenceLocale && !locales.includes(referenceLocale)) {
    throw new Error(`${upstreamDir}: missing requested reference locale ${referenceLocale}`);
  }

  const fetchMetadata = readFetchMetadata(metadataPath);
  const baseline = readVerifiedBaseline({ baselineDir, locale, baseLocale });
  const upstreamMainPath = localeFilePath(upstreamDir, baseLocale, 'main');
  const upstreamDynamicPath = localeFilePath(upstreamDir, baseLocale, 'dynamic');
  const upstreamMain = readLocaleObject(upstreamMainPath, `${baseLocale}:upstream:main`);
  const upstreamDynamic = readLocaleObject(upstreamDynamicPath, `${baseLocale}:upstream:dynamic`);
  const referenceMainPath = referenceLocale
    ? localeFilePath(upstreamDir, referenceLocale, 'main')
    : null;
  const referenceDynamicPath = referenceLocale
    ? localeFilePath(upstreamDir, referenceLocale, 'dynamic')
    : null;
  const referenceMain = referenceMainPath
    ? readLocaleObject(referenceMainPath, `${referenceLocale}:reference:main`)
    : {};
  const referenceDynamic = referenceDynamicPath
    ? readLocaleObject(referenceDynamicPath, `${referenceLocale}:reference:dynamic`)
    : {};

  const mainDiff = buildDiffRows(
    'main',
    baseline.mainData,
    upstreamMain,
    referenceMain,
    referenceLocale,
  );
  const dynamicDiff = buildDiffRows(
    'dynamic',
    baseline.dynamicData,
    upstreamDynamic,
    referenceDynamic,
    referenceLocale,
  );
  const localePendingDir = path.join(pendingDir, locale);
  const pendingTotal = mainDiff.summary.total + dynamicDiff.summary.total;
  const needsTranslation =
    mainDiff.summary.add +
      mainDiff.summary.update +
      dynamicDiff.summary.add +
      dynamicDiff.summary.update >
    0;
  const mainDiffPath = path.join(localePendingDir, 'main.diff.jsonl');
  const dynamicDiffPath = path.join(localePendingDir, 'dynamic.diff.jsonl');
  const manifestPath = path.join(localePendingDir, 'manifest.json');
  const upstreamHashes = {
    main: hashJson(upstreamMain),
    dynamic: hashJson(upstreamDynamic),
  };
  const referenceHashes = referenceLocale
    ? {
        main: hashJson(referenceMain),
        dynamic: hashJson(referenceDynamic),
      }
    : null;
  const sourceHashes = {
    baseline: baseline.hashes,
    upstream: upstreamHashes,
    reference: referenceHashes,
  };

  if (pendingTotal === 0) {
    fs.rmSync(localePendingDir, { recursive: true, force: true });
    return {
      locale,
      baseLocale,
      referenceLocale,
      pendingDir: toRepoRelative(localePendingDir),
      pendingCreated: false,
      needsTranslation: false,
      diffSummary: {
        main: mainDiff.summary,
        dynamic: dynamicDiff.summary,
      },
      sourceHashes: {
        ...sourceHashes,
      },
    };
  }

  const existingManifest = reusablePending(localePendingDir, {
    locale,
    sourceHashes,
    diffSummary: {
      main: mainDiff.summary,
      dynamic: dynamicDiff.summary,
    },
    mainRows: mainDiff.rows,
    dynamicRows: dynamicDiff.rows,
  });
  if (existingManifest) {
    return {
      locale,
      baseLocale,
      referenceLocale,
      pendingDir: toRepoRelative(localePendingDir),
      pendingCreated: true,
      needsTranslation,
      diffSummary: existingManifest.diffSummary,
      sourceHashes: existingManifest.sourceHashes,
      pendingFiles: existingManifest.pendingFiles,
      reusedPending: true,
    };
  }

  const tempDir = path.join(
    pendingDir,
    `.${locale}.tmp-${process.pid}-${Date.now()}`,
  );
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.mkdirSync(tempDir, { recursive: true });
  writeJsonl(path.join(tempDir, 'main.diff.jsonl'), mainDiff.rows);
  writeJsonl(path.join(tempDir, 'dynamic.diff.jsonl'), dynamicDiff.rows);

  const manifest = {
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
    locale,
    baseLocale,
    referenceLocale,
    cachedLocales: locales,
    successfulLocales: fetchMetadata.successfulLocales,
    failedLocales: fetchMetadata.failedLocales,
    warnings: fetchMetadata.warnings,
    changedFiles: fetchMetadata.changedFiles,
    needsTranslation,
    source: {
      baseline: {
        main: toRepoRelative(baseline.paths.main),
        dynamic: toRepoRelative(baseline.paths.dynamic),
        metadata: toRepoRelative(baseline.paths.metadata),
      },
      upstream: {
        main: toRepoRelative(upstreamMainPath),
        dynamic: toRepoRelative(upstreamDynamicPath),
      },
      reference: {
        main: referenceMainPath ? toRepoRelative(referenceMainPath) : null,
        dynamic: referenceDynamicPath ? toRepoRelative(referenceDynamicPath) : null,
      },
    },
    sourceHashes,
    output: {
      main: `${locale}/${locale}.json`,
      dynamic: `${locale}/${locale}.dynamic.json`,
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
  writeJson(path.join(tempDir, 'manifest.json'), manifest);
  fs.mkdirSync(pendingDir, { recursive: true });
  replaceDirectory(tempDir, localePendingDir);

  return {
    locale,
    baseLocale,
    referenceLocale,
    pendingDir: toRepoRelative(localePendingDir),
    pendingCreated: true,
    needsTranslation,
    diffSummary: manifest.diffSummary,
    sourceHashes: manifest.sourceHashes,
    pendingFiles: manifest.pendingFiles,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(buildLocaleDiff(args), null, 2)}\n`);
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
