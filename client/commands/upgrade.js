// upgrade — apt upgrade：拉新→diff 摘要→重审→快照→重投影→改 lock；--dry-run 只演示
import fs from 'node:fs';
import path from 'node:path';
import { fetchSkill } from '../lib/registries/github.js';
import { readUpstream, setUpstream, historySnapshot } from '../lib/state.js';
import { auditDir, stripFilter, stripSummary, writeScan } from '../lib/audit.js';
import { readSkillDir, walk, rmDir, treeHash } from '../lib/package.js';
import { projectSkill, targetDirFor } from '../lib/project.js';
import { registerSkill, updateLock } from '../lib/hub.js';
import { fetchMirror } from '../lib/registries/index.js';
import { ok, warn, fail, info, auditTag } from '../lib/render.js';
import { L } from '../lib/i18n.js';

function copyFiltered(src, dst, keep) {
  fs.mkdirSync(dst, { recursive: true });
  for (const p of walk(src)) {
    const rel = path.relative(src, p).split(path.sep).join('/');
    if (!keep(rel)) continue;
    const d = path.join(dst, rel);
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.copyFileSync(p, d);
  }
}

export async function run(ctx) {
  const flags = ctx.flags.raw;
  const up = readUpstream(ctx.hub);
  const skills = ctx.library.skills || {};
  if (flags.all && ctx.args.length) { fail(L('--all 和指定名字只能二选一', '--all and specific names are mutually exclusive')); return 1; }
  const names = flags.all ? Object.keys(skills) : ctx.args;
  if (!names.length) { fail(L('用法: skillmkt upgrade <名字|--all>', 'usage: skillmkt upgrade <name|--all>')); return 1; }

  let upgraded = 0;
  for (const name of names) {
    const s = skills[name];
    if (!s) { warn(L(`没纳入管理: ${name}`, `not managed: ${name}`)); continue; }
    const u = up.skills?.[name];
    if (!u?.outdated && !flags.force) { info(L(`${name}: clean（update 先刷新）`, `${name}: clean (run update first to refresh)`)); continue; }
    const src = s.source || {};
    if (src.registry !== 'github' || !src.ref) { warn(L(`${name}: 无上游可升级`, `${name}: no upstream to upgrade from`)); continue; }

    const [owner, repo] = src.ref.split('/');
    info(`${name}: ${L(`正在拉取 ${src.ref} …`, `fetching ${src.ref} …`)}`);
    try {
      const got = await fetchSkill({ owner, repo, ref: null, path: src.rpath || src.path || null, mirror: fetchMirror(ctx) });
      const pkg = readSkillDir(got.dir);
      const audit = auditDir(got.dir, { strip: !flags.keepScripts });
      if (audit.verdict === 'malicious') { warn(L(`${name}: 新版判定为恶意——保留旧版`, `${name}: new version audited malicious — keeping old version`)); continue; }
      if (ctx.flags.dryRun) {
        info(`[dry-run] ${name}: ${L(`${pkg?.fileCount ?? '?'} 个文件，审核:${auditTag(audit.verdict)}`, `${pkg?.fileCount ?? '?'} files, audit:${audit.verdict}`)}${audit.stripped.length ? L(`，剔除 ${audit.stripped.length} 个`, `, strip ${audit.stripped.length}`) : ''}`);
        continue;
      }
      historySnapshot(ctx.hub, name, s);
      const dest = path.join(ctx.hub, 'skills', name);
      rmDir(dest);
      copyFiltered(got.dir, dest, stripFilter(flags.keepScripts ? [] : audit.stripped));
      writeScan(ctx.hub, name, audit);
      // 重投影
      const lockTargets = {};
      for (const t of s.targets || []) {
        const dir = targetDirFor(ctx, t, name);
        if (!dir) continue;
        const r = projectSkill(dest, name, dir, { mode: 'copy' });
        lockTargets[t] = { hash: r.hash, projected_at: new Date().toISOString(), mode: 'copy' };
      }
      registerSkill(ctx.hub, name, { ...s, source: { ...src, pin: got.sha }, version: pkg?.version || s.version, installed_at: new Date().toISOString(), audit: audit.stripped.length ? 'stripped' : audit.verdict });
      updateLock(ctx.hub, name, treeHash(dest), lockTargets);
      setUpstream(ctx.hub, name, { ref: got.sha, outdated: false });
      upgraded++;
      ok(`${name} → ${got.sha.slice(0, 7)} ${L('审核', 'audit')}:${auditTag(audit.verdict)}`);
      for (const g of stripSummary(audit.stripped)) info(`  ${L('剥离', 'strip')} ${g.key === 'exec' ? L('可执行文件', 'executables') : `${g.key.slice(4)}/`}: ${g.files.length} ${L('个', '')}`);
    } catch (e) {
      warn(`${name}: ${L('升级失败', 'upgrade failed')} — ${e.message.slice(0, 100)}`);
    }
  }
  ok(L(`upgrade 完成：应用了 ${upgraded} 个`, `upgrade done: ${upgraded} applied`));
  return 0;
}
