const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createCoverageHandler,
  formatCoveragePayload,
  normalizeMode,
} = require('./coverage');

function responseFor(url = '/coverage') {
  const chunks = [];
  return {
    req: { url },
    res: {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
      },
      end(chunk) {
        if (chunk) chunks.push(String(chunk));
        this.body = chunks.join('');
      },
    },
  };
}

test('normalizes query modes with mode taking precedence', () => {
  assert.equal(normalizeMode({ mode: 'fix', m: '%' }), 'fix');
  assert.equal(normalizeMode({ mode: 'percentage' }), 'percentage');
  assert.equal(normalizeMode({ m: '*' }), 'fix');
  assert.equal(normalizeMode({ m: '%' }), 'percentage');
  assert.equal(normalizeMode({ mode: 'unknown', m: '%' }), 'default');
});

test('formats default, fixed, and percentage payloads', () => {
  const coverage = {
    'zh-CN': 0.9985,
    'zh-TW': 0.9,
    fr: -1,
  };

  assert.equal(
    formatCoveragePayload(coverage, 'default'),
    '{\n  "zh-CN": 0.9985,\n  "zh-TW": 0.9,\n  "fr": -1\n}\n',
  );
  assert.equal(
    formatCoveragePayload(coverage, 'fix'),
    '{\n  "zh-CN": 0.9985,\n  "zh-TW": 0.9000,\n  "fr": -1\n}\n',
  );
  assert.equal(
    formatCoveragePayload(coverage, 'percentage'),
    '{\n  "zh-CN": "99.85%",\n  "zh-TW": "90.00%",\n  "fr": "invalid"\n}\n',
  );
});

test('handler prefers bot locale-update coverage and preserves local locale keyset', async () => {
  const calls = [];
  const handler = createCoverageHandler({
    localLocalesPath: '/virtual/locales.json',
    readFile: async () => JSON.stringify({ locales: ['zh-CN', 'zh-TW', 'fr-FR'] }),
    fetchJson: async (url, options) => {
      calls.push({ url, options });
      if (url.includes('/branches/bot%2Flocale-update')) {
        return { ok: true, status: 200, json: { name: 'bot/locale-update' } };
      }
      assert.match(url, /ref=bot%2Flocale-update$/);
      return {
        ok: true,
        status: 200,
        text: JSON.stringify({ coverage: { 'zh-CN': 0.9985, 'fr-FR': 0.5 } }),
      };
    },
  });
  const { req, res } = responseFor('/coverage?m=%');

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
  assert.deepEqual(JSON.parse(res.body), {
    'zh-CN': '99.85%',
    'zh-TW': 'invalid',
    'fr-FR': '50.00%',
  });
  assert.equal(calls.length, 2);
});

test('handler rejects out-of-range remote coverage values', async () => {
  const handler = createCoverageHandler({
    localLocalesPath: '/virtual/locales.json',
    readFile: async () => JSON.stringify({ locales: ['zh-CN', 'zh-TW', 'fr-FR'] }),
    fetchJson: async (url) => {
      if (url.includes('/branches/bot%2Flocale-update')) {
        return { ok: true, status: 200, json: { name: 'bot/locale-update' } };
      }
      return {
        ok: true,
        status: 200,
        text: JSON.stringify({ coverage: { 'zh-CN': 1, 'zh-TW': 1.0001, 'fr-FR': -0.1 } }),
      };
    },
  });
  const { req, res } = responseFor('/coverage');

  await handler(req, res);

  assert.deepEqual(JSON.parse(res.body), {
    'zh-CN': 1,
    'zh-TW': -1,
    'fr-FR': -1,
  });
});

test('handler falls back to main when the bot branch is absent', async () => {
  const handler = createCoverageHandler({
    localLocalesPath: '/virtual/locales.json',
    readFile: async () => JSON.stringify({ locales: ['zh-CN'] }),
    fetchJson: async (url) => {
      if (url.includes('/branches/bot%2Flocale-update')) {
        return { ok: false, status: 404, json: { message: 'Not Found' } };
      }
      assert.match(url, /ref=main$/);
      return {
        ok: true,
        status: 200,
        text: JSON.stringify({ coverage: { 'zh-CN': 1 } }),
      };
    },
  });
  const { req, res } = responseFor('/coverage?mode=fix');

  await handler(req, res);

  assert.equal(res.body, '{\n  "zh-CN": 1.0000\n}\n');
});

test('handler returns -1 values when remote coverage cannot be fetched', async () => {
  const handler = createCoverageHandler({
    localLocalesPath: '/virtual/locales.json',
    readFile: async () => JSON.stringify({ locales: ['zh-CN', 'zh-TW'] }),
    fetchJson: async () => {
      throw new Error('network unavailable');
    },
  });
  const { req, res } = responseFor('/coverage');

  await handler(req, res);

  assert.deepEqual(JSON.parse(res.body), {
    'zh-CN': -1,
    'zh-TW': -1,
  });
});
