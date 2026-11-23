// project.js — copy 投影（hub 权威）+ drift 校验；--link 可选 symlink
import fs from 'node:fs';
import path from 'node:path';
import { treeHash, copyDir, rmDir, readSkillDir } from './package.js';
import { primaryDir } from './scanner.js';
import { L } from './i18n.js';

// 投影单个 skill 到目标目录 → {target, hash, action}
export function projectSkill(srcDir, name, targetDir, { mode = 'copy', dryRun = false, force = false, lockEntry = null } = {}) {
  const dest = path.join(targetDir, name);
  const srcHash = treeHash(srcDir);

  if (fs.existsSync(dest)) {
    const destHash = treeHash(dest);
    if (destHash === srcHash) return { target: dest, hash: srcHash, action: 'skipped', mode };
    // 漂移：lock 记的是旧版 → 正常更新；lock 记的与现场不符 → 手动改过的 unmanaged 内容
    const managedDrift = lockEntry && lockEntry.hash === destHash;
    if (!managedDrift && !force) {
      return { target: dest, hash: srcHash, action: 'conflict', mode, detail: 'unmanaged content differs — --force to overwrite' };
    }
  }

  if (dryRun) return { target: dest, hash: srcHash, action: fs.existsSync(dest) ? 'would-update' : 'would-create', mode };
  rmDir(dest);
  if (mode === 'link') {
    try {
      fs.symlinkSync(srcDir, dest, 'dir');
      return { target: dest, hash: srcHash, action: 'linked', mode };
    } catch { /* 降级 copy */ }
  }
  fs.mkdirSync(targetDir, { recursive: true });
  copyDir(srcDir, dest);
  return { target: dest, hash: srcHash, action: 'copied', mode: 'copy' };
}

export function unproject(name, targetDir, { dryRun = false } = {}) {
  const dest = path.join(targetDir, name);
  if (!fs.existsSync(dest)) return { target: dest, action: 'absent' };
  if (!dryRun) rmDir(dest);
  return { target: dest, action: dryRun ? 'would-remove' : 'removed' };
}

// lock vs 实测漂移（doctor/sync --dry-run 共用）
export function checkDrift(ctx) {
  const drift = [];
  for (const [name, entry] of Object.entries(ctx.lock.skills || {})) {
    for (const [target, t] of Object.entries(entry.targets || {})) {
      const dir = targetDirFor(ctx, target, name);
      if (!dir) continue;
      const skillDir = path.join(dir, name);
      if (!fs.existsSync(skillDir)) { drift.push({ name, target, issue: 'missing' }); continue; }
      if (treeHash(skillDir) !== t.hash) drift.push({ name, target, issue: 'content-differs' });
    }
  }
  return drift;
}

// target 标识 → 物理目录（harness id 或 custom:<abs> 或 project:<abs>）
export function targetDirFor(ctx, target, _name) {
  if (target.startsWith('custom:')) return target.slice(7);
  if (target.startsWith('project:')) return target.slice(8);
  const h = ctx.harnesses.find((x) => x.id === target);
  return h ? primaryDir(h) : null;
}

// 解析目标集：--to/--target/--scope/default_targets
export function resolveTargets(ctx, { allowAdopted = null } = {}) {
  const f = ctx.flags.raw;
  if (f.to && f.target) throw new Error(L('--to 与 --target 互斥', '--to and --target are mutually exclusive'));
  if (f.to) return [{ id: `custom:${path.resolve(expandTilde(f.to))}`, dir: path.resolve(expandTilde(f.to)), mode: f.link ? 'link' : 'copy' }];
  if (f.scope === 'project' || f.scope === 'repo') {
    if (!ctx.project) throw new Error(L('--scope project 需在仓库目录内运行', '--scope project must run inside a repo directory'));
    const out = [];
    for (const h of ctx.harnesses) {
      if (h.detectOnly) continue;
      for (const pd of h.projectDirs || []) {
        const dir = path.join(ctx.project.root, pd);
        out.push({ id: `project:${dir}`, dir, mode: 'copy' });
      }
    }
    return dedup(out);
  }
  const ids = f.target ? String(f.target).split(',') : (ctx.config.default_targets.length ? ctx.config.default_targets : allowAdopted);
  const out = [];
  for (const id of ids || []) {
    if (id.startsWith('custom:')) { out.push({ id, dir: id.slice(7), mode: 'copy' }); continue; }
    const custom = ctx.config.targets[id];
    if (custom) { out.push({ id: `custom:${path.resolve(expandTilde(custom.path))}`, dir: path.resolve(expandTilde(custom.path)), mode: custom.transport === 'link' ? 'link' : 'copy' }); continue; }
    const h = ctx.harnesses.find((x) => x.id === id);
    if (!h) { if (ids) throw new Error(L(`未知目标: ${id}`, `unknown target: ${id}`)); continue; }
    const dir = primaryDir(h);
    if (dir) out.push({ id, dir, mode: 'copy' });
  }
  return dedup(out);
}

const dedup = (arr) => [...new Map(arr.map((t) => [t.dir, t])).values()];
const expandTilde = (p) => (p.startsWith('~') ? path.join(process.env.HOME || '', p.slice(1)) : p);
