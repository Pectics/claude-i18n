import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { comparePagesCoverage } from './compare_pages_coverage.mjs';

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function withServer(routes, callback) {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const route = routes[pathname];
    if (!route) {
      response.writeHead(404).end('missing');
      return;
    }
    response.writeHead(route.status ?? 200, { 'content-type': route.type ?? 'text/plain' }).end(route.body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

function createArtifact() {
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-coverage-'));
  const coverage = {
    schemaVersion: 1,
    baseLocale: 'en-US',
    coverage: {
      'zh-CN': { covered: 9, total: 10, ratio: 0.9 },
      'zh-TW': { covered: 8, total: 10, ratio: 0.8 },
    },
  };
  writeJson(path.join(artifactDir, 'coverage.json'), coverage);
  return { artifactDir, coverage };
}

test('skips deployment only when coverage and every badge are healthy', async () => {
  const { artifactDir, coverage } = createArtifact();
  try {
    await withServer(
      {
        '/coverage.json': { type: 'application/json', body: JSON.stringify(coverage) },
        '/badges/zh-CN.svg': { type: 'image/svg+xml', body: '<svg>CN</svg>' },
        '/badges/zh-TW.svg': { type: 'image/svg+xml', body: '<svg>TW</svg>' },
      },
      async (baseUrl) => {
        assert.deepEqual(await comparePagesCoverage({ artifactDir, baseUrl }), {
          changed: false,
          reason: 'published coverage and badges are current',
        });
      },
    );
  } finally {
    fs.rmSync(artifactDir, { recursive: true, force: true });
  }
});

test('requests deployment for changed coverage, missing badges, and invalid SVG', async () => {
  const { artifactDir, coverage } = createArtifact();
  try {
    for (const routes of [
      {
        '/coverage.json': {
          type: 'application/json',
          body: JSON.stringify({ ...coverage, coverage: { ...coverage.coverage, 'zh-CN': { covered: 10, total: 10, ratio: 1 } } }),
        },
      },
      {
        '/coverage.json': { type: 'application/json', body: JSON.stringify(coverage) },
        '/badges/zh-CN.svg': { body: '<svg>CN</svg>' },
      },
      {
        '/coverage.json': { type: 'application/json', body: JSON.stringify(coverage) },
        '/badges/zh-CN.svg': { body: '<html>bad</html>' },
        '/badges/zh-TW.svg': { body: '<svg>TW</svg>' },
      },
    ]) {
      await withServer(routes, async (baseUrl) => {
        assert.equal((await comparePagesCoverage({ artifactDir, baseUrl })).changed, true);
      });
    }
  } finally {
    fs.rmSync(artifactDir, { recursive: true, force: true });
  }
});
