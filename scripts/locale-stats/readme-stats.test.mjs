import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { countTarget, readSource, readTarget } from './locale_statistics.mjs';
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
| ${labels[0]} \`zh-Hans\` | 999 | 999 | 999 |
| ${labels[1]} \`zh-Hant\` | 999 | 999 | 999 |
<!-- locale-stats:summary:end -->
middle
<!-- locale-stats:supported:start -->
| Language | Locale | Main | Dynamic | Status |
| --- | --- | ---: | ---: | --- |
| ${labels[0]} | \`zh-Hans\` | 999 | 999 | ${labels[2]} |
| ${labels[1]} | \`zh-Hant\` | 999 | 999 | ${labels[2]} |
<!-- locale-stats:supported:end -->
outro
`;
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readme-stats-'));
  writeJson(path.join(root, '.original', 'upstream', 'en-US.json'), { a: 1, b: 2, c: 3 });
  writeJson(path.join(root, '.original', 'upstream', 'en-US.dynamic.json'), { d: 1, e: 2 });
  writeJson(path.join(root, 'locales.json'), { locales: ['zh-Hans', 'zh-Hant'] });
  writeJson(path.join(root, 'zh-Hans', 'zh-Hans.json'), { a: 1, b: 2, c: 3 });
  writeJson(path.join(root, 'zh-Hans', 'zh-Hans.dynamic.json'), { d: 1 });
  writeJson(path.join(root, 'zh-Hant', 'zh-Hant.json'), { a: 1 });
  writeJson(path.join(root, 'zh-Hant', 'zh-Hant.dynamic.json'), { d: 1, e: 2 });
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
      'zh-Hans': { main: 3, dynamic: 1, total: 4 },
      'zh-Hant': { main: 1, dynamic: 2, total: 3 },
    });

    for (const readme of ['README.md', 'README.zh.md', 'README.tw.md']) {
      const text = fs.readFileSync(path.join(root, readme), 'utf8');
      assert.match(text, /`zh-Hans` \| 3 \| 1 \| 4 \|/);
      assert.match(text, /`zh-Hant` \| 1 \| 2 \| 3 \|/);
      assert.match(text, /`zh-Hans` \| 3 \| 1 \|/);
      assert.match(text, /`zh-Hant` \| 1 \| 2 \|/);
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
    const largePack = Object.fromEntries(Array.from({ length: 1234 }, (_, index) => [`key${index}`, index]));
    writeJson(path.join(root, '.original', 'upstream', 'en-US.json'), largePack);
    writeJson(path.join(root, 'zh-Hans', 'zh-Hans.json'), largePack);
    updateReadmeStats(root);
    const text = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    assert.match(text, /`zh-Hans` \| 1,234 \| 1 \| 1,235 \|/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('counts main and dynamic intersections independently, including empty packs and extra old keys', () => {
  const root = createFixture();
  try {
    writeJson(path.join(root, '.original', 'upstream', 'en-US.json'), { added: '', same: '' });
    writeJson(path.join(root, '.original', 'upstream', 'en-US.dynamic.json'), { same: '' });
    writeJson(path.join(root, 'zh-Hans', 'zh-Hans.json'), { same: '', removed: 'old' });
    writeJson(path.join(root, 'zh-Hans', 'zh-Hans.dynamic.json'), { same: '', extra: 'old' });
    writeJson(path.join(root, 'zh-Hant', 'zh-Hant.json'), {});
    writeJson(path.join(root, 'zh-Hant', 'zh-Hant.dynamic.json'), {});

    const { statistics } = updateReadmeStats(root);
    assert.deepEqual(statistics, {
      'zh-Hans': { main: 1, dynamic: 1, total: 2 },
      'zh-Hant': { main: 0, dynamic: 0, total: 0 },
    });
    assert.match(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), /`zh-Hans` \| 1 \| 1 \| 2 \|/);
    const source = readSource(path.join(root, '.original', 'upstream'));
    for (const locale of ['zh-Hans', 'zh-Hant']) {
      assert.equal(statistics[locale].total, countTarget(source, readTarget(root, locale)).total);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('damaged targets skip every README in workflow mode, while damaged or empty English sources fail', () => {
  for (const damageSource of [false, true]) {
    const root = createFixture();
    try {
      const before = Object.fromEntries(
        ['README.md', 'README.zh.md', 'README.tw.md'].map((name) => [name, fs.readFileSync(path.join(root, name), 'utf8')]),
      );
      if (damageSource) {
        writeJson(path.join(root, '.original', 'upstream', 'en-US.json'), {});
        writeJson(path.join(root, '.original', 'upstream', 'en-US.dynamic.json'), {});
        assert.throws(() => updateReadmeStats(root, { skipInvalidTargets: true }), /has no keys/);
      } else {
        fs.writeFileSync(path.join(root, 'zh-Hant', 'zh-Hant.json'), '{invalid', 'utf8');
        const result = updateReadmeStats(root, { skipInvalidTargets: true });
        assert.equal(result.skipped, true);
      }
      for (const [name, content] of Object.entries(before)) {
        assert.equal(fs.readFileSync(path.join(root, name), 'utf8'), content);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('rejects missing, malformed, or non-object locale JSON', () => {
  for (const mutate of [
    (root) => fs.rmSync(path.join(root, 'zh-Hans', 'zh-Hans.dynamic.json')),
    (root) => fs.writeFileSync(path.join(root, 'zh-Hans', 'zh-Hans.json'), '{invalid', 'utf8'),
    (root) => writeJson(path.join(root, 'zh-Hans', 'zh-Hans.json'), []),
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
      .replace('`zh-Hans` | 999 | 999 | 999', '`swap` | 999 | 999 | 999')
      .replace('`zh-Hant` | 999 | 999 | 999', '`zh-Hans` | 999 | 999 | 999')
      .replace('`swap` | 999 | 999 | 999', '`zh-Hant` | 999 | 999 | 999');
    fs.writeFileSync(wrongOrderPath, wrongOrder, 'utf8');
    assert.throws(() => updateReadmeStats(wrongOrderRoot), /does not match locales\.json/);
  } finally {
    fs.rmSync(missingMarkerRoot, { recursive: true, force: true });
    fs.rmSync(wrongOrderRoot, { recursive: true, force: true });
  }
});
