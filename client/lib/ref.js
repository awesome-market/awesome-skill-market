// ref.js — install 引用语法解析（§6）
import fs from 'node:fs';
import path from 'node:path';
import { expandHome } from './hub.js';
import { harnessDirOf } from './scanner.js';

const GH_SHORT = /^([\w.-]+)\/([\w.-]+)(?:@([^\s]+))?$/;
const GH_URL = /^(?:https?:\/\/|git@)github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:#(\S+))?$/;

export function parseRef(input, flags = {}, { harnesses = [], registries = [] } = {}) {
  // 1. 本地路径（存在即 local/harness）
  const expanded = path.resolve(expandHome(input));
  if (fs.existsSync(expanded) && fs.statSync(expanded).isDirectory()) {
    const h = harnessDirOf(harnesses, expanded);
    return h ? { kind: 'harness', absPath: expanded, harnessId: h.harnessId, dir: h.dir }
             : { kind: 'local', absPath: expanded };
  }

  // 2. git URL
  const urlM = input.match(GH_URL);
  if (urlM) return { kind: 'github', owner: urlM[1], repo: urlM[2], ref: urlM[3] || null, path: flags.path || null };

  // 3. registry 前缀 corp:name
  const colon = input.match(/^([\w-]+):([\w./@-]+)$/);
  if (colon && registries.some((r) => (r.name || r.type) === colon[1])) {
    return { kind: 'named', name: colon[2], registry: colon[1] };
  }

  // 4. owner/repo[@ref]（--path 定位子目录）
  const ghM = input.match(GH_SHORT);
  if (ghM && !input.startsWith('-')) {
    return { kind: 'github', owner: ghM[1], repo: ghM[2], ref: ghM[3] || null, path: flags.path || null };
  }

  // 5. 裸名——默认 skills.sh 索引（可 --from 换 registry）
  return { kind: 'named', name: input, registry: flags.from || 'skillssh' };
}
