// skillmkt SPA — no build. token from ?token=; SSE live updates. zh/en via I18N.
const T = new URLSearchParams(location.search).get('token') || '';
const api = async (p, opt) => (await fetch(`/api${p}${p.includes('?') ? '&' : '?'}token=${T}`, { headers: { authorization: `Bearer ${T}` }, ...opt })).json();
const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let S = null, tab = location.hash.slice(1).split('?')[0] || 'skills';
let saveMsg = '', saveMsgAt = 0;   // 保存结果提示——要挺过保存后的连续重渲染（自己 refresh + SSE config 事件）
const mkState = { q: '', results: null, installed: new Set(), perm: new Set(), force: new Set(), status: {}, directOut: '', directPerm: false, directForce: false };   // 市场页状态——SSE refresh 重渲染不丢
let mgOut = '';   // 合并结果提示——同上
const isSuspicious = (out) => /可疑|suspicious/i.test(out || '');   // 审核"可疑"→ 需用户知情确认才放行
const isManaged = (out) => /已在管理|already managed/i.test(out || '');   // 已管理且内容不同（装旧版）→ --force 确认

const I18N = {
  zh: {
    title: 'skillmkt — 本地 skill 管理面板', tag: '本地管理面板',
    nav_skills: '已安装', nav_market: '市场', nav_merge: '合并', nav_conflicts: '冲突处理', nav_review: '安全审核', nav_setup: '设置',
    live_conn: '连接中…', live_on: '已连接', live_off: '已断开',
    foot_hub: (h) => `数据目录：${h}`,
    err_conn: (e) => `连不上本地服务：${esc(e)}——服务可能已退出，重跑 <code>skillmkt serve</code>`,
    err_token: (e) => `${esc(e)}——网址里的 token 已失效，重跑 <code>skillmkt serve</code> 拿新链接`,
    sep: '、',
    sk_h: (n) => `已安装的 skill（${n}）`,
    sk_desc: '通过 skillmkt 安装、统一管理的 skill。点开「安装位置」可以决定它出现在哪些 AI 工具的 skills 目录里。',
    sk_at: '装在：', sk_hub: '仅仓库', sk_loc: '安装位置',
    sk_empty: '还没有安装任何 skill。<br>在终端运行 <code>skillmkt install 名称</code> 安装；不知道装什么可以先 <code>skillmkt search 关键词</code> 搜一搜。',
    tg_label: '安装到这些 AI 工具', tg_warn: '取消勾选会把已复制的删掉',
    tg_save: '保存安装位置', tg_saved: '已保存并生效', tg_fail: (e) => `失败：${e}`,
    agents_h: '你电脑上的 AI 工具',
    agents_desc: '检测到的 agent 及其 skills 目录。「可用」表示工具已安装、目录会在首次安装 skill 时自动建好。',
    upd_h: (n) => `有更新可用（${n}）`,
    upd_desc: '上游发布了新版本。终端运行 <code>skillmkt upgrade</code> 更新。',
    cf_h: (n) => `冲突处理（${n} 条待处理）`,
    cf_desc: '不同 skill 对同一件事给出相反规则时，需要你拍板。每条冲突填一句理由，然后选 A、选 B、自己合并，或者标为误报。',
    side: (w, s) => `方案 ${w} · 来自 ${s}`,
    ai_note: (x) => `AI 分析：${x}`, fp_note: (x) => `误报原因：${x}`,
    reason_l: '裁决理由（必填——以后翻记录时知道为什么这么选）',
    reason_ph: '例：A 的规则更具体，覆盖了 B 的场景',
    keep_a: '采用方案 A', keep_b: '采用方案 B', merge_btn: '自己合并两条…', dismiss_btn: '其实不冲突',
    mtext_l: '合并后的规则文本（已预填两条原文，直接改）',
    submit_merge: '提交合并', cancel: '取消',
    need_reason: '先填一句裁决理由',
    cf_empty: '没有待处理的冲突。<br>合并两个 skill 时会自动检测：<code>skillmkt merge 名字A 名字B</code>',
    rv_h: (n) => `安全检查记录（${n}）`,
    rv_desc: '每次安装 skill 时做的供应链安全检查结果（恶意脚本、凭证收集等）。',
    findings: (n) => `${n} 条发现`, ai_rec: (v) => `，AI 复审：${v}`,
    rv_empty: '还没有检查记录——安装 skill 时会自动生成。',
    dec_h: (n) => `我的裁决记录（${n}）`,
    dec_desc: '你在「冲突处理」里做过的拍板，都在这里留底。',
    set_h: '设置',
    set_desc: '一次配置即可：界面语言默认跟随终端；AI 模型可选（用于冲突自动仲裁等智能功能，不配也能正常用）；安装位置决定新 skill 默认复制到哪些 AI 工具。',
    step_lang: '第 1 步 · 界面语言',
    lang_desc: '默认跟随终端的语言环境（LANG / LC_ALL）。切换后立即生效并保存到 config.yml。',
    step_llm: '第 2 步 · AI 模型（可选）',
    probe_hint: (m) => `点「扫描」自动发现本机正在运行的模型服务（LM Studio、Ollama、oMLX 等）。${m ? `当前使用：<code>${esc(m)}</code>` : ''}`,
    probe_btn: '扫描本机模型服务',
    l_url: '服务地址', l_key: '访问密钥', l_model: '模型名称',
    key_sub: '填了密钥会用本机机器码加密后存入 config.yml——文件拷到别的机器解不开，换机需重填。',
    model_ph: '可输入关键字搜索，扫描后自动列出发现的模型',
    smoke_btn: '测试连接',
    ep_key: '需要密钥（点这行填地址，再填密钥、测试连接）',
    ep_n: (n) => `${n} 个模型（点这行选中，在「模型名称」下拉框里搜索）`,
    eps_empty: '没扫到——已尝试本机所有监听端口。确认模型服务已启动，或直接把服务地址填到下面',
    found: (n, m) => `发现 ${n} 个服务、${m} 个模型`,
    scanning_txt: '扫描中…', scanning_drop: '正在扫描本机服务…',
    no_models: '暂无模型——先扫描或填密钥', no_match: '无匹配',
    enc_disp: '已加密保存',
    hint_wrong: '← 密钥错误', hint_pend: '← 待验证', hint_need: '← 需要密钥',
    verifying: '验证密钥…',
    key_ok: (n) => `密钥有效，已加载 ${n} 个模型`,
    key_bad: (e) => `密钥错误：${e}`, key_nomodels: '密钥通了，但没读到模型',
    req_fail: (e) => `请求失败：${e}`,
    testing: '测试中…',
    conn_ok: '连接成功', sent: '发送：', reply: '回复：', empty_reply: '（空回复）',
    conn_fail: (e) => `连接失败：${e}`,
    step_tg: '第 3 步 · skill 默认安装位置',
    tg_desc2: '勾选的 AI 工具会在你安装新 skill 时自动收到一份副本。已勾过的话保存即生效。',
    step_save: '第 4 步 · 保存', save_btn: '保存设置',
    saved: (enc) => `已保存到 config.yml${enc ? '，密钥已加密' : ''}`,
    save_fail: (e) => `保存失败：${e}`,
    mk_h: 'Skill 市场', mk_desc: '搜 skills.sh 公共市场，或直接粘 owner/repo / 本地路径。',
    mk_ph: '搜关键词，或粘 owner/repo / 绝对路径', mk_search: '搜索', mk_direct: '按输入直接安装', mk_install: '安装',
    mk_busy: '处理中…', ins_done: '完成', ins_fail: (c) => `失败（退出码 ${c}）`,
    mk_susp: '审核判为可疑——了解风险后仍要装？', mk_force: '仍要安装', ext_force: '仍要纳入',
    mk_mng: '已在管理且内容不同（装旧版？）——覆盖现有副本？', mk_ow: '覆盖安装',
    mk_nosrc: '私有源暂不可装', mk_privsrc: '私有源',
    sk_remove: '移除', sk_remove_sure: '再点一次确认', sk_removed: '已移除', open_dir: '打开文件夹',
    det_btn: '详情', det_files: (n) => `${n} 个文件`, det_diff: '上游 diff', det_rollback: '回滚上一版', det_tags: '找旧版→',
    det_old: '装旧版', det_old_ph: 'tag 或 sha，如 agent-skills-6ec…', det_noroll: '无历史可回滚（upgrade 后才存快照）',
    ext_h: (n) => `散落在 AI 工具里的 skill（${n}）`,
    ext_desc: '能用但没人管：没版本、没审核、没更新——纳入管理补齐。',
    ext_adopt: '纳入管理', ext_busy: '处理中…',
    maint_h: '维护', upd_refresh: '刷新上游信息', upd_one: '升级', upd_all: '全部升级',
    sync_btn: '检查并修复投影', op_busy: '执行中…', op_done: '完成',
    mg_h: '合并 skill', mg_desc: '勾选两个以上已管理的 skill，规则会抽出来去重、查冲突——有分歧的进「冲突处理」由你裁决，最终生成一个不含未决规则的新 skill。',
    mg_pick: '选择要合并的 skill（≥2）', mg_name: '新 skill 名字（可选，默认自动生成）', mg_go: '开始合并',
    mg_busy: '合并中…', mg_few: '至少勾两个',
    mg_state: (n, r) => `当前合并产物：${n}（${r} 条规则）`,
    mg_build: '生成 SKILL.md', mg_install: '安装这个合并 skill', mg_to_conflicts: '有冲突待裁决 → 去「冲突处理」',
    rv_reaudit: '重新审核',
  },
  en: {
    title: 'skillmkt — local skill manager', tag: 'local skill manager',
    nav_skills: 'Installed', nav_market: 'Market', nav_merge: 'Merge', nav_conflicts: 'Conflicts', nav_review: 'Security', nav_setup: 'Settings',
    live_conn: 'connecting…', live_on: 'connected', live_off: 'disconnected',
    foot_hub: (h) => `Data dir: ${h}`,
    err_conn: (e) => `Cannot reach the local service: ${esc(e)} — it may have exited; run <code>skillmkt serve</code> again`,
    err_token: (e) => `${esc(e)} — the token in this URL expired; run <code>skillmkt serve</code> for a fresh link`,
    sep: ', ',
    sk_h: (n) => `Installed skills (${n})`,
    sk_desc: 'Skills installed and managed by skillmkt. Open "Locations" to decide which AI tools get a copy in their skills directory.',
    sk_at: 'in: ', sk_hub: 'hub only', sk_loc: 'Locations',
    sk_empty: 'No skills installed yet.<br>Run <code>skillmkt install &lt;name&gt;</code> in the terminal, or <code>skillmkt search &lt;keyword&gt;</code> to find some.',
    tg_label: 'Install into these AI tools', tg_warn: 'Unchecking removes the existing copy',
    tg_save: 'Save locations', tg_saved: 'Saved', tg_fail: (e) => `Failed: ${e}`,
    agents_h: 'AI tools on this machine',
    agents_desc: 'Detected agents and their skills directories. "Available" means the tool is installed and its directory will be created on first install.',
    upd_h: (n) => `Updates available (${n})`,
    upd_desc: 'Upstream published a new version. Run <code>skillmkt upgrade</code> to update.',
    cf_h: (n) => `Conflicts (${n} pending)`,
    cf_desc: 'When skills give opposite rules for the same thing, you decide. Give a one-line reason, then keep A, keep B, merge them yourself, or mark it a false positive.',
    side: (w, s) => `Option ${w} · from ${s}`,
    ai_note: (x) => `AI analysis: ${x}`, fp_note: (x) => `Dismissed because: ${x}`,
    reason_l: 'Decision reason (required — so the record explains why later)',
    reason_ph: 'e.g. A is more specific and covers B’s case',
    keep_a: 'Keep option A', keep_b: 'Keep option B', merge_btn: 'Merge manually…', dismiss_btn: 'Not a conflict',
    mtext_l: 'Merged rule text (prefilled with both originals — edit directly)',
    submit_merge: 'Submit merge', cancel: 'Cancel',
    need_reason: 'Write a one-line reason first',
    cf_empty: 'No pending conflicts.<br>Merging two skills detects them automatically: <code>skillmkt merge &lt;A&gt; &lt;B&gt;</code>',
    rv_h: (n) => `Security checks (${n})`,
    rv_desc: 'Supply-chain checks run on every skill install (malicious scripts, credential harvesting, etc.).',
    findings: (n) => `${n} findings`, ai_rec: (v) => `, AI review: ${v}`,
    rv_empty: 'No checks yet — they are generated automatically on install.',
    dec_h: (n) => `My decisions (${n})`,
    dec_desc: 'Decisions you made in "Conflicts" are recorded here.',
    set_h: 'Settings',
    set_desc: 'One-time configuration: the UI language follows your terminal by default; the AI model is optional (powers smart features like conflict arbitration — everything works without it); install locations decide which AI tools get new skills.',
    step_lang: 'Step 1 · Interface language',
    lang_desc: 'Defaults to your terminal locale (LANG / LC_ALL). Applies immediately and is saved to config.yml.',
    step_llm: 'Step 2 · AI model (optional)',
    probe_hint: (m) => `Click "Scan" to discover model services running on this machine (LM Studio, Ollama, oMLX, etc.).${m ? ` Current: <code>${esc(m)}</code>` : ''}`,
    probe_btn: 'Scan local model services',
    l_url: 'Service URL', l_key: 'Access key', l_model: 'Model name',
    key_sub: 'A key you enter is encrypted with this machine’s ID into config.yml — copying the file elsewhere cannot decrypt it; re-enter after switching machines.',
    model_ph: 'Type to search — discovered models are listed automatically',
    smoke_btn: 'Test connection',
    ep_key: 'needs a key (click to fill URL, then enter key & test)',
    ep_n: (n) => `${n} models (click to select, then pick in the Model name dropdown)`,
    eps_empty: 'Nothing found — all listening ports were probed. Start the model service, or type its URL below',
    found: (n, m) => `Found ${n} services, ${m} models`,
    scanning_txt: 'Scanning…', scanning_drop: 'Scanning local services…',
    no_models: 'No models — scan first or enter a key', no_match: 'No matches',
    enc_disp: 'Saved (encrypted)',
    hint_wrong: '← wrong key', hint_pend: '← pending', hint_need: '← key required',
    verifying: 'Verifying key…',
    key_ok: (n) => `Key valid — loaded ${n} models`,
    key_bad: (e) => `Wrong key: ${e}`, key_nomodels: 'Key accepted but no models returned',
    req_fail: (e) => `Request failed: ${e}`,
    testing: 'Testing…',
    conn_ok: 'Connected', sent: 'Sent: ', reply: 'Reply: ', empty_reply: '(empty reply)',
    conn_fail: (e) => `Connection failed: ${e}`,
    step_tg: 'Step 3 · Default skill locations',
    tg_desc2: 'Checked AI tools receive a copy of each newly installed skill. Save to apply.',
    step_save: 'Step 4 · Save', save_btn: 'Save settings',
    saved: (enc) => `Saved to config.yml${enc ? ' — key encrypted' : ''}`,
    save_fail: (e) => `Save failed: ${e}`,
    mk_h: 'Skill market', mk_desc: 'Search the skills.sh market, or paste owner/repo / local path.',
    mk_ph: 'keywords, or paste owner/repo / absolute path', mk_search: 'Search', mk_direct: 'Install input as ref/path', mk_install: 'Install',
    mk_busy: 'Working…', ins_done: 'Done', ins_fail: (c) => `Failed (exit ${c})`,
    mk_susp: 'Audit flagged this suspicious — install anyway?', mk_force: 'Install anyway', ext_force: 'Adopt anyway',
    mk_mng: 'Already managed with different content (older version?) — overwrite?', mk_ow: 'Overwrite',
    mk_nosrc: 'private source — N/A', mk_privsrc: 'private source',
    sk_remove: 'Remove', sk_remove_sure: 'Click again to confirm', sk_removed: 'Removed', open_dir: 'Open folder',
    det_btn: 'Details', det_files: (n) => `${n} files`, det_diff: 'Upstream diff', det_rollback: 'Rollback a version', det_tags: 'older versions→',
    det_old: 'Install older', det_old_ph: 'tag or sha, e.g. agent-skills-6ec…', det_noroll: 'no history to roll back (snapshots start after upgrade)',
    ext_h: (n) => `Unmanaged skills scattered in agent dirs (${n})`,
    ext_desc: 'No versioning, audit, or updates — adopt to fix that.',
    ext_adopt: 'Adopt', ext_busy: 'Adopting…',
    maint_h: 'Maintenance', upd_refresh: 'Refresh upstream info', upd_one: 'Upgrade', upd_all: 'Upgrade all',
    sync_btn: 'Check & repair projections', op_busy: 'Working…', op_done: 'Done',
    mg_h: 'Merge skills', mg_desc: 'Check two or more managed skills — rules get extracted, deduplicated and conflict-checked. Disagreements land in "Conflicts" for you to decide; the result is a new skill with no unresolved rules.',
    mg_pick: 'Skills to merge (≥2)', mg_name: 'New skill name (optional)', mg_go: 'Merge',
    mg_busy: 'Merging…', mg_few: 'Pick at least two',
    mg_state: (n, r) => `Current merged result: ${n} (${r} rules)`,
    mg_build: 'Build SKILL.md', mg_install: 'Install this merged skill', mg_to_conflicts: 'Pending conflicts → go to "Conflicts"',
    rv_reaudit: 'Re-audit',
  },
};
const t = (k, ...a) => { const v = (I18N[S?.lang] || I18N.zh)[k] ?? I18N.zh[k]; return typeof v === 'function' ? v(...a) : (v ?? k); };
// 已安装名字 → 上游页面：github 用 pin+rpath（命中后的真实目录）锁到具体版本；无 rpath 退 repo@pin 根；wellknown → skills.sh site 页
const skLink = (n, s) => {
  const src = s?.source || {}, q = '?src=awesome-skill-market';
  if (src.registry === 'github' && src.ref) {
    const u = src.pin ? `https://github.com/${src.ref}/tree/${src.pin}${src.rpath ? `/${src.rpath}` : ''}` : `https://github.com/${src.ref}`;
    return `<a class="pg" href="${u}${q}" target="_blank" rel="noopener">${esc(n)}</a>`;
  }
  if (src.registry === 'wellknown' && src.ref) return `<a class="pg" href="https://www.skills.sh/site/${src.ref}${q}" target="_blank" rel="noopener">${esc(n)}</a>`;
  return esc(n);
};

