#!/usr/bin/env node
// sync.js — fetch upstream skill repos at HEAD, snapshot into work/upstream/, update upstream.lock.json
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CFG, DIRS, FILES } from './lib/env.js';
import { log, readJSON, writeJSON } from './lib/util.js';
import { headSha } from './lib/gh.js';

export async function sync() {
  const upstreams = readJSON(FILES.upstreams);
  const lock = readJSON(FILES.lock, { upstreams: [] });
  const changed = [];

  for (const up of upstreams) {
    const sha = headSha(up.repo);
    const prev = lock.upstreams.find((u) => u.name === up.name);
    const dest = path.join(DIRS.upstream, up.name);

    if (prev?.sha === sha && fs.existsSync(dest)) {
      log(`sync: ${up.name} unchanged (${sha.slice(0, 8)})`);
      continue;
    }

    log(`sync: ${up.name} ${prev?.sha?.slice(0, 8) ?? 'new'} -> ${sha.slice(0, 8)}, downloading`);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    const tgz = path.join(DIRS.work, `${up.name}.tar.gz`);
    execFileSync('curl', ['-fsSL', `https://codeload.github.com/${up.repo}/tar.gz/${sha}`, '-o', tgz]);
    execFileSync('tar', ['-xzf', tgz, '-C', dest, '--strip-components=1']);
    fs.rmSync(tgz);

    const entry = { name: up.name, repo: up.repo, sha, includePaths: up.includePaths, syncedAt: new Date().toISOString() };
    lock.upstreams = [...lock.upstreams.filter((u) => u.name !== up.name), entry].sort((a, b) => a.name.localeCompare(b.name));
    changed.push(up.name);
  }

  writeJSON(FILES.lock, lock);
  return changed;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const changed = await sync();
  console.log(changed.length ? `changed: ${changed.join(', ')}` : 'all up to date');
}
