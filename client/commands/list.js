// list (alias: ls) — 安装矩阵：skills×targets + external + pending 冲突数
import path from 'node:path';
import { table, out, info } from '../lib/render.js';
import { scanAll } from '../lib/scanner.js';
import { listYAML } from '../lib/yamlls.js';
import { L } from '../lib/i18n.js';

export async function run(ctx) {
  const { hub, library, harnesses, project } = ctx;
  const skills = library.skills || {};
  const rows = scanAll(hub, harnesses, library, project?.root);
  const externals = rows.filter((r) => r.state === 'external');
  const conflicts = listYAML(path.join(hub, 'conflicts'));
  const pendingBySide = new Map();
  for (const c of conflicts.filter((x) => x.status === 'pending')) {
    for (const s of c.sides || []) pendingBySide.set(s.source, (pendingBySide.get(s.source) || 0) + 1);
  }

  // 列：name + 每个出现过为 target 的 harness + audit + conflicts + source
  const allTargets = [...new Set(Object.values(skills).flatMap((s) => s.targets || []))];
  const tableRows = Object.entries(skills).map(([name, s]) => {
    const row = { name, version: s.version && s.version !== '0.0.0' ? s.version : '-', audit: s.audit || '-', conflicts: pendingBySide.get(name) || 0, source: s.source?.registry === 'wellknown' ? String(s.source?.ref || '').split('/')[0] || 'wellknown' : s.source?.registry || '?' };
    for (const t of allTargets) row[`t_${t}`] = (s.targets || []).includes(t) ? `●${(s.transport?.[t] || 'copy').slice(0, 4)}` : '—';
    return row;
  });
  const cols = [
    { key: 'name', title: 'skill' }, { key: 'version', title: 'ver' },
    ...allTargets.map((t) => ({ key: `t_${t}`, title: t.slice(0, 8) })),
    { key: 'audit', title: 'audit' }, { key: 'conflicts', title: 'conf' }, { key: 'source', title: 'src' },
  ];

  const extRows = externals.map((e) => ({ name: `◌${e.name}`, dir: e.targetDir || e.where, ver: e.version }));
  const data = { managed: tableRows, external: extRows, targets: allTargets };

  out(data, {
    json: ctx.flags.json,
    human: () => {
      if (tableRows.length) table(tableRows, cols);
      else info(L('（清单是空的——先 skillmkt install <路径> 收一个进来，或 skillmkt search 去搜）', '(list is empty — skillmkt install <path> to add one, or skillmkt search to find one)'));
      if (extRows.length) {
        if (ctx.flags.raw.scan) {
          info('');
          info(L('这些 skill 在 agent 目录里，但还没纳入管理：', 'these skills exist in agent dirs but are not managed yet:'));
          for (const e of extRows) info(`  ${e.name.padEnd(30)} ${e.dir}`);
          const ex = extRows[0];
          info(L(`→ 收一个进来试试：skillmkt install ${ex.dir}/${ex.name.slice(1)}`, `→ to manage one, e.g.: skillmkt install ${ex.dir}/${ex.name.slice(1)}`));
        } else {
          info(L(`（另有 ${extRows.length} 个 skill 散在 agent 目录——skillmkt list --scan 查看）`, `(${extRows.length} more skills scattered in agent dirs — skillmkt list --scan to view)`));
        }
      }
      if (ctx.project) {
        const projRows = rows.filter((r) => r.where === 'project');
        if (projRows.length) {
          info('');
          info(L(`项目 ${ctx.project.root}:`, `project ${ctx.project.root}:`));
          for (const r of projRows) info(`  ${r.state === 'managed' ? '●' : '◌'} ${r.name}  ${r.targetDir}`);
        }
      }
    },
  });
  return 0;
}
