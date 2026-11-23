// ref.js — install 引用语法解析（§6）
import fs from 'node:fs';
import path from 'node:path';
import { expandHome } from './hub.js';
import { harnessDirOf } from './scanner.js';

// owner/repo[/sub/dir][@ref]——3+ 段即 skills.sh 全 slug（slug 本身就是 owner/repo/path）
const GH_SHORT = /^([\w.-]+)\/([\w.-]+)((?:\/[\w.-]+)*)(?:@([^\s]+))?$/;
const GH_URL = /^(?:https?:\/\/|git@)github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:#(\S+))?$/;
// 浏览器复制的 tree 页：github.com/o/r/tree/<ref>/<subdir>?…——ref 含 / 的罕见，取首段
const GH_TREE = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/tree\/([^/?#]+)(?:\/([^?#]*?))?\/?(?:[?#].*)?$/;

export function parseRef(input, flags = {}, { harnesses = [], registries = [] } = {}) {
  // 1. 本地路径（存在即 local/harness）
  const expanded = path.resolve(expandHome(input));
  if (fs.existsSync(expanded) && fs.statSync(expanded).isDirectory()) {
    const h = harnessDirOf(harnesses, expanded);
    return h ? { kind: 'harness', absPath: expanded, harnessId: h.harnessId, dir: h.dir }
             : { kind: 'local', absPath: expanded };
  }

  // 2. git URL / tree 页 URL
  const treeM = input.match(GH_TREE);
  if (treeM) return { kind: 'github', owner: treeM[1], repo: treeM[2], ref: treeM[3] || null, path: treeM[4] || flags.path || null };
  const urlM = input.match(GH_URL);
  if (urlM) return { kind: 'github', owner: urlM[1], repo: urlM[2], ref: urlM[3] || null, path: flags.path || null };

  // 3. registry 前缀 corp:name
  const colon = input.match(/^([\w-]+):([\w./@-]+)$/);
  if (colon && registries.some((r) => (r.name || r.type) === colon[1])) {
    return { kind: 'named', name: colon[2], registry: colon[1] };
  }

  // 4. owner/repo[/sub/dir][@ref]（slug 内嵌路径优先，--path 兜底）
  const ghM = input.replace(/\/+$/, '').match(GH_SHORT);
  if (ghM && !input.startsWith('-')) {
    return { kind: 'github', owner: ghM[1], repo: ghM[2], path: ghM[3]?.replace(/^\/+/, '') || flags.path || null, ref: ghM[4] || null };
  }

  // 5. 裸名——默认 skills.sh 索引（可 --from 换 registry）
  return { kind: 'named', name: input, registry: flags.from || 'skillssh' };
}
