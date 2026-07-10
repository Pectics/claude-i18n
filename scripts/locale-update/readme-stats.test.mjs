import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { updateReadmeStats } from './update_readme_stats.mjs';

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readmeFixture(language) {
  const labels = {
    en: ['Simplified Chinese', 'Traditional Chinese', 'Available'],
    zh: ['简体中文', '繁體中文', '可用'],
    tw: ['簡體中文', '繁體中文', '可用'],
  }[language];

  return `intro
<!-- locale-stats:summary:start -->
| Pack | Main | Dynamic | Total |
| --- | ---: | ---: | ---: |
| ${labels[0]} \`zh-CN\` | 999 | 999 | 999 |
| ${labels[1]} \`zh-TW\` | 999 | 999 | 999 |
<!-- locale-stats:summary:end -->
middle
<!-- locale-stats:supported:start -->
| Language | Locale | Main | Dynamic | Status |
| --- | --- | ---: | ---: | --- |
| ${labels[0]} | \`zh-CN\` | 999 | 999 | ${labels[2]} |
| ${labels[1]} | \`zh-TW\` | 999 | 999 | ${labels[2]} |
<!-- locale-stats:supported:end -->
outro
`;
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readme-stats-'));
  writeJson(path.join(root, 'locales.json'), { locales: ['zh-CN', 'zh-TW'] });
  writeJson(path.join(root, 'zh-CN', 'zh-CN.json'), { a: 1, b: 2, c: 3 });
  writeJson(path.join(root, 'zh-CN', 'zh-CN.dynamic.json'), { d: 1 });
  writeJson(path.join(root, 'zh-TW', 'zh-TW.json'), { a: 1 });
  writeJson(path.join(root, 'zh-TW', 'zh-TW.dynamic.json'), { d: 1, e: 2 });
  fs.writeFileSync(path.join(root, 'README.md'), readmeFixture('en'), 'utf8');
  fs.writeFileSync(path.join(root, 'README.zh.md'), readmeFixture('zh'), 'utf8');
  fs.writeFileSync(path.join(root, 'README.tw.md'), readmeFixture('tw'), 'utf8');
  return root;
}

test('updates both locale tables in all localized READMEs while preserving their copy', () => {
  const root = createFixture();
  try {
    assert.throws(() => updateReadmeStats(root, { check: true }), /statistics are stale/);

    const result = updateReadmeStats(root);
    assert.deepEqual(result.changedFiles, ['README.md', 'README.zh.md', 'README.tw.md']);
    assert.deepEqual(result.statistics, {
      'zh-CN': { main: 3, dynamic: 1, total: 4 },
      'zh-TW': { main: 1, dynamic: 2, total: 3 },
    });

    for (const readme of ['README.md', 'README.zh.md', 'README.tw.md']) {
      const text = fs.readFileSync(path.join(root, readme), 'utf8');
      assert.match(text, /`zh-CN` \| 3 \| 1 \| 4 \|/);
      assert.match(text, /`zh-TW` \| 1 \| 2 \| 3 \|/);
      assert.match(text, /`zh-CN` \| 3 \| 1 \|/);
      assert.match(text, /`zh-TW` \| 1 \| 2 \|/);
    }
    assert.match(fs.readFileSync(path.join(root, 'README.zh.md'), 'utf8'), /简体中文/);
    assert.match(fs.readFileSync(path.join(root, 'README.tw.md'), 'utf8'), /繁體中文/);

    assert.deepEqual(updateReadmeStats(root).changedFiles, []);
    assert.doesNotThrow(() => updateReadmeStats(root, { check: true }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('formats large key counts with stable thousands separators', () => {
  const root = createFixture();
  try {
    writeJson(
      path.join(root, 'zh-CN', 'zh-CN.json'),
      Object.fromEntries(Array.from({ length: 1234 }, (_, index) => [`key${index}`, index])),
    );
    updateReadmeStats(root);
    const text = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    assert.match(text, /`zh-CN` \| 1,234 \| 1 \| 1,235 \|/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects missing, malformed, or non-object locale JSON', () => {
  for (const mutate of [
    (root) => fs.rmSync(path.join(root, 'zh-CN', 'zh-CN.dynamic.json')),
    (root) => fs.writeFileSync(path.join(root, 'zh-CN', 'zh-CN.json'), '{invalid', 'utf8'),
    (root) => writeJson(path.join(root, 'zh-CN', 'zh-CN.json'), []),
  ]) {
    const root = createFixture();
    try {
      mutate(root);
      assert.throws(() => updateReadmeStats(root));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('rejects damaged markers and locale rows that do not match manifest order', () => {
  const missingMarkerRoot = createFixture();
  const wrongOrderRoot = createFixture();
  try {
    const missingMarkerPath = path.join(missingMarkerRoot, 'README.md');
    fs.writeFileSync(
      missingMarkerPath,
      fs.readFileSync(missingMarkerPath, 'utf8').replace('<!-- locale-stats:summary:end -->', ''),
      'utf8',
    );
    assert.throws(() => updateReadmeStats(missingMarkerRoot), /missing or invalid summary/);

    const wrongOrderPath = path.join(wrongOrderRoot, 'README.md');
    const wrongOrder = fs
      .readFileSync(wrongOrderPath, 'utf8')
      .replace('`zh-CN` | 999 | 999 | 999', '`swap` | 999 | 999 | 999')
      .replace('`zh-TW` | 999 | 999 | 999', '`zh-CN` | 999 | 999 | 999')
      .replace('`swap` | 999 | 999 | 999', '`zh-TW` | 999 | 999 | 999');
    fs.writeFileSync(wrongOrderPath, wrongOrder, 'utf8');
    assert.throws(() => updateReadmeStats(wrongOrderRoot), /does not match locales\.json/);
  } finally {
    fs.rmSync(missingMarkerRoot, { recursive: true, force: true });
    fs.rmSync(wrongOrderRoot, { recursive: true, force: true });
  }
});
