// prompt.js — TTY 确认/选择（非 TTY 一律安全默认）
import readline from 'node:readline';

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

// 多选：序号逗号/空格分隔；回车=保持预勾选；0/none=全不选。返回选中的下标数组
export async function multiChoose(question, options, { checked = [] } = {}) {
  if (!process.stdin.isTTY) return checked;
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  process.stderr.write(`${question}（序号逗号分隔，回车=当前勾选，0=全不装）\n`);
  options.forEach((o, i) => process.stderr.write(`  ${checked.includes(i) ? '[x]' : '[ ]'} ${i + 1}. ${o.label || o}\n`));
  const ans = await new Promise((res) => rl.question('> ', res));
  rl.close();
  const t = ans.trim().toLowerCase();
  if (!t) return checked;
  if (t === '0' || t === 'none') return [];
  const idx = t.split(/[,\s]+/).map((x) => parseInt(x, 10) - 1).filter((i) => i >= 0 && i < options.length);
  return [...new Set(idx)];
}
