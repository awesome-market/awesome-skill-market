// dashboard.js — 裸跑数据汇聚 + 渲染（尊重 ui.enabled）
import fs from 'node:fs';
import path from 'node:path';
import { readYAMLFile, isInitialized } from './hub.js';
import { scanAll } from './scanner.js';
import { treeHash } from './package.js';
import { dashboard } from './render.js';
import { listYAML } from './yamlls.js';

export async function renderDashboard(ctx) {
  const { hub, library, harnesses, llm, project, config } = ctx;

  // ui.enabled=always → 前台起服务开面板（挂住流日志，Ctrl-C 一起退）
  if (config.ui.enabled === 'always' && ctx.tty && ctx.flags.ui !== 'off') {
    const { maybeHandoff } = await import('./daemon.js');
    if (await maybeHandoff(ctx, '/')) return 0;   // 接管后永不返回
  }

  const rows = scanAll(hub, harnesses, library, project?.root);
  const managedHash = {};
  for (const [name] of Object.entries(library.skills || {})) {
    const p = path.join(hub, 'skills', name);
    if (fs.existsSync(p)) managedHash[name] = treeHash(p);
  }
  const upstream = readYAMLFile(path.join(hub, 'state', 'upstream.yml'), { skills: {} });
  const conflicts = listYAML(path.join(hub, 'conflicts'));

  // llm 解析链有 env/.env 兜底——非 config 来源时标注，免得用户困惑
  const configFile = isInitialized(ctx.hub);
  dashboard({ hub, library, scan: { rows, harnesses, managedHash }, upstream, conflicts, llm, llmVia: llm?.via, configFile, project });
  return 0;
}
