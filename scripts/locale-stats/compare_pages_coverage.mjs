import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function usage() {
  throw new Error(
    'Usage: node compare_pages_coverage.mjs --artifact-dir <path> --base-url <url> [--cache-bust <value>]',
  );
}

function parseArgs(argv) {
  const args = { artifactDir: null, baseUrl: null, cacheBust: Date.now().toString() };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--artifact-dir' && next) {
      args.artifactDir = path.resolve(next);
      index += 1;
    } else if (token === '--base-url' && next) {
      args.baseUrl = next.replace(/\/+$/, '');
      index += 1;
    } else if (token === '--cache-bust' && next) {
      args.cacheBust = next;
      index += 1;
    } else {
      usage();
    }
  }
  if (!args.artifactDir || !args.baseUrl) usage();
  return args;
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
}

function result(changed, reason) {
  return { changed, reason };
}

export async function comparePagesCoverage({ artifactDir, baseUrl, cacheBust = Date.now().toString() }) {
  const localPath = path.join(artifactDir, 'coverage.json');
  const local = JSON.parse(fs.readFileSync(localPath, 'utf8'));
  if (
    !local ||
    typeof local !== 'object' ||
    Array.isArray(local) ||
    Object.keys(local).length === 0 ||
    Object.values(local).some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))
  ) {
    throw new Error(`${localPath}: expected a non-empty locale coverage object`);
  }

  const request = async (relativePath) => {
    const separator = relativePath.includes('?') ? '&' : '?';
    return fetch(`${baseUrl}/${relativePath}${separator}run=${encodeURIComponent(cacheBust)}`, {
      headers: { 'cache-control': 'no-cache' },
      signal: AbortSignal.timeout(30_000),
    });
  };

  try {
    const coverageResponse = await request('coverage.json');
    if (!coverageResponse.ok) return result(true, `coverage.json returned HTTP ${coverageResponse.status}`);

    const remote = await coverageResponse.json();
    if (JSON.stringify(stableJson(remote)) !== JSON.stringify(stableJson(local))) {
      return result(true, 'coverage.json differs');
    }

    for (const locale of Object.keys(local)) {
      const badgeResponse = await request(`badges/${encodeURIComponent(locale)}.svg`);
      if (!badgeResponse.ok) return result(true, `${locale} badge returned HTTP ${badgeResponse.status}`);
      const badge = await badgeResponse.text();
      if (!/<svg(?:\s|>)/i.test(badge)) return result(true, `${locale} badge is not an SVG`);
    }

    return result(false, 'published coverage and badges are current');
  } catch (error) {
    return result(true, `published Pages data is unavailable: ${error.message}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const comparison = await comparePagesCoverage(args);
  process.stdout.write(`${JSON.stringify(comparison)}\n`);
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();
