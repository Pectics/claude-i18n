import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countTarget, InvalidTargetError, readLocales, readSource, readTarget } from './locale_statistics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT_DIR = path.resolve(__dirname, '..', '..');
const README_FILES = ['README.md', 'README.zh.md', 'README.tw.md'];

function usage() {
  throw new Error('Usage: node update_readme_stats.mjs [--root <path>] [--check] [--skip-invalid-targets]');
}

function parseArgs(argv) {
  const args = { rootDir: DEFAULT_ROOT_DIR, check: false, skipInvalidTargets: false };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--root' && next) {
      args.rootDir = path.resolve(next);
      index += 1;
    } else if (token === '--check') {
      args.check = true;
    } else if (token === '--skip-invalid-targets') {
      args.skipInvalidTargets = true;
    } else {
      usage();
    }
  }

  return args;
}

function collectStatistics(rootDir, locales, statisticsOverride = {}) {
  const source = readSource(path.join(rootDir, '.original'));
  return Object.fromEntries(
    locales.map((locale) => {
      if (statisticsOverride[locale]) {
        const { main, dynamic } = statisticsOverride[locale];
        return [locale, { main, dynamic, total: main + dynamic }];
      }
      return [locale, countTarget(source, readTarget(rootDir, locale))];
    }),
  );
}

function formatCount(value) {
  return value.toLocaleString('en-US');
}

function marker(name, side) {
  return `<!-- locale-stats:${name}:${side} -->`;
}

function replaceBlock(readmePath, text, name, locales, statistics) {
  const startMarker = marker(name, 'start');
  const endMarker = marker(name, 'end');
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker);

  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`${readmePath}: missing or invalid ${name} locale statistics markers`);
  }
  if (text.indexOf(startMarker, start + startMarker.length) !== -1 || text.indexOf(endMarker, end + endMarker.length) !== -1) {
    throw new Error(`${readmePath}: duplicate ${name} locale statistics markers`);
  }

  const bodyStart = start + startMarker.length;
  const body = text.slice(bodyStart, end);
  const lines = body.split('\n');
  const localeRows = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/`([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)`/);
    if (match) localeRows.push({ index, locale: match[1] });
  }

  const actualLocales = localeRows.map((row) => row.locale);
  if (JSON.stringify(actualLocales) !== JSON.stringify(locales)) {
    throw new Error(
      `${readmePath}: ${name} locale row order ${JSON.stringify(actualLocales)} does not match locales.json ${JSON.stringify(locales)}`,
    );
  }

  for (const { index, locale } of localeRows) {
    const cells = lines[index].split('|');
    const stats = statistics[locale];
    if (name === 'summary') {
      if (cells.length !== 6) throw new Error(`${readmePath}: malformed summary row for ${locale}`);
      cells[2] = ` ${formatCount(stats.main)} `;
      cells[3] = ` ${formatCount(stats.dynamic)} `;
      cells[4] = ` ${formatCount(stats.total)} `;
    } else if (name === 'supported') {
      if (cells.length !== 7) throw new Error(`${readmePath}: malformed supported row for ${locale}`);
      cells[3] = ` ${formatCount(stats.main)} `;
      cells[4] = ` ${formatCount(stats.dynamic)} `;
    } else {
      throw new Error(`Unknown locale statistics block: ${name}`);
    }
    lines[index] = cells.join('|');
  }

  return `${text.slice(0, bodyStart)}${lines.join('\n')}${text.slice(end)}`;
}

export function buildReadmeStatsUpdates(rootDir = DEFAULT_ROOT_DIR, options = {}) {
  const locales = readLocales(rootDir);
  const statistics = collectStatistics(rootDir, locales, options.statisticsOverride);
  const changedFiles = [];
  const files = [];

  for (const relativePath of README_FILES) {
    const readmePath = path.join(rootDir, relativePath);
    const current = fs.readFileSync(readmePath, 'utf8');
    let updated = replaceBlock(readmePath, current, 'summary', locales, statistics);
    updated = replaceBlock(readmePath, updated, 'supported', locales, statistics);
    if (updated !== current) {
      changedFiles.push(relativePath);
      files.push({ relativePath, filePath: readmePath, content: updated });
    }
  }

  return { locales, statistics, changedFiles, files };
}

export function updateReadmeStats(rootDir = DEFAULT_ROOT_DIR, options = {}) {
  let result;
  try {
    result = buildReadmeStatsUpdates(rootDir, options);
  } catch (error) {
    if (options.skipInvalidTargets && error instanceof InvalidTargetError) {
      return { skipped: true, reason: error.message, changedFiles: [] };
    }
    throw error;
  }
  const { changedFiles } = result;

  if (options.check && changedFiles.length > 0) {
    throw new Error(`README locale statistics are stale: ${changedFiles.join(', ')}`);
  }

  if (!options.check) {
    for (const file of result.files) {
      fs.writeFileSync(file.filePath, file.content, 'utf8');
    }
  }

  return {
    locales: result.locales,
    statistics: result.statistics,
    changedFiles,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = updateReadmeStats(args.rootDir, { check: args.check, skipInvalidTargets: args.skipInvalidTargets });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
