// package.js — SkillPackage 归一化、tree-hash、frontmatter 解析
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';

const FRONT_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

// skill 名安全字集：Unicode 字母/数字 + . _ -，首字符须字母数字——挡 / \ .. 路径逃逸（name 来自不可信 SKILL.md frontmatter）
export const safeName = (n) => typeof n === 'string' && /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,79}$/u.test(n);

// 目录内含判定：startsWith 必须带分隔符——挡 /hub/evidence-evil 同前缀兄弟目录逃逸
export const insideDir = (base, f) => { const r = path.resolve(f), b = path.resolve(base); return r === b || r.startsWith(b + path.sep); };

// 外部数据源给的 URL host：只认 https + 正常域名（挡 IP literal / user:pass@ / http 注入）
export const isSafeHost = (origin) => {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'https:' || u.username || u.password) return false;
    return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z0-9-]+$/i.test(u.hostname) && !/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname);
  } catch { return false; }
};

// 外部数据源给的落盘相对路径：只允许正常段——挡 ../、\、绝对路径、空段（输入可含 % 编码）
export const isSafeRel = (r) => {
  try { r = decodeURIComponent(r); } catch { return false; }
  return /^[A-Za-z0-9._\-/]+$/.test(r) && !r.split('/').some((s) => s === '..' || s === '' || s === '.');
};

export function parseFrontmatter(file) {
  try {
    const src = fs.readFileSync(file, 'utf8');
    const m = src.match(FRONT_RE);
    const meta = m ? (YAML.parse(m[1]) || {}) : {};
    // skills.sh 惯例：version 常藏在 metadata.version
    if (meta.version == null && meta.metadata?.version != null) meta.version = String(meta.metadata.version);
    return { meta, body: src.replace(FRONT_RE, '') };
  } catch {
    return { meta: {}, body: '' };
  }
}

export function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;   // symlink 不当文件——防 link→~/.ssh/id_rsa 内容被当 skill 文件拷走（copyDir/hash 同理不跟随）
  }
}

// 排序路径+内容哈希；目录名不参与（重命名稳定）
export function treeHash(dir) {
  const h = crypto.createHash('sha256');
  for (const p of walk(dir)) {
    const rel = path.relative(dir, p).split(path.sep).join('/');
    h.update(rel);
    h.update('\0');
    try { h.update(fs.readFileSync(p)); } catch { /* unreadable → skip */ }
    h.update('\n');
  }
  return 'sha256:' + h.digest('hex');
}

export function readSkillDir(absPath) {
  const skill = path.join(absPath, 'SKILL.md');
  if (!fs.existsSync(skill)) return null;
  const { meta } = parseFrontmatter(skill);
  const files = [...walk(absPath)].map((p) => path.relative(absPath, p));
  return {
    name: meta.name || path.basename(absPath),
    version: meta.version || '0.0.0',
    description: meta.description || '',
    path: absPath,
    files,
    fileCount: files.length,
    contentHash: treeHash(absPath),
    meta,
  };
}

export function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);   // 只拷普通文件——symlink/fifo 一律跳过
  }
}

export function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// 远端 tar 预检：只允许普通文件(-)+目录(d)——挡 ../、绝对路径、symlink/hardlink/pax header 写穿逃逸
export function assertSafeTar(tarPath) {
  const names = execFileSync('tar', ['tzf', tarPath], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const types = execFileSync('tar', ['tvzf', tarPath], { encoding: 'utf8' }).split('\n').filter((l) => l.trim()).map((l) => l[0]);
  if (names.length !== types.length) throw new Error('archive member listing mismatch');   // 对齐不了宁可拒包
  for (let i = 0; i < names.length; i++) {
    const n = names[i];
    if (n.startsWith('/') || /^[A-Za-z]:/.test(n) || n.split('/').includes('..') || n.includes('\\'))
      throw new Error(`unsafe member in archive: ${n}`);
    if (types[i] && types[i] !== '-' && types[i] !== 'd')
      throw new Error(`unsafe member type '${types[i]}' in archive: ${n}（skill 包不需要链接/设备文件）`);
  }
}

// fetch → 落盘（带超时+体积上限）——远端包防 OOM/挂死
export async function fetchToFile(url, dest, { timeout = 90e3, maxBytes = 200e6, headers = {} } = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeout), redirect: 'follow' });
  if (!res.ok) throw new Error(`fetch ${res.status}: ${url}`);
  const len = +(res.headers.get('content-length') || 0);
  if (len > maxBytes) throw new Error(`response too large: ${len} bytes`);
  let n = 0;
  const fd = fs.openSync(dest, 'w');
  try {
    for await (const chunk of res.body) {
      n += chunk.length;
      if (n > maxBytes) throw new Error(`response exceeds ${maxBytes} bytes`);
      fs.writeSync(fd, chunk);
    }
  } finally { fs.closeSync(fd); }
  return n;
}
