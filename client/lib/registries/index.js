// registries/index.js — 按 ref/type 路由适配器 + fetch mirror 前缀
import * as github from './github.js';
import * as skillssh from './skillssh.js';
import * as rfc from './rfc.js';
import { L } from '../i18n.js';

export const ADAPTERS = { github, skillssh, rfc, clawhub: null };

export function adapterFor(type) {
  const a = ADAPTERS[type];
  if (!a) throw new Error(L(`registry adapter 未实现: ${type}（二期）`, `registry adapter not implemented: ${type} (phase 2)`));
  return a;
}

export function fetchMirror(ctx) {
  return ctx.config._raw?.fetch_mirror || process.env.SKILLMKT_FETCH_MIRROR || null;
}

// 统一拉取入口：named → skillssh 解析为 github 坐标
export async function fetchRef(ref, ctx) {
  const mirror = fetchMirror(ctx);
  if (ref.kind === 'github') {
    return github.fetchSkill({ ...ref, mirror });
  }
  if (ref.kind === 'named' && (!ref.registry || ref.registry === 'skillssh' || ref.registry === 'github')) {
    const coord = await skillssh.resolveNamed(ref.name, ctx);
    if (!coord) throw new Error(L(`skills.sh 索引未收录: ${ref.name}——可试 skillmkt install owner/repo 直指`, `not in the skills.sh index: ${ref.name} — try skillmkt install owner/repo`));
    return github.fetchSkill({ ...coord, ref: null, mirror });
  }
  if (ref.registry) {
    const reg = ctx.config.registries.find((r) => (r.name || r.type) === ref.registry);
    if (!reg) throw new Error(L(`未配置 registry: ${ref.registry}`, `registry not configured: ${ref.registry}`));
    const a = adapterFor(reg.type);
    if (!a.fetchSkill) throw new Error(L(`registry ${reg.type} 不支持 fetch`, `registry ${reg.type} does not support fetch`));
    return a.fetchSkill(ref, ctx, reg);
  }
  throw new Error(L(`无法解析引用: ${JSON.stringify(ref)}`, `cannot resolve ref: ${JSON.stringify(ref)}`));
}
