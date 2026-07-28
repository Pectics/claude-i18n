import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const PAGES_WORKFLOW = fs.readFileSync(path.join(ROOT_DIR, '.github', 'workflows', 'locale-update-pages.yml'), 'utf8');
const README_WORKFLOW = fs.readFileSync(path.join(ROOT_DIR, '.github', 'workflows', 'locale-update-readme.yml'), 'utf8');
const APPLY_SCRIPT = fs.readFileSync(path.join(__dirname, 'apply_translation.mjs'), 'utf8');

test('Pages workflow always compares main locale packs with an explicit latest-upstream ref', () => {
  assert.match(PAGES_WORKFLOW, /name: "locale-update: Publish coverage to Pages"/);
  assert.match(PAGES_WORKFLOW, /workflow_call:/);
  assert.match(PAGES_WORKFLOW, /workflow_dispatch:/);
  assert.match(PAGES_WORKFLOW, /push:\n\s+branches:\n\s+- main/);
  assert.match(PAGES_WORKFLOW, /ref: main/);
  assert.match(PAGES_WORKFLOW, /--target-root "\$GITHUB_WORKSPACE"/);
  assert.match(PAGES_WORKFLOW, /--upstream-dir "\$UPSTREAM_DIR"/);
  assert.match(PAGES_WORKFLOW, /--head "\$UPDATE_BRANCH"/);
  assert.match(PAGES_WORKFLOW, /git archive "origin\/\$UPSTREAM_REF" \.original\/upstream/);
  assert.match(PAGES_WORKFLOW, /UPSTREAM_DIR=\$upstream_root\/\.original\/upstream/);
});

test('Pages workflow uses artifact deployment permissions and skips healthy unchanged data', () => {
  assert.match(PAGES_WORKFLOW, /pages: write/);
  assert.match(PAGES_WORKFLOW, /id-token: write/);
  assert.match(PAGES_WORKFLOW, /PAGES_ARTIFACT_DIR: coverage-pages-artifact/);
  assert.match(PAGES_WORKFLOW, /actions\/upload-pages-artifact@v4/);
  assert.match(PAGES_WORKFLOW, /actions\/deploy-pages@v4/);
  assert.match(PAGES_WORKFLOW, /needs\.build\.outputs\.changed == 'true'/);
  assert.match(PAGES_WORKFLOW, /compare_pages_coverage\.mjs/);
  assert.doesNotMatch(PAGES_WORKFLOW, /echo "PAGES_ARTIFACT_DIR=.*GITHUB_ENV/);
  assert.doesNotMatch(PAGES_WORKFLOW, /bot\/coverage-data|publish_coverage/);
});

test('README workflow updates only the bot branch and checks pull requests', () => {
  assert.match(README_WORKFLOW, /name: "locale-update: Sync README statistics"/);
  assert.match(README_WORKFLOW, /- bot\/locale-update/);
  assert.match(README_WORKFLOW, /github\.event_name == 'push'/);
  assert.match(README_WORKFLOW, /github\.event_name == 'pull_request'/);
  assert.match(README_WORKFLOW, /node scripts\/locale-update\/update_readme_stats\.mjs --check/);
  assert.match(README_WORKFLOW, /docs: Update locale pack statistics/);
  assert.doesNotMatch(README_WORKFLOW, /coverage|deploy-pages/);
  assert.match(APPLY_SCRIPT, /buildReadmeStatsUpdates\(ROOT_DIR/);
  assert.match(APPLY_SCRIPT, /commitFileTransaction\(transactionEntries\)/);
});
