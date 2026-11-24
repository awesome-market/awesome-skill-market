// wellknown.js — skills.sh 私有源适配器：详情页(.site)提取 .well-known/agent-skills/ 文件清单逐文件拉
// 私有源（uizze.sh/smithery.ai 等）没有 git 坐标——slug 即定位符
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { L } from '../i18n.js';
import { safeName } from '../package.js';

// 页面抓来的 host：只认 https + 正常域名（挡 IP literal/user:pass@ 注入）
const safeHost = (origin) => {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z0-9-]+$/i.test(u.hostname) || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) return null;
    return u.origin;
  } catch { return null; }
};
// rel 是落盘路径——只允许正常相对段，挡 ../、\、绝对路径
const safeRel = (r) => {
  try { r = decodeURIComponent(r); } catch { return false; }
  return /^[A-Za-z0-9._\-/]+$/.test(r) && !r.split('/').some((s) => s === '..' || s === '' || s === '.');
};

const UA = { 'user-agent': 'skillmkt' };
const SITE = (slug) => `https://www.skills.sh/site/${slug}`;

// fetchSkill({slug}) → {dir, tmp, provenance}——与 github.fetchSkill 同型
export async function fetchSkill({ slug, ctx = null }) {
  // ① 详情页抓 .well-known/agent-skills/ 全量文件 URL（页面转义成 …md\，去尾\）
  const page = await fetch(SITE(slug), { headers: UA, signal: AbortSignal.timeout(12e3) })
    .then((r) => (r.ok ? r.text() : null))
    .catch(() => null);
  if (!page) throw new Error(L(`skills.sh 详情页打不开: ${slug}（私有源/已下架？）`, `skills.sh detail page unreachable: ${slug} (private source or delisted?)`));
  const urls = [...new Set(
    (page.match(/https?:\\?\/\\?\/[^"'<>\\\s]+\.well-known\/agent-skills\/[^"'<>\\\s]+/g) || [])
      .map((u) => u.replace(/\\/g, '').replace(/[.,;)}\]]+$/, ''))
  )];
  // ② 推导 skillId 与文件相对路径；SKILL.md 兜底必拉（全部来自页面——先过安全校验再拼路径）
  const idM = urls.map((u) => u.match(/\.well-known\/agent-skills\/([^/]+)\//)?.[1]).find(Boolean);
  const skillId = idM || slug.split('/').pop();
  if (!safeName(skillId)) throw new Error(L(`${slug}: 页面给的 skillId 非法: ${skillId}`, `${slug}: page-supplied skillId unsafe: ${skillId}`));
  const host = (urls[0] && safeHost(new URL(urls[0]).origin)) || `https://${slug.split('/')[0]}`;
  const rels = new Set(urls
    .map((u) => u.split(`.well-known/agent-skills/${skillId}/`)[1])
    .filter(Boolean)
    .filter(safeRel));
  rels.add('SKILL.md');

  // ③ 逐文件拉取（无 manifest 可列——页面给的即全量）
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skillmkt-wk-'));
  const dir = path.join(tmp, skillId);
  fs.mkdirSync(dir, { recursive: true });
  const got = [];
  for (const rel of rels) {
    const relDec = decodeURIComponent(rel);
    const url = `${host}/.well-known/agent-skills/${skillId}/${rel}`;
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15e3), redirect: 'follow' });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 50e6) continue;                     // 单文件 50MB 上限
      const dest = path.join(dir, relDec);
      if (!(path.resolve(dest) + path.sep).startsWith(path.resolve(dir) + path.sep) && path.resolve(dest) !== path.resolve(dir)) continue;   // 双保险：拼完必须还在 dir 内
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      got.push(rel);
    } catch { /* 单文件失败不致命——SKILL.md 在就行 */ }
  }
  if (!got.includes('SKILL.md')) throw new Error(L(`${slug}: SKILL.md 拉不到——私有源结构对不上`, `${slug}: cannot fetch SKILL.md — private source layout unrecognized`));
  return {
    dir, tmp, sha: null,
    provenance: { registry: 'wellknown', ref: slug, path: null, pin: null, via: 'skills.sh-site', files: got.length },
  };
}
