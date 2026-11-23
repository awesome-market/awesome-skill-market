// serve — 本地 daemon：node:http + token + SSE + 静态 SPA；--daemon 内部模式 / --stop / --wait
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { daemonFile, readDaemon, openURL } from '../lib/daemon.js';
import { loadConflicts } from '../lib/conflicts.js';
import { loadDecisions, decide } from '../lib/decide.js';
import { readLibrary, readLock, readConfig, writeConfig, registerSkill, updateLock, ensureHub, isInitialized } from '../lib/hub.js';
import { readUpstream } from '../lib/state.js';
import { readYAML } from '../../pipeline/lib/util.js';
import { detectHarnesses, scanAll } from '../lib/scanner.js';
import { probeEndpoints, chat, encryptSecret, resolveKeyRef, listModels } from '../lib/llm.js';
import { projectSkill, unproject, targetDirFor } from '../lib/project.js';
import { readSkillDir, treeHash } from '../lib/package.js';
import { searchRemote } from '../lib/registries/skillssh.js';
import { execFile } from 'node:child_process';
import { ok, info } from '../lib/render.js';
import { L, detectLang } from '../lib/i18n.js';

const PUB = path.join(new URL('.', import.meta.url).pathname, '../public');
const CLI = path.join(new URL('.', import.meta.url).pathname, '../bin/skillmkt.js');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

// CLI 子进程复用——装/删/合并/升级等操作走同一套实现，不复制逻辑
// '--' 隔开 flag 与用户输入，防 -开头的 ref 被当 flag 解析
const cli = (args, timeout = 180e3) => new Promise((r) => {
  execFile(process.execPath, [CLI, ...args], { timeout, env: { ...process.env, CI: '1' } },
    (e, stdout, stderr) => r({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, out: `${stdout || ''}${stderr || ''}`.trim() }));
});

