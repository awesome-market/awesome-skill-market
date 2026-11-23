// prompt.js — TTY 确认/选择（非 TTY 一律安全默认）
import readline from 'node:readline';
import { L } from './i18n.js';

export async function confirm(question, { defaultYes = false } = {}) {
  if (!process.stdin.isTTY) return defaultYes;
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const ans = await new Promise((res) => rl.question(`${question} [${defaultYes ? 'Y/n' : 'y/N'}] `, res));
  rl.close();
  const a = ans.trim().toLowerCase();
  return a === '' ? defaultYes : a === 'y' || a === 'yes';
}

export async function choose(question, options) {
  if (!process.stdin.isTTY) return options[0];
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  process.stderr.write(`${question}\n`);
  options.forEach((o, i) => process.stderr.write(`  ${i + 1}. ${o.label || o}\n`));
  const ans = await new Promise((res) => rl.question('> ', res));
  rl.close();
  const n = parseInt(ans, 10);
  return options[n - 1] ?? options[0];
}

// 自由文本输入（非 TTY 返回空串）
export async function ask(question) {
  if (!process.stdin.isTTY) return '';
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const ans = await new Promise((res) => rl.question(question, res));
  rl.close();
  return ans;
}

// 密钥输入：raw 模式逐字符读，回显 *（粘贴整块也不回显真值）；非 TTY 返回空串
export async function askSecret(question) {
  if (!process.stdin.isTTY) return '';
  process.stderr.write(question);
  return new Promise((res) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    let buf = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (ch) => {
      if (ch === '\u0003') { cleanup(); process.stderr.write('\n'); process.exit(130); }
      if (ch === '\r' || ch === '\n') { cleanup(); process.stderr.write('\n'); return res(buf); }
      if (ch === '\u007f' || ch === '\b') {
        if (buf.length) { buf = buf.slice(0, -1); process.stderr.write('\b \b'); }
        return;
      }
      buf += ch;
      process.stderr.write('*'.repeat([...ch].length));   // 粘贴一次来整块→按字符数回星
    };
    const cleanup = () => { stdin.off('data', onData); stdin.setRawMode(wasRaw ?? false); stdin.pause(); };
    stdin.on('data', onData);
  });
}

// 多选：序号逗号/空格分隔；回车=保持预勾选；0/none=全不选。返回选中的下标数组
export async function multiChoose(question, options, { checked = [] } = {}) {
  if (!process.stdin.isTTY) return checked;
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  process.stderr.write(`${question}${L('（序号逗号分隔，回车=当前勾选，0=全不装）', ' (comma-separated numbers, Enter = keep checked, 0 = none)')}\n`);
  options.forEach((o, i) => process.stderr.write(`  ${checked.includes(i) ? '[x]' : '[ ]'} ${i + 1}. ${o.label || o}\n`));
  const ans = await new Promise((res) => rl.question('> ', res));
  rl.close();
  const t = ans.trim().toLowerCase();
  if (!t) return checked;
  if (t === '0' || t === 'none') return [];
  const idx = t.split(/[,\s]+/).map((x) => parseInt(x, 10) - 1).filter((i) => i >= 0 && i < options.length);
  return [...new Set(idx)];
}
