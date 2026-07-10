import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from './shared.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT_DIR = path.resolve(__dirname, '..', '..');
const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

function usage() {
  throw new Error(
    'Usage: node generate_coverage.mjs --output-dir <path> [--base-locale <locale>] [--upstream-dir <path>] [--target-root <path>] [--badge-color <color>]',
  );
}

function parseArgs(argv) {
  const args = {
    baseLocale: 'en-US',
    upstreamDir: path.join(DEFAULT_ROOT_DIR, '.original'),
    targetRoot: DEFAULT_ROOT_DIR,
    outputDir: null,
    badgeColor: 'e5534b',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--base-locale' && next) {
      args.baseLocale = next;
      index += 1;
    } else if (token === '--upstream-dir' && next) {
      args.upstreamDir = path.resolve(next);
      index += 1;
    } else if (token === '--target-root' && next) {
      args.targetRoot = path.resolve(next);
      index += 1;
    } else if (token === '--output-dir' && next) {
      args.outputDir = path.resolve(next);
      index += 1;
    } else if (token === '--badge-color' && next) {
      args.badgeColor = next;
      index += 1;
    } else {
      usage();
    }
  }

  if (!args.outputDir) usage();
  if (!LOCALE_PATTERN.test(args.baseLocale)) {
    throw new Error(`Invalid base locale: ${args.baseLocale}`);
  }
  return args;
}

function readFlatObject(filePath) {
  const data = readJson(filePath);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${filePath}: expected a flat JSON object`);
  }
  return data;
}

function readLocales(targetRoot) {
  const localesPath = path.join(targetRoot, 'locales.json');
  const data = readJson(localesPath);
  if (!data || typeof data !== 'object' || !Array.isArray(data.locales)) {
    throw new Error(`${localesPath}: expected an object with a locales array`);
  }

  const locales = data.locales;
  if (locales.length === 0) {
    throw new Error(`${localesPath}: locales must not be empty`);
  }

  const seen = new Set();
  for (const locale of locales) {
    if (typeof locale !== 'string' || !LOCALE_PATTERN.test(locale)) {
      throw new Error(`${localesPath}: invalid locale ${JSON.stringify(locale)}`);
    }
    if (seen.has(locale)) {
      throw new Error(`${localesPath}: duplicate locale ${locale}`);
    }
    seen.add(locale);
  }
  return locales;
}

function coveredKeyCount(upstream, target) {
  const targetKeys = new Set(Object.keys(target));
  return Object.keys(upstream).filter((key) => targetKeys.has(key)).length;
}

function roundRatio(value) {
  return Number(value.toFixed(4));
}

function calculateCoverage(args) {
  const upstreamMain = readFlatObject(path.join(args.upstreamDir, `${args.baseLocale}.json`));
  const upstreamDynamic = readFlatObject(path.join(args.upstreamDir, `${args.baseLocale}.dynamic.json`));
  const mainTotal = Object.keys(upstreamMain).length;
  const dynamicTotal = Object.keys(upstreamDynamic).length;
  const total = mainTotal + dynamicTotal;
  if (total === 0) {
    throw new Error(`${args.upstreamDir}: upstream locale ${args.baseLocale} has no keys`);
  }

  const locales = readLocales(args.targetRoot);
  const coverage = Object.fromEntries(
    locales.map((locale) => {
      const localeDir = path.join(args.targetRoot, locale);
      const targetMain = readFlatObject(path.join(localeDir, `${locale}.json`));
      const targetDynamic = readFlatObject(path.join(localeDir, `${locale}.dynamic.json`));
      const covered = coveredKeyCount(upstreamMain, targetMain) + coveredKeyCount(upstreamDynamic, targetDynamic);
      return [locale, { covered, total, ratio: roundRatio(covered / total) }];
    }),
  );

  return {
    schemaVersion: 1,
    baseLocale: args.baseLocale,
    coverage,
  };
}

function writeArtifacts(args, payload) {
  const badgesDir = path.join(args.outputDir, 'badges');
  fs.rmSync(path.join(args.outputDir, 'coverage.json'), { force: true });
  fs.rmSync(badgesDir, { recursive: true, force: true });
  fs.mkdirSync(badgesDir, { recursive: true });
  writeJson(path.join(args.outputDir, 'coverage.json'), payload);

  for (const [locale, coverage] of Object.entries(payload.coverage)) {
    writeJson(path.join(badgesDir, `${locale}.json`), {
      schemaVersion: 1,
      label: locale,
      message: `${((coverage.covered / coverage.total) * 100).toFixed(2)}%`,
      color: args.badgeColor,
    });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const payload = calculateCoverage(args);
  writeArtifacts(args, payload);
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

main();
