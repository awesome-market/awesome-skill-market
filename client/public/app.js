// skillmkt SPA — no build. token from ?token=; SSE live updates.
const T = new URLSearchParams(location.search).get('token') || '';
const api = async (p, opt) => (await fetch(`/api${p}${p.includes('?') ? '&' : '?'}token=${T}`, { headers: { authorization: `Bearer ${T}` }, ...opt })).json();
const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let S = null, tab = location.hash.slice(1).split('?')[0] || 'skills';
let saveMsg = '', saveMsgAt = 0;   // 保存结果提示——要挺过保存后的连续重渲染（自己 refresh + SSE config 事件）

async function refresh() {
  try { S = await api('/state'); }
  catch (e) { document.getElementById('app').innerHTML = `<p class="pill bad">连不上本地服务：${esc(e.message)}——服务可能已退出，重跑 <code>skillmkt serve</code></p>`; return; }
  if (S?.error) { document.getElementById('app').innerHTML = `<p class="pill bad">${esc(S.error)}——网址里的 token 已失效，重跑 <code>skillmkt serve</code> 拿新链接</p>`; return; }
  if (!location.hash && !S.initialized) { tab = 'setup'; location.hash = 'setup'; }   // 未初始化→设置页
  render();
}
const syncTabs = () => document.querySelectorAll('nav [data-t]').forEach((x) => x.classList.toggle('on', x.dataset.t === tab));
document.querySelectorAll('nav [data-t]').forEach((t) => t.onclick = () => { tab = t.dataset.t; location.hash = tab; syncTabs(); render(); });
const es = new EventSource(`/api/events?token=${T}`);
es.addEventListener('decide', () => refresh());
es.addEventListener('config', () => refresh());
es.addEventListener('targets', () => refresh());
const live = document.getElementById('live');
es.onopen = () => { live.classList.remove('off'); live.innerHTML = '<span class="dot"></span>已连接'; };
es.onerror = () => { live.classList.add('off'); live.innerHTML = '<span class="dot"></span>已断开'; };

// 机器状态 → 人话
const CN = {
  installed: '已安装', available: '可用', likely: '疑似已装', absent: '未检测到',
  managed: '已纳入管理', external: '未管理', 'hub-untracked': '未登记',
  clean: '安全', suspicious: '可疑', malicious: '危险',
  pending: '待处理', decided: '已裁决', resolved: '已裁决', dismissed: '已忽略',
  outdated: '有更新', missing: '文件缺失', 'content-differs': '内容被改过', drifted: '有改动',
  'keep-a': '采用 A', 'keep-b': '采用 B', merge: '已合并', active: '生效中',
};
const pill = (v) => {
  const cls = ['clean', 'installed', 'active', 'managed', 'keep-a', 'keep-b', 'decided', 'resolved', 'merge'].includes(v) ? 'ok'
    : ['malicious', 'pending', 'missing', 'outdated', 'content-differs'].includes(v) ? 'bad' : 'warn';
  return `<span class="pill ${cls}">${esc(CN[v] || v)}</span>`;
};

