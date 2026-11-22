#!/usr/bin/env node
// arbitrate.js — independent second opinion on pending conflicts.
// A fresh-context arbiter sees ONLY the two rules + the suggestion (never the synthesis
// conversation) and decides whether the suggestion is sound enough to auto-apply.
// Approved verdicts write decisions/*.yml like a human vote — auditable, overturnable.
// Rejected/unsure stays pending for human arbitration via issue comments.
import path from 'node:path';
import { CFG, DIRS } from './lib/env.js';
import { log, readYAML, writeYAML, listYAMLFiles } from './lib/util.js';
import { chatJSON } from './lib/llm.js';
import { ghApi } from './lib/gh.js';

const SYSTEM = `You are an INDEPENDENT arbiter for UI-design rule conflicts. You did not write the analysis below — evaluate it cold.

Two rules are claimed to contradict, and a suggestion was made to resolve them. Three verdicts:

- "dismiss" — the pair is NOT a real contradiction: actually compatible, restatements, or they govern different scopes. The conflict should not exist; both rules just merge.
- "approve" — a genuine contradiction AND the suggestion resolves it soundly and completely. keep-a/keep-b must pick the defensibly better rule; for merge/scope-split you write the resolved combined rule in "rule". Only approve calls you could defend to upstream authors.
- "human" — a genuine contradiction BUT the suggestion is wrong, incomplete, or you are uncertain. A human will arbitrate.`;

const SHAPE = `{"verdict":"approve|dismiss|human","reason":"one sentence","rule":"resolved combined rule text — required only for approve on merge/scope-split; null otherwise"}`;

const KIND_TO_RES = { 'keep-a': 'A', 'keep-b': 'B', 'merge': 'merge', 'scope-split': 'merge' };

export async function arbitrate() {
  const decisions = new Map(listYAMLFiles(DIRS.decisions).map((f) => {
    const d = readYAML(f);
    return [d.id, d];
  }));
  const pending = listYAMLFiles(DIRS.conflicts)
    .map((f) => ({ file: f, ...readYAML(f) }))
    .filter((c) => c.status === 'pending' && c.suggestion?.kind && KIND_TO_RES[c.suggestion.kind]);

  log(`arbitrate: ${pending.length} suggested pending conflicts to review`);
  let accepted = 0, dismissed = 0;

  for (const conf of pending) {
    const [A, B] = conf.sides;
    const user = `RULE A: ${A.text}\nRULE B: ${B.text}\n\nAI EXPLANATION: ${conf.ai_explanation}\n\nSUGGESTION: ${conf.suggestion.kind}${conf.suggestion.note ? ` — ${conf.suggestion.note}` : ''}`;
    let verdict;
    try {
      verdict = await chatJSON({
        label: `arbitrate:${conf.id}`, system: SYSTEM, user, shapeDesc: SHAPE,
        thinking: false, temperature: 0.2, maxTokens: 4096,
        validate: (o) => {
          if (!['approve', 'dismiss', 'human'].includes(o?.verdict)) return 'verdict must be approve|dismiss|human';
          if (o.verdict === 'approve' && conf.suggestion.kind !== 'keep-a' && conf.suggestion.kind !== 'keep-b' && !o.rule) {
            return 'merge/scope-split approval requires "rule" text';
          }
          return true;
        },
      });
    } catch (e) {
      log(`arbitrate: ${conf.id} arbiter failed (${e.message.split('\n')[0]}); leaving for human`);
      continue;
    }

    if (verdict.verdict === 'human') {
      log(`arbitrate: ${conf.id} -> human (${verdict.reason ?? 'rejected'})`);
      continue;
    }

    // "dismiss" — not a real contradiction; free both sides back into the merge pool
    if (verdict.verdict === 'dismiss') {
      conf.status = 'dismissed';
      conf.dismiss_reason = verdict.reason;
      writeYAML(conf.file, conf);
      dismissed++;
      log(`arbitrate: ${conf.id} -> dismissed (${verdict.reason})`);
      if (conf.issue_url) {
        const num = conf.issue_url.split('/').pop();
        try {
          ghApi(`repos/${CFG.githubRepo}/issues/${num}/comments`, {
            method: 'POST',
            fields: { body: `🚫 误报关闭 Dismissed as false conflict：独立仲裁器判定两侧并非真矛盾——${verdict.reason}。The independent arbiter found the two sides are not genuinely contradictory; both return to the merge pool.\n\n若不同意 If you disagree：reopen 本 issue 回复 \`a\`/\`b\`/\`merge ...\`/\`custom ...\` 照常裁决即可正常受理。` },
          });
          ghApi(`repos/${CFG.githubRepo}/issues/${num}`, { method: 'PATCH', fields: { state: 'closed' } });
        } catch (e) {
          log(`arbitrate: ${conf.id} dismissed, but issue #${num} close failed (${e.message})`);
        }
      }
      continue;
    }

    const resolution = KIND_TO_RES[conf.suggestion.kind];
    const custom = resolution === 'merge' ? (verdict.rule || conf.suggestion.note) : null;
    const prev = decisions.get(conf.id);
    writeYAML(path.join(DIRS.decisions, `${conf.id}.yml`), {
      id: conf.id,
      status: 'active',
      resolution,
      custom,
      reason: `auto-accepted ${conf.suggestion.kind}: ${verdict.reason}`,
      alternatives_rejected: [],
      trigger: 'auto-arbiter',
      decided_at: new Date().toISOString(),
      decided_by: 'auto-arbiter',
      comment_url: null,
      supersedes: prev ? { resolution: prev.resolution, reason: prev.reason, at: prev.decided_at } : null,
    });
    conf.status = 'decided';
    writeYAML(conf.file, conf);
    accepted++;
    log(`arbitrate: ${conf.id} -> ${resolution}${custom ? ' (merged text)' : ''} — ${verdict.reason}`);

    // close the issue if one is already open for this conflict
    if (conf.issue_url) {
      const num = conf.issue_url.split('/').pop();
      try {
        ghApi(`repos/${CFG.githubRepo}/issues/${num}/comments`, {
          method: 'POST',
          fields: { body: `✅ 自动裁决 Auto-arbitrated：**${resolution}**${custom ? ` — ${custom}` : ''}\n\n独立仲裁器认可了 AI 建议（${conf.suggestion.kind}）。An independent arbiter approved the AI suggestion (${conf.suggestion.kind}).\n理由 Reason：${verdict.reason}\n\n推翻 Overturn：reopen 本 issue 回复 \`a\`/\`b\`/\`merge ...\`/\`custom ...\`，或直接改 \`decisions/${conf.id}.yml\`。` },
        });
        ghApi(`repos/${CFG.githubRepo}/issues/${num}`, { method: 'PATCH', fields: { state: 'closed' } });
        ghApi(`repos/${CFG.githubRepo}/issues/${num}/labels`, { method: 'POST', fields: { 'labels[]': 'decided' } });
      } catch (e) {
        log(`arbitrate: ${conf.id} decided, but issue #${num} close failed (${e.message}); poll will retry`);
      }
    }
  }
  log(`arbitrate: ${accepted} auto-decided, ${dismissed} dismissed (false conflicts), ${pending.length - accepted - dismissed} left for humans`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  await arbitrate();
}
