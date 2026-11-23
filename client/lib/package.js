// package.js — SkillPackage 归一化、tree-hash、frontmatter 解析
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const FRONT_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(file) {
  try {
    const src = fs.readFileSync(file, 'utf8');
    const m = src.match(FRONT_RE);
    const meta = {};
    if (m) {
      for (const line of m[1].split('\n')) {
        const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
        if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
      }
    }
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
    else if (e.isFile() || e.isSymbolicLink()) yield p;
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
    else fs.copyFileSync(s, d);
  }
}

export function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
