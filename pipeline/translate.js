#!/usr/bin/env node
// translate.js — backfill Chinese translations on conflicts that predate bilingual judge output.
// Fills sides[].text_zh, ai_explanation_zh, suggestion.note_zh. Idempotent: skips fields already set.
import { DIRS } from './lib/env.js';
import { log, readYAML, writeYAML, listYAMLFiles } from './lib/util.js';
import { chatJSON } from './lib/llm.js';

const SHAPE = `{"explanation_zh":"中文","suggestion_note_zh":"中文 or null","side_a_zh":"中文","side_b_zh":"中文"}`;

export async function translateConflicts() {
  let done = 0;
  for (const f of listYAMLFiles(DIRS.conflicts)) {
    const conf = readYAML(f);
    const needZh = !conf.ai_explanation_zh || conf.sides.some((s) => !s.text_zh)
      || (conf.suggestion?.note && !conf.suggestion.note_zh);
    if (!needZh) continue;

    const out = await chatJSON({
      label: `translate:${conf.id}`,
      system: 'You translate UI-design rule arbitration content into Chinese. Output faithful, concise 简体中文 translations. Keep technical terms (CSS properties, token names) in English where natural.',
      user: `RULE A: ${conf.sides[0].text}\n\nRULE B: ${conf.sides[1].text}\n\nEXPLANATION: ${conf.ai_explanation || '(none)'}\n\nSUGGESTION NOTE: ${conf.suggestion?.note || '(none)'}`,
      shapeDesc: SHAPE,
      maxTokens: 4096,
      validate: (o) => (o?.side_a_zh && o?.side_b_zh ? true : 'missing zh fields'),
    });
    conf.sides[0].text_zh = out.side_a_zh;
    conf.sides[1].text_zh = out.side_b_zh;
    conf.ai_explanation_zh = out.explanation_zh || conf.ai_explanation_zh;
    if (conf.suggestion?.note && out.suggestion_note_zh) conf.suggestion.note_zh = out.suggestion_note_zh;
    writeYAML(f, conf);
    done++;
    log(`translate: ${conf.id} done`);
  }
  log(`translate: ${done} conflicts backfilled`);
  return done;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  await translateConflicts();
}