async function render() {
  const app = document.getElementById('app');
  document.getElementById('foot').textContent = `数据目录：${S.hub}`;
  syncTabs();

  if (tab === 'skills') {
    const skills = Object.entries(S.library.skills || {});
    app.innerHTML = `<h2>已安装的 skill（${skills.length}）</h2>
      <p class="desc">通过 skillmkt 安装、统一管理的 skill。点开「安装位置」可以决定它出现在哪些 AI 工具的 skills 目录里。</p>`
      + (skills.map(([n, s]) => `
      <div class="card"><div class="row"><b>${esc(n)}</b><span class="mut">${esc(s.version || '')}</span><span class="mut">${esc(s.source?.registry || '')}</span>${pill(s.audit || 'clean')}
      <span class="mut" style="margin-left:auto">装在：${(s.targets || []).map((t) => esc(CN[t] || t)).join('、') || '仅仓库'}</span>
      <button data-tg="${esc(n)}">安装位置</button></div>
      <div class="tgbox" data-box="${esc(n)}" style="display:none;margin-top:10px"></div></div>`).join('')
      || `<div class="empty">还没有安装任何 skill。<br>在终端运行 <code>skillmkt install 名称</code> 安装；不知道装什么可以先 <code>skillmkt search 关键词</code> 搜一搜。</div>`);
    app.querySelectorAll('[data-tg]').forEach((b) => b.onclick = () => {
      const box = app.querySelector(`[data-box="${b.dataset.tg}"]`);
      if (box.style.display === 'block') { box.style.display = 'none'; return; }
      const s = S.library.skills[b.dataset.tg];
      box.style.display = 'block';
      box.innerHTML = `<label class="field">复制到这些 AI 工具（取消勾选会把已复制的删掉）</label>` +
        (S.harnesses || []).filter((x) => x.state !== 'absent' && !x.detectOnly).map((x) =>
          `<label class="check"><input type="checkbox" data-th="${esc(x.id)}" ${(s.targets || []).includes(x.id) ? 'checked' : ''}> ${esc(x.id)} ${pill(x.state)} <span class="mut">${esc(x.primaryDir || '')}</span></label>`).join('')
        + `<div class="row" style="margin-top:10px"><button class="primary tgo">保存安装位置</button><span class="tout mut"></span></div>`;
      box.querySelector('.tgo').onclick = async () => {
        const ts = [...box.querySelectorAll('[data-th]:checked')].map((x) => x.dataset.th);
        const r = await api('/targets', { method: 'POST', body: JSON.stringify({ name: b.dataset.tg, targets: ts }) });
        box.querySelector('.tout').textContent = r.ok ? '已保存并生效' : `失败：${r.error}`;
        refresh();
      };
    });
    app.innerHTML += `<h2>你电脑上的 AI 工具</h2>
      <p class="desc">检测到的 agent 及其 skills 目录。「可用」表示工具已安装、目录会在首次安装 skill 时自动建好。</p>`
      + (S.harnesses || []).map((h) => `<div class="card row"><b>${esc(h.id)}</b>${pill(h.state)}<span class="mut">${esc(h.primaryDir || h.dirs?.[0]?.path || '')}</span></div>`).join('');
    const up = S.upstream.skills || {};
    const outs = Object.entries(up).filter(([, u]) => u.outdated);
    if (outs.length) app.innerHTML += `<h2>有更新可用（${outs.length}）</h2>
      <p class="desc">上游发布了新版本。终端运行 <code>skillmkt upgrade</code> 更新。</p>`
      + outs.map(([n]) => `<div class="card row"><b>${esc(n)}</b>${pill('outdated')}</div>`).join('');
  }

  if (tab === 'conflicts') {
    const cs = S.conflicts || [];
    const pendN = cs.filter((c) => c.status === 'pending').length;
    app.innerHTML = `<h2>冲突处理（${pendN} 条待处理）</h2>
      <p class="desc">不同 skill 对同一件事给出相反规则时，需要你拍板。每条冲突填一句理由，然后选 A、选 B、自己合并，或者标为误报。</p>`;
    for (const c of cs) {
      const card = el(`<div class="card"><div class="row"><b>${esc(c.id)}</b>${pill(c.status)}<span class="mut">${esc(c.domain || '')}</span></div>
        <div class="side a"><span class="who">方案 A · 来自 ${esc(c.sides[0].source)}</span>${esc(c.sides[0].text)}</div>
        <div class="side b"><span class="who">方案 B · 来自 ${esc(c.sides[1].source)}</span>${esc(c.sides[1].text)}</div>
        ${c.ai_explanation ? `<p class="mut">AI 分析：${esc(c.ai_explanation)}</p>` : ''}
        ${c.dismiss_reason ? `<p class="mut">误报原因：${esc(c.dismiss_reason)}</p>` : ''}
        <div class="ev-imgs"></div>
        ${c.status === 'pending' ? `
          <label class="field">裁决理由（必填——以后翻记录时知道为什么这么选）</label>
          <input type="text" class="reason" placeholder="例：A 的规则更具体，覆盖了 B 的场景">
          <div class="row" style="margin-top:12px">
          <button data-r="keep-a">采用方案 A</button><button data-r="keep-b">采用方案 B</button>
          <button data-r="merge">自己合并两条…</button><button data-r="dismissed">其实不冲突</button><span class="err mut"></span></div>
          <div class="editbox" style="display:none;margin-top:12px">
            <label class="field">合并后的规则文本（已预填两条原文，直接改）</label><textarea class="mtext"></textarea>
            <div class="row" style="margin-top:10px"><button class="primary go">提交合并</button><button class="cancel">取消</button></div></div>` : ''}</div>`);
      if (c.evidence_files) card.querySelector('.ev-imgs').innerHTML = c.evidence_files.filter((f) => f.endsWith('.png')).map((f) => `<img class="ev" src="/evidence/${c.id}/${f}?token=${T}" alt="evidence ${esc(f)}">`).join('');
      const post = async (resolution, custom) => {
        const reason = card.querySelector('.reason')?.value || '';
        if (!reason.trim()) { card.querySelector('.err').textContent = '先填一句裁决理由'; card.querySelector('.reason')?.focus(); return; }
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
    if (!cs.length) app.innerHTML += '<div class="empty">没有待处理的冲突。<br>合并两个 skill 时会自动检测：<code>skillmkt merge 名字A 名字B</code></div>';
  }

  if (tab === 'review') {
    const scans = S.scans || [];
    app.innerHTML = `<h2>安全检查记录（${scans.length}）</h2>
      <p class="desc">每次安装 skill 时做的供应链安全检查结果（恶意脚本、凭证收集等）。</p>`
      + (scans.map((s) => `<div class="card row"><b>${esc(s.skill || s.name || '')}</b>${pill(s.verdict)}<span class="mut">${(s.findings || []).length} 条发现${s.llm ? `，AI 复审：${esc(CN[s.llm.verdict] || s.llm.verdict)}` : ''}</span></div>`).join('')
        || '<div class="empty">还没有检查记录——安装 skill 时会自动生成。</div>');
    const decs = (S.decisions || []).filter((d) => d.status === 'active');
    if (decs.length) app.innerHTML += `<h2>我的裁决记录（${decs.length}）</h2>
      <p class="desc">你在「冲突处理」里做过的拍板，都在这里留底。</p>`
      + decs.map((d) => `<div class="card"><div class="row"><b>${esc(d.id)}</b>${pill(d.resolution)}<span class="mut">via ${esc(d.decided_by)}</span></div><p class="mut">${esc(d.reason)}</p></div>`).join('');
  }

  if (tab === 'setup') {
    const h = S.harnesses || [];
    const cfg = await api('/config');
    const installed = h.filter((x) => x.state === 'installed' && !x.detectOnly).map((x) => x.id);
    const sel = new Set(cfg.default_targets?.length ? cfg.default_targets : installed);
    app.innerHTML = `<h2>设置</h2>
      <p class="desc">一次配置即可：AI 模型可选（用于冲突自动仲裁等智能功能，不配也能正常用）；安装位置决定新 skill 默认复制到哪些 AI 工具。</p>
      <div class="card"><h3>第 1 步 · AI 模型（可选）</h3>
        <p class="mut">点「扫描」自动发现本机正在运行的模型服务（LM Studio、Ollama、oMLX 等）。${cfg.llm?.model ? `当前使用：<code>${esc(cfg.llm.model)}</code>` : ''}</p>
        <div class="row"><button id="probe">扫描本机模型服务</button><span id="probe-out" class="mut"></span></div>
        <div id="eps"></div>
        <div class="frow"><span class="lab">服务地址</span><input type="text" id="murl" autocomplete="off" placeholder="http://localhost:1234/v1" value="${esc(cfg.llm?.base_url || '')}"></div>
        <div class="frow" id="key-row" style="display:none"><span class="lab">访问密钥</span><input type="text" id="mkey" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-1p-ignore data-lpignore="true" data-form-type="other" value="${esc(cfg.llm?.api_key?.startsWith('enc:') ? '已加密保存' : (cfg.llm?.api_key || ''))}"><span class="fhint" id="key-hint"></span>
          <div class="fsub">填了密钥会用本机机器码加密后存入 config.yml——文件拷到别的机器解不开，换机需重填。</div></div>
        <div class="frow" id="model-box"><span class="lab">模型名称</span>
          <div class="combo"><input type="text" id="mmodel" autocomplete="off" placeholder="可输入关键字搜索，扫描后自动列出发现的模型" value="${esc(cfg.llm?.model || '')}">
          <div class="combo-list" id="model-drop" style="display:none"></div></div>
          <button id="smoke">测试连接</button>
          <div id="smoke-out" class="fsub"></div></div></div>
      <div class="card"><h3>第 2 步 · skill 默认安装位置</h3>
        <p class="mut">勾选的 AI 工具会在你安装新 skill 时自动收到一份副本。已勾过的话保存即生效。</p>
        ${h.map((x) => `<label class="check"><input type="checkbox" data-h="${esc(x.id)}" ${sel.has(x.id) ? 'checked' : ''} ${x.state === 'absent' ? 'disabled' : ''}> ${esc(x.id)} ${pill(x.state)} <span class="mut">${esc(x.primaryDir || '')}</span></label>`).join('')}</div>
      <div class="card"><div class="row" style="justify-content:space-between;align-items:center"><h3 style="margin:0">第 3 步 · 保存</h3>
        <div class="row" style="gap:12px"><span id="save-out" class="mut"></span><button class="primary" id="save">保存设置</button></div></div></div>`;
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
        || `<div class="none">${curOpts.length ? '无匹配' : (scanning ? '正在扫描本机服务…' : '暂无模型——先扫描或填密钥')}</div>`;
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
      app.querySelector('#probe-out').textContent = '扫描中…';
      const eps = await fetchEps();
      app.querySelector('#eps').innerHTML = eps.map((e) => e.needs_key
        ? `<div class="ep" data-b="${esc(e.base_url)}">${esc(e.name)}:${e.port} — <span class="mut">需要密钥（点这行填地址，再填密钥、测试连接）</span></div>`
        : `<div class="ep" data-b="${esc(e.base_url)}">${esc(e.name)}:${e.port} — ${e.models.length} 个模型（点这行选中，在「模型名称」下拉框里搜索）</div>`).join('')
        || '<p class="mut" style="margin-top:8px">没扫到——已尝试本机所有监听端口。确认模型服务已启动，或直接把服务地址填到下面</p>';
      app.querySelector('#probe-out').textContent = `发现 ${eps.length} 个服务、${modelMap.size} 个模型`;
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
        ? (keyFailed ? '← 密钥错误' : (has ? '← 待验证' : '← 需要密钥')) : '';
      app.querySelector('#model-box').style.display = (hasUrl && !want) ? '' : 'none';  // 验证通过才出现
    };
    // 拿密钥真发 /models——通过才收录模型并放出模型框；失败保持隐藏
    const verifyKey = async () => {
      const cur = app.querySelector('#murl').value.trim().replace(/\/+$/, '');
      const key = realKey();
      if (!key) return;
      const out = app.querySelector('#smoke-out');
      out.textContent = '验证密钥…';
      let r;
      try { r = await api('/models', { method: 'POST', body: JSON.stringify({ base_url: cur, api_key: key }) }); }
      catch (e) { out.textContent = `请求失败：${e.message}`; return; }
      if (r.models?.length) {
        keyOk = true; keyFailed = false;
        for (const m of r.models) { modelMap.set(m, cur); loadedModels.set(m, cur); }
        const ep = epsList.find((e) => sameBase(e.base_url, cur));
        if (ep) { ep.needs_key = false; ep.models = r.models; }
        markKeyNeed(true); refreshOpts();
        out.textContent = `密钥有效，已加载 ${r.models.length} 个模型`;
      } else {
        keyOk = false; keyFailed = true; markKeyNeed(true);                 // 模型框保持隐藏
        out.textContent = r.error ? `密钥错误：${r.error}` : '密钥通了，但没读到模型';
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
    // 已存的 enc: 密钥显示为「已加密保存」占位态：点击清空可输新密钥，留空失焦还原（不误删）
    const ENC_DISP = '已加密保存';
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
      out.textContent = '测试中…';
      const r = await api('/llm-smoke', { method: 'POST', body: JSON.stringify({ base_url: app.querySelector('#murl').value, model: app.querySelector('#mmodel').value, api_key: realKey() }) });
      out.innerHTML = r.ok
        ? `连接成功<br>发送：${esc(r.sent)}<br>回复：${esc(r.reply || '（空回复）')}`
        : `连接失败：${esc(r.error)}`;
    };
    if (saveMsg && Date.now() - saveMsgAt < 6000) { const o = app.querySelector('#save-out'); if (o) o.textContent = saveMsg; }
    app.querySelector('#save').onclick = async () => {
      try {
        const targets = [...app.querySelectorAll('[data-h]:checked')].map((x) => x.dataset.h);
        const api_key = realKey() || undefined;                                  // 占位态→回传原始 enc: 值，保持不变
        const r = await api('/config', { method: 'POST', body: JSON.stringify({ llm: { base_url: app.querySelector('#murl').value || null, model: app.querySelector('#mmodel').value || null, api_key, concurrency: 2, timeout_ms: 60000 }, default_targets: targets }) });
        saveMsg = r.ok ? `已保存到 config.yml${r.key_enc ? '，密钥已加密' : ''}` : `保存失败：${r.error}`;
      } catch (e) { saveMsg = `保存失败：${e.message}`; }
      saveMsgAt = Date.now();
      await refresh();   // 重渲染会把 save-out 抹掉——上面的 flash 负责补回来
    };
  }
}
refresh();
