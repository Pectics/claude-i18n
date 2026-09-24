import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflowDir = path.join(root, '.github', 'workflows');
const stats = fs.readFileSync(path.join(workflowDir, 'locale-stats.yml'), 'utf8');
const original = fs.readFileSync(path.join(workflowDir, 'original-update.yml'), 'utf8');
const sync = fs.readFileSync(path.join(root, 'scripts', 'locale-stats', 'sync_locale_stats.sh'), 'utf8');

test('the sole statistics workflow handles main changes, explicit calls, and manual recovery', () => {
  for (const old of ['locale-update.yml', 'locale-update-readme.yml', 'locale-update-pages.yml']) {
    assert.equal(fs.existsSync(path.join(workflowDir, old)), false);
  }
  assert.match(stats, /push:\n\s+branches:\n\s+- main/);
  for (const file of ['locales.json', 'en-US.json', 'en-US.dynamic.json', 'scripts/locale-stats/**', 'locale-stats.yml']) {
    assert.ok(stats.includes(file), file);
  }
  assert.match(stats, /"\*\/\*\.json"/);
  assert.match(stats, /workflow_call:/);
  assert.match(stats, /workflow_dispatch:/);
  assert.match(stats, /group: locale-stats\n\s+cancel-in-progress: false/);
  assert.doesNotMatch(stats, /pull_request:|bot\/locale-update|gh pr list|upstream_ref/);
});

test('the source refresh calls statistics only after a changed push and independently of Crowdin', () => {
  assert.match(original, /echo "changed=false"/);
  assert.match(original, /git push origin HEAD:main\n\s+echo "changed=true"/);
  assert.match(original, /sync-reference:[\s\S]*?needs: update\n\s+if: needs\.update\.outputs\.changed == 'true'/);
  assert.match(original, /sync-stats:[\s\S]*?needs: update\n\s+if: needs\.update\.outputs\.changed == 'true'/);
  assert.match(original, /uses: \.\/\.github\/workflows\/locale-stats\.yml/);
  assert.doesNotMatch(original, /sync-stats:[\s\S]*needs: \[.*sync-reference/);
  for (const permission of ['contents: write', 'pages: write', 'id-token: write']) {
    assert.ok(original.includes(permission));
    assert.ok(stats.includes(permission));
  }
});

test('statistics workflow retries README push conflicts and directly deploys only changed Pages data', () => {
  assert.match(sync, /for attempt in 1 2 3/);
  assert.match(sync, /git fetch --no-tags origin main/);
  assert.match(sync, /git checkout -B locale-stats origin\/main/);
  assert.match(sync, /--skip-invalid-targets/);
  assert.match(sync, /git diff --quiet -- README\.md README\.zh\.md README\.tw\.md/);
  assert.match(sync, /git push origin HEAD:refs\/heads\/main/);
  assert.doesNotMatch(sync, /--force/);
  assert.match(stats, /generate_coverage\.mjs[\s\S]*compare_pages_coverage\.mjs/);
  assert.match(stats, /needs\.build\.outputs\.changed == 'true'/);
  assert.match(stats, /actions\/upload-pages-artifact@v4/);
  assert.match(stats, /actions\/deploy-pages@v4/);
  assert.match(stats, /snapshot: \$\{\{ steps\.snapshot\.outputs\.sha \}\}/);
  assert.match(stats, /Reject an artifact from an outdated main snapshot/);
  for (const readme of ['README.md', 'README.zh.md', 'README.tw.md']) {
    const text = fs.readFileSync(path.join(root, readme), 'utf8');
    assert.match(text, /actions\/workflows\/locale-stats\.yml/);
    assert.match(text, /claude-i18n\/badges\/zh-Hans\.svg/);
    assert.match(text, /claude-i18n\/badges\/zh-Hant\.svg/);
  }
});