// startServer — 可复用：serve 命令与 CLI 接管共用。返回 {port, token, server, emit, shutdown}
export async function startServer(ctx, { quiet = false, port = 0 } = {}) {
  ensureHub(ctx.hub);
  const flags = ctx.flags.raw;
  const token = crypto.randomBytes(16).toString('hex');
  const sse = new Set();
  const emit = (type, data) => { for (const res of sse) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); };
  let lastActive = Date.now();
  const idleMs = (ctx.config.daemon?.idle_minutes ?? 30) * 60e3;

  const harnesses = ctx.harnesses ?? detectHarnesses();   // bareRun/init 路径 ctx 可能没 withState
  // 界面默认语言跟终端 locale（SKILLMKT_LANG/LANG/LC_* 以 zh 开头→中文）
  const state = () => ({
    hub: ctx.hub,
    lang: (() => readConfig(ctx.hub)._raw?.ui?.lang ?? detectLang())(),
    initialized: isInitialized(ctx.hub),
    library: readLibrary(ctx.hub), lock: readLock(ctx.hub),
    upstream: readUpstream(ctx.hub), conflicts: loadConflicts(ctx.hub),
    decisions: loadDecisions(ctx.hub), harnesses,
    scans: fs.existsSync(path.join(ctx.hub, 'scans'))
      ? fs.readdirSync(path.join(ctx.hub, 'scans')).sort().map((f) => readYAML(path.join(ctx.hub, 'scans', f))).filter(Boolean)
      : [],
    merged: (() => {
      const f = path.join(ctx.hub, 'merged', 'rules.yml');
      if (!fs.existsSync(f)) return null;
      const y = readYAML(f) || {};
      return { name: y.name, sources: y.sources || [], rules: (y.rules || []).length,
        built: fs.existsSync(path.join(ctx.hub, 'merged', 'skill-out', 'SKILL.md')) };
    })(),
  });

  const descCache = new Map();   // slug → 简介（SKILL.md frontmatter description）
  const parseDesc = (md) => {
    const fm = md.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) return '';
    const lines = fm[1].split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^description:\s*(.*)$/);
      if (!m) continue;
      let v = m[1].trim().replace(/^["']|["']$/g, '');
      if (!v || v === '|' || v === '>') v = (lines[i + 1] || '').trim();
      return v.slice(0, 200);
    }
    return '';
  };
  const fetchDesc = async (slug) => {
    if (descCache.has(slug)) return descCache.get(slug);
    const parts = slug.split('/');
    let desc = '';
    if (parts[0].includes('.')) {   // 私有源：host/.well-known/agent-skills/id/SKILL.md
      desc = await fetch(`https://${parts[0]}/.well-known/agent-skills/${parts.slice(1).join('/')}/SKILL.md`,
        { headers: { 'user-agent': 'skillmkt' }, signal: AbortSignal.timeout(8e3) })
        .then((r) => (r.ok ? r.text() : '')).then(parseDesc).catch(() => '');
    } else {                       // GitHub：raw 需真实分支，skill 路径也要多级回退（同 github.js 定位逻辑）
      const sub = parts.slice(2).join('/');
      const subs = sub ? [sub, `skills/${sub}`, `packages/${sub}`, `plugins/${sub}`, `.claude/skills/${sub}`] : ['', 'skills', 'packages'];
      const rels = subs.map((p) => (p ? `${p}/SKILL.md` : 'SKILL.md'));
      const tryRaw = async (br) => {
        for (const rel of rels) {
          const md = await fetch(`https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${br}/${rel}`,
            { headers: { 'user-agent': 'skillmkt' }, signal: AbortSignal.timeout(8e3) })
            .then((r) => (r.ok ? r.text() : '')).catch(() => '');
          if (md) return parseDesc(md);
        }
        return '';
      };
      for (const br of ['main', 'master']) { desc = await tryRaw(br); if (desc) break; }
      if (!desc) {
        try {
          const { execFileSync } = await import('node:child_process');
          const br = execFileSync('gh', ['api', `repos/${parts[0]}/${parts[1]}`, '--jq', '.default_branch'], { encoding: 'utf8', timeout: 8000 }).trim();
          if (br && !['main', 'master'].includes(br)) desc = await tryRaw(br);
        } catch { /* gh 不可用就算了 */ }
      }
    }
    descCache.set(slug, desc);
    return desc;
  };
  const routes = {
    'GET /api/state': () => state(),
    'GET /api/desc': (u) => fetchDesc(u.searchParams.get('slug') || '').then((desc) => ({ desc })),
    'GET /api/conflicts': () => loadConflicts(ctx.hub),
    'GET /api/decisions': () => loadDecisions(ctx.hub),
    'GET /api/config': () => readConfig(ctx.hub)._raw,
    'GET /api/probe': async () => probeEndpoints(400, { extraBases: [readConfig(ctx.hub).llm?.base_url] }),
    'GET /api/search': async (u) => { const q = u.searchParams.get('q') || ''; return q ? searchRemote(q, ctx) : { skills: [] }; },
    'GET /api/scan': () => scanAll(ctx.hub, harnesses, readLibrary(ctx.hub), null)
      .filter((r) => r.state === 'external')
      .map((r) => ({ name: r.name, dir: r.targetDir || '', path: r.path, where: r.where, version: r.version, description: r.description || '' })),
    'GET /api/skill': (u) => {
      const n = u.searchParams.get('name') || '';
      if (!n || n.includes('/') || n.includes('..')) return { error: 'bad name' };
      const pkg = readSkillDir(path.join(ctx.hub, 'skills', n));
      return pkg ? { ...pkg, library: readLibrary(ctx.hub).skills?.[n] || null } : { error: 'not found' };
    },
    'GET /api/diff': async (u) => cli(['diff', '--', u.searchParams.get('name') || '']),
  };
  const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => b += c); req.on('end', () => r(b || '{}')); });

  // 只记关键事件：打开网页 + 真正落盘的写操作；点击/读取/静态资源一律不打扰
  const action = (req, u) => {
    const p = u.pathname;
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) return L('打开了网页', 'opened the page');
    if (req.method === 'POST' && p === '/api/config') return L('保存了设置', 'saved settings');
    if (req.method === 'POST' && p === '/api/targets') return L('修改了 skill 的安装位置', 'changed skill install locations');
    if (req.method === 'POST' && p === '/api/install') return L('安装了 skill', 'installed a skill');
    if (req.method === 'POST' && p === '/api/remove') return L('移除了 skill', 'removed a skill');
    if (req.method === 'POST' && p === '/api/merge') return L('合并了 skill', 'merged skills');
    if (req.method === 'POST' && p === '/api/build') return L('生成了合并产物', 'built merged skill');
    if (req.method === 'POST' && p === '/api/update') return L('刷新了上游信息', 'refreshed upstream info');
    if (req.method === 'POST' && p === '/api/upgrade') return L('升级了 skill', 'upgraded skills');
    if (req.method === 'POST' && p === '/api/sync') return L('修复了投影', 'repaired projections');
    if (req.method === 'POST' && p === '/api/audit') return L('重新审核了 skill', 're-audited a skill');
    if (req.method === 'POST' && p === '/api/rollback') return L('回滚了 skill', 'rolled back a skill');
    if (req.method === 'POST' && p === '/api/open') return L('打开了文件夹', 'opened a folder');
    return null;
  };

  const server = http.createServer(async (req, res) => {
    lastActive = Date.now();
    const u = new URL(req.url, 'http://x');
    if (!quiet) res.on('finish', () => {
      const a = req.logNote ?? action(req, u);
      if (a == null) return;
      const tail = res.statusCode === 401 ? L('（被拒绝：链接已过期，重新打开）', ' (rejected: link expired — reopen)')
        : res.statusCode >= 400 ? L(`（失败 ${res.statusCode}）`, ` (failed ${res.statusCode})`) : '';
      console.log(`  ${new Date().toTimeString().slice(0, 8)}  ${a}${tail}`);
    });
    // auth：Bearer header 或 ?token=（SSE/img 用 query，服务端不下发 cookie）
    const authed = req.headers.authorization === `Bearer ${token}` || u.searchParams.get('token') === token;
    if (u.pathname === '/api/events') {                       // SSE
      if (!authed) { res.writeHead(401); return res.end(); }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write('retry: 2000\n\n');
      sse.add(res);
      req.on('close', () => sse.delete(res));
      return;
    }
    if (u.pathname.startsWith('/api/')) {
      if (!authed) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"error":"unauthorized"}'); }
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST') {
        let b;
        try { b = JSON.parse(await body(req)); }
        catch { res.writeHead(400); return res.end('{"error":"bad json"}'); }
        try {
          if (u.pathname === '/api/decide') {
            const c = loadConflicts(ctx.hub).find((x) => x.id === b.id);
            if (!c) { res.writeHead(404); return res.end('{"error":"not found"}'); }
            if (!b.reason?.trim()) { res.writeHead(400); return res.end('{"error":"reason required"}'); }
            req.logNote = L(`裁决了一个冲突（${{ 'keep-a': '采用方案 A', 'keep-b': '采用方案 B', merge: '合并两条', dismissed: '其实不冲突' }[b.resolution] || b.resolution}）`,
              `decided a conflict (${{ 'keep-a': 'kept A', 'keep-b': 'kept B', merge: 'merged', dismissed: 'not a conflict' }[b.resolution] || b.resolution})`);
            decide(ctx.hub, c, { resolution: b.resolution, custom: b.custom || null, reason: b.reason, by: 'web-ui' });
            c.status = 'resolved';
            const { writeConflict } = await import('../lib/conflicts.js');
            writeConflict(ctx.hub, c);
            emit('decide', { id: c.id });
            return res.end('{"ok":true}');
          }
          if (u.pathname === '/api/config') {                         // init：合并写 config
            const raw = readConfig(ctx.hub)._raw;
            let keyEnc = false;
            if (b.llm !== undefined) {
              const k = String(b.llm.api_key || '');
              if (k && !k.startsWith('env:') && !k.startsWith('enc:')) {
                b.llm.api_key = encryptSecret(k);                     // 机器码加密后存 config.yml
                keyEnc = true;
              }
              raw.llm = b.llm;
            }
            if (b.ui !== undefined) raw.ui = { ...(raw.ui || {}), ...b.ui };   // 合并——写 lang 不抹掉 enabled
            if (b.default_targets !== undefined) raw.default_targets = b.default_targets;
            if (b.policy) raw.policy = b.policy;
            writeConfig(ctx.hub, raw);
            emit('config', {});
            return res.end(JSON.stringify({ ok: true, key_enc: keyEnc }));
          }
          if (u.pathname === '/api/llm-smoke') {                      // init 冒烟
            const key = resolveKeyRef(b.api_key, ctx);                // env: 引用走 hub/.env 等解析链
            const sent = 'Reply with exactly: OK';
            const r = await chat({ base_url: b.base_url, model: b.model, api_key: key, timeout_ms: 15000 }, { user: sent, maxTokens: 64 });
            return res.end(JSON.stringify({ ok: true, sent, reply: r.trim().slice(0, 200) }));
          }
          if (u.pathname === '/api/models') {                         // 指定端点+密钥拉模型列表
            const key = resolveKeyRef(b.api_key, ctx);
            try {
              return res.end(JSON.stringify({ models: await listModels(b.base_url, key) }));
            } catch (e) { return res.end(JSON.stringify({ models: [], error: e.message.slice(0, 80) })); }
          }
          if (u.pathname === '/api/targets') {                        // web 改投影目标
            const name = b.name, targets = b.targets || [];
            req.logNote = L(`修改了「${name}」的安装位置`, `changed install locations for "${name}"`);
            const lib = readLibrary(ctx.hub);
            const s = lib.skills?.[name];
            if (!s) { res.writeHead(404); return res.end('{"error":"not found"}'); }
            const dest = path.join(ctx.hub, 'skills', name);
            const lockTargets = {};
            // 取消勾选的目标：删掉已复制的副本（否则孤儿文件遗留且 drift 检不出）
            for (const t of s.targets || []) {
              if (targets.includes(t)) continue;
              const dir = targetDirFor(ctx, t, name);
              if (dir) unproject(name, dir);
            }
            for (const t of targets) {
              const dir = targetDirFor(ctx, t, name);
              if (!dir) continue;
              const r = projectSkill(dest, name, dir, { mode: 'copy' });
              lockTargets[t] = { hash: r.hash, projected_at: new Date().toISOString(), mode: 'copy' };
            }
            registerSkill(ctx.hub, name, { ...s, targets });
            updateLock(ctx.hub, name, treeHash(dest), lockTargets);
            emit('targets', { name });
            return res.end('{"ok":true}');
          }
          if (u.pathname === '/api/install') {
            const args = ['install', '--yes'];
            if (b.path) args.push('--path', String(b.path));
            if (b.permissive) args.push('--policy', 'permissive');
            args.push('--', String(b.ref || ''));
            const r = await cli(args);
            emit('library', {});
            return res.end(JSON.stringify(r));
          }
          if (u.pathname === '/api/remove') {
            const r = await cli(['remove', ...(b.purge ? ['--purge'] : []), '--', String(b.name || '')]);
            emit('library', {});
            return res.end(JSON.stringify(r));
          }
          if (u.pathname === '/api/merge') {
            const names = (b.names || []).map(String).filter(Boolean);
            const args = ['merge'];
            if (b.name) args.push('--name', String(b.name));
            args.push('--', ...names);
            const r = await cli(args);
            emit('library', {});
            return res.end(JSON.stringify(r));
          }
          if (u.pathname === '/api/build') {
            const r = await cli(['build']);
            emit('library', {});
            return res.end(JSON.stringify(r));
          }
          if (u.pathname === '/api/update') {
            const r = await cli(['update'], 300e3);
            emit('library', {});
            return res.end(JSON.stringify(r));
          }
          if (u.pathname === '/api/upgrade') {
            const r = await cli(['upgrade', ...(b.name ? ['--', String(b.name)] : ['--all'])], 300e3);
            emit('library', {});
            return res.end(JSON.stringify(r));
          }
          if (u.pathname === '/api/sync') {
            const r = await cli(['sync']);
            emit('library', {});
            return res.end(JSON.stringify(r));
          }
          if (u.pathname === '/api/audit') {
            const r = await cli(['audit', '--', String(b.name || '')]);
            emit('library', {});
            return res.end(JSON.stringify(r));
          }
          if (u.pathname === '/api/rollback') {
            const r = await cli(['rollback', '--', String(b.name || '')]);
            emit('library', {});
            return res.end(JSON.stringify(r));
          }
          if (u.pathname === '/api/open') {                            // 系统文件管理器打开目录
            const p = path.resolve(String(b.path || ''));
            if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) return res.end(JSON.stringify({ ok: false, error: 'not a dir' }));
            execFile(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open', [p], () => {});
            return res.end('{"ok":true}');
          }
        } catch (e) { res.writeHead(400); return res.end(JSON.stringify({ error: e.message })); }
        res.writeHead(404); return res.end('{"error":"not found"}');
      }
      const h = routes[`${req.method} ${u.pathname}`];
      if (h) {
        try { return res.end(JSON.stringify(await h(u))); }
        catch (e) { res.writeHead(500); return res.end(JSON.stringify({ error: e.message })); }
      }
      res.writeHead(404); return res.end('{"error":"not found"}');
    }
    // 静态：public/ 公开；/evidence/ 需鉴权且锁死在 hub/evidence 内（防 ../ 穿越读 config.yml 等）
    const p = u.pathname === '/' ? '/index.html' : u.pathname;
    let file;
    if (p.startsWith('/evidence/')) {
      if (!authed) { res.writeHead(401); return res.end(); }
      const evDir = path.join(ctx.hub, 'evidence');
      file = path.join(evDir, p.slice('/evidence/'.length));
      if (!path.resolve(file).startsWith(path.resolve(evDir))) { res.writeHead(403); return res.end(); }
    } else {
      file = path.join(PUB, p);
      if (!path.resolve(file).startsWith(PUB)) { res.writeHead(403); return res.end(); }
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
    res.setHeader('cache-control', 'no-store');              // 每次请求都读磁盘——迭代期不让浏览器拿缓存旧 app.js
    fs.createReadStream(file).pipe(res);
  });

  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const realPort = server.address().port;
  fs.writeFileSync(daemonFile(ctx.hub), JSON.stringify({ pid: process.pid, port: realPort, token, started: new Date().toISOString() }));
  const idle = setInterval(() => { if (Date.now() - lastActive > idleMs) { server.close(); process.exit(0); } }, 60e3);
  idle.unref();

  const shutdown = () => {
    clearInterval(idle);
    fs.rmSync(daemonFile(ctx.hub), { force: true });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 800).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return { server, port: realPort, token, emit, shutdown };
}

