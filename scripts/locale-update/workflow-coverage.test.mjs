import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const WORKFLOW_PATH = path.join(ROOT_DIR, '.github', 'workflows', 'locale-update.yml');

test('locale update delegates latest upstream coverage to the reusable Pages workflow', () => {
  const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');

  assert.match(workflow, /name: "locale-update: Sync upstream locales"/);
  assert.match(workflow, /name: Sync upstream locale files/);
  assert.match(workflow, /name: Fetch upstream locales and build diff/);
  assert.match(workflow, /"\.original\/upstream"/);
  assert.match(workflow, /jq --raw-output '\.locales\[\]'/);
  assert.match(workflow, /--baseline-dir "\.original\/baselines\/\$target_locale"/);
  assert.match(workflow, /--pending-dir "\$PENDING_DIR"/);
  assert.doesNotMatch(workflow, /rm -rf "\$PENDING_DIR"/);
  assert.match(workflow, /echo "upstream_ready=true"/);
  assert.match(workflow, /name: Select coverage upstream snapshot/);
  assert.match(workflow, /uses: \.\/\.github\/workflows\/locale-update-pages\.yml/);
  assert.match(workflow, /upstream_ref: \$\{\{ needs\.update\.outputs\.coverage_upstream_ref \}\}/);
  assert.doesNotMatch(workflow, /COVERAGE_BRANCH|bot\/coverage-data|publish_coverage|generate_coverage/);
  assert.doesNotMatch(workflow, /git add -A locales\.json/);
});

test('locale update reuses only an open bot PR and safely replaces a stale remote branch', () => {
  const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');

  assert.match(workflow, /if \[ -n "\$pr_number" \]; then/);
  assert.match(workflow, /branch_source="open-pr"/);
  assert.match(workflow, /branch_source="base"/);
  assert.doesNotMatch(workflow, /branch_source="remote-branch"/);
  assert.match(workflow, /remote_sha="\$\(git ls-remote --heads origin "\$UPDATE_BRANCH"/);
  assert.match(workflow, /--force-with-lease="refs\/heads\/\$BRANCH_NAME:\$REMOTE_SHA"/);
});

test('all README coverage badges use Pages after cutover', () => {
  for (const readme of ['README.md', 'README.zh.md', 'README.tw.md']) {
    const text = fs.readFileSync(path.join(ROOT_DIR, readme), 'utf8');
    assert.match(text, /https:\/\/pectics\.github\.io\/claude-i18n\/badges\/zh-CN\.svg/);
    assert.match(text, /https:\/\/pectics\.github\.io\/claude-i18n\/badges\/zh-TW\.svg/);
    assert.doesNotMatch(text, /bot\/coverage-data/);
  }
});