async function refresh() {
  try { S = await api('/state'); }
  catch (e) { document.getElementById('app').innerHTML = `<p class="pill bad">${t('err_conn', e.message)}</p>`; return; }
  if (S?.error) { document.getElementById('app').innerHTML = `<p class="pill bad">${t('err_token', S.error)}</p>`; return; }
  if (!location.hash && !S.initialized) { tab = 'setup'; location.hash = 'setup'; }   // 未初始化→设置页
  render();
}
const syncTabs = () => document.querySelectorAll('nav [data-t]').forEach((x) => x.classList.toggle('on', x.dataset.t === tab));
document.querySelectorAll('nav [data-t]').forEach((x) => x.onclick = () => { tab = x.dataset.t; location.hash = tab; syncTabs(); render(); });
const es = new EventSource(`/api/events?token=${T}`);
es.addEventListener('decide', () => refresh());
es.addEventListener('config', () => refresh());
es.addEventListener('targets', () => refresh());
es.addEventListener('library', () => refresh());
const live = document.getElementById('live');
es.onopen = () => { live.classList.remove('off'); live.innerHTML = `<span class="dot"></span>${t('live_on')}`; };
es.onerror = () => { live.classList.add('off'); live.innerHTML = `<span class="dot"></span>${t('live_off')}`; };

