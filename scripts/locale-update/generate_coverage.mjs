import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from './shared.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT_DIR = path.resolve(__dirname, '..', '..');
const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const BADGE_COLORS = {
  green: '4c1',
  yellow: 'dfb317',
  red: 'e5534b',
  invalid: '9f9f9f',
};

function usage() {
  throw new Error(
    'Usage: node generate_coverage.mjs --output-dir <path> [--base-locale <locale>] [--upstream-dir <path>] [--target-root <path>] [--curl-bin <path>] [--shields-base-url <url>]',
  );
}

function parseArgs(argv) {
  const args = {
    baseLocale: 'en-US',
    upstreamDir: path.join(DEFAULT_ROOT_DIR, '.original'),
    targetRoot: DEFAULT_ROOT_DIR,
    outputDir: null,
    curlBin: 'curl',
    shieldsBaseUrl: 'https://img.shields.io',
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
    } else if (token === '--curl-bin' && next) {
      args.curlBin = next;
      index += 1;
    } else if (token === '--shields-base-url' && next) {
      args.shieldsBaseUrl = next.replace(/\/+$/, '');
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
  return Object.fromEntries(
    locales.map((locale) => {
      try {
        const localeDir = path.join(args.targetRoot, locale);
        const targetMain = readFlatObject(path.join(localeDir, `${locale}.json`));
        const targetDynamic = readFlatObject(path.join(localeDir, `${locale}.dynamic.json`));
        const covered = coveredKeyCount(upstreamMain, targetMain) + coveredKeyCount(upstreamDynamic, targetDynamic);
        return [locale, { covered, total, ratio: roundRatio(covered / total) }];
      } catch {
        return [locale, { covered: null, total, ratio: null }];
      }
    }),
  );
}

function badgePresentation(coverage) {
  if (!Number.isInteger(coverage.covered) || coverage.covered < 0 || coverage.total <= 0) {
    return { message: 'invalid', color: BADGE_COLORS.invalid };
  }

  const ratio = coverage.covered / coverage.total;
  const message = `${(ratio * 100).toFixed(2)}%`;
  if (ratio >= 0.9) return { message, color: BADGE_COLORS.green };
  if (ratio >= 0.75) return { message, color: BADGE_COLORS.yellow };
  return { message, color: BADGE_COLORS.red };
}

function badgeUrl(args, locale, coverage) {
  const escapedLocale = locale.replaceAll('_', '__').replaceAll('-', '--');
  const { message, color } = badgePresentation(coverage);
  return `${args.shieldsBaseUrl}/badge/${escapedLocale}-${encodeURIComponent(message)}-${color}`;
}

function downloadBadge(args, locale, coverage, outputPath) {
  const url = badgeUrl(args, locale, coverage);
  const result = spawnSync(
    args.curlBin,
    [
      '--fail',
      '--silent',
      '--show-error',
      '--location',
      '--retry',
      '3',
      '--retry-delay',
      '1',
      '--connect-timeout',
      '10',
      '--max-time',
      '30',
      '--output',
      outputPath,
      url,
    ],
    { encoding: 'utf8' },
  );

  if (result.error || result.status !== 0) {
    fs.rmSync(outputPath, { force: true });
    const detail = result.error?.message || result.stderr?.trim() || `exit ${result.status}`;
    throw new Error(`Failed to download ${locale} badge: ${detail}`);
  }

  const svg = fs.readFileSync(outputPath, 'utf8');
  if (!/<svg(?:\s|>)/i.test(svg)) {
    fs.rmSync(outputPath, { force: true });
    throw new Error(`Downloaded ${locale} badge is not an SVG`);
  }
}

function writeArtifacts(args, coverageByLocale) {
  const badgesDir = path.join(args.outputDir, 'badges');
  const stagingBadgesDir = path.join(args.outputDir, `.badges-${process.pid}`);
  fs.rmSync(stagingBadgesDir, { recursive: true, force: true });
  fs.mkdirSync(stagingBadgesDir, { recursive: true });

  try {
    for (const [locale, coverage] of Object.entries(coverageByLocale)) {
      downloadBadge(args, locale, coverage, path.join(stagingBadgesDir, `${locale}.svg`));
    }

    fs.rmSync(badgesDir, { recursive: true, force: true });
    fs.renameSync(stagingBadgesDir, badgesDir);
    writeJson(path.join(args.outputDir, 'coverage.json'), coverageByLocale);
  } catch (error) {
    fs.rmSync(stagingBadgesDir, { recursive: true, force: true });
    throw error;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const coverageByLocale = calculateCoverage(args);
  writeArtifacts(args, coverageByLocale);
  process.stdout.write(`${JSON.stringify(coverageByLocale, null, 2)}\n`);
}

main();
