// skillssh.js — skills.sh 官方 /api/search 消费（npx skills 同款）+ 多词降级归并
const DEFAULT_BASE = 'https://skills.sh';
const MIN_EXACT = 10, MAX_TERMS = 6, MAX_MERGED = 25;

export function searchBase(ctx) {
  return (process.env.SKILLMKT_SEARCH_API || process.env.SKILLS_API_URL
    || ctx.config._raw?.skills_api || DEFAULT_BASE).replace(/\/+$/, '');
}

async function api(base, q, owner) {
  const params = new URLSearchParams({ q });
  if (owner) params.set('owner', owner);
  const res = await fetch(`${base}/api/search?${params}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.skills || []).map((s) => ({
    name: s.name, slug: s.id, source: s.source || '', installs: s.installs || 0,
  }));
}

// 官方同款归并：精确<10 且 2-6 词 → 丢词子查询按 hits+rank+installs 归并
export async function searchRemote(query, ctx, { owner = null } = {}) {
  const base = searchBase(ctx);
  const exact = await api(base, query, owner);
  const terms = [...new Set(query.trim().split(/\s+/).filter(Boolean))];
  if (exact.length >= MIN_EXACT || terms.length < 2 || terms.length > MAX_TERMS) {
    return { skills: exact, exactCount: exact.length, base };
  }
  const subs = terms.map((_, i) => terms.filter((__, j) => j !== i).join(' '));
  const lists = await Promise.all(subs.map((q) => api(base, q, owner)));
  const seen = new Set(exact.map((s) => s.slug));
  const cand = new Map();
  for (const list of lists) list.forEach((s, rank) => {
    if (seen.has(s.slug)) return;
    const e = cand.get(s.slug);
    if (e) { e.hits++; e.bestRank = Math.min(e.bestRank, rank); }
    else cand.set(s.slug, { skill: s, hits: 1, bestRank: rank });
  });
  const partial = [...cand.values()]
    .sort((a, b) => b.hits - a.hits || a.bestRank - b.bestRank || b.skill.installs - a.skill.installs)
    .slice(0, MAX_MERGED - exact.length).map((e) => e.skill);
  return { skills: [...exact, ...partial], exactCount: exact.length, base };
}

// 裸名 → skills.sh 索引定位 {owner/repo + path}（slug="owner/repo/skill-id"）
export async function resolveNamed(name, ctx) {
  const { skills } = await searchRemote(name, ctx);
  const hit = skills.find((s) => s.name === name || s.slug.endsWith(`/${name}`))
    ?? skills[0];
  if (!hit) return null;
  const parts = hit.slug.split('/');
  if (parts.length >= 3) {
    return { owner: parts[0], repo: parts[1], path: parts.slice(2).join('/'), meta: hit };
  }
  const src = (hit.source || '').split('/');
  return src.length >= 2
    ? { owner: src[0], repo: src[1], path: hit.slug.split('/').pop(), meta: hit }
    : null;
}
