import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readJson, writeJson } from './shared.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT_DIR = path.resolve(__dirname, '..', '..');

function usage() {
  throw new Error(
    'Usage: node update_coverage.mjs [--repo-root <path>] [--source-locales <path>] [--output-locales <path>] [--pending-manifest <path>]',
  );
}

function parseArgs(argv) {
  const args = {
    repoRoot: DEFAULT_ROOT_DIR,
    sourceLocales: null,
    outputLocales: null,
    pendingManifest: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--repo-root' && next) {
      args.repoRoot = path.resolve(next);
      index += 1;
    } else if (token === '--source-locales' && next) {
      args.sourceLocales = path.resolve(next);
      index += 1;
    } else if (token === '--output-locales' && next) {
      args.outputLocales = path.resolve(next);
      index += 1;
    } else if (token === '--pending-manifest' && next) {
      args.pendingManifest = path.resolve(next);
      index += 1;
    } else {
      usage();
    }
  }

  args.sourceLocales ??= path.join(args.repoRoot, 'locales.json');
  args.outputLocales ??= path.join(args.repoRoot, 'locales.json');
  args.pendingManifest ??= path.join(args.repoRoot, '.pending', 'locale-update', 'manifest.json');
  return args;
}

function assertLocalesData(data, filePath) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.locales)) {
    throw new Error(`${filePath}: expected an object with a locales array`);
  }
}

function readObjectKeys(filePath) {
  const data = readJson(filePath);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${filePath}: expected a flat JSON object`);
  }
  return Object.keys(data);
}

function readCurrentTotal(repoRoot, locale) {
  const localeDir = path.join(repoRoot, locale);
  const mainPath = path.join(localeDir, `${locale}.json`);
  const dynamicPath = path.join(localeDir, `${locale}.dynamic.json`);
  return readObjectKeys(mainPath).length + readObjectKeys(dynamicPath).length;
}

function readEntryDeltaTotals(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    return { additionTotal: 0, deletionTotal: 0 };
  }

  const manifest = readJson(manifestPath);
  const main = manifest?.diffSummary?.main ?? {};
  const dynamic = manifest?.diffSummary?.dynamic ?? {};
  const additionTotal = Number(main.add ?? 0) + Number(dynamic.add ?? 0);
  const deletionTotal = Number(main.remove ?? 0) + Number(dynamic.remove ?? 0);

  if (!Number.isFinite(additionTotal) || !Number.isFinite(deletionTotal)) {
    throw new Error(`${manifestPath}: diffSummary add/remove values must be numeric`);
  }
  return { additionTotal, deletionTotal };
}

function roundCoverage(value) {
  return Number(value.toFixed(4));
}

function coverageForCurrentTotal(currentTotal, additionTotal, deletionTotal) {
  const denominator = currentTotal - deletionTotal + additionTotal;
  if (!Number.isFinite(currentTotal) || currentTotal <= 0 || denominator <= 0) {
    return -1;
  }
  return roundCoverage(1 - additionTotal / denominator);
}

function calculateCoverage(repoRoot, locales, additionTotal, deletionTotal) {
  return Object.fromEntries(
    locales.map((locale) => {
      try {
        const currentTotal = readCurrentTotal(repoRoot, locale);
        return [locale, coverageForCurrentTotal(currentTotal, additionTotal, deletionTotal)];
      } catch {
        return [locale, -1];
      }
    }),
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const localesData = readJson(args.sourceLocales);
  assertLocalesData(localesData, args.sourceLocales);

  const locales = localesData.locales.filter((locale) => typeof locale === 'string' && locale.length > 0);
  const { additionTotal, deletionTotal } = readEntryDeltaTotals(args.pendingManifest);
  const coverage = calculateCoverage(args.repoRoot, locales, additionTotal, deletionTotal);
  const outputData = {
    ...localesData,
    locales,
    coverage,
  };

  writeJson(args.outputLocales, outputData);
  console.log(
    JSON.stringify(
      {
        locales,
        additionTotal,
        deletionTotal,
        coverage,
      },
      null,
      2,
    ),
  );
}

main();
