// doctor — 环境健康检查（npm doctor 语义 + flutter 式工具链矩阵）
import fs from 'node:fs';
import path from 'node:path';
import { ok, warn, fail, info } from '../lib/render.js';
import { hubExists } from '../lib/hub.js';
import { scanSkillDir } from '../lib/scanner.js';
import { readSkillDir, treeHash } from '../lib/package.js';
import { execFileSync } from 'node:child_process';
import { L } from '../lib/i18n.js';

const NODE_MIN = 22;

async function ping(url, ms = 3000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
    return res.status;
  } catch { return 0; } finally { clearTimeout(t); }
}

// lock vs 实测投影漂移
function driftCheck(ctx) {
  const drift = [];
  for (const [name, entry] of Object.entries(ctx.lock.skills || {})) {
    for (const [target, t] of Object.entries(entry.targets || {})) {
      let dir = null;
      if (target.startsWith('custom:')) dir = target.slice(7);
      else {
        const h = ctx.harnesses.find((x) => x.id === target);
        dir = h?.dirs.find((d) => d.exists)?.path ?? h?.dirs[0]?.path;
      }
      if (!dir) continue;
      const skillDir = path.join(dir, name);
      if (!fs.existsSync(skillDir)) { drift.push({ name, target, issue: 'missing' }); continue; }
      const actual = treeHash(skillDir);
      if (actual !== t.hash) drift.push({ name, target, issue: 'content-differs' });
    }
  }
  return drift;
}

export async function run(ctx) {
  const checks = [];
  const say = (okFlag, msg, extra) => {
    checks.push({ ok: okFlag, msg, ...(extra || {}) });
    (okFlag === true ? ok : okFlag === 'warn' ? warn : fail)(msg);
  };

  // node 版本
  const major = +process.versions.node.split('.')[0];
  say(major >= NODE_MIN, `node ${process.versions.node}${major < NODE_MIN ? ` — need ≥${NODE_MIN}` : ''}`);

  // hub
  const exists = hubExists(ctx.hub);
  let writable = false;
  try { fs.mkdirSync(ctx.hub, { recursive: true }); fs.accessSync(ctx.hub, fs.constants.W_OK); writable = true; } catch {}
  say(writable, `hub ${ctx.hub} ${exists ? '' : '(skeleton only) '}${writable ? '(writable)' : '(NOT WRITABLE)'}`);

  // harness 矩阵
  const hrows = [];
  for (const h of ctx.harnesses) {
    const dir = h.dirs.find((d) => d.exists) ?? h.dirs[0];
    const skills = dir?.exists ? scanSkillDir(dir.path).length : 0;
    const note = h.detectOnly ? 'detect-only' : h.state === 'available' ? 'bin only — dir will create'
      : h.state === 'likely' ? L('dir only — 装过?', 'dir only — installed?') : h.state === 'absent' ? '' : `${skills} skills`;
    hrows.push({ id: h.id, dir: dir?.path ?? '-', state: h.state, note });
  }
  const hInstalled = hrows.filter((r) => r.state === 'installed').length;
  say(hInstalled > 0 || hrows.some((r) => r.state !== 'absent'), 'harnesses detected:');
  for (const r of hrows) info(`${r.id.padEnd(12)} ${r.dir.padEnd(34)} ${r.state.padEnd(10)} ${r.note}`);

  // registries 连通
  const regs = ctx.config.registries;
  const regNotes = [];
  for (const r of regs) {
    if (r.type === 'github') {
      let gh = true;
      try { execFileSync('gh', ['--version'], { stdio: 'ignore' }); } catch { gh = false; }
      regNotes.push(`github${r.default ? ' (default)' : ''}${gh ? '' : ' — gh CLI missing!'}`);
      if (!gh) say('warn', 'registry github: gh CLI not found');
    } else if (r.url) {
      const code = await ping(r.url);
      regNotes.push(`${r.type} ${r.url}${code ? '' : ' — unreachable'}`);
      if (!code) say('warn', `registry ${r.type} ${r.url}: unreachable`);
    }
  }
  say(regNotes.length > 0, `registries: ${regNotes.join(', ') || 'none'}`);

  // llm 已配状态（不探端口——探测只在 init/config）
  if (ctx.llm) say(true, `llm configured: ${ctx.llm.model} @ ${ctx.llm.base_url}`);
  else {
    say('warn', L('llm not configured — LLM features disabled (audit/conflicts/diff 降级静态)', 'llm not configured — LLM features disabled (audit/conflicts/diff fall back to static)'));
    info(L('→ 跑 skillmkt init 一键配置', '→ run skillmkt init for one-step setup'));
  }

  // drift
  const drift = exists ? driftCheck(ctx) : [];
  if (drift.length) say('warn', `projection drift: ${drift.length} (run: skillmkt sync)`);
  else if (exists) say(true, 'projections in sync');

  const bad = checks.filter((c) => c.ok === false).length;
  const warns = checks.filter((c) => c.ok === 'warn').length;
  if (ctx.flags.json) {
    console.log(JSON.stringify({ node: process.versions.node, hub: ctx.hub, harnesses: hrows, drift, checks, ok: bad === 0 }, null, 2));
  }
  if (bad) { fail(`${bad} check(s) failed`); return 1; }
  if (warns) info(`${warns} warning(s)`);
  return 0;
}
