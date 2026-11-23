// render.js — 终端表格/卡片/仪表盘；装饰全走 stderr，--json 时 stdout 纯数据
import { L } from './i18n.js';
const err = (...a) => console.error(...a);

export function table(rows, cols) {
  const widths = cols.map((c) => Math.max(c.title.length, ...rows.map((r) => String(r[c.key] ?? '').length)));
  const line = (cells) => '  ' + cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ').trimEnd();
  err(line(cols.map((c) => c.title)));
  for (const r of rows) err(line(cols.map((c) => r[c.key])));
}

export function out(data, { json = false, human = null } = {}) {
  if (json) {
    console.log(JSON.stringify(data, null, 2));
  } else if (human) {
    human();
  } else {
    console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  }
}

export const ok = (s) => err(`✓ ${s}`);
export const warn = (s) => err(`⚠ ${s}`);
export const fail = (s) => err(`✗ ${s}`);
export const info = (s) => err(`  ${s}`);

// 裸跑仪表盘：只摆"需要注意力"的信息
export function dashboard({ hub, library, scan, upstream, conflicts, llm, llmVia, configFile = true, project }) {
  const skills = Object.keys(library.skills || {});
  const updates = Object.keys(upstream?.skills || {}).filter(
    (n) => upstream.skills[n]?.tree_hash !== (scan.managedHash?.[n] ?? null) && upstream.skills[n]
  ).length;
  const pending = conflicts.filter((c) => c.status === 'pending').length;
  const externals = scan.rows.filter((r) => r.state === 'external').length;
  const audits = skills.map((n) => library.skills[n].audit);
  const bad = audits.filter((a) => a === 'suspicious' || a === 'quarantined').length;

  err(`skillmkt · hub ${hub}${llm ? ` · llm ${llm.model} ✓${llmVia ? L(`（来自 ${llmVia}，未写 config.yml）`, ` (from ${llmVia}, not in config.yml)`) : ''}` : ''}`);
  err('');
  err(`skills      ${skills.length} installed${updates ? ` · ${updates} update available` : ''} · audit ${audits.length - bad}✓${bad ? `/${bad}⚠` : ''}`);
  const hs = scan.harnesses.filter((h) => h.state !== 'absent')
    .map((h) => `${h.id}${h.state === 'installed' ? '●' : h.state === 'available' ? '○available' : '~likely'}`);
  if (hs.length) err(`harnesses   ${hs.join('  ')}`);
  if (project) err(`project     ${project.root}`);
  if (pending) err(`conflicts   ${pending} pending — ${L('需要裁决', 'needs your decision')}`);
  if (externals) err(`external    ${externals} ${L('未收编 — install <path> 纳入管理', 'unmanaged — `install <path>` to adopt')}`);
  err('');
  const hints = [];
  if (pending) hints.push(L('skillmkt conflicts --ui    裁决冲突（开面板看图）', 'skillmkt conflicts --ui    decide conflicts (visual panel)'));
  if (updates) hints.push(L('skillmkt outdated          看可更新项', 'skillmkt outdated          view updates'));
  if (!configFile) hints.push(L('skillmkt init              把设置写进 config.yml（现在全靠环境变量兜底）', 'skillmkt init              write settings to config.yml (currently env-only)'));
  hints.push(externals
    ? L('skillmkt list              安装矩阵 + ◌external 路径', 'skillmkt list              install matrix + ◌external paths')
    : L('skillmkt list              安装矩阵', 'skillmkt list              install matrix'));
  hints.push(L('skillmkt --help            全部命令', 'skillmkt --help            all commands'));
  hints.slice(0, 4).forEach((h) => err(h));
}
