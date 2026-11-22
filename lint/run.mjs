#!/usr/bin/env node
// lint/run.mjs — deterministic check of mechanizable rules against HTML/CSS/JS sources.
// usage: node lint/run.mjs <file|dir> [...]
// rules live in lint/rules.json — curated ports of merged floor/reflex rules.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RULES_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'rules.json');
const rules = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8')).map((r) => ({ ...r, re: new RegExp(r.pattern, 'iu') }));

const EXT = new Map([['.css', 'css'], ['.html', 'html'], ['.htm', 'html'], ['.js', 'js'], ['.jsx', 'js'], ['.ts', 'js'], ['.tsx', 'js'], ['.vue', 'html'], ['.svelte', 'html'], ['.astro', 'html']]);

function* walk(p) {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      yield* walk(path.join(p, e.name));
    }
  } else if (EXT.has(path.extname(p))) yield p;
}

let findings = 0;
for (const target of process.argv.slice(2)) {
  for (const file of walk(target)) {
    const kind = EXT.get(path.extname(file));
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (const r of rules) {
      if (!r.files.includes(kind) && !r.files.includes('any')) continue;
      lines.forEach((line, i) => {
        if (r.re.test(line) && !(r.allow && new RegExp(r.allow, 'i').test(line))) {
          findings++;
          console.log(`${file}:${i + 1}: [${r.id}] ${r.message}`);
        }
      });
    }
  }
}
process.exitCode = findings ? 1 : 0;
