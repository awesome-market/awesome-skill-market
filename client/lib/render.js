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

// 审核结论词 → 当前语言（clean/suspicious/stripped/malicious/quarantined）
export const auditTag = (v) => L({ clean: '✓', suspicious: '可疑', stripped: '已剔除', malicious: '恶意', quarantined: '已隔离' }[v] ?? v, v);

// 按终端显示宽度对齐（CJK 字符算 2 列）
const w = (s) => [...s].reduce((n, c) => n + (c.codePointAt(0) > 0x2e7f ? 2 : 1), 0);
export const pad = (s, n) => s + ' '.repeat(Math.max(0, n - w(s)));

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
  const audits = skills.map((n) => library.skills[n].audit);
  const bad = audits.filter((a) => a === 'suspicious' || a === 'quarantined').length;

  err(`skillmkt · hub ${hub}${llm ? ` · llm ${llm.model} ✓${llmVia ? L(`（来自 ${llmVia}，未写 config.yml）`, ` (from ${llmVia}, not in config.yml)`) : ''}` : ''}`);
  err('');
  err(`${pad(L('skill', 'skills'), 11)}${L(`${skills.length} 个已管理`, `${skills.length} installed`)}${updates ? ` · ${L(`${updates} 个可更新`, `${updates} update available`)}` : ''} · ${L(`审核`, 'audit')} ${audits.length - bad}✓${bad ? `/${bad}⚠` : ''}`);
  // 按状态分组展示（已装/可装；likely 探测不确定不显示）
  const grp = (st) => scan.harnesses.filter((h) => h.state === st).map((h) => h.id);
  const parts = [
    grp('installed').length && `${L('已装', 'installed')} ${grp('installed').join(' ')}`,
    grp('available').length && `${L('可装', 'installable')} ${grp('available').join(' ')}`,
  ].filter(Boolean);
  if (parts.length) err(`${pad(L('agent', 'agents'), 11)}${parts.join(' · ')}`);
  if (project) err(`${pad(L('项目', 'project'), 11)}${project.root}`);
  if (pending) err(`${pad(L('冲突', 'conflicts'), 11)}${L(`${pending} 个待裁决`, `${pending} pending`)} — ${L('需要裁决', 'needs your decision')}`);
  // 散在 agent 目录的外部 skill 不显示——只有 `list --scan` 主动扫描才列
  err('');
  const hints = [];
  if (pending) hints.push(L('skillmkt conflicts --ui    裁决冲突（开面板看图）', 'skillmkt conflicts --ui    decide conflicts (visual panel)'));
  if (updates) hints.push(L('skillmkt outdated          看可更新项', 'skillmkt outdated          view updates'));
  if (!configFile) hints.push(llmVia
    ? L('skillmkt init              把设置写进 config.yml（现在全靠环境变量兜底）', 'skillmkt init              write settings to config.yml (currently env-only)')
    : L('skillmkt init              初始化设置（语言/模型/目标 agent）', 'skillmkt init              set up language/model/agents'));
  hints.push(L('skillmkt list              列出所有 skill 及各自安装位置', 'skillmkt list              list all skills and where they are installed'));
  hints.push(L('skillmkt serve             启动 Web 面板（可视化操作）', 'skillmkt serve             start the web UI server'));
  hints.push(L('skillmkt --help            全部命令', 'skillmkt --help            all commands'));
  hints.slice(0, 6).forEach((h) => err(h));
}
