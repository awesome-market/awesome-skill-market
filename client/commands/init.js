// init — 交互式初始化：形态选择（Web/终端）→ LLM 探测→选模型→冒烟→写配置→harness 默认目标
import fs from 'node:fs';
import { ensureHub, writeConfig, readConfig } from '../lib/hub.js';
import { probeEndpoints, chat } from '../lib/llm.js';
import { openURL, readDaemon, pidAlive } from '../lib/daemon.js';
import { choose, confirm, ask } from '../lib/prompt.js';
import { ok, warn, fail, info } from '../lib/render.js';
import { L, lang, setUILang } from '../lib/i18n.js';

export async function run(ctx) {
  ensureHub(ctx.hub);
  if (!ctx.tty) {
    info(L('non-interactive: hub 骨架已建，LLM 配置请用 skillmkt config set llm.*', 'non-interactive: hub skeleton created — configure LLM with skillmkt config set llm.*'));
    return 0;
  }

  // 首问：初始化形态（写 ui.enabled——§3.11 自动接管与裸跑形态听它的）
  let mode = ctx.flags.ui === 'force' ? 'web' : ctx.flags.ui === 'off' ? 'cli' : null;
  while (!mode) {
    const sel = await choose(L('初始化方式？', 'Init method?'), [
      { label: L('Web 面板（推荐——探测结果、模型列表、harness 勾选可视化）', 'Web panel (recommended — visual probe results, model list, agent checkboxes)'), v: 'web' },
      { label: L('终端向导（纯键盘，SSH/无浏览器环境）', 'Terminal wizard (keyboard-only, for SSH/no-browser setups)'), v: 'cli' },
      { label: L('切换语言 / Switch language', 'Switch language / 切换语言'), v: 'lang' },
    ]);
    if (sel.v === 'lang') {   // 立刻 zh↔en：写 config + 换语言重问
      const next = lang() === 'zh' ? 'en' : 'zh';
      const r = readConfig(ctx.hub)._raw;
      r.ui = { ...(r.ui || {}), lang: next };
      writeConfig(ctx.hub, r);
      setUILang(next);
      continue;
    }
    mode = sel.v;
  }

  const raw = readConfig(ctx.hub)._raw;
  raw.ui = { ...(raw.ui || {}), enabled: mode === 'web' ? 'always' : 'auto' };
  writeConfig(ctx.hub, raw);   // ui 偏好先落盘（web 页内继续改其余键）

  if (mode === 'web') {
    // 前台语义：本进程=服务器，开页后挂住流日志，Ctrl-C 连服务一起退
    try {
      const d = readDaemon(ctx.hub);
      if (d && pidAlive(d.pid)) {
        ok(`Web 初始化已打开: ${openURL(d, '/#setup')}${L('（服务已在别的终端跑）', ' (server running in another terminal)')}`);
        return 0;
      }
      const { startServer } = await import('./serve.js');
      const srv = await startServer(ctx, { quiet: false });
      const url = openURL({ port: srv.port, token: srv.token }, '/#setup');
      ok(`${L('Web 初始化已打开', 'Web init opened')}: ${url}`);
      info(L('setup 页内：扫描端点 → 选模型 → 勾 agent → 保存（写入 config.yml）', 'in setup: scan endpoints → pick model → check agents → save (writes config.yml)'));
      info(L('服务前台运行中 — Ctrl-C 退出', 'server running in foreground — Ctrl-C to exit'));
      await new Promise(() => {});
      return 0;
    } catch (e) {
      warn(L(`服务起不来（${e.message.slice(0, 60)}）——回退终端向导`, `server failed to start (${e.message.slice(0, 60)}) — falling back to terminal wizard`));
    }
  }

  // LLM 端点探测（只在用户进入配置步骤时探测——铁律）
  info(L('探测本地 LLM 服务…', 'Probing local LLM services…'));
  const found = await probeEndpoints(400, { extraBases: [ctx.config.llm?.base_url] });
  let base_url = null, model = null;

  if (found.length) {
    const opts = [
      ...found.flatMap((f) => f.models.slice(0, 6).map((m) => ({
        label: `${f.name}:${f.port} — ${m}`, v: { base_url: f.base_url, model: m },
      }))),
      { label: L('手动输入端点', 'Enter endpoint manually'), v: 'manual' },
      { label: L('跳过（确定性功能照常用）', 'Skip (deterministic features still work)'), v: 'skip' },
    ];
    for (const f of found.filter((x) => x.needs_key)) {
      info(L(`发现 ${f.name}:${f.port}（需要密钥，模型列表读不出）——选"手动输入端点"后填 ${f.base_url}`, `found ${f.name}:${f.port} (key required, can't list models) — pick "manual" and enter ${f.base_url}`));
    }
    const sel = await choose(L('选择模型端点：', 'Choose a model endpoint:'), opts);
    if (sel.v === 'manual') {
      base_url = (await ask(L('  服务地址 > ', '  Service URL > '))).trim() || null;
      if (base_url) model = (await ask(L('  模型名称 > ', '  Model name > '))).trim() || null;
    } else if (sel.v !== 'skip') {
      ({ base_url, model } = sel.v);
    }
  } else {
    info(L('未发现本地 LLM 服务（已扫本机所有监听端口）', 'No local LLM service found (all listening ports probed)'));
    base_url = (await ask(L('  服务地址（留空跳过）> ', '  Service URL (empty to skip) > '))).trim() || null;
    if (base_url) model = (await ask(L('  模型名称 > ', '  Model name > '))).trim() || null;
  }

  // API key 环境变量引用（不存真值）
  if (base_url) {
    const keyEnv = await choose(L('API key 来源？', 'API key source?'), [
      { label: L('无需 key（本地端点常见）', 'No key needed (common for local endpoints)'), v: null },
      { label: 'SKILLMKT_API_KEY', v: 'env:SKILLMKT_API_KEY' },
      { label: 'OMLX_API_KEY', v: 'env:OMLX_API_KEY' },
    ]);
    raw.llm = { base_url, model, ...(keyEnv.v ? { api_key: keyEnv.v } : {}), concurrency: 2, timeout_ms: 60000 };

    // 冒烟：真实 chat 调用
    try {
      const probe = { base_url, model, api_key: keyEnv.v ? process.env[keyEnv.v.slice(4)] ?? '' : '', timeout_ms: 15000 };
      const reply = await chat(probe, { user: 'Reply with exactly: OK', maxTokens: 64 });
      ok(`llm smoke: ${reply.trim().slice(0, 40) || '(empty reply)'}`);
    } catch (e) {
      warn(L(`llm smoke failed: ${e.message}（配置已写入，功能将降级）`, `llm smoke failed: ${e.message} (config saved; features will degrade)`));
    }
  }

  // harness 默认目标 = installed 态
  const installed = ctx.harnesses.filter((h) => h.state === 'installed' && !h.detectOnly).map((h) => h.id);
  raw.default_targets = [...new Set([...(raw.default_targets || []), ...installed])];
  writeConfig(ctx.hub, raw);

  ok(`init done — default_targets: ${raw.default_targets.join(', ') || L('（无 installed harness，装好后 targets add）', '(no installed agent — use targets add later)')}`);
  info(`llm: ${model ? `${model} @ ${base_url}` : L('未配置（skillmkt init 随时重跑）', 'not configured (rerun skillmkt init anytime)')}`);
  return 0;
}
