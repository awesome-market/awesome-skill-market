#!/usr/bin/env node
// issues.js — file one GitHub issue per pending conflict (deduped by conflict id in title)
import fs from 'node:fs';
import path from 'node:path';
import { CFG, DIRS } from './lib/env.js';
import { log, readYAML, writeYAML, listYAMLFiles } from './lib/util.js';
import { ensureLabels, openIssuesWithLabel, createIssue, rawURL } from './lib/gh.js';

const LABELS = [
  { name: 'conflict', color: 'd93f0b', description: 'Unresolved rule conflict awaiting human arbitration' },
  { name: 'pipeline', color: '0e8a16', description: 'Created by the merge pipeline' },
  { name: 'decision-needed', color: 'fbca04', description: 'Needs a decisions/*.yml entry' },
];

function issueBody(conf) {
  const [A, B] = conf.sides;
  const img = (p) => `![](${rawURL(p)})`;
  const sug = conf.suggestion
    ? `\`${conf.suggestion.kind}\`${conf.suggestion.note ? ` — ${conf.suggestion.note}` : ''}`
    : '_none_';
  const evSection = conf.evidence === 'screenshot' && conf.evidence_files?.length
    ? `### 证据对比（左 A / 右 B）

| OPTION A — ${A.source} | OPTION B — ${B.source} |
|---|---|
| ${img(`evidence/${conf.id}/option-a.png`)} | ${img(`evidence/${conf.id}/option-b.png`)} |
| ${img(`evidence/${conf.id}/option-a-mobile.png`)} | ${img(`evidence/${conf.id}/option-b-mobile.png`)} |

> 图是 AI 对规则的"理解产物"。若图误导了判断，评论 \`/reshoot\` + 说明，重新出图。
`
    : `### 证据

此冲突类型为 \`${conf.evidence}\`，暂无自动截图。
`;
  return `## 规则冲突 \`${conf.id}\`

| | 规则 | 来源 | 级别 |
|---|---|---|---|
| **A** | ${A.text} | \`${A.source}\` | ${A.severity} |
| **B** | ${B.text} | \`${B.source}\` | ${B.severity} |

**AI 说明**：${conf.ai_explanation || '—'}

**AI 建议**：${sug}

${evSection}
### 裁决方式

编辑 \`decisions/${conf.id}.yml\`（或 \`npm run decide -- ${conf.id} --resolution A --reason "..."`）：

\`\`\`yaml
id: ${conf.id}
status: active
resolution: A          # A | B | merge | custom
custom: null           # resolution=merge 时填合并后的规则文本
reason: "..."
alternatives_rejected: []
decided_by: "${CFG.githubRepo.split('/')[0]}"
\`\`\`

裁决提交后，下一次 pipeline 循环会按裁决重建 skill。推翻裁决直接改同一文件并说明理由。

_fingerprint: \`${conf.fingerprint}\` · evidence: \`${conf.evidence}\` · detected: ${conf.detected_at}_`;
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
  await issues();
}
