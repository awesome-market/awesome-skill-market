// init — 交互式初始化：形态选择（Web/终端）→ LLM 探测→选模型→冒烟→写配置→harness 默认目标
import fs from 'node:fs';
import { ensureHub, writeConfig, readConfig } from '../lib/hub.js';
import { probeEndpoints, chat, encryptSecret, listModels } from '../lib/llm.js';
import { openURL, readDaemon, pidAlive } from '../lib/daemon.js';
import { choose, confirm, ask, askSecret } from '../lib/prompt.js';
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
  let base_url = null, model = null, ep = null;

  if (found.length) {
    // 与 web 同构：先选服务（每端点一行）→ 需要密钥才问密钥 → 再选模型
    const epOpts = [
      ...found.map((f) => ({
        label: `${f.name}:${f.port} — ${f.needs_key ? L('需要密钥', 'key required') : L(`${f.models.length} 个模型`, `${f.models.length} models`)}`,
        v: f,
      })),
      { label: L('手动输入端点', 'Enter endpoint manually'), v: 'manual' },
      { label: L('跳过（确定性功能照常用）', 'Skip (deterministic features still work)'), v: 'skip' },
    ];
    const sel = await choose(L('选择服务：', 'Choose a service:'), epOpts);
    if (sel.v === 'manual') base_url = (await ask(L('  服务地址 > ', '  Service URL > '))).trim() || null;
    else if (sel.v !== 'skip') { ep = sel.v; base_url = ep.base_url; }
  } else {
    info(L('未发现本地 LLM 服务（已扫本机所有监听端口）', 'No local LLM service found (all listening ports probed)'));
    base_url = (await ask(L('  服务地址（留空跳过）> ', '  Service URL (empty to skip) > '))).trim() || null;
  }

  // 模型探测：已知端点给列表；手输地址先裸探——401/403 → 需要密钥（和 web 的自动检测一致）
  let models = ep?.models || [];
  let needKey = !!ep?.needs_key;
  if (base_url && !models.length && !ep?.needs_key) {
    try { models = await listModels(base_url, ''); }
    catch (e) { if (/401|403/.test(e.message)) needKey = true; }
  }

  // 密钥：只在需要时问；失败不默默继续——给"换个方式 / 退出向导"选择
  let api_key = null, keyPlain = '';
  if (base_url && needKey) {
    for (;;) {   // 密钥来源循环：任何一步失败都回到这里重选
      const ks = await choose(L('这个服务需要访问密钥，怎么提供？', 'This service needs an access key — how should it be provided?'), [
        { label: L('现在粘贴进来（只输一次，自动加密保存）', 'Paste it now (entered once, saved encrypted)'), v: 'paste' },
        { label: L('从环境变量 SKILLMKT_API_KEY 读', 'Read env var SKILLMKT_API_KEY'), v: 'env:SKILLMKT_API_KEY' },
        { label: L('退出向导', 'Quit wizard'), v: 'quit' },
      ]);
      if (ks.v === 'quit') {
        info(L('配好后重跑：skillmkt init', 'after fixing, rerun: skillmkt init'));
        return 0;
      }
      if (!ks.v) break;                                            // 不需要密钥 → 出循环
      if (ks.v === 'paste') {
        for (;;) {   // 粘贴后真验证：错密钥可重输，留空回上一步
          keyPlain = (await askSecret(L('  密钥 > ', '  Key > '))).trim();
          if (!keyPlain) break;
          try {
            models = await listModels(base_url, keyPlain);
            api_key = encryptSecret(keyPlain);
            ok(L(`密钥有效，已加载 ${models.length} 个模型`, `Key valid — loaded ${models.length} models`));
            break;
          } catch (e) {
            warn(L(`密钥错误（${e.message}）——重输，或留空返回上一步`, `Wrong key (${e.message}) — re-enter, or leave empty to go back`));
            keyPlain = '';
          }
        }
        if (api_key) break;
        continue;
      }
      // env:VAR —— 没设/验证失败时给明确指引：本进程读不到事后 export 的值，只能换方式或退出
      const vn = ks.v.slice(4);
      keyPlain = process.env[vn] ?? '';
      if (!keyPlain) {
        warn(L(`环境变量 ${vn} 没设置——本向导运行中设了也读不到（环境变量只在启动时继承）`, `env var ${vn} is not set — exporting it now won't reach this wizard (env is inherited at launch)`));
      } else {
        try {
          models = await listModels(base_url, keyPlain);
          api_key = `env:${vn}`;
          ok(L(`已用 ${vn} 验证，加载 ${models.length} 个模型`, `verified with ${vn} — loaded ${models.length} models`));
          break;
        } catch (e) {
          warn(L(`用 ${vn} 验证失败（${e.message}）`, `key in ${vn} failed verification (${e.message})`));
        }
      }
      // 失败 → 直接回外圈重显示来源菜单（想退出选"退出向导"）
    }
  }

  // 模型：拉到了就列出来选，拉不到手填
  if (base_url && !model) {
    if (models.length) {
      model = (await choose(L('选择模型：', 'Choose a model:'), models.map((m) => ({ label: m, v: m })))).v;
    } else {
      model = (await ask(L('  模型名称 > ', '  Model name > '))).trim() || null;
    }
  }

  if (base_url) {
    raw.llm = { base_url, model, ...(api_key ? { api_key } : {}), concurrency: 2, timeout_ms: 60000 };

    // 冒烟：真实 chat 调用
    try {
      const reply = await chat({ base_url, model, api_key: keyPlain, timeout_ms: 15000 }, { user: 'Reply with exactly: OK', maxTokens: 64 });
      ok(`llm smoke: ${reply.trim().slice(0, 40) || '(empty reply)'}`);
    } catch (e) {
      warn(L(`llm smoke failed: ${e.message}（配置已写入，功能将降级）`, `llm smoke failed: ${e.message} (config saved; features will degrade)`));
    }
  }

  // harness 默认目标 = installed 态
  const installed = ctx.harnesses.filter((h) => h.state === 'installed' && !h.detectOnly).map((h) => h.id);
  raw.default_targets = [...new Set([...(raw.default_targets || []), ...installed])];
  raw.initialized = true;   // 完成标记——裸跑据此判断要不要自动进向导
  writeConfig(ctx.hub, raw);

  ok(`init done — default_targets: ${raw.default_targets.join(', ') || L('（无 installed harness，装好后 targets add）', '(no installed agent — use targets add later)')}`);
  info(`llm: ${model ? `${model} @ ${base_url}` : L('未配置（skillmkt init 随时重跑）', 'not configured (rerun skillmkt init anytime)')}`);

  info(L('接下来怎么用：', 'What you can do next:'));
  for (const [cmd, desc] of [
    ['skillmkt install <路径>', L('收编一个本地 skill（目录或压缩包）', 'adopt a local skill (dir or archive)')],
    ['skillmkt search <关键词>', L('搜远端 skill 市场', 'search the remote skill market')],
    ['skillmkt list', L('看已管理的 skill', 'list managed skills')],
    ['skillmkt serve', L('打开 Web 面板（冲突/裁决/合并可视化）', 'open the web panel (conflicts/decisions/merge)')],
    ['skillmkt doctor', L('体检：配置、agent、端点连通性', 'health check: config, agents, endpoint')],
    ['skillmkt --help', L('全部命令', 'all commands')],
  ]) info(`    ${cmd.padEnd(30)} ${desc}`);
  return 0;
}