// 语言切换：header 下拉与设置页按钮共用——保存 ui.lang 即生效
const setLang = async (v) => {
  await api('/config', { method: 'POST', body: JSON.stringify({ ui: { lang: v } }) });
  if (S) S.lang = v;
  render();
};
document.getElementById('langsel').onchange = (e) => setLang(e.target.value);

// 机器状态 → 人话（按语言分表）
const PILLS = {
  zh: {
    installed: '已安装', available: '可用', likely: '疑似已装', absent: '未检测到',
    managed: '已纳入管理', external: '未管理', 'hub-untracked': '未登记',
    clean: '安全', suspicious: '可疑', malicious: '危险',
    pending: '待处理', decided: '已裁决', resolved: '已裁决', dismissed: '已忽略',
    outdated: '有更新', missing: '文件缺失', 'content-differs': '内容被改过', drifted: '有改动',
    'keep-a': '采用 A', 'keep-b': '采用 B', merge: '已合并', active: '生效中',
  },
  en: {
    installed: 'Installed', available: 'Available', likely: 'Probably installed', absent: 'Not found',
    managed: 'Managed', external: 'Unmanaged', 'hub-untracked': 'Untracked',
    clean: 'Clean', suspicious: 'Suspicious', malicious: 'Malicious',
    pending: 'Pending', decided: 'Decided', resolved: 'Decided', dismissed: 'Dismissed',
    outdated: 'Update', missing: 'Missing', 'content-differs': 'Modified', drifted: 'Drifted',
    'keep-a': 'Keep A', 'keep-b': 'Keep B', merge: 'Merged', active: 'Active',
  },
};
const CN = (v) => PILLS[S?.lang || 'zh']?.[v] ?? v;
const pill = (v) => {
  const cls = ['clean', 'installed', 'active', 'managed', 'keep-a', 'keep-b', 'decided', 'resolved', 'merge'].includes(v) ? 'ok'
    : ['malicious', 'pending', 'missing', 'outdated', 'content-differs'].includes(v) ? 'bad' : 'warn';
  return `<span class="pill ${cls}">${esc(CN(v))}</span>`;
};

// 顶栏/底栏等框架文案随语言刷新
const chrome = () => {
  document.title = t('title');
  document.documentElement.lang = S?.lang === 'en' ? 'en' : 'zh-CN';
  document.querySelector('header .tag').textContent = t('tag');
  document.querySelectorAll('nav [data-t]').forEach((x) => { x.textContent = t('nav_' + x.dataset.t); });
  const ls = document.getElementById('langsel');
  if (ls) ls.value = S?.lang || 'zh';
};

