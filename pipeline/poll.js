#!/usr/bin/env node
// poll.js — resolve arbitration via issue comments: owner/collaborator replies "a" | "b" | "merge <text>" | "custom <text>"
// Writes decisions/<conf>.yml, flips conflict status, closes the issue.
import path from 'node:path';
import { CFG, DIRS } from './lib/env.js';
import { log, readYAML, writeYAML, listYAMLFiles } from './lib/util.js';
import { ghApi, openIssuesWithLabel } from './lib/gh.js';

const VALID_AUTHORS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

// "a" | "b" | "merge <rule text>" | "custom <rule text>" — a/b take optional "- reason" tail
export function parseVote(body) {
  const t = body.trim();
  const ab = t.match(/^(a|b)\s*(?:[-—:]\s*(.+))?$/is);
  if (ab) return { resolution: ab[1].toUpperCase(), reason: ab[2]?.trim() || null };
  const mc = t.match(/^(merge|custom)\s+(.+)$/is);
  if (mc) return { resolution: mc[1].toLowerCase(), custom: mc[2].trim() };
  if (/^(merge|custom)\s*$/i.test(t)) {
    return { resolution: null, error: `回复需要跟合并后的规则文本，例：\`${t.toLowerCase()} 合并后的规则\`` };
  }
  return null;
}

async function commentIssue(repo, number, body) {
  ghApi(`repos/${repo}/issues/${number}/comments`, { method: 'POST', fields: { body } });
}

function closeIssue(repo, number) {
  try {
    ghApi(`repos/${repo}/issues/${number}`, { method: 'PATCH', fields: { state: 'closed' } });
    ghApi(`repos/${repo}/issues/${number}/labels`, { method: 'POST', fields: { labels: ['decided'] } });
  } catch (e) {
    log(`poll: close/label issue #${number} failed: ${e.message}`);
  }
}

export async function poll() {
  if (!CFG.githubRepo) return [];
  const open = openIssuesWithLabel(CFG.githubRepo, 'conflict');
  if (!open.length) return [];

  const confByFile = new Map(listYAMLFiles(DIRS.conflicts).map((f) => [path.basename(f, '.yml'), f]));
  const resolved = [];

  for (const issue of open) {
    const id = (issue.title.match(/conf-\d+/) || [])[0];
    if (!id || !confByFile.has(id)) continue;
    const comments = ghApi(`repos/${CFG.githubRepo}/issues/${issue.number}/comments?per_page=100`) || [];

    for (const c of comments) {
      if (!VALID_AUTHORS.has(c.author_association)) continue;
      const vote = parseVote(c.body || '');
      if (!vote) continue;
      if (vote.error) {
        await commentIssue(CFG.githubRepo, issue.number, `⚠️ ${vote.error}`);
        continue;
      }

      const confFile = confByFile.get(id);
      const conf = readYAML(confFile);
      const decFile = path.join(DIRS.decisions, `${id}.yml`);
      const prev = readYAML(decFile);

      writeYAML(decFile, {
        id,
        status: 'active',
        resolution: vote.resolution.toLowerCase() === 'a' ? 'A' : vote.resolution.toLowerCase() === 'b' ? 'B' : vote.resolution,
        custom: vote.custom ?? null,
        reason: vote.reason ?? `arbitrated via issue #${issue.number} by @${c.user.login}`,
        alternatives_rejected: prev?.alternatives_rejected ?? [],
        trigger: 'issue-comment',
        decided_at: new Date().toISOString(),
        decided_by: c.user.login,
        comment_url: c.html_url,
        supersedes: prev ? { resolution: prev.resolution, reason: prev.reason, at: prev.decided_at } : null,
      });
      conf.status = 'decided';
      writeYAML(confFile, conf);
      resolved.push(id);

      await commentIssue(
        CFG.githubRepo, issue.number,
        `✅ 裁决已记录：**${vote.resolution.toUpperCase()}**${vote.custom ? ` — ${vote.custom}` : ''}\n\nby @${c.user.login} · 下一次 pipeline 循环将按此重建 skill。如需推翻，reopen 本 issue 再回复，或直接改 \`decisions/${id}.yml\`。`,
      );
      closeIssue(CFG.githubRepo, issue.number);
      log(`poll: ${id} decided via issue #${issue.number} -> ${vote.resolution}`);
      break; // one vote per issue per cycle
    }
  }
  return resolved;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  await poll();
}
