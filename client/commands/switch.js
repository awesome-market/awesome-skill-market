// switch — 在留档版本间切换（纯本地不联网）：--to <key|version|pin> 直指；TTY 无参列单选
import fs from 'node:fs';
import path from 'node:path';
import { historySnapshot, historyRestore, historyList } from '../lib/state.js';
import { historyDir, registerSkill, updateLock } from '../lib/hub.js';
import { projectSkill, targetDirFor } from '../lib/project.js';
import { treeHash, readSkillDir } from '../lib/package.js';
import { choose } from '../lib/prompt.js';
import { ok, fail, info } from '../lib/render.js';
import { L } from '../lib/i18n.js';

const label = (v) => `${v.key}${v.version ? ` · ${v.version}` : ''}${v.source?.pin ? ` · pin ${String(v.source.pin).slice(0, 7)}` : ''}`;

// 应用一次切换：当前内容先补档（key 已有则跳过）→ 恢复目标 → 重投影 → 元数据回写
export function applySwitch(ctx, name, pick) {
  const s = ctx.library.skills?.[name];
  if (!s) return null;
  const dest = path.join(ctx.hub, 'skills', name);
  if (!ctx.flags.dryRun) {
    if (fs.existsSync(dest)) historySnapshot(ctx.hub, name, s);   // 当前态也留档——切换双向可逆
    historyRestore(ctx.hub, name, pick.key);
    const lockTargets = {};
    for (const t of s.targets || []) {
      const dir = targetDirFor(ctx, t, name);
      if (!dir) continue;
      const r = projectSkill(dest, name, dir, { mode: 'copy', force: true });
      lockTargets[t] = { hash: r.hash, projected_at: new Date().toISOString(), mode: 'copy' };
    }
    updateLock(ctx.hub, name, treeHash(dest), lockTargets);
    const restored = readSkillDir(dest);
    registerSkill(ctx.hub, name, { ...s, source: pick.source || s.source, version: pick.version || restored?.version || s.version });
  }
  return true;
}

export async function run(ctx) {
  const name = ctx.args[0];
  if (!name || ctx.args.length > 1) { fail(L('用法: skillmkt switch <名字> [--to <key|version|pin>]', 'usage: skillmkt switch <name> [--to <key|version|pin>]')); return 1; }
  const s = ctx.library.skills?.[name];
  if (!s) { fail(L(`没纳入管理: ${name}`, `not managed: ${name}`)); return 1; }
  const vers = historyList(ctx.hub, name);
  if (!vers.length) { fail(L(`${name}: 无留档版本（版本变更时会自动存一份）`, `${name}: no archived versions (one is stored on every version change)`)); return 1; }

  const curHash = fs.existsSync(path.join(ctx.hub, 'skills', name)) ? treeHash(path.join(ctx.hub, 'skills', name)) : null;
  const to = ctx.flags.raw.to;
  let pick = null;
  if (to) {
    pick = vers.find((v) => v.key === to || v.key.startsWith(to) || v.version === to || String(v.source?.pin || '').startsWith(to));
    if (!pick) { fail(L(`没匹配的留档: ${to}（可选：${vers.map((v) => v.key).join(', ')}）`, `no archive matches: ${to} (have: ${vers.map((v) => v.key).join(', ')})`)); return 1; }
  } else if (process.stdin.isTTY && !ctx.flags.yes) {
    const opts = vers.map((v) => ({ label: `${label(v)}${v.hash && v.hash === curHash ? L('（当前）', ' (current)') : ''}`, _v: v }));
    pick = (await choose(L(`切换到哪个版本？`, `Switch to which version?`), opts))?._v || null;
  } else pick = vers[0];   // 非交互/--yes：切最近一份留档
  if (!pick) return 1;

  if (pick.hash && pick.hash === curHash) { info(L(`${name} 已是该版本`, `${name} is already at that version`)); return 0; }
  if (!applySwitch(ctx, name, pick)) return 1;
  ok(`${ctx.flags.dryRun ? '[dry-run] ' : ''}${L(`已切换 ${name} → ${pick.version || pick.key}`, `switched ${name} → ${pick.version || pick.key}`)}`);
  return 0;
}
