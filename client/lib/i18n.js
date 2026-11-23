// i18n.js — CLI 双语：config ui.lang > 终端 locale（SKILLMKT_LANG 可强制）> en
// 用法：L('中文', 'English')——字符串留在调用点，不建大字典
let override = null;
export const setUILang = (v) => { override = (v === 'zh' || v === 'en') ? v : null; };
export const detectLang = () => {
  const l = (process.env.SKILLMKT_LANG || process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '').toLowerCase();
  return l.startsWith('zh') ? 'zh' : 'en';
};
export const lang = () => {
  const forced = (process.env.SKILLMKT_LANG || '').toLowerCase().slice(0, 2);
  if (forced === 'en' || forced === 'zh') return forced;   // 显式强制 > config
  return override ?? detectLang();
};
export const L = (zh, en) => (lang() === 'en' ? en : zh);
