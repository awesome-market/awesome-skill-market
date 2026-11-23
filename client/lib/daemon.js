// daemon.js — daemon.json{pid,port,token,started} + openURL + CLI 自动接管
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { L } from './i18n.js';

export const daemonFile = (hub) => path.join(hub, 'daemon.json');
export const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

export function readDaemon(hub) {
  try { return JSON.parse(fs.readFileSync(daemonFile(hub), 'utf8')); } catch { return null; }
}

export function openURL(d, route = '/') {
  // token 必须进 ?search（location.search 可读）；#fragment 只带 tab 名
  const frag = route.includes('#') ? `#${route.split('#')[1]}` : '';
  const url = `http://127.0.0.1:${d.port}/?token=${d.token}${frag}`;
  try { execFileSync('open', [url]); } catch { /* linux: xdg-open */ try { execFileSync('xdg-open', [url]); } catch { /* noop */ } }
  return url;
}

// CLI 接管：有活 daemon→开页复用（返回 true 让调用方退出）；
// 没有→当前进程前台起服务+开页+挂住流日志（Ctrl-C 连服务一起退，永不返回）
export async function maybeHandoff(ctx, route = '/') {
  if (!process.stdout.isTTY || ctx.flags.raw.cli || ctx.flags.raw.noUi) return false;
  if (ctx.flags.raw.ui === false) return false;
  if (ctx.config?.ui?.enabled === 'never' || ctx.config?.ui?.enabled === false) return false;
  const d = readDaemon(ctx.hub);
  if (d && pidAlive(d.pid)) {
    console.log(`opened ${openURL(d, route)}${L('（服务已在跑，Ctrl-C 那个终端的 serve 可停）', ' (server already running — the serve in that terminal can be stopped)')}`);
    return true;
  }
  try {
    const { startServer } = await import('../commands/serve.js');
    const srv = await startServer(ctx, { quiet: false });
    console.log(`opened ${openURL({ port: srv.port, token: srv.token }, route)}`);
    console.log(L('  服务前台运行中 — 操作日志见下方，Ctrl-C 退出', '  server running in foreground — activity log below, Ctrl-C to exit'));
    await new Promise(() => {});          // 挂住：本进程=服务器
    return true;
  } catch { return false; }
}
