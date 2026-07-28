import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  baselineTransactionEntries,
  compareKeyOrder,
  createUnverifiedMetadata,
  createVerifiedMetadata,
  localeFilePath,
  readLocaleObject,
  readVerifiedBaseline,
} from './baselines.mjs';
import {
  commitFileTransaction,
  compareMessageStructure,
  readJson,
  serializeJson,
} from './shared.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT_DIR = path.resolve(__dirname, '..', '..');

function usage() {
  throw new Error(
    'Usage: node migrate_baselines.mjs (--check|--apply) [--root <path>] [--base-locale <locale>]',
  );
}

function parseArgs(argv) {
  const args = {
    mode: null,
    rootDir: DEFAULT_ROOT_DIR,
    baseLocale: 'en-US',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--check') {
      args.mode = 'check';
    } else if (token === '--apply') {
      args.mode = 'apply';
    } else if (token === '--root' && next) {
      args.rootDir = path.resolve(next);
      index += 1;
    } else if (token === '--base-locale' && next) {
      args.baseLocale = next;
      index += 1;
    } else {
      usage();
    }
  }

  if (!args.mode) usage();
  return args;
}

function readTargetLocales(rootDir) {
  const localesPath = path.join(rootDir, 'locales.json');
  const data = readJson(localesPath);
  if (!data || typeof data !== 'object' || !Array.isArray(data.locales) || data.locales.length === 0) {
    throw new Error(`${localesPath}: expected a non-empty locales array`);
  }
  return data.locales;
}

function targetPaths(rootDir, locale) {
  return {
    main: path.join(rootDir, locale, `${locale}.json`),
    dynamic: path.join(rootDir, locale, `${locale}.dynamic.json`),
  };
}

function auditFileAgainstSource(fileLabel, sourceData, targetData) {
  const result = compareKeyOrder(sourceData, targetData);
  const structureErrors = [];
  for (const [key, sourceText] of Object.entries(sourceData)) {
    const targetText = targetData[key];
    if (typeof targetText !== 'string') continue;
    try {
      compareMessageStructure(sourceText, targetText, `${fileLabel}:${key}`);
    } catch (error) {
      structureErrors.push(error.message);
    }
  }
  return { ...result, structureErrors };
}

function auditAgainstSource(sourceMain, sourceDynamic, targetMain, targetDynamic) {
  const main = auditFileAgainstSource('main', sourceMain, targetMain);
  const dynamic = auditFileAgainstSource('dynamic', sourceDynamic, targetDynamic);
  return {
    main,
    dynamic,
    verified:
      main.missing.length === 0 &&
      main.extra.length === 0 &&
      main.orderMatches &&
      main.structureErrors.length === 0 &&
      dynamic.missing.length === 0 &&
      dynamic.extra.length === 0 &&
      dynamic.orderMatches &&
      dynamic.structureErrors.length === 0,
  };
}

export function migrateBaselines({ rootDir, baseLocale = 'en-US', mode }) {
  const upstreamDir = path.join(rootDir, '.original', 'upstream');
  const baselinesDir = path.join(rootDir, '.original', 'baselines');
  const upstreamMain = readLocaleObject(
    localeFilePath(upstreamDir, baseLocale, 'main'),
    `${baseLocale}:upstream:main`,
  );
  const upstreamDynamic = readLocaleObject(
    localeFilePath(upstreamDir, baseLocale, 'dynamic'),
    `${baseLocale}:upstream:dynamic`,
  );
  const locales = readTargetLocales(rootDir);
  const results = [];
  let hasFailure = false;

  for (const locale of locales) {
    const target = targetPaths(rootDir, locale);
    const targetMain = readLocaleObject(target.main, `${locale}:target:main`);
    const targetDynamic = readLocaleObject(target.dynamic, `${locale}:target:dynamic`);
    const baselineDir = path.join(baselinesDir, locale);

    if (mode === 'check') {
      if (!fs.existsSync(path.join(baselineDir, 'metadata.json'))) {
        hasFailure = true;
        results.push({
          locale,
          status: 'unverified',
          error: `Missing baseline metadata: ${path.join(baselineDir, 'metadata.json')}`,
        });
        continue;
      }
      try {
        const baseline = readVerifiedBaseline({ baselineDir, locale, baseLocale });
        const verification = auditAgainstSource(
          baseline.mainData,
          baseline.dynamicData,
          targetMain,
          targetDynamic,
        );
        if (!verification.verified) throw new Error(`${locale}: target files do not match the verified baseline`);
        results.push({ locale, status: 'verified', verification });
      } catch (error) {
        hasFailure = true;
        results.push({ locale, status: 'unverified', error: error.message });
      }
      continue;
    }

    const verification = auditAgainstSource(upstreamMain, upstreamDynamic, targetMain, targetDynamic);
    if (!verification.verified) {
      hasFailure = true;
      const metadata = createUnverifiedMetadata({
        locale,
        baseLocale,
        reason: 'Target locale keys do not match the current upstream snapshot',
        verification,
      });
      if (mode === 'apply') {
        commitFileTransaction([
          {
            filePath: path.join(baselineDir, 'metadata.json'),
            content: serializeJson(metadata),
          },
        ]);
      }
      results.push({ locale, status: 'unverified', verification });
      continue;
    }

    if (mode === 'apply') {
      const metadata = createVerifiedMetadata({
        locale,
        baseLocale,
        mainData: upstreamMain,
        dynamicData: upstreamDynamic,
      });
      commitFileTransaction(
        baselineTransactionEntries({
          baselineDir,
          baseLocale,
          mainData: upstreamMain,
          dynamicData: upstreamDynamic,
          metadata,
        }),
      );
    }

    results.push({ locale, status: 'verified', verification });
  }

  const summary = {
    mode,
    baseLocale,
    locales: results,
    verified: results.filter((entry) => entry.status === 'verified').length,
    unverified: results.filter((entry) => entry.status !== 'verified').length,
  };

  if (hasFailure) {
    const error = new Error('One or more locale baselines are unverified');
    error.summary = summary;
    throw error;
  }
  return summary;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    process.stdout.write(`${JSON.stringify(migrateBaselines(args), null, 2)}\n`);
  } catch (error) {
    if (error.summary) process.stderr.write(`${JSON.stringify(error.summary, null, 2)}\n`);
    throw error;
  }
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
