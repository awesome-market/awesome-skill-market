#!/usr/bin/env node
// evidence.js — for pending conflicts: LLM writes A/B fixtures, Playwright renders screenshots
import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from './lib/env.js';
import { log, readYAML, writeYAML, listYAMLFiles } from './lib/util.js';
import { chatJSON } from './lib/llm.js';

const FIXTURE_SYSTEM = `You build minimal evidence fixtures for a UI-design rule dispute. Output ONE self-contained HTML file per option:

- Same fictional product, same layout scaffold in both files — the ONLY difference is the disputed rule being applied vs. not applied (or applied two different ways).
- The difference must be visible at a glance in a 1200x800 STATIC screenshot. If the rule concerns motion, hover, or animation: depict the differing state statically — render the element in its triggered/end state, show a before-vs-after pair inside the page, or use a frozen mid-transition frame. Never rely on interaction to reveal the difference.
- Inline <style> only, no external assets, no real brand names, no lorem ipsum — short plausible copy.
- Include a small caption bar fixed to the bottom-left: "OPTION A — <5-word description>" (same for B).
- Keep each file under 200 lines. Plain CSS, no JS unless the rule requires it.`;

const FIXTURE_SHAPE = `{"a_html":"<!doctype html>...","b_html":"<!doctype html>...","note":"what a viewer should look for"}`;

async function makeEvidence(conf) {
  const dir = path.join(DIRS.evidence, conf.id);
  fs.mkdirSync(dir, { recursive: true });
  const aHtml = path.join(dir, 'option-a.html');
  const bHtml = path.join(dir, 'option-b.html');
  const [A, B] = conf.sides;

  async function genFixtures(feedback) {
    const { a_html, b_html, note } = await chatJSON({
      label: `evidence:${conf.id}`,
      system: FIXTURE_SYSTEM,
      user: `Disputed rules:\nOPTION A (${A.source}): ${A.text}\nOPTION B (${B.source}): ${B.text}\n\nWhy they conflict: ${conf.ai_explanation}\n\nBuild the two fixtures.${feedback ? `\n\nPREVIOUS ATTEMPT FAILED: ${feedback}` : ''}`,
      shapeDesc: FIXTURE_SHAPE,
      validate: (o) => (o?.a_html?.includes('<') && o?.b_html?.includes('<')) || 'missing html',
      maxTokens: 16000,
    });
    fs.writeFileSync(aHtml, a_html);
    fs.writeFileSync(bHtml, b_html);
    fs.writeFileSync(path.join(dir, 'note.txt'), note ?? '');
  }

  async function shoot() {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    try {
      for (const [opt, file] of [['a', aHtml], ['b', bHtml]]) {
        const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, reducedMotion: 'reduce' });
        await page.goto(`file://${file}`);
        await page.waitForTimeout(350);
        await page.screenshot({ path: path.join(dir, `option-${opt}.png`) });
        await page.close();
      }
      const page = await browser.newPage({ viewport: { width: 390, height: 700 }, reducedMotion: 'reduce' });
      for (const [opt, file] of [['a', aHtml], ['b', bHtml]]) {
        await page.goto(`file://${file}`);
        await page.waitForTimeout(350);
        await page.screenshot({ path: path.join(dir, `option-${opt}-mobile.png`) });
      }
      await page.close();
    } finally {
      await browser.close();
    }
  }

  const identical = () =>
    fs.existsSync(path.join(dir, 'option-a.png')) &&
    fs.readFileSync(path.join(dir, 'option-a.png')).equals(fs.readFileSync(path.join(dir, 'option-b.png')));

  if (!fs.existsSync(aHtml) || !fs.existsSync(bHtml)) await genFixtures(null);
  await shoot();

  // QA: a static screenshot pair that renders identically proves nothing — retry once, then flag
  if (identical()) {
    log(`evidence: ${conf.id} screenshots identical, regenerating`);
    await genFixtures('The two screenshots rendered pixel-identical — the disputed difference was not visible statically. Make it obvious in the rendered output itself.');
    await shoot();
    if (identical()) {
      fs.writeFileSync(path.join(dir, 'inconclusive.txt'), 'A/B screenshots rendered identically twice; difference likely needs interaction or is not visual.\n');
      return { dir, files: [], inconclusive: true };
    }
  }
  return { dir, files: ['option-a.png', 'option-b.png', 'option-a-mobile.png', 'option-b-mobile.png'] };
}

export async function evidence() {
  const made = [];
  const todo = listYAMLFiles(DIRS.conflicts).filter((f) => {
    const c = readYAML(f);
    return c.status === 'pending'
      && ['screenshot', 'recording'].includes(c.evidence)
      && !(c.evidence_files?.length && fs.existsSync(path.join(DIRS.evidence, c.id, 'option-a.png')));
  });
  for (const [n, f] of todo.entries()) {
    const conf = readYAML(f);
    try {
      const { files, inconclusive } = await makeEvidence(conf);
      conf.evidence_files = files;
      conf.evidence_inconclusive = inconclusive || undefined;
      writeYAML(f, conf);
      made.push(conf.id);
      log(`evidence [${n + 1}/${todo.length}]: ${conf.id} rendered${inconclusive ? ' (inconclusive)' : ''}`);
    } catch (e) {
      log(`evidence [${n + 1}/${todo.length}]: ${conf.id} failed: ${e.message}`);
    }
  }
  return made;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  await evidence();
}
