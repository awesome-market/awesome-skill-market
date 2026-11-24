// github.js — owner/repo[@ref] 拉取：gh api tarball → codeload(+mirror) → jsdelivr 逐文件
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { L } from '../i18n.js';
import { parseFrontmatter, assertSafeTar, fetchToFile } from '../package.js';

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
      await fetchToFile(url, tar, { timeout: 90e3, maxBytes: 300e6 });   // 带超时+300MB 上限——防慢挂/OOM
      if (fs.statSync(tar).size > 100) return { tmp, tar, via: url.includes('codeload') && !mirror ? 'codeload' : 'mirror' };
    } catch { /* next */ }
  }
  return null;
}

// fetch → {dir: 解压后 skill 根目录（含 SKILL.md 或其子目录）, provenance}
export async function fetchSkill({ owner, repo, ref = null, path: sub = null, mirror = null }) {
  const sha = headSha(owner, repo, ref) || ref || 'HEAD';
  const got = await fetchTarball(owner, repo, sha, { mirror });
  const hint = /\./.test(owner) ? L(`（${owner} 看着是私有源域名，不是 GitHub 组织——skills.sh 私有源 skill 目前装不了）`, ` (${owner} looks like a private registry domain, not a GitHub owner — private-source skills aren't installable yet)`) : '';
  if (!got) throw new Error(`fetch failed: ${owner}/${repo}@${sha}${L('（直连与镜像均不可达）', ' (direct and mirror both unreachable)')}${hint}`);
  assertSafeTar(got.tar);                                // 远端包成员预检：只要 文件+目录，挡 ../、link、写穿
  execFileSync('tar', ['xzf', got.tar, '-C', got.tmp]);
  const root = fs.readdirSync(got.tmp).find((d) => d.startsWith(`${owner.replace(/\W/g, '')}`) || d.includes('-'))
    ?? fs.readdirSync(got.tmp).find((d) => fs.statSync(path.join(got.tmp, d)).isDirectory());
  let dir = path.join(got.tmp, root), hit = null;
  if (sub) {
    // slug 与仓库路径不总一致（skills.sh slug 常省略 skills/ 前缀）——多级回退定位
    const topDirs = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    const cands = [sub, `skills/${sub}`, ...topDirs.map((d) => `${d}/${sub}`)];
    hit = cands.find((c) => fs.existsSync(path.join(dir, c, 'SKILL.md')));
    if (!hit) {
      // 插件仓布局更深（.claude/skills/<name>、cli/assets/skills/<name>）——限深递归搜 SKILL.md，
      // 父目录名或 frontmatter name 命中 sub 即算找到；全部列出供报错提示
      const all = [], matches = [];
      const walkSk = (d, depth) => {
        if (depth > 5) return;
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          if (!e.isDirectory() || e.name === '.git' || e.name === 'node_modules') continue;
          const p = path.join(d, e.name), rel = path.relative(dir, p).split(path.sep).join('/');
          const sf = path.join(p, 'SKILL.md');
          if (fs.existsSync(sf)) {
            let metaName = null;
            try { metaName = parseFrontmatter(sf).meta?.name; } catch { /* 解析不了就用目录名 */ }
            all.push(rel);
            if (e.name === sub || metaName === sub) matches.push(rel);
          }
          walkSk(p, depth + 1);
        }
      };
      walkSk(dir, 1);
      matches.sort((a, b) => a.split('/').length - b.split('/').length);  // 命中多个取最浅的
      hit = matches[0];
      if (!hit) {
        const list = all.slice(0, 10).join(', ');
        throw new Error(L(`repo 内找不到: ${sub}${all.length ? `——发现的 skills: ${list}${all.length > 10 ? ' …' : ''}` : ''}`, `not found in repo: ${sub}${all.length ? ` — skills found: ${list}${all.length > 10 ? ' …' : ''}` : ''}`));
      }
    }
    dir = path.join(dir, hit);
  }
  return {
    dir, tmp: got.tmp, sha,
    // path=请求的 sub（update/upgrade 重新定位的 hint）；rpath=repo 内命中的真实目录（UI 链接用，防 404）
    provenance: { registry: 'github', ref: `${owner}/${repo}`, path: sub, rpath: sub ? hit : null, pin: sha, via: got.via },
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
    if (rel.split('/').includes('..') || rel.includes('\\') || rel.startsWith('/')) continue;   // CDN 返回的清单也不盲信
    const res = await fetch(base + f, { signal: AbortSignal.timeout(30e3) });
    if (!res.ok) continue;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 50e6) continue;                                   // 单文件 50MB 上限
    const dest = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
  }
}
