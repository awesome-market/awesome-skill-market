// audit [name|--all] — 重跑静态审核刷新 scans/；--llm 附加语义审（批次6 全量）
import path from 'node:path';
import fs from 'node:fs';
import { auditDir, writeScan, verdictOf, RULE_IDS } from '../lib/audit.js';
import { llmAudit } from '../lib/ai.js';
import { walk } from '../lib/package.js';
import { ok, warn, fail, info, auditTag } from '../lib/render.js';
import { readLibrary, writeLibrary } from '../lib/hub.js';
import { readYAML } from '../../pipeline/lib/util.js';
import { L } from '../lib/i18n.js';

export async function run(ctx) {
  const flags = ctx.flags.raw;
  const skills = ctx.library.skills || {};
  if (flags.allow && !RULE_IDS.includes(flags.allow)) { fail(L(`未知规则 id: ${flags.allow}（可选: ${RULE_IDS.join(' ')}）`, `unknown rule id: ${flags.allow} (one of: ${RULE_IDS.join(' ')})`)); return 1; }
  if (flags.all && ctx.args.length) { fail(L('--all 和指定名字只能二选一', '--all and specific names are mutually exclusive')); return 1; }
  const names = flags.all ? Object.keys(skills) : ctx.args;
  if (!names.length) { fail(L('用法: skillmkt audit <名字|--all> [--llm] [--allow <规则id>]', 'usage: skillmkt audit <name|--all> [--llm] [--allow <rule-id>]')); return 1; }
  let worst = 'clean';
  const order = { clean: 0, suspicious: 1, stripped: 1, malicious: 2 };
  for (const name of names) {
    const dir = path.join(ctx.hub, 'skills', name);
    if (!fs.existsSync(dir)) { warn(L(`没纳入管理: ${name}`, `not managed: ${name}`)); continue; }
    const r = auditDir(dir, { strip: false });
    // --llm：additive 语义审（静态结论之上，降级安全）
    if (flags.llm && ctx.llm) {
      const files = [...walk(dir)].filter((p) => /\.(md|txt|js|sh|py)$/i.test(p))
        .map((p) => ({ path: path.relative(dir, p), content: fs.readFileSync(p, 'utf8') }));
      const lr = await llmAudit(ctx.llm, { name, files }).catch(() => null);
      if (lr) { r.llm = lr; info(`  llm: ${lr.verdict}${lr.reasons?.length ? ` — ${lr.reasons.join('; ')}` : ''}`); }
      else warn(L('  LLM 审核不可用——沿用静态检查结论', '  llm audit unavailable — keeping static verdict'));
    }
    // 豁免：历史 allow + 本次 --allow；豁免的 finding 标 allowed 不定罪但留档
    const old = readYAML(path.join(ctx.hub, 'scans', `${name}.yml`)) || {};
    const allow = [...new Set([...(old.allow || []), ...(flags.allow ? [flags.allow] : [])])];
    for (const f of r.findings) if (allow.includes(f.rule)) f.allowed = true;
    r.verdict = verdictOf(r.findings, r.stripped);
    writeScan(ctx.hub, name, r, { llm: r.llm || null, allow });
    // library 里的审核标记跟着最新结论走
    if (skills[name] && skills[name].audit !== r.verdict) {
      const lib = readLibrary(ctx.hub);
      if (lib.skills?.[name]) { lib.skills[name].audit = r.verdict; writeLibrary(ctx.hub, lib); }
    }
    if (order[r.verdict] > order[worst]) worst = r.verdict;
    const waived = r.findings.filter((f) => f.doc || f.allowed).length;
    info(`${name}: ${auditTag(r.verdict)}${r.findings.length ? L(`（${r.findings.length} 处发现${waived ? `，${waived} 处豁免` : ''}）`, ` (${r.findings.length} findings${waived ? `, ${waived} waived` : ''})`) : ''}`);
  }
  ok(L('审核完成', 'audit done'));
  return worst === 'malicious' ? 2 : 0;
}
