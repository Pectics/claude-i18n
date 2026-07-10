import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const WORKFLOW_PATH = path.join(ROOT_DIR, '.github', 'workflows', 'locale-update.yml');

test('locale update publishes deterministic coverage artifacts from the main snapshot', () => {
  const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  const generateIndex = workflow.indexOf('node "$coverage_script"');
  const noChangeIndex = workflow.indexOf('if [ "$changed_count" -eq 0 ]');
  const publishIndex = workflow.indexOf('- name: Publish locale coverage data');
  const updateCommitIndex = workflow.indexOf('- name: Commit and push update branch');

  assert.match(workflow, /COVERAGE_BRANCH: coverage-data/);
  assert.match(workflow, /git archive "origin\/\$BASE_REF" \| tar -x -C "\$main_snapshot_dir"/);
  assert.match(workflow, /generate_coverage\.mjs/);
  assert.match(workflow, /--upstream-dir "\$tmp_dir"/);
  assert.match(workflow, /--target-root "\$main_snapshot_dir"/);
  assert.match(workflow, /publish_coverage\.sh/);
  assert.ok(generateIndex !== -1 && generateIndex < noChangeIndex, 'coverage must run even when no locale diff exists');
  assert.ok(publishIndex !== -1 && publishIndex < updateCommitIndex, 'coverage publishing must be independent of the PR commit');
  assert.doesNotMatch(workflow, /update_coverage\.mjs|--pending-manifest|--output-locales/);
  assert.doesNotMatch(workflow, /git add -A locales\.json/);
});
