// build [--check] [--out dir] — merged/rules.yml + decisions → 产物 SKILL.md
// pending 冲突双边按 rule hash 排除（不是 id——id 会随重抽漂移）
import fs from 'node:fs';
import path from 'node:path';
import { loadConflicts } from '../lib/conflicts.js';
import { activeDecisions } from '../lib/decide.js';
import { readYAML } from '../../pipeline/lib/util.js';
import { ok, warn, fail, info } from '../lib/render.js';
import { mergedDir } from './merge.js';
import { L } from '../lib/i18n.js';

export function buildSkill(hub) {
  const mPath = path.join(mergedDir(hub), 'rules.yml');
  if (!fs.existsSync(mPath)) return null;
  const merged = readYAML(mPath);
  const decisions = activeDecisions(hub);
  const pending = loadConflicts(hub, { pendingOnly: true });
  const blocked = new Set(pending.flatMap((c) => c.sides.map((s) => s.hash)));
  // 已决 hash：keep-x 排除另一方；merge 排除双方（custom 文本单独注入）；dismissed 双边保留
  const decidedRm = new Set(), customs = [];
  const allConflicts = loadConflicts(hub);
  for (const [fp, d] of decisions) {
    const c = allConflicts.find((x) => x.fingerprint === fp);
    if (!c) continue;
    if (d.resolution === 'keep-a') decidedRm.add(c.sides[1].hash);
    else if (d.resolution === 'keep-b') decidedRm.add(c.sides[0].hash);
    else if (d.resolution === 'merge') { c.sides.forEach((s) => decidedRm.add(s.hash)); if (d.custom) customs.push({ text: d.custom, sources: c.sides.map((s) => s.source) }); }
  }
  const kept = (merged.rules || []).filter((r) => !blocked.has(r.hash) && !decidedRm.has(r.hash));
  return { merged, kept, customs, pending: pending.length };
}

export async function run(ctx) {
  const b = buildSkill(ctx.hub);
  if (!b) { fail(L('无 merged/rules.yml — 先 skillmkt merge', 'no merged/rules.yml — run skillmkt merge first')); return 1; }
  const { merged, kept, customs, pending } = b;
  // 渲染：域分组 + provenance 注释
  const byDom = new Map();
  for (const r of kept) { (byDom.get(r.domain) || byDom.set(r.domain, []).get(r.domain)).push(r); }
  let md = `---\nname: ${merged.name}\ndescription: merged skill (${merged.sources.join(' + ')})\nversion: 0.1.0\n---\n\n# ${merged.name}\n\n> merged from: ${merged.sources.join(', ')} · ${kept.length} rules · ${pending} pending conflicts excluded\n`;
  for (const [dom, rules] of byDom) {
    md += `\n## ${dom}\n`;
    for (const r of rules) md += `\n- ${r.text} <!-- ${r.source}:${r.id} -->`;
    md += '\n';
  }
  if (customs.length) {
    md += '\n## merged-decisions\n';
    for (const c of customs) md += `\n- ${c.text} <!-- merge:${c.sources.join('+')} -->`;
    md += '\n';
  }
  const outDir = ctx.flags.raw.out ? path.resolve(ctx.flags.raw.out) : path.join(mergedDir(ctx.hub), 'skill-out');
  if (ctx.flags.raw.check) {
    const f = path.join(outDir, 'SKILL.md');
    const same = fs.existsSync(f) && fs.readFileSync(f, 'utf8') === md;
    console.log(same ? 'build --check: ok' : 'build --check: STALE');
    return same ? 0 : 1;
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'SKILL.md'), md);
  ok(`built ${outDir}/SKILL.md — ${kept.length} rules${pending ? L(`，⚠ ${pending} pending 双边已排除`, ` — ⚠ ${pending} pending, both sides excluded`) : ''}`);
  return pending ? 3 : 0;
}
