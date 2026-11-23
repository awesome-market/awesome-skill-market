// github.js — owner/repo[@ref] 拉取：gh api tarball → codeload(+mirror) → jsdelivr 逐文件
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { L } from '../i18n.js';
import { treeHash, copyDir } from '../package.js';

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function haveGh() {
  try { sh('gh', ['--version']); return true; } catch { return false; }
}

export function headSha(owner, repo, ref = null) {
  if (haveGh()) {
    try {
      const r = ref || 'HEAD';
      return sh('gh', ['api', `repos/${owner}/${repo}/commits/${r}`, '--jq', '.sha']);
    } catch { /* fallthrough */ }
  }
  return ref;
}

async function fetchTarball(owner, repo, ref, { mirror = null } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skillmkt-gh-'));
  const tar = path.join(tmp, 'pkg.tar.gz');
  const urls = [
    `https://codeload.github.com/${owner}/${repo}/tar.gz/${ref}`,
    ...(mirror ? [`${mirror.replace(/\/+$/, '')}/https://codeload.github.com/${owner}/${repo}/tar.gz/${ref}`] : []),
  ];
  if (haveGh()) {
    try {
      execFileSync('gh', ['api', `repos/${owner}/${repo}/tarball/${ref}`, '-H', 'Accept: application/vnd.github+json'], { stdio: ['ignore', fs.openSync(tar, 'w'), 'pipe'] });
      if (fs.statSync(tar).size > 100) return { tmp, tar, via: 'gh' };
    } catch { /* fallthrough to codeload */ }
  }
  for (const url of urls) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) continue;
      fs.writeFileSync(tar, Buffer.from(await res.arrayBuffer()));
      if (fs.statSync(tar).size > 100) return { tmp, tar, via: url.includes('codeload') && !mirror ? 'codeload' : 'mirror' };
    } catch { /* next */ }
  }
  return null;
}

// fetch → {dir: 解压后 skill 根目录（含 SKILL.md 或其子目录）, provenance}
export async function fetchSkill({ owner, repo, ref = null, path: sub = null, mirror = null }) {
  const sha = headSha(owner, repo, ref) || ref || 'HEAD';
  const got = await fetchTarball(owner, repo, sha, { mirror });
  if (!got) throw new Error(`fetch failed: ${owner}/${repo}@${sha}${L('（直连与镜像均不可达）', ' (direct and mirror both unreachable)')}`);
  execFileSync('tar', ['xzf', got.tar, '-C', got.tmp]);
  const root = fs.readdirSync(got.tmp).find((d) => d.startsWith(`${owner.replace(/\W/g, '')}`) || d.includes('-'))
    ?? fs.readdirSync(got.tmp).find((d) => fs.statSync(path.join(got.tmp, d)).isDirectory());
  let dir = path.join(got.tmp, root);
  if (sub) {
    // slug 与仓库路径不总一致（skills.sh slug 常省略 skills/ 前缀）——多级回退定位
    const topDirs = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    const cands = [sub, `skills/${sub}`, ...topDirs.map((d) => `${d}/${sub}`)];
    const hit = cands.find((c) => fs.existsSync(path.join(dir, c, 'SKILL.md')))
      ?? cands.find((c) => fs.existsSync(path.join(dir, c)));
    if (!hit) throw new Error(L(`repo 内找不到: ${sub}（试了 ${cands.slice(0, 4).join(', ')} …）`, `not found in repo: ${sub} (tried ${cands.slice(0, 4).join(', ')} …)`));
    dir = path.join(dir, hit);
  }
  return {
    dir, tmp: got.tmp, sha,
    provenance: { registry: 'github', ref: `${owner}/${repo}`, path: sub, pin: sha, via: got.via },
  };
}

// 远端 git/trees → subtree 的 git-tree-hash（update/outdated 免下载对比）
import { remoteTreeHash } from '../githash.js';
export async function remoteTree(owner, repo, ref, sub = null) {
  if (!haveGh()) throw new Error('gh CLI required for remote tree');
  const sha = headSha(owner, repo, ref);
  const tree = JSON.parse(sh('gh', ['api', `repos/${owner}/${repo}/git/trees/${sha}?recursive=1`])).tree;
  return { sha, tree_hash: remoteTreeHash(tree, sub) };
}

export async function versionsSkill() { return []; } // TODO: tags/releases

// jsdelivr 逐文件兜底（data.jsdelivr.com 列目录）——mirror 全挂时的最后手段
export async function fetchViaJsdelivr(owner, repo, ref, sub, destDir) {
  const api = `https://data.jsdelivr.com/v1/packages/gh/${owner}/${repo}@${ref}`;
  const tree = await (await fetch(api)).json();
  const files = [];
  const walkJs = (node, prefix) => {
    for (const f of node.files || []) {
      const p = prefix ? `${prefix}/${f.name}` : f.name;
      if (f.type === 'directory') walkJs(f, p);
      else files.push(p);
    }
  };
  walkJs(tree, '');
  const base = `https://fastly.jsdelivr.net/gh/${owner}/${repo}@${ref}/`;
  for (const f of files) {
    if (sub && !f.startsWith(`${sub}/`) && f !== sub) continue;
    const rel = sub ? f.slice(sub.length + 1) : f;
    const res = await fetch(base + f);
    if (!res.ok) continue;
    const dest = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  }
}
