// dashboard.js — 裸跑数据汇聚 + 渲染（尊重 ui.enabled）
import fs from 'node:fs';
import path from 'node:path';
import { readYAMLFile } from './hub.js';
import { scanAll } from './scanner.js';
import { treeHash } from './package.js';
import { dashboard } from './render.js';
import { listYAML } from './yamlls.js';

export function renderDashboard(ctx) {
  const { hub, library, harnesses, llm, project, config } = ctx;

  // ui.enabled=always → 开面板（daemon 接管，批次7 实装前降级终端仪表盘）
  if (config.ui.enabled === 'always' && ctx.tty && ctx.flags.ui !== 'off') {
    // TODO(batch7): ensureDaemon + openURL('/')
  }

  const rows = scanAll(hub, harnesses, library, project?.root);
  const managedHash = {};
  for (const [name] of Object.entries(library.skills || {})) {
    const p = path.join(hub, 'skills', name);
    if (fs.existsSync(p)) managedHash[name] = treeHash(p);
  }
  const upstream = readYAMLFile(path.join(hub, 'state', 'upstream.yml'), { skills: {} });
  const conflicts = listYAML(path.join(hub, 'conflicts'));

  dashboard({ hub, library, scan: { rows, harnesses, managedHash }, upstream, conflicts, llm, project });
  return 0;
}
