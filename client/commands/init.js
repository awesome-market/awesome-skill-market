// init — 交互式初始化：形态选择（Web/终端）→ LLM 探测→选模型→冒烟→写配置→harness 默认目标
import fs from 'node:fs';
import { ensureHub, writeConfig, readConfig } from '../lib/hub.js';
import { probeEndpoints, chat } from '../lib/llm.js';
import { openURL, readDaemon, pidAlive } from '../lib/daemon.js';
import { choose, confirm } from '../lib/prompt.js';
import { ok, warn, fail, info } from '../lib/render.js';

export async function run(ctx) {
  ensureHub(ctx.hub);
  if (!ctx.tty) {
    info('non-interactive: hub 骨架已建，LLM 配置请用 skillmkt config set llm.*');
    return 0;
  }

  // 首问：初始化形态（写 ui.enabled——§3.11 自动接管与裸跑形态听它的）
  const mode = ctx.flags.ui === 'force' ? 'web' : ctx.flags.ui === 'off' ? 'cli'
    : (await choose('初始化方式？', [
        { label: 'Web 面板（推荐——探测结果、模型列表、harness 勾选可视化）', v: 'web' },
        { label: '终端向导（纯键盘，SSH/无浏览器环境）', v: 'cli' },
      ])).v;

  const raw = readConfig(ctx.hub)._raw;
  raw.ui = { ...(raw.ui || {}), enabled: mode === 'web' ? 'always' : 'auto' };
  writeConfig(ctx.hub, raw);   // ui 偏好先落盘（web 页内继续改其余键）

  if (mode === 'web') {
    // 前台语义：本进程=服务器，开页后挂住流日志，Ctrl-C 连服务一起退
    try {
      const d = readDaemon(ctx.hub);
      if (d && pidAlive(d.pid)) {
        ok(`Web 初始化已打开: ${openURL(d, '/#setup')}（服务已在别的终端跑）`);
        return 0;
      }
      const { startServer } = await import('./serve.js');
      const srv = await startServer(ctx, { quiet: false });
      const url = openURL({ port: srv.port, token: srv.token }, '/#setup');
      ok(`Web 初始化已打开: ${url}`);
      info('setup 页内：扫描端点 → 选模型 → 勾 agent → 保存（写入 config.yml）');
      info('服务前台运行中 — Ctrl-C 退出');
      await new Promise(() => {});
      return 0;
    } catch (e) {
      warn(`服务起不来（${e.message.slice(0, 60)}）——回退终端向导`);
    }
  }

  // LLM 端点探测（只在用户进入配置步骤时探测——铁律）
  info('探测本地 LLM 服务…');
  const found = await probeEndpoints(400, { extraBases: [ctx.config.llm?.base_url] });
  let base_url = null, model = null;

  if (found.length) {
    const opts = [
      ...found.flatMap((f) => f.models.slice(0, 6).map((m) => ({
        label: `${f.name}:${f.port} — ${m}`, v: { base_url: f.base_url, model: m },
      }))),
      { label: '手动输入端点', v: 'manual' },
      { label: '跳过（确定性功能照常用）', v: 'skip' },
    ];
    for (const f of found.filter((x) => x.needs_key)) {
      info(`发现 ${f.name}:${f.port}（需要密钥，模型列表读不出）——选"手动输入端点"后填 ${f.base_url}`);
    }
    const sel = await choose('选择模型端点：', opts);
    if (sel.v === 'manual') {
      // 手动输入交给 config set 提示
      info('→ skillmkt config set llm.base_url <url> && skillmkt config set llm.model <id>');
    } else if (sel.v !== 'skip') {
      ({ base_url, model } = sel.v);
    }
  } else {
    info('未发现本地 LLM 服务（已扫本机所有监听端口）');
    info('→ 手动：skillmkt config set llm.base_url http://host:port/v1');
  }

  // API key 环境变量引用（不存真值）
  if (base_url) {
    const keyEnv = await choose('API key 来源？', [
      { label: '无需 key（本地端点常见）', v: null },
      { label: 'SKILLMKT_API_KEY', v: 'env:SKILLMKT_API_KEY' },
      { label: 'OMLX_API_KEY', v: 'env:OMLX_API_KEY' },
    ]);
    raw.llm = { base_url, model, ...(keyEnv.v ? { api_key: keyEnv.v } : {}), concurrency: 2, timeout_ms: 60000 };

    // 冒烟：真实 chat 调用
    try {
      const probe = { base_url, model, api_key: keyEnv.v ? process.env[keyEnv.v.slice(4)] ?? '' : '', timeout_ms: 15000 };
      const reply = await chat(probe, { user: 'Reply with exactly: OK', maxTokens: 8 });
      ok(`llm smoke: ${reply.trim().slice(0, 40) || '(empty reply)'}`);
    } catch (e) {
      warn(`llm smoke failed: ${e.message}（配置已写入，功能将降级）`);
    }
  }

  // harness 默认目标 = installed 态
  const installed = ctx.harnesses.filter((h) => h.state === 'installed' && !h.detectOnly).map((h) => h.id);
  raw.default_targets = [...new Set([...(raw.default_targets || []), ...installed])];
  writeConfig(ctx.hub, raw);

  ok(`init done — default_targets: ${raw.default_targets.join(', ') || '（无 installed harness，装好后 targets add）'}`);
  info(`llm: ${model ? `${model} @ ${base_url}` : '未配置（skillmkt init 随时重跑）'}`);
  return 0;
}
