import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

function git(args, cwd, options = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    ...options,
  });
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function copyIgnoreScript(repoRoot) {
  fs.copyFileSync(path.join(ROOT_DIR, 'ignore.sh'), path.join(repoRoot, 'ignore.sh'));
}

test('ignore script deploys preview branches with earlier deploy-relevant changes', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vercel-ignore-'));

  try {
    git(['init', '-b', 'main'], repoRoot);
    git(['config', 'user.email', 'test@example.com'], repoRoot);
    git(['config', 'user.name', 'Test User'], repoRoot);
    copyIgnoreScript(repoRoot);
    writeFile(path.join(repoRoot, 'README.md'), 'base\n');
    git(['add', '.'], repoRoot);
    git(['commit', '-m', 'base'], repoRoot);

    git(['switch', '-c', 'feature'], repoRoot);
    writeFile(path.join(repoRoot, 'locales.json'), '{"locales":["zh-CN"]}\n');
    git(['add', 'locales.json'], repoRoot);
    git(['commit', '-m', 'change deploy file'], repoRoot);
    writeFile(path.join(repoRoot, 'README.md'), 'base\nnotes\n');
    git(['add', 'README.md'], repoRoot);
    git(['commit', '-m', 'change docs last'], repoRoot);

    const result = spawnSync('bash', ['./ignore.sh'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        VERCEL_GIT_COMMIT_SHA: git(['rev-parse', 'HEAD'], repoRoot).trim(),
        VERCEL_GIT_COMMIT_REF: 'feature',
        VERCEL_GIT_PULL_REQUEST_ID: '42',
      },
    });

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /locales\.json/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('ignore script deploys preview builds when Vercel previous SHA matches the current commit', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vercel-ignore-preview-'));

  try {
    git(['init', '-b', 'main'], repoRoot);
    git(['config', 'user.email', 'test@example.com'], repoRoot);
    git(['config', 'user.name', 'Test User'], repoRoot);
    copyIgnoreScript(repoRoot);
    writeFile(path.join(repoRoot, 'README.md'), 'base\n');
    git(['add', '.'], repoRoot);
    git(['commit', '-m', 'base'], repoRoot);

    writeFile(path.join(repoRoot, 'vercel.json'), '{"buildCommand":"bash ./build.sh"}\n');
    git(['add', 'vercel.json'], repoRoot);
    git(['commit', '-m', 'change vercel config'], repoRoot);

    const headSha = git(['rev-parse', 'HEAD'], repoRoot).trim();
    const result = spawnSync('bash', ['./ignore.sh'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        VERCEL_ENV: 'preview',
        VERCEL_GIT_COMMIT_SHA: headSha,
        VERCEL_GIT_PREVIOUS_SHA: headSha,
      },
    });

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Preview deployment requested/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('ignore script deploys production builds for every configured locale directory', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vercel-ignore-locales-'));

  try {
    git(['init', '-b', 'main'], repoRoot);
    git(['config', 'user.email', 'test@example.com'], repoRoot);
    git(['config', 'user.name', 'Test User'], repoRoot);
    copyIgnoreScript(repoRoot);
    writeFile(path.join(repoRoot, 'locales.json'), '{"locales":["zh-CN","zh-TW"]}\n');
    writeFile(path.join(repoRoot, 'zh-CN', 'zh-CN.json'), '{"hello":"\u4f60\u597d"}\n');
    writeFile(path.join(repoRoot, 'zh-TW', 'zh-TW.json'), '{"hello":"\u4f60\u597d"}\n');
    git(['add', '.'], repoRoot);
    git(['commit', '-m', 'base'], repoRoot);

    const baseSha = git(['rev-parse', 'HEAD'], repoRoot).trim();
    writeFile(path.join(repoRoot, 'zh-TW', 'zh-TW.json'), '{"hello":"\u60a8\u597d"}\n');
    git(['add', 'zh-TW/zh-TW.json'], repoRoot);
    git(['commit', '-m', 'update zh-TW only'], repoRoot);

    const result = spawnSync('bash', ['./ignore.sh'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        VERCEL_ENV: 'production',
        VERCEL_GIT_COMMIT_SHA: git(['rev-parse', 'HEAD'], repoRoot).trim(),
        VERCEL_GIT_COMMIT_REF: 'main',
        VERCEL_GIT_PREVIOUS_SHA: baseSha,
      },
    });

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /zh-TW\/zh-TW\.json/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