export async function run(ctx) {
  const flags = ctx.flags.raw;
  if (flags.stop) {
    const d = readDaemon(ctx.hub);
    if (d) { try { process.kill(d.pid); } catch { /* dead */ } fs.rmSync(daemonFile(ctx.hub), { force: true }); ok(L('daemon 已停', 'daemon stopped')); }
    else info(L('没有 daemon 在跑', 'no daemon running'));
    return 0;
  }
  // 已有前台/分离实例在跑 → 不重复起，报地址
  const existing = readDaemon(ctx.hub);
  if (existing && existing.pid !== process.pid) {
    try {
      process.kill(existing.pid, 0);
      info(L(`已在跑: http://127.0.0.1:${existing.port}/?token=${existing.token}（--stop 停掉）`, `already running: http://127.0.0.1:${existing.port}/?token=${existing.token} (use --stop to stop)`));
      if (ctx.tty && !flags.daemon) openURL(existing, '/');
      return 0;
    } catch { /* stale */ }
  }
  const d = await startServer(ctx, { quiet: !!flags.daemon, port: flags.port || 0 });
  if (flags.daemon) { console.log(`daemon ready :${d.port}`); await new Promise(() => {}); }
  console.log(`serve: http://127.0.0.1:${d.port}/?token=${d.token}`);
  console.log(L(`  前台运行 — Ctrl-C 退出（idle ${ctx.config.daemon?.idle_minutes ?? 30}m 自退）`, `  running in foreground — Ctrl-C to exit (idle ${ctx.config.daemon?.idle_minutes ?? 30}m auto-stop)`));
  if (ctx.tty) openURL(d, '/');   // TTY 起服务自动开浏览器；脚本/--daemon 不开
  await new Promise(() => {});
  return 0;
}
