import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLISH_SCRIPT = path.join(__dirname, 'publish_coverage.sh');

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function publish(repo, artifacts, worktree) {
  return execFileSync(
    'bash',
    [
      PUBLISH_SCRIPT,
      '--artifacts-dir',
      artifacts,
      '--worktree-dir',
      worktree,
      '--branch',
      'coverage-data',
      '--remote',
      'origin',
    ],
    { cwd: repo, encoding: 'utf8' },
  );
}

test('creates the data branch, skips unchanged data, and removes stale badges on update', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-publish-'));
  const remote = path.join(root, 'remote.git');
  const repo = path.join(root, 'repo');
  const artifacts = path.join(root, 'artifacts');
  const worktree = path.join(root, 'coverage-worktree');

  try {
    git(['init', '--bare', remote], root);
    fs.mkdirSync(repo);
    git(['init', '-b', 'main'], repo);
    git(['config', 'user.name', 'Test User'], repo);
    git(['config', 'user.email', 'test@example.com'], repo);
    fs.writeFileSync(path.join(repo, 'README.md'), 'main\n', 'utf8');
    git(['add', 'README.md'], repo);
    git(['commit', '-m', 'initial'], repo);
    git(['remote', 'add', 'origin', remote], repo);
    git(['push', '-u', 'origin', 'main'], repo);

    writeJson(path.join(artifacts, 'coverage.json'), { schemaVersion: 1, coverage: { 'zh-CN': { ratio: 1 } } });
    writeJson(path.join(artifacts, 'badges', 'zh-CN.json'), { schemaVersion: 1, message: '100.00%' });
    writeJson(path.join(artifacts, 'badges', 'removed.json'), { schemaVersion: 1, message: '50.00%' });

    assert.match(publish(repo, artifacts, worktree), /published=true/);
    assert.equal(git(['rev-list', '--count', 'refs/heads/coverage-data'], remote).trim(), '1');
    assert.match(publish(repo, artifacts, worktree), /published=false/);
    assert.equal(git(['rev-list', '--count', 'refs/heads/coverage-data'], remote).trim(), '1');

    writeJson(path.join(artifacts, 'coverage.json'), { schemaVersion: 1, coverage: { 'zh-CN': { ratio: 0.5 } } });
    fs.rmSync(path.join(artifacts, 'badges', 'removed.json'));
    assert.match(publish(repo, artifacts, worktree), /published=true/);
    assert.equal(git(['rev-list', '--count', 'refs/heads/coverage-data'], remote).trim(), '2');
    assert.throws(
      () => git(['show', 'refs/heads/coverage-data:badges/removed.json'], remote),
      /does not exist|exists on disk, but not in/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
