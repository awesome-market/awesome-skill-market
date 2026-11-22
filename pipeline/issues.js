#!/usr/bin/env node
// issues.js — file one GitHub issue per pending conflict (deduped by conflict id in title)
import fs from 'node:fs';
import path from 'node:path';
import { CFG, DIRS } from './lib/env.js';
import { log, readYAML, writeYAML, listYAMLFiles } from './lib/util.js';
import { ensureLabels, openIssuesWithLabel, createIssue, rawURL, ghApi } from './lib/gh.js';

const LABELS = [
  { name: 'conflict', color: 'd93f0b', description: 'Unresolved rule conflict awaiting human arbitration' },
  { name: 'pipeline', color: '0e8a16', description: 'Created by the merge pipeline' },
  { name: 'decision-needed', color: 'fbca04', description: 'Needs a decisions/*.yml entry' },
  { name: 'decided', color: '5319e7', description: 'Arbitrated via issue comment or decisions/*.yml' },
];

const stripLangTag = (s) => (s ?? '').replace(/^(EN|ZH|中文|RULE\s*[AB]|规则\s*[AB])\s*[:：]\s*/i, '');

function issueBody(conf) {
  const [A, B] = conf.sides;
  const img = (p) => `![](${rawURL(p)})`;
  const side = (s) => `${s.text}${s.text_zh ? `<br>${stripLangTag(s.text_zh)}` : ''}`;
  const sug = conf.suggestion
    ? `\`${conf.suggestion.kind}\`${conf.suggestion.note ? ` — ${stripLangTag(conf.suggestion.note)}` : ''}${conf.suggestion.note_zh ? `<br>${stripLangTag(conf.suggestion.note_zh)}` : ''}`
    : '_none_ / 无_';
  const explanation = [
    stripLangTag(conf.ai_explanation) || '—',
    conf.ai_explanation_zh ? `<br>${stripLangTag(conf.ai_explanation_zh)}` : '',
  ].join('');
  const evSection = conf.evidence_files?.length
    ? `### 证据对比 Evidence — 左 A / 右 B (left A / right B)

| OPTION A — ${A.source} | OPTION B — ${B.source} |
|---|---|
| ${img(`evidence/${conf.id}/option-a.png`)} | ${img(`evidence/${conf.id}/option-b.png`)} |
| ${img(`evidence/${conf.id}/option-a-mobile.png`)} | ${img(`evidence/${conf.id}/option-b-mobile.png`)} |

> 图是 AI 对规则的理解产物；若误导判断，评论 \`/reshoot\` + 说明重新出图。
> Screenshots are the AI's interpretation of each rule. If they mislead, comment \`/reshoot\` plus a note to regenerate.
`
    : `### 证据 Evidence

${conf.evidence_inconclusive ? '两次生成对比图渲染结果一致——此分歧可能需交互才可见，或并非纯视觉差异，请直接按规则文本裁决。<br>Two render attempts produced identical screenshots — arbitrate on the rule text.' : `此冲突类型为 \`${conf.evidence}\`，暂无自动截图。<br>Evidence type \`${conf.evidence}\` — no auto screenshot.`}
`;
  return `## 规则冲突 Rule conflict \`${conf.id}\`

| | 规则 Rule | 来源 Source | 级别 Severity |
|---|---|---|---|
| **A** | ${side(A)} | \`${A.source}\` | ${A.severity} |
| **B** | ${side(B)} | \`${B.source}\` | ${B.severity} |

**AI 说明 Explanation**：${explanation}

**AI 建议 Suggestion**：${sug}

${evSection}
### 裁决方式 How to decide — 直接回复本 issue / just reply

| 回复 Reply | 效果 Effect |
|---|---|
| \`a\` 或 \`b\` | 选该侧规则入库（可加 \`- 理由\`）<br>Ship that side (\`a - reason\` adds a reason) |
| \`merge 合并后的规则文本\` | 用你给的合并文本入库<br>Ship your merged rule text |
| \`custom 规则文本\` | 完全自定义<br>Fully custom rule |

仅 repo owner/collaborator 的回复生效。Pipeline 每轮扫描评论，裁决后自动写入 \`decisions/${conf.id}.yml\`、回复确认并关闭 issue。
Only owner/collaborator replies count. Each daemon cycle harvests votes, writes \`decisions/${conf.id}.yml\`, confirms and closes this issue.

推翻 Overturn：reopen 本 issue 再回复一次，或 \`npm run decide -- ${conf.id} --resolution A --reason "..."\`。
To overturn: reopen this issue and reply again, or run \`npm run decide\`.

_fingerprint: \`${conf.fingerprint}\` · evidence: \`${conf.evidence}\` · detected: ${conf.detected_at}_`;
}

export { issueBody };

/** Rewrite bodies of open conflict issues (e.g. after template changes). */
export async function updateBodies() {
  const open = openIssuesWithLabel(CFG.githubRepo, 'conflict');
  const byId = new Map(open.map((i) => [(i.title.match(/conf-\d+/) || [])[0], i.number]));
  for (const f of listYAMLFiles(DIRS.conflicts)) {
    const conf = readYAML(f);
    const num = byId.get(conf.id);
    if (!num) continue;
    ghApi(`repos/${CFG.githubRepo}/issues/${num}`, { method: 'PATCH', fields: { body: issueBody(conf) } });
    log(`issues: updated body of #${num} (${conf.id})`);
  }
}

export async function issues() {
  if (!CFG.githubRepo) { log('issues: GITHUB_REPO unset, skip'); return []; }
  ensureLabels(CFG.githubRepo, LABELS);
  const open = openIssuesWithLabel(CFG.githubRepo, 'conflict');
  const openIds = new Set(open.map((i) => (i.title.match(/conf-\d+/) || [])[0]).filter(Boolean));
  const decidedIds = new Set(
    listYAMLFiles(DIRS.decisions)
      .map((f) => readYAML(f))
      .filter((d) => d?.status === 'active')
      .map((d) => d.id),
  );

  const filed = [];
  for (const f of listYAMLFiles(DIRS.conflicts)) {
    const conf = readYAML(f);
    if (conf.status !== 'pending' || decidedIds.has(conf.id)) continue;
    if (openIds.has(conf.id) || conf.issue_url) continue;
    try {
      const url = createIssue(CFG.githubRepo, {
        title: `[conflict] ${conf.id}: ${conf.sides[0].source} vs ${conf.sides[1].source}`,
        body: issueBody(conf),
        labels: ['conflict', 'pipeline', 'decision-needed'],
      });
      conf.issue_url = url;
      writeYAML(f, conf);
      filed.push(conf.id);
      log(`issues: filed ${conf.id} -> ${url}`);
    } catch (e) {
      log(`issues: ${conf.id} failed: ${e.message}`);
    }
  }
  return filed;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  if (process.argv.includes('--update-bodies')) await updateBodies();
  else await issues();
}