async function render() {
  const app = document.getElementById('app');
  chrome();
  document.getElementById('foot').textContent = t('foot_hub', S.hub);
  syncTabs();

  if (tab === 'skills') {
    const skills = Object.entries(S.library.skills || {});
    // 先取数据再拼整页——innerHTML 只能赋一次；分段 += 会重建 DOM 冲掉已绑事件
    const ext = await api('/scan');
    const up = S.upstream.skills || {};
    const outs = Object.entries(up).filter(([, u]) => u.outdated);
    app.innerHTML = `<h2>${t('sk_h', skills.length)}</h2>
      <p class="desc">${t('sk_desc')}</p>`
      + (skills.map(([n, s]) => `
      <div class="card"><div class="sk-head"><b>${skLink(n, s)}</b><span class="mut">${esc(s.version || '')}</span><span class="mut">${esc(s.source?.registry || '')}</span>${pill(s.audit || 'clean')}
      <span class="acts"><button class="sm" data-open="${esc(`${S.hub}/skills/${n}`)}">${t('open_dir')}</button><button data-dt="${esc(n)}">${t('det_btn')}</button><button data-rm="${esc(n)}">${t('sk_remove')}</button></span></div>
      <div class="trow">${(s.targets || []).map((x) => `<span class="tchip">${esc(x)}</span>`).join('') || `<span class="mut">${t('sk_hub')}</span>`}<button class="sm" data-tg="${esc(n)}">${t('sk_loc')}</button></div>
      <div class="tgbox" data-box="${esc(n)}" style="display:none;margin-top:10px"></div>
      <div class="dtbox" data-dbox="${esc(n)}" style="display:none;margin-top:10px"></div></div>`).join('')
      || `<div class="empty">${t('sk_empty')}</div>`)
      + `<h2>${t('agents_h')}</h2>
      <p class="desc">${t('agents_desc')}</p>`
      + (S.harnesses || []).map((h) => `<div class="card row"><b>${esc(h.id)}</b>${pill(h.state)}<span class="mut">${esc(h.primaryDir || h.dirs?.[0]?.path || '')}</span><button class="sm" data-open="${esc(h.primaryDir || h.dirs?.[0]?.path || '')}" style="margin-left:auto">${t('open_dir')}</button></div>`).join('')
      + `<h2>${t('maint_h')}</h2>
      <div class="card row"><button id="m-upd">${t('upd_refresh')}</button><button id="m-sync">${t('sync_btn')}</button>
      ${outs.length ? `<button id="m-upg" class="primary">${t('upd_all')}（${outs.length}）</button>` : ''}<span id="m-out" class="mut"></span></div>`
      + (outs.length ? outs.map(([n]) => `<div class="card row"><b>${esc(n)}</b>${pill('outdated')}<button class="upg" data-n="${esc(n)}" style="margin-left:auto">${t('upd_one')}</button><span class="uout mut"></span></div>`).join('') : '')
      + (ext?.length ? `<h2>${t('ext_h', ext.length)}</h2><p class="desc">${t('ext_desc')}</p>`
        + ext.map((e) => `<div class="card row"><b>${esc(e.name)}</b><span class="mut">${esc(e.where)} · ${esc(e.dir)}</span>
          <span style="margin-left:auto"></span><button class="sm" data-open="${esc(e.path || '')}">${t('open_dir')}</button><button class="adopt" data-d="${esc(e.path || '')}">${t('ext_adopt')}</button><span class="aout mut"></span></div>`).join('') : '');
    // 打开文件夹：调系统文件管理器
    app.querySelectorAll('[data-open]').forEach((b) => b.onclick = () =>
      api('/open', { method: 'POST', body: JSON.stringify({ path: b.dataset.open }) }));
    // 移除：两段式确认（第一下变确认文案，3 秒内再点才真删）
    app.querySelectorAll('[data-rm]').forEach((b) => {
      let armed = false, timer = null;
      b.onclick = async () => {
        if (!armed) { armed = true; b.textContent = t('sk_remove_sure'); b.classList.add('danger'); timer = setTimeout(() => { armed = false; b.textContent = t('sk_remove'); b.classList.remove('danger'); }, 3000); return; }
        clearTimeout(timer); b.disabled = true; b.classList.remove('danger'); b.textContent = t('op_busy');
        const r = await api('/remove', { method: 'POST', body: JSON.stringify({ name: b.dataset.rm }) });
        b.textContent = r.code === 0 ? t('sk_removed') : t('ins_fail', r.code);
        if (r.code === 0) refresh();
      };
    });
    // 详情：文件清单 + 上游 diff + 回滚
    app.querySelectorAll('[data-dt]').forEach((b) => b.onclick = async () => {
      const box = app.querySelector(`[data-dbox="${b.dataset.dt}"]`);
      if (box.style.display === 'block') { box.style.display = 'none'; return; }
      const s = S.library.skills[b.dataset.dt];
      const d = await api(`/skill?name=${encodeURIComponent(b.dataset.dt)}`);
      const src = s?.source || {};
      const gh = src.registry === 'github' && src.ref;
      const page = gh ? `https://github.com/${src.ref}` : src.ref ? `https://www.skills.sh/site/${src.ref}` : '';
      const srcHtml = page ? `<a href="${page}?src=awesome-skill-market" target="_blank" rel="noopener">${esc(src.registry)} ${esc(src.ref)}</a>` : `${esc(src.registry || '')} ${esc(src.ref || '')}`;
      const tagsHtml = gh ? ` · <a href="https://github.com/${src.ref}/tags?src=awesome-skill-market" target="_blank" rel="noopener">${t('det_tags')}</a>` : '';
      box.style.display = 'block';
      box.innerHTML = `<p class="mut" style="margin:4px 0">${esc(d.description || '')} · ${t('det_files', d.fileCount ?? d.files?.length ?? 0)} · ${srcHtml}${src.pin ? ` · pin <code>${esc(String(src.pin).slice(0, 7))}</code>` : ''}${tagsHtml}</p>
        <div class="row">${s?.source?.registry === 'github' ? `<button class="df">${t('det_diff')}</button>` : ''}${S.hist?.[b.dataset.dt] ? `<button class="rb">${t('det_rollback')}</button>` : `<span class="mut">${t('det_noroll')}</span>`}<span class="out mut"></span></div>
        ${gh ? `<div class="row" style="margin-top:8px"><span class="mut">${t('det_old')}</span><input class="ot" placeholder="${t('det_old_ph')}" style="width:240px"><button class="od sm">${t('det_diff')}</button><button class="oi sm">${t('mk_install')}</button><span class="out2 mut"></span></div>` : ''}
        <pre class="pre mut" style="display:none;white-space:pre-wrap;font-size:13.5px;max-height:260px;overflow:auto"></pre>`;
      // 装旧版：tag/sha → install owner/repo@tag --path <sub>；已在管理→覆盖安装两段确认
      let oForce = false, oPerm = false;
      box.querySelector('.oi')?.addEventListener('click', async (e) => {
        const tag = box.querySelector('.ot').value.trim();
        if (!tag) return;
        e.target.disabled = true; e.target.textContent = t('op_busy');
        const r = await api('/install', { method: 'POST', body: JSON.stringify({ ref: `${src.ref}@${tag}`, path: src.path || undefined, permissive: oPerm, force: oForce }) });
        e.target.disabled = false;
        if (r.code === 0) { box.querySelector('.out2').textContent = t('ins_done'); e.target.textContent = t('mk_install'); refresh(); return; }
        if (isManaged(r.out) && !oForce) { oForce = true; e.target.textContent = t('mk_ow'); box.querySelector('.out2').textContent = t('mk_mng'); return; }
        if (isSuspicious(r.out) && !oPerm) { oPerm = true; e.target.textContent = t('mk_force'); box.querySelector('.out2').textContent = t('mk_susp'); return; }
        e.target.textContent = t('mk_install');
        box.querySelector('.out2').textContent = (r.out || '').split('\n').filter((l) => l.trim()).pop()?.slice(0, 120) || t('ins_fail', r.code);
      });
      // 旧版预览 diff：同一个输入框的 tag → 比本地 vs 那个版本
      box.querySelector('.od')?.addEventListener('click', async (e) => {
        const tag = box.querySelector('.ot').value.trim();
        if (!tag) return;
        e.target.disabled = true; e.target.textContent = t('op_busy');
        const r = await api(`/diff?name=${encodeURIComponent(b.dataset.dt)}&ref=${encodeURIComponent(tag)}`);
        const pre = box.querySelector('.pre'); pre.style.display = 'block'; pre.textContent = r.out || '(no output)';
        e.target.disabled = false; e.target.textContent = t('det_diff');
      });
      box.querySelector('.df')?.addEventListener('click', async (e) => {
        e.target.disabled = true; e.target.textContent = t('op_busy');
        const r = await api(`/diff?name=${encodeURIComponent(b.dataset.dt)}`);
        const pre = box.querySelector('.pre'); pre.style.display = 'block'; pre.textContent = r.out || '(no output)';
        e.target.disabled = false; e.target.textContent = t('det_diff');
      });
      box.querySelector('.rb')?.addEventListener('click', async (e) => {
        e.target.disabled = true; e.target.textContent = t('op_busy');
        const r = await api('/rollback', { method: 'POST', body: JSON.stringify({ name: b.dataset.dt }) });
        box.querySelector('.out').textContent = r.code === 0 ? t('op_done') : (r.out || '').slice(0, 120);
        e.target.disabled = false; e.target.textContent = t('det_rollback');
        if (r.code === 0) refresh();
      });
    });
    app.querySelectorAll('[data-tg]').forEach((b) => b.onclick = () => {
      const box = app.querySelector(`[data-box="${b.dataset.tg}"]`);
      if (box.style.display === 'block') { box.style.display = 'none'; return; }
      const s = S.library.skills[b.dataset.tg];
      box.style.display = 'block';
      box.innerHTML = `<label class="field">${t('tg_label')}</label><div class="field" style="font-size:13.5px">${t('tg_warn')}</div>` +
        `<table class="tgtable">` + (S.harnesses || []).filter((x) => x.state !== 'absent' && !x.detectOnly).map((x) => {
          const has = (s.targets || []).includes(x.id);
          const dir = x.primaryDir || x.dirs?.[0]?.path || '';   // scanner 给的是 dirs[]，primaryDir 可能为空
          const p = dir ? (has ? `${dir}/${b.dataset.tg}` : dir) : '';
          return `<tr><td><input type="checkbox" id="th-${esc(b.dataset.tg)}-${esc(x.id)}" data-th="${esc(x.id)}" ${has ? 'checked' : ''}></td>` +
          `<td><label for="th-${esc(b.dataset.tg)}-${esc(x.id)}">${esc(x.id)}</label></td><td>${pill(x.state)}</td><td class="dir">${esc(dir)}</td>` +
          `<td>${p ? `<button class="sm" data-open="${esc(p)}">${t('open_dir')}</button>` : ''}</td></tr>`;
        }).join('')
        + `</table><div class="row end" style="margin-top:10px"><span class="tout mut"></span><button class="primary tgo">${t('tg_save')}</button></div>`;
      box.querySelectorAll('[data-open]').forEach((o) => o.onclick = () =>
        api('/open', { method: 'POST', body: JSON.stringify({ path: o.dataset.open }) }));
      box.querySelector('.tgo').onclick = async () => {
        const ts = [...box.querySelectorAll('[data-th]:checked')].map((x) => x.dataset.th);
        const r = await api('/targets', { method: 'POST', body: JSON.stringify({ name: b.dataset.tg, targets: ts }) });
        box.querySelector('.tout').textContent = r.ok ? t('tg_saved') : t('tg_fail', r.error);
        refresh();
      };
    });
    const runOp = async (btn, path, body) => {
      btn.disabled = true; const old = btn.textContent; btn.textContent = t('op_busy');
      const r = await api(path, { method: 'POST', body: JSON.stringify(body || {}) });
      btn.disabled = false; btn.textContent = old;
      return r;
    };
    app.querySelector('#m-upd').onclick = async (e) => { const r = await runOp(e.target, '/update'); app.querySelector('#m-out').textContent = (r.out || '').split('\n').pop().slice(0, 100); refresh(); };
    app.querySelector('#m-sync').onclick = async (e) => { const r = await runOp(e.target, '/sync'); app.querySelector('#m-out').textContent = (r.out || '').split('\n').pop().slice(0, 100); };
    app.querySelector('#m-upg')?.addEventListener('click', async (e) => { await runOp(e.target, '/upgrade'); refresh(); });
    app.querySelectorAll('.upg').forEach((b) => b.onclick = async () => {
      const r = await runOp(e.target, '/upgrade', { name: b.dataset.n });
      const o = b.parentElement.querySelector('.uout'); if (o) o.textContent = r.code === 0 ? t('op_done') : (r.out || '').slice(0, 100);
      if (r.code === 0) refresh();
    });
    // 收编：可疑→"仍要收编"知情确认
    app.querySelectorAll('.adopt').forEach((b) => b.onclick = async () => {
      b.disabled = true; b.textContent = t('op_busy');
      const permissive = b.dataset.perm === '1';
      const r = await api('/install', { method: 'POST', body: JSON.stringify({ ref: b.dataset.d, permissive }) });
      const o = b.parentElement.querySelector('.aout');
      if (r.code === 0) { if (o) o.textContent = t('op_done'); refresh(); return; }
      b.disabled = false;
      if (isSuspicious(r.out) && !permissive) {
        b.dataset.perm = '1'; b.textContent = t('ext_force');
        if (o) o.textContent = t('mk_susp');
      } else {
        b.textContent = t('ext_adopt');
        if (o) o.textContent = (r.out || '').split('\n').filter((l) => l.trim()).pop()?.slice(0, 100);
      }
    });
  }

  if (tab === 'market') {
    // 搜索状态挂模块级——SSE/手动 refresh 重渲染后不丢结果
    app.innerHTML = `<h2>${t('mk_h')}</h2><p class="desc">${t('mk_desc')}</p>
      <div class="card"><div class="frow"><input type="text" id="mk-q" placeholder="${t('mk_ph')}" value="${esc(mkState.q)}" style="flex:1">
        <button class="primary" id="mk-go">${t('mk_search')}</button><button id="mk-dir">${t('mk_direct')}</button></div>
        <div id="mk-out" class="fsub"><span id="mk-out-txt">${esc(mkState.directOut)}</span>
        ${mkState.directPerm ? `<button id="mk-force">${t('mk_force')}</button>` : ''}${mkState.directForce ? `<button id="mk-ow">${t('mk_ow')}</button>` : ''}</div></div>
      <div id="mk-res"></div>`;
    const q = app.querySelector('#mk-q');
    const res = app.querySelector('#mk-res');
    // 可疑审核的知情确认：失败后按钮变"仍要安装"，再点带 permissive 重试
    const tryInstall = async (btn, ref, path, slug, outEl) => {
      btn.disabled = true; const old = btn.textContent; btn.textContent = t('mk_busy');
      const r = await api('/install', { method: 'POST', body: JSON.stringify({ ref, path, permissive: mkState.perm.has(slug), force: mkState.force.has(slug) }) });
      if (r.code === 0) {
        mkState.installed.add(slug); mkState.status[slug] = '';
        btn.textContent = t('ins_done'); return;
      }
      btn.disabled = false;
      if (isSuspicious(r.out) && !mkState.perm.has(slug)) {
        mkState.perm.add(slug);
        btn.textContent = t('mk_force');
        mkState.status[slug] = t('mk_susp');
      } else if (isManaged(r.out) && !mkState.force.has(slug)) {
        mkState.force.add(slug);
        btn.textContent = t('mk_ow');
        mkState.status[slug] = t('mk_mng');
      } else {
        btn.textContent = old;
        mkState.status[slug] = (r.out || '').split('\n').filter((l) => l.trim()).pop()?.slice(0, 120) || t('ins_fail', r.code);
      }
      outEl.textContent = mkState.status[slug];
    };
    const renderResults = () => {
      res.innerHTML = (mkState.results || []).map((s) => {
        // github 源（source 含 /）用 owner/repo+path；私有源（uizze.sh 等）直接以 slug 走 wellknown 适配器
        const src = s.source || '', repo = src.includes('/') ? src : null;
        const ref = repo || s.slug, sub = repo && s.slug.startsWith(src + '/') ? s.slug.slice(src.length + 1) : '';
        const done = mkState.installed.has(s.slug), perm = mkState.perm.has(s.slug), frc = mkState.force.has(s.slug);
        const label = done ? t('ins_done') : frc ? t('mk_ow') : perm ? t('mk_force') : t('mk_install');
        // GitHub 源先链 repo 根（保底可开）；desc 接口返回命中路径后再升级成精确子目录链接
        const page = `${repo ? `https://github.com/${src}` : `https://www.skills.sh/site/${s.slug}`}?src=awesome-skill-market`;
        return `<div class="card"><div class="row"><b><a class="pg" href="${page}" target="_blank" rel="noopener">${esc(s.name)}</a></b><span class="mut">${esc(s.slug)} · ${s.installs} installs${repo ? '' : ` · ${t('mk_privsrc')}`}</span>
          <button class="mk-i" style="margin-left:auto" data-s="${esc(s.slug)}" data-r="${esc(ref)}" data-p="${esc(sub)}" ${done ? 'disabled' : ''}>${label}</button>
          <span class="iout mut">${esc(mkState.status[s.slug] || '')}</span></div>
          <div class="dsc mut" data-slug="${esc(s.slug)}"></div></div>`;
      }).join('') || (mkState.results ? `<div class="empty">${t('cf_empty')}</div>` : '');
      res.querySelectorAll('.mk-i').forEach((b) => b.onclick = () =>
        tryInstall(b, b.dataset.r, b.dataset.p, b.dataset.s, b.parentElement.querySelector('.iout')));
      // 简介懒加载：API 索引不带 description，逐条从 SKILL.md frontmatter 补（服务端缓存）
      // 返回的命中路径顺带把名字链接从 repo 根升级成 skill 子目录页
      res.querySelectorAll('.dsc').forEach(async (d) => {
        const r = await api(`/desc?slug=${encodeURIComponent(d.dataset.slug)}`);
        if (r.desc) d.textContent = r.desc;
        if (r.rel !== undefined && r.rel !== null && r.branch) {
          const a = d.closest('.card').querySelector('.pg');
          if (a?.href.includes('github.com/')) {
            const m = a.href.match(/github\.com\/([^/]+\/[^/]+)/);
            if (m) a.href = `https://github.com/${m[1]}/tree/${r.branch}/${r.rel}?src=awesome-skill-market`;
          }
        }
      });
    };
    renderResults();
    app.querySelector('#mk-go').onclick = async () => {
      mkState.q = q.value.trim();
      res.innerHTML = `<p class="mut">${t('mk_busy')}</p>`;
      const r = await api(`/search?q=${encodeURIComponent(mkState.q)}`);
      mkState.results = r.skills ? r.skills.slice(0, 15) : null;
      renderResults();
    };
    const directInstall = async (permissive, force) => {
      const v = q.value.trim(); if (!v) return;
      const btn = app.querySelector('#mk-dir');
      btn.disabled = true; const old = btn.textContent; btn.textContent = t('mk_busy');
      const r = await api('/install', { method: 'POST', body: JSON.stringify({ ref: v, permissive, force }) });
      btn.disabled = false; btn.textContent = old;
      if (r.code === 0) { mkState.directOut = t('ins_done'); mkState.directPerm = false; mkState.directForce = false; }
      else if (isSuspicious(r.out) && !permissive) { mkState.directOut = t('mk_susp'); mkState.directPerm = true; }
      else if (isManaged(r.out) && !force) { mkState.directOut = t('mk_mng'); mkState.directForce = true; }
      else { mkState.directOut = (r.out || '').split('\n').filter((l) => l.trim()).pop()?.slice(0, 120) || t('ins_fail', r.code); }
      app.querySelector('#mk-out-txt').textContent = mkState.directOut;
      if (mkState.directPerm && !app.querySelector('#mk-force')) {
        const f = el(`<button id="mk-force">${t('mk_force')}</button>`);
        f.onclick = () => { mkState.directPerm = false; directInstall(true, mkState.directForce); };
        app.querySelector('#mk-out').appendChild(f);
      }
      if (mkState.directForce && !app.querySelector('#mk-ow')) {
        const f = el(`<button id="mk-ow">${t('mk_ow')}</button>`);
        f.onclick = () => { mkState.directForce = false; directInstall(mkState.directPerm, true); };
        app.querySelector('#mk-out').appendChild(f);
      }
    };
    app.querySelector('#mk-dir').onclick = () => directInstall(mkState.directPerm, mkState.directForce);
    app.querySelector('#mk-force')?.addEventListener('click', () => { mkState.directPerm = false; directInstall(true, mkState.directForce); });
    app.querySelector('#mk-ow')?.addEventListener('click', () => { mkState.directForce = false; directInstall(mkState.directPerm, true); });
    q.addEventListener('input', () => { mkState.q = q.value; });
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') app.querySelector('#mk-go').click(); });
  }

  if (tab === 'merge') {
    const skills = Object.keys(S.library.skills || {});
    const mg = S.merged;
    const pendN = (S.conflicts || []).filter((c) => c.status === 'pending').length;
    app.innerHTML = `<h2>${t('mg_h')}</h2><p class="desc">${t('mg_desc')}</p>
      <div class="card"><h3>${t('mg_pick')}</h3>`
      + (skills.map((n) => `<label class="check"><input type="checkbox" data-mg="${esc(n)}"> ${esc(n)}</label>`).join('')
        || `<div class="empty">${t('sk_empty')}</div>`)
      + `<div class="frow"><input type="text" id="mg-name" placeholder="${t('mg_name')}" style="flex:1">
        <button class="primary" id="mg-go">${t('mg_go')}</button><span id="mg-out" class="mut">${esc(mgOut)}</span></div></div>`
      + (mg ? `<div class="card"><div class="row"><b>${t('mg_state', esc(mg.name), mg.rules)}</b>
        <button id="mg-build" ${mg.built ? 'disabled' : ''}>${t('mg_build')}</button>
        ${mg.built ? `<button class="primary" id="mg-inst">${t('mg_install')}</button>` : ''}
        <span id="mg-sout" class="mut"></span></div></div>` : '')
      + (pendN ? `<div class="card row"><span class="pill warn">${pendN} pending</span><button onclick="location.hash='conflicts'">${t('mg_to_conflicts')}</button></div>` : '');
    app.querySelector('#mg-go').onclick = async (e) => {
      const names = [...app.querySelectorAll('[data-mg]:checked')].map((x) => x.dataset.mg);
      if (names.length < 2) { app.querySelector('#mg-out').textContent = t('mg_few'); return; }
      e.target.disabled = true; e.target.textContent = t('mg_busy');
      const r = await api('/merge', { method: 'POST', body: JSON.stringify({ names, name: app.querySelector('#mg-name').value.trim() || undefined }) });
      mgOut = (r.out || '').split('\n').pop().slice(0, 140);
      app.querySelector('#mg-out').textContent = mgOut;
      e.target.disabled = false; e.target.textContent = t('mg_go');
      refresh();
    };
    app.querySelector('#mg-build')?.addEventListener('click', async (e) => {
      e.target.disabled = true; e.target.textContent = t('op_busy');
      const r = await api('/build', { method: 'POST', body: '{}' });
      app.querySelector('#mg-sout').textContent = (r.out || '').split('\n').pop().slice(0, 120);
      refresh();
    });
    app.querySelector('#mg-inst')?.addEventListener('click', async (e) => {
      e.target.disabled = true; e.target.textContent = t('op_busy');
      const r = await api('/install', { method: 'POST', body: JSON.stringify({ ref: `${S.hub}/merged/skill-out` }) });
      app.querySelector('#mg-sout').textContent = r.code === 0 ? t('ins_done') : (r.out || '').split('\n').pop().slice(0, 120);
      refresh();
    });
  }

  if (tab === 'conflicts') {
    const cs = S.conflicts || [];
    const pendN = cs.filter((c) => c.status === 'pending').length;
    app.innerHTML = `<h2>${t('cf_h', pendN)}</h2>
      <p class="desc">${t('cf_desc')}</p>`;
    for (const c of cs) {
      const card = el(`<div class="card"><div class="row"><b>${esc(c.id)}</b>${pill(c.status)}<span class="mut">${esc(c.domain || '')}</span></div>
        <div class="side a"><span class="who">${t('side', 'A', esc(c.sides[0].source))}</span>${esc(c.sides[0].text)}</div>
        <div class="side b"><span class="who">${t('side', 'B', esc(c.sides[1].source))}</span>${esc(c.sides[1].text)}</div>
        ${c.ai_explanation ? `<p class="mut">${t('ai_note', esc(c.ai_explanation))}</p>` : ''}
        ${c.dismiss_reason ? `<p class="mut">${t('fp_note', esc(c.dismiss_reason))}</p>` : ''}
        <div class="ev-imgs"></div>
        ${c.status === 'pending' ? `
          <label class="field">${t('reason_l')}</label>
          <input type="text" class="reason" placeholder="${t('reason_ph')}">
          <div class="row" style="margin-top:12px">
          <button data-r="keep-a">${t('keep_a')}</button><button data-r="keep-b">${t('keep_b')}</button>
          <button data-r="merge">${t('merge_btn')}</button><button data-r="dismissed">${t('dismiss_btn')}</button><span class="err mut"></span></div>
          <div class="editbox" style="display:none;margin-top:12px">
            <label class="field">${t('mtext_l')}</label><textarea class="mtext"></textarea>
            <div class="row" style="margin-top:10px"><button class="primary go">${t('submit_merge')}</button><button class="cancel">${t('cancel')}</button></div></div>` : ''}</div>`);
      if (c.evidence_files) card.querySelector('.ev-imgs').innerHTML = c.evidence_files.filter((f) => f.endsWith('.png')).map((f) => `<img class="ev" src="/evidence/${c.id}/${f}?token=${T}" alt="evidence ${esc(f)}">`).join('');
      const post = async (resolution, custom) => {
        const reason = card.querySelector('.reason')?.value || '';
        if (!reason.trim()) { card.querySelector('.err').textContent = t('need_reason'); card.querySelector('.reason')?.focus(); return; }
        const r = await api('/decide', { method: 'POST', body: JSON.stringify({ id: c.id, resolution, custom, reason }) });
        if (r?.error) { card.querySelector('.err').textContent = r.error; return; }
        refresh();
      };
      card.querySelectorAll('button[data-r]').forEach((b) => b.onclick = async () => {
        if (b.dataset.r === 'merge') {
          const box = card.querySelector('.editbox');
          box.style.display = 'block';
          box.querySelector('.mtext').value = `${c.sides[0].text}\n${c.sides[1].text}`;
          box.querySelector('.mtext').focus();
          return;
        }
        post(b.dataset.r, null);
      });
      card.querySelector('.editbox .go')?.addEventListener('click', () => post('merge', card.querySelector('.mtext').value.trim()));
      card.querySelector('.editbox .cancel')?.addEventListener('click', () => { card.querySelector('.editbox').style.display = 'none'; });
      app.appendChild(card);
    }
    if (!cs.length) app.innerHTML += `<div class="empty">${t('cf_empty')}</div>`;
  }

  if (tab === 'review') {
    const scans = S.scans || [];
    app.innerHTML = `<h2>${t('rv_h', scans.length)}</h2>
      <p class="desc">${t('rv_desc')}</p>`
      + (scans.map((s) => `<div class="card row"><b>${esc(s.skill || s.name || '')}</b>${pill(s.verdict)}<span class="mut">${t('findings', (s.findings || []).length)}${s.llm ? t('ai_rec', esc(CN(s.llm.verdict))) : ''}</span>
        <button class="ra" data-n="${esc(s.skill || s.name || '')}" style="margin-left:auto">${t('rv_reaudit')}</button><span class="raout mut"></span></div>`).join('')
        || `<div class="empty">${t('rv_empty')}</div>`);
    const decs = (S.decisions || []).filter((d) => d.status === 'active');
    if (decs.length) app.innerHTML += `<h2>${t('dec_h', decs.length)}</h2>
      <p class="desc">${t('dec_desc')}</p>`
      + decs.map((d) => `<div class="card"><div class="row"><b>${esc(d.id)}</b>${pill(d.resolution)}<span class="mut">via ${esc(d.decided_by)}</span></div><p class="mut">${esc(d.reason)}</p></div>`).join('');
    app.querySelectorAll('.ra').forEach((b) => b.onclick = async () => {
      b.disabled = true; const old = b.textContent; b.textContent = t('op_busy');
      const r = await api('/audit', { method: 'POST', body: JSON.stringify({ name: b.dataset.n }) });
      b.disabled = false; b.textContent = old;
      b.parentElement.querySelector('.raout').textContent = (r.out || '').split('\n').pop().slice(0, 80);
      if (r.code === 0) refresh();
    });
  }

  if (tab === 'setup') {
    const h = S.harnesses || [];
    const cfg = await api('/config');
    const installed = h.filter((x) => x.state === 'installed' && !x.detectOnly).map((x) => x.id);
    const sel = new Set(cfg.default_targets?.length ? cfg.default_targets : installed);
    const curLang = S.lang || 'zh';
    app.innerHTML = `<h2>${t('set_h')}</h2>
      <p class="desc">${t('set_desc')}</p>
      <div class="card"><h3>${t('step_lang')}</h3>
        <p class="mut">${t('lang_desc')}</p>
        <div class="seg"><button data-l="zh" class="${curLang === 'zh' ? 'on' : ''}">中文</button><button data-l="en" class="${curLang === 'en' ? 'on' : ''}">English</button></div></div>
      <div class="card"><h3>${t('step_llm')}</h3>
        <p class="mut">${t('probe_hint', cfg.llm?.model)}</p>
        <div class="row"><button id="probe">${t('probe_btn')}</button><span id="probe-out" class="mut"></span></div>
        <div id="eps"></div>
        <div class="frow"><span class="lab" style="width:96px">${t('l_url')}</span><input type="text" id="murl" autocomplete="off" placeholder="http://localhost:1234/v1" value="${esc(cfg.llm?.base_url || '')}"></div>
        <div class="frow" id="key-row" style="display:none"><span class="lab" style="width:96px">${t('l_key')}</span><input type="password" id="mkey" autocomplete="new-password" autocorrect="off" autocapitalize="off" spellcheck="false" data-1p-ignore data-lpignore="true" data-form-type="other" value="${esc(cfg.llm?.api_key?.startsWith('enc:') ? t('enc_disp') : (cfg.llm?.api_key || ''))}"><span class="fhint" id="key-hint"></span>
          <div class="fsub">${t('key_sub')}</div></div>
        <div class="frow" id="model-box"><span class="lab" style="width:96px">${t('l_model')}</span>
          <div class="combo"><input type="text" id="mmodel" autocomplete="off" placeholder="${t('model_ph')}" value="${esc(cfg.llm?.model || '')}">
          <div class="combo-list" id="model-drop" style="display:none"></div></div>
          <button id="smoke">${t('smoke_btn')}</button>
          <div id="smoke-out" class="fsub"></div></div></div>
      <div class="card"><h3>${t('step_tg')}</h3>
        <p class="mut">${t('tg_desc2')}</p>
        ${h.map((x) => `<label class="check"><input type="checkbox" data-h="${esc(x.id)}" ${sel.has(x.id) ? 'checked' : ''} ${x.state === 'absent' ? 'disabled' : ''}> ${esc(x.id)} ${pill(x.state)} <span class="mut">${esc(x.primaryDir || '')}</span></label>`).join('')}</div>
      <div class="card"><div class="row" style="justify-content:space-between;align-items:center"><h3 style="margin:0">${t('step_save')}</h3>
        <div class="row" style="gap:12px"><span id="save-out" class="mut"></span><button class="primary" id="save">${t('save_btn')}</button></div></div></div>`;
    app.querySelectorAll('[data-l]').forEach((b) => b.onclick = () => setLang(b.dataset.l));
    const modelMap = new Map();   // model → base_url（选中模型自动回填地址）
    const loadedModels = new Map(); // 密钥端点拉到的模型——重扫后保留
    let epsList = [], lastScan = 0, scanning = false;
    // localhost / 127.0.0.1 / ::1 视为同一台——配置和扫描报的写法可能不同
    const LOOP = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
    const sameBase = (a, b) => {
      try { const x = new URL(a), y = new URL(b); return x.protocol === y.protocol && x.port === y.port && (x.hostname === y.hostname || (LOOP.has(x.hostname) && LOOP.has(y.hostname))); }
      catch { return a === b; }
    };
    // 模型下拉按当前服务地址过滤：地址匹配已扫描端点→只给它的模型；不匹配→给全部
    let curOpts = [];
    const refreshOpts = () => {
      const cur = app.querySelector('#murl').value.trim().replace(/\/+$/, '');
      const known = epsList.some((e) => sameBase(e.base_url, cur));
      curOpts = [...modelMap.keys()].filter((m) => !known || sameBase(modelMap.get(m), cur));
      renderDrop();   // 数组变了 DOM 也要重建——verifyKey 等只调 refreshOpts 的路径才不会漏渲染
      return curOpts.length;
    };
    // 自绘搜索下拉（Safari 不支持 <datalist>，会把 option 当文本渲染盖住布局）
    let modelDirty = false;   // 只有用户敲过字才按输入过滤；点开展示全部（预填的模型名不当过滤条件）
    const renderDrop = () => {
      const q = modelDirty ? app.querySelector('#mmodel').value.trim().toLowerCase() : '';
      const list = curOpts.filter((m) => m.toLowerCase().includes(q)).slice(0, 60);
      const drop = app.querySelector('#model-drop');
      drop.innerHTML = list.map((m) => `<div class="opt" data-m="${esc(m)}">${esc(m)}</div>`).join('')
        || `<div class="none">${curOpts.length ? t('no_match') : (scanning ? t('scanning_drop') : t('no_models'))}</div>`;
      drop.querySelectorAll('.opt').forEach((o) => o.onmousedown = (e) => {   // mousedown 先于 blur
        e.preventDefault();
        modelDirty = false;
        app.querySelector('#mmodel').value = o.dataset.m;
        const b = modelMap.get(o.dataset.m);
        if (b) { app.querySelector('#murl').value = b; refreshOpts(); }
        drop.style.display = 'none';
      });
    };
    if (cfg.llm?.model) { modelMap.set(cfg.llm.model, cfg.llm?.base_url || ''); refreshOpts(); }   // 初始：当前模型先入下拉
    // 静默探测：只把模型喂进下拉，绝不渲染服务列表——点模型框触发的也走这条
    const fetchEps = async () => {
      lastScan = Date.now();
      scanning = true; refreshOpts();
      const eps = await api('/probe');
      scanning = false;
      epsList = eps;
      modelMap.clear();
      for (const e of eps) for (const m of e.models) if (!modelMap.has(m)) modelMap.set(m, e.base_url);
      for (const [m, b] of loadedModels) modelMap.set(m, b);
      if (cfg.llm?.model) modelMap.set(cfg.llm.model, cfg.llm?.base_url || '');   // 当前模型始终留在下拉里
      const curEp = eps.find((e) => sameBase(e.base_url, app.querySelector('#murl').value.trim().replace(/\/+$/, '')));
      if (curEp?.needs_key && realKey()) verifyKey();   // 配置的端点要密钥→自动用已存密钥拉模型回来
      refreshOpts();
      return eps;
    };
    // 只有用户点「扫描」按钮才展示服务列表和统计
    const doScan = async () => {
      app.querySelector('#probe-out').textContent = t('scanning_txt');
      const eps = await fetchEps();
      app.querySelector('#eps').innerHTML = eps.map((e) => e.needs_key
        ? `<div class="ep" data-b="${esc(e.base_url)}">${esc(e.name)}:${e.port} — <span class="mut">${t('ep_key')}</span></div>`
        : `<div class="ep" data-b="${esc(e.base_url)}">${esc(e.name)}:${e.port} — ${t('ep_n', e.models.length)}</div>`).join('')
        || `<p class="mut" style="margin-top:8px">${t('eps_empty')}</p>`;
      app.querySelector('#probe-out').textContent = t('found', eps.length, modelMap.size);
      app.querySelectorAll('#eps [data-b]').forEach((d) => d.onclick = () => {
        app.querySelectorAll('#eps .ep').forEach((x) => x.classList.remove('sel'));
        d.classList.add('sel');
        app.querySelector('#murl').value = d.dataset.b;
        const ep = epsList.find((e) => sameBase(e.base_url, d.dataset.b));
        if (ep?.needs_key && realKey()) verifyKey();
        else markKeyNeed(ep?.needs_key);
        refreshOpts();
      });
    };
    app.querySelector('#probe').onclick = () => doScan();
    app.querySelector('#mmodel').addEventListener('input', (e) => {
      const b = modelMap.get(e.target.value);
      if (b) { app.querySelector('#murl').value = b; refreshOpts(); }
    });
    // 填完服务地址自动检测是否需要密钥：已知端点直接看 needs_key，手输地址真发 /models 探
    let keyOk = !!app.querySelector('#mkey').value.trim();   // 已保存的密钥视为已验证；改动地址/密钥后回到未验证
    let keyFailed = false;                                                 // 验证真失败过→显示「密钥错误」而非「未验证」
    const markKeyNeed = (need) => {
      const has = !!app.querySelector('#mkey').value.trim();
      const hasUrl = !!app.querySelector('#murl').value.trim();
      const want = !!need && !keyOk;                                        // 要密钥且尚未验证通过
      app.querySelector('#key-row').style.display = (need || has) ? '' : 'none';
      app.querySelector('#mkey').classList.toggle('req', want);
      app.querySelector('#key-hint').textContent = want
        ? (keyFailed ? t('hint_wrong') : (has ? t('hint_pend') : t('hint_need'))) : '';
      app.querySelector('#model-box').style.display = (hasUrl && !want) ? '' : 'none';  // 验证通过才出现
    };
    // 拿密钥真发 /models——通过才收录模型并放出模型框；失败保持隐藏
    const verifyKey = async () => {
      const cur = app.querySelector('#murl').value.trim().replace(/\/+$/, '');
      const key = realKey();
      if (!key) return;
      const out = app.querySelector('#smoke-out');
      out.textContent = t('verifying');
      let r;
      try { r = await api('/models', { method: 'POST', body: JSON.stringify({ base_url: cur, api_key: key }) }); }
      catch (e) { out.textContent = t('req_fail', e.message); return; }
      if (r.models?.length) {
        keyOk = true; keyFailed = false;
        for (const m of r.models) { modelMap.set(m, cur); loadedModels.set(m, cur); }
        const ep = epsList.find((e) => sameBase(e.base_url, cur));
        if (ep) { ep.needs_key = false; ep.models = r.models; }
        markKeyNeed(true); refreshOpts();
        out.textContent = t('key_ok', r.models.length);
      } else {
        keyOk = false; keyFailed = true; markKeyNeed(true);                 // 模型框保持隐藏
        out.textContent = r.error ? t('key_bad', r.error) : t('key_nomodels');
      }
    };
    markKeyNeed(false);                                                    // 初始：无密钥需求→藏密钥行
    app.querySelector('#murl').addEventListener('input', () => {
      keyOk = false; keyFailed = false;
      const cur = app.querySelector('#murl').value.trim().replace(/\/+$/, '');
      markKeyNeed(epsList.find((e) => sameBase(e.base_url, cur))?.needs_key);
      refreshOpts(); renderDrop();
    });
    app.querySelector('#mmodel').addEventListener('input', () => { modelDirty = true; renderDrop(); app.querySelector('#model-drop').style.display = 'block'; });
    app.querySelector('#mmodel').addEventListener('blur', () => setTimeout(() => { app.querySelector('#model-drop').style.display = 'none'; modelDirty = false; }, 120));
    // 已存的 enc: 密钥显示为占位态：点击清空可输新密钥，留空失焦还原（不误删）
    const ENC_DISP = t('enc_disp');
    const mk = app.querySelector('#mkey');
    const realKey = () => { const v = mk.value.trim(); return v === ENC_DISP ? (cfg.llm?.api_key || '') : v; };  // 占位态→回传原始 enc: 值（服务端可解）
    mk.addEventListener('focus', () => { if (mk.value === ENC_DISP) mk.value = ''; });
    mk.addEventListener('blur', () => { if (!mk.value.trim() && cfg.llm?.api_key?.startsWith('enc:')) mk.value = ENC_DISP; });
    app.querySelector('#mkey').addEventListener('input', () => {
      keyOk = false; keyFailed = false;                                    // 密钥改动→回到未验证态，模型框收起
      const cur = app.querySelector('#murl').value.trim().replace(/\/+$/, '');
      markKeyNeed(epsList.find((e) => sameBase(e.base_url, cur))?.needs_key);
    });
    app.querySelector('#murl').addEventListener('change', async () => {
      const cur = app.querySelector('#murl').value.trim().replace(/\/+$/, '');
      const ep = epsList.find((e) => sameBase(e.base_url, cur));
      const key = realKey();
      if (ep) {
        if (ep.needs_key && key) return verifyKey();
        return markKeyNeed(ep.needs_key);
      }
      if (!/^https?:\/\//.test(cur)) return markKeyNeed(false);
      if (key) return verifyKey();                                         // 手输地址+有密钥→顺便验真伪
      const r = await api('/models', { method: 'POST', body: JSON.stringify({ base_url: cur, api_key: '' }) });
      markKeyNeed(!!r.error && /401|403/.test(r.error));
      if (r.models?.length) { for (const m of r.models) { modelMap.set(m, cur); loadedModels.set(m, cur); } refreshOpts(); }
    });
    // 需要密钥的端点：密钥填完自动验证
    app.querySelector('#mkey').addEventListener('change', async () => {
      const cur = app.querySelector('#murl').value.trim().replace(/\/+$/, '');
      const ep = epsList.find((e) => sameBase(e.base_url, cur));
      const key = realKey();
      if (!key || !(ep?.needs_key || (!ep && /^https?:\/\//.test(cur)))) return;
      await verifyKey();
    });
    // 点进模型框静默刷新模型池（不显示服务列表）；点「扫描」按钮才展示
    app.querySelector('#mmodel').addEventListener('focus', () => {
      if (Date.now() - lastScan > 10e3) fetchEps();
      renderDrop(); app.querySelector('#model-drop').style.display = 'block';
    });
    app.querySelector('#smoke').onclick = async () => {
      const out = app.querySelector('#smoke-out');
      out.textContent = t('testing');
      const r = await api('/llm-smoke', { method: 'POST', body: JSON.stringify({ base_url: app.querySelector('#murl').value, model: app.querySelector('#mmodel').value, api_key: realKey() }) });
      out.innerHTML = r.ok
        ? `${t('conn_ok')}<br>${t('sent')}${esc(r.sent)}<br>${t('reply')}${esc(r.reply || t('empty_reply'))}`
        : t('conn_fail', esc(r.error));
    };
    if (saveMsg && Date.now() - saveMsgAt < 6000) { const o = app.querySelector('#save-out'); if (o) o.textContent = saveMsg; }
    app.querySelector('#save').onclick = async () => {
      try {
        const targets = [...app.querySelectorAll('[data-h]:checked')].map((x) => x.dataset.h);
        const api_key = realKey() || undefined;                                  // 占位态→回传原始 enc: 值，保持不变
        const r = await api('/config', { method: 'POST', body: JSON.stringify({ llm: { base_url: app.querySelector('#murl').value || null, model: app.querySelector('#mmodel').value || null, api_key, concurrency: 2, timeout_ms: 60000 }, default_targets: targets }) });
        saveMsg = r.ok ? t('saved', r.key_enc) : t('save_fail', r.error);
      } catch (e) { saveMsg = t('save_fail', e.message); }
      saveMsgAt = Date.now();
      await refresh();   // 重渲染会把 save-out 抹掉——上面的 flash 负责补回来
    };
  }
}
refresh();
