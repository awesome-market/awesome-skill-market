// config — get/set/list config.yml 点路径键（脚本友好）
import { readConfig, writeConfig, setConfigKey, getConfigKey, ensureHub } from '../lib/hub.js';
import { ok, fail, info } from '../lib/render.js';
import YAML from 'yaml';

export async function run(ctx) {
  const [sub, key, ...rest] = ctx.args;
  ensureHub(ctx.hub);
  const raw = readConfig(ctx.hub)._raw;

  if (sub === 'get') {
    const v = getConfigKey(raw, key);
    if (v === undefined) { fail(L(`未知配置键: ${key}`, `unknown key: ${key}`)); return 1; }
    console.log(typeof v === 'object' ? YAML.stringify(v).trim() : String(v));
    return 0;
  }
  if (sub === 'set') {
    const value = rest.join(' ');
    if (!key || value === '') { fail(L('用法: config set <键> <值>', 'usage: config set <key> <value>')); return 1; }
    // 数字/布尔/JSON 智能转型
    let v = value;
    try { v = JSON.parse(value); } catch { /* string */ }
    setConfigKey(raw, key, v);
    writeConfig(ctx.hub, raw);
    ok(`${key} = ${YAML.stringify(v).trim()}`);
    return 0;
  }
  if (sub === 'list' || !sub) {
    console.log(YAML.stringify(raw).trim() || '# empty');
    return 0;
  }
  fail(L('用法: skillmkt config [list] | get <键> | set <键> <值>', 'usage: skillmkt config [list] | get <key> | set <key> <value>'));
  return 1;
}
