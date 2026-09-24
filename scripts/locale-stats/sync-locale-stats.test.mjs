import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();

function git(cwd, ...args) {
  return execFileSync(realGit, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function copy(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, source), destination);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`);
}

test('README sync retries a moved main, recalculates, and skips a second unchanged commit', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-locale-stats-'));
  try {
    const bare = path.join(root, 'remote.git');
    const seed = path.join(root, 'seed');
    const work = path.join(root, 'work');
    const competing = path.join(root, 'competing');
    const bin = path.join(root, 'bin');
    fs.mkdirSync(seed);
    fs.mkdirSync(bin);
    git(root, 'init', '--bare', bare);
    git(seed, 'init', '-b', 'main');
    git(seed, 'config', 'user.name', 'Test');
    git(seed, 'config', 'user.email', 'test@example.com');
    for (const file of ['README.md', 'README.zh.md', 'README.tw.md', 'scripts/locale-stats/shared.mjs', 'scripts/locale-stats/locale_statistics.mjs', 'scripts/locale-stats/update_readme_stats.mjs', 'scripts/locale-stats/sync_locale_stats.sh']) {
      copy(file, path.join(seed, file));
    }
    writeJson(path.join(seed, 'locales.json'), { locales: ['zh-Hans', 'zh-Hant'] });
    writeJson(path.join(seed, '.original/upstream/en-US.json'), { a: '' });
    writeJson(path.join(seed, '.original/upstream/en-US.dynamic.json'), {});
    for (const locale of ['zh-Hans', 'zh-Hant']) {
      writeJson(path.join(seed, locale, `${locale}.json`), { a: '' });
      writeJson(path.join(seed, locale, `${locale}.dynamic.json`), {});
    }
    git(seed, 'add', '.');
    git(seed, 'commit', '-m', 'fixture');
    git(seed, 'remote', 'add', 'origin', bare);
    git(seed, 'push', '-u', 'origin', 'main');
    git(root, 'clone', '-b', 'main', bare, work);
    git(root, 'clone', '-b', 'main', bare, competing);
    git(competing, 'config', 'user.name', 'Concurrent test');
    git(competing, 'config', 'user.email', 'concurrent@example.com');

    const wrapper = path.join(bin, 'git');
    fs.writeFileSync(wrapper, `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = push ] && [ "\${2:-}" = origin ] && [ ! -f "$CONFLICT_DONE" ]; then
  touch "$CONFLICT_DONE"
  "$REAL_GIT" -C "$COMPETING_CLONE" fetch origin main >/dev/null
  "$REAL_GIT" -C "$COMPETING_CLONE" checkout -B main origin/main >/dev/null
  "$NODE_BIN" -e 'const fs=require("fs"); fs.writeFileSync(process.argv[1], JSON.stringify({b:""})+"\\n")' "$COMPETING_CLONE/.original/upstream/en-US.json"
  "$REAL_GIT" -C "$COMPETING_CLONE" add .original/upstream/en-US.json
  "$REAL_GIT" -C "$COMPETING_CLONE" commit -m 'concurrent source change' >/dev/null
  "$REAL_GIT" -C "$COMPETING_CLONE" push origin main >/dev/null
fi
exec "$REAL_GIT" "$@"
`);
    fs.chmodSync(wrapper, 0o755);
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      REAL_GIT: realGit,
      NODE_BIN: process.execPath,
      COMPETING_CLONE: competing,
      CONFLICT_DONE: path.join(root, 'conflict-done'),
    };
    const output = execFileSync('bash', ['scripts/locale-stats/sync_locale_stats.sh'], {
      cwd: work, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.match(output, /Statistics snapshot:/);
    assert.equal(fs.existsSync(env.CONFLICT_DONE), true);
    assert.match(fs.readFileSync(path.join(work, 'README.md'), 'utf8'), /`zh-Hans` \| 0 \| 0 \| 0 \|/);
    assert.equal(git(work, 'rev-parse', 'HEAD'), git(work, 'rev-parse', 'origin/main'));
    const commit = git(work, 'rev-parse', 'HEAD');
    execFileSync('bash', ['scripts/locale-stats/sync_locale_stats.sh'], {
      cwd: work, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(git(work, 'rev-parse', 'HEAD'), commit);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
