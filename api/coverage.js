const fs = require('node:fs/promises');
const path = require('node:path');

const REPO_OWNER = 'Pectics';
const REPO_NAME = 'claude-i18n';
const UPDATE_BRANCH = 'bot/locale-update';
const MAIN_BRANCH = 'main';
const GITHUB_API = 'https://api.github.com';
const DEFAULT_TIMEOUT_MS = 8000;

function githubHeaders(accept) {
  const headers = {
    accept,
    'user-agent': 'claude-i18n-coverage',
    'x-github-api-version': '2022-11-28',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

async function githubFetch(url, options = {}) {
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is not available in this runtime');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: options.headers,
      signal: controller.signal,
    });
    return {
      ok: response.ok,
      status: response.status,
      text: await response.text(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function localLocalesPath() {
  return path.join(__dirname, '..', 'locales.json');
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label}: invalid JSON: ${error.message}`);
  }
}

function readLocaleKeys(localesData) {
  if (!localesData || typeof localesData !== 'object' || !Array.isArray(localesData.locales)) {
    throw new Error('locales.json: expected an object with a locales array');
  }
  return localesData.locales.filter((locale) => typeof locale === 'string' && locale.length > 0);
}

function invalidCoverageFor(locales) {
  return Object.fromEntries(locales.map((locale) => [locale, -1]));
}

function normalizeMode(query) {
  const mode = query.mode;
  const shortMode = query.m;

  if (mode === 'fix') return 'fix';
  if (mode === 'percentage') return 'percentage';
  if (mode !== undefined) return 'default';
  if (shortMode === '*') return 'fix';
  if (shortMode === '%') return 'percentage';
  return 'default';
}

function queryFromUrl(reqUrl) {
  const parsed = new URL(reqUrl || '/coverage', 'http://localhost');
  return Object.fromEntries(parsed.searchParams.entries());
}

function isValidCoverageValue(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function selectCoverage(locales, sourceCoverage) {
  if (!sourceCoverage || typeof sourceCoverage !== 'object' || Array.isArray(sourceCoverage)) {
    return invalidCoverageFor(locales);
  }

  return Object.fromEntries(
    locales.map((locale) => {
      const value = sourceCoverage[locale];
      return [locale, isValidCoverageValue(value) ? value : -1];
    }),
  );
}

function roundedNumberLiteral(value, fixed) {
  if (value === -1) return '-1';
  const rounded = Number(value).toFixed(4);
  if (fixed) return rounded;
  return rounded.replace(/\.?0+$/, '');
}

function formatCoveragePayload(coverage, mode) {
  const entries = Object.entries(coverage);

  if (mode === 'percentage') {
    const payload = Object.fromEntries(
      entries.map(([locale, value]) => [
        locale,
        value === -1 ? 'invalid' : `${(Number(value) * 100).toFixed(2)}%`,
      ]),
    );
    return `${JSON.stringify(payload, null, 2)}\n`;
  }

  const fixed = mode === 'fix';
  const lines = entries.map(([locale, value]) => `  ${JSON.stringify(locale)}: ${roundedNumberLiteral(value, fixed)}`);
  return `{\n${lines.join(',\n')}\n}\n`;
}

async function branchExists(fetchJson) {
  const branchUrl = `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/branches/${encodeURIComponent(UPDATE_BRANCH)}`;
  const response = await fetchJson(branchUrl, {
    headers: githubHeaders('application/vnd.github+json'),
  });
  if (response.ok) return true;
  if (response.status === 404) return false;
  throw new Error(`GitHub branch check failed with HTTP ${response.status}`);
}

async function fetchCoverageFromRef(ref, fetchJson) {
  const contentsUrl =
    `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/locales.json?ref=${encodeURIComponent(ref)}`;
  const response = await fetchJson(contentsUrl, {
    headers: githubHeaders('application/vnd.github.raw+json'),
  });
  if (!response.ok || typeof response.text !== 'string') {
    return null;
  }

  const data = parseJson(response.text, `${ref}:locales.json`);
  return data && typeof data === 'object' ? data.coverage : null;
}

async function loadSourceCoverage(fetchJson) {
  const useUpdateBranch = await branchExists(fetchJson);
  const ref = useUpdateBranch ? UPDATE_BRANCH : MAIN_BRANCH;
  return fetchCoverageFromRef(ref, fetchJson);
}

function createCoverageHandler(options = {}) {
  const readFile = options.readFile ?? ((filePath) => fs.readFile(filePath, 'utf8'));
  const fetchJson = options.fetchJson ?? githubFetch;
  const deployedLocalesPath = options.localLocalesPath ?? localLocalesPath();

  return async function coverageHandler(req, res) {
    try {
      const localLocales = parseJson(await readFile(deployedLocalesPath), deployedLocalesPath);
      const locales = readLocaleKeys(localLocales);
      let sourceCoverage = null;

      try {
        sourceCoverage = await loadSourceCoverage(fetchJson);
      } catch {
        sourceCoverage = null;
      }

      const mode = normalizeMode(queryFromUrl(req.url));
      const coverage = selectCoverage(locales, sourceCoverage);

      res.statusCode = 200;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 's-maxage=300, stale-while-revalidate=300');
      res.end(formatCoveragePayload(coverage, mode));
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(`${JSON.stringify({ error: error.message })}\n`);
    }
  };
}

const handler = createCoverageHandler();

module.exports = handler;
module.exports.createCoverageHandler = createCoverageHandler;
module.exports.formatCoveragePayload = formatCoveragePayload;
module.exports.normalizeMode = normalizeMode;
module.exports.selectCoverage = selectCoverage;
