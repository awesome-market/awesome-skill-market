import { sh } from './util.js';
import { CFG } from './env.js';

/** gh api helper; returns parsed JSON. */
export function ghApi(path, { method = 'GET', fields = {} } = {}) {
  const args = ['api', path, '-X', method];
  for (const [k, v] of Object.entries(fields)) args.push('-f', `${k}=${v}`);
  const out = sh('gh', args, { quiet: true });
  return out ? JSON.parse(out) : null;
}

export function defaultBranch(repo) {
  return ghApi(`repos/${repo}`).default_branch;
}

export function headSha(repo) {
  const b = defaultBranch(repo);
  return ghApi(`repos/${repo}/commits/${b}`).sha;
}

export function ensureLabels(repo, labels) {
  const existing = new Set(
    (ghApi(`repos/${repo}/labels?per_page=100`) || []).map((l) => l.name),
  );
  for (const { name, color, description } of labels) {
    if (existing.has(name)) continue;
    try {
      ghApi(`repos/${repo}/labels`, { method: 'POST', fields: { name, color, description } });
    } catch { /* race / perms: non-fatal */ }
  }
}

export function openIssuesWithLabel(repo, label) {
  return ghApi(`repos/${repo}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100`) || [];
}

export function createIssue(repo, { title, body, labels = [] }) {
  const out = sh('gh', ['issue', 'create', '-R', repo, '--title', title, '--body', body, ...labels.flatMap((l) => ['--label', l])], { quiet: true });
  return out.trim(); // issue URL
}

export const rawURL = (repoPath) =>
  `https://raw.githubusercontent.com/${CFG.githubRepo}/${CFG.githubBranch}/${repoPath}`;
