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
    const row = { name, version: s.version || '-', audit: s.audit || '-', conflicts: pendingBySide.get(name) || 0, source: s.source?.registry || '?' };
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
      else info(L('(empty — skillmkt search / install 开始)', '(empty — skillmkt search / install to start)'));
      if (extRows.length) {
        info('');
        info(L('external（未收编）:', 'external (unmanaged):'));
        for (const e of extRows) info(`  ${e.name.padEnd(30)} ${e.dir}`);
        info(L(`→ skillmkt install <path> 收编`, `→ skillmkt install <path> to adopt`));
      }
      if (ctx.project) {
        const projRows = rows.filter((r) => r.where === 'project');
        if (projRows.length) {
          info('');
          info(`project ${ctx.project.root}:`);
          for (const r of projRows) info(`  ${r.state === 'managed' ? '●' : '◌'} ${r.name}  ${r.targetDir}`);
        }
      }
    },
  });
  return 0;
}
