// skillmkt SPA — no build. token from ?token=; SSE live updates.
const T = new URLSearchParams(location.search).get('token') || '';
const api = async (p, opt) => (await fetch(`/api${p}${p.includes('?') ? '&' : '?'}token=${T}`, { headers: { authorization: `Bearer ${T}` }, ...opt })).json();
const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let S = null, tab = location.hash.slice(1).split('?')[0] || 'skills';

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
        <label class="field">服务地址</label><input type="text" id="murl" placeholder="http://localhost:1234/v1" value="${esc(cfg.llm?.base_url || '')}">
        <label class="field">模型名称</label><input type="text" id="mmodel" list="model-opts" placeholder="可输入关键字搜索，扫描后自动列出发现的模型" value="${esc(cfg.llm?.model || '')}">
        <datalist id="model-opts"></datalist>
        <label class="field">访问密钥</label><input type="text" id="mkey" value="${esc(cfg.llm?.api_key || '')}">
        <p class="mut">本机服务一般留空。填了明文密钥会存到 <code>~/.skillmkt/.env</code>（仅本人可读），配置文件里只留引用——不会以明文落进 config.yml。</p>
        <div class="row"><button id="smoke">测试连接</button><span id="smoke-out" class="mut"></span></div></div>
      <div class="card"><h3>第 2 步 · skill 默认安装位置</h3>
        <p class="mut">勾选的 AI 工具会在你安装新 skill 时自动收到一份副本。已勾过的话保存即生效。</p>
        ${h.map((x) => `<label class="check"><input type="checkbox" data-h="${esc(x.id)}" ${sel.has(x.id) ? 'checked' : ''} ${x.state === 'absent' ? 'disabled' : ''}> ${esc(x.id)} ${pill(x.state)} <span class="mut">${esc(x.primaryDir || '')}</span></label>`).join('')}</div>
      <div class="card"><h3>第 3 步 · 保存</h3>
        <div class="row"><button class="primary" id="save">保存设置</button><span id="save-out" class="mut"></span></div></div>`;
    const modelMap = new Map();   // model → base_url（选中模型自动回填地址）
    const loadedModels = new Map(); // 密钥端点拉到的模型——重扫后保留
    let epsList = [], lastScan = 0;
    // 模型下拉按当前服务地址过滤：地址匹配已扫描端点→只给它的模型；不匹配→给全部
    const refreshOpts = () => {
      const cur = app.querySelector('#murl').value.trim().replace(/\/+$/, '');
      const known = epsList.some((e) => e.base_url === cur);
      const list = [...modelMap.keys()].filter((m) => !known || modelMap.get(m) === cur);
      app.querySelector('#model-opts').innerHTML = list.map((m) => `<option value="${esc(m)}">`).join('');
      return list.length;
    };
    const doScan = async (quiet = false) => {
      lastScan = Date.now();
      if (!quiet) app.querySelector('#probe-out').textContent = '扫描中…';
      const eps = await api('/probe');
      epsList = eps;
      modelMap.clear();
      for (const e of eps) for (const m of e.models) if (!modelMap.has(m)) modelMap.set(m, e.base_url);
      for (const [m, b] of loadedModels) modelMap.set(m, b);
      refreshOpts();
      app.querySelector('#eps').innerHTML = eps.map((e) => e.needs_key
        ? `<div class="ep" data-b="${esc(e.base_url)}">${esc(e.name)}:${e.port} — <span class="mut">需要密钥（点这行填地址，再填密钥、测试连接）</span></div>`
        : `<div class="ep" data-b="${esc(e.base_url)}">${esc(e.name)}:${e.port} — ${e.models.length} 个模型（点这行选中，在「模型名称」下拉框里搜索）</div>`).join('')
        || '<p class="mut" style="margin-top:8px">没扫到——已尝试本机所有监听端口。确认模型服务已启动，或直接把服务地址填到下面</p>';
      app.querySelector('#probe-out').textContent = `发现 ${eps.length} 个服务、${modelMap.size} 个模型`;
      app.querySelectorAll('#eps [data-b]').forEach((d) => d.onclick = () => {
        app.querySelectorAll('#eps .ep').forEach((x) => x.classList.remove('sel'));
        d.classList.add('sel');
        app.querySelector('#murl').value = d.dataset.b;
        refreshOpts();
      });
    };
    app.querySelector('#probe').onclick = () => doScan();
    app.querySelector('#mmodel').addEventListener('input', (e) => {
      const b = modelMap.get(e.target.value);
      if (b) { app.querySelector('#murl').value = b; refreshOpts(); }
    });
    app.querySelector('#murl').addEventListener('input', () => refreshOpts());
    // 需要密钥的端点：密钥填完自动拉它的模型列表
    app.querySelector('#mkey').addEventListener('change', async () => {
      const cur = app.querySelector('#murl').value.trim().replace(/\/+$/, '');
      const ep = epsList.find((e) => e.base_url === cur);
      const key = app.querySelector('#mkey').value.trim();
      if (!ep?.needs_key || !key) return;
      const out = app.querySelector('#smoke-out');
      out.textContent = '读取模型列表…';
      const r = await api('/models', { method: 'POST', body: JSON.stringify({ base_url: cur, api_key: key }) });
      if (r.models?.length) {
        for (const m of r.models) { modelMap.set(m, cur); loadedModels.set(m, cur); }
        ep.needs_key = false; ep.models = r.models;
        refreshOpts();
        out.textContent = `已加载 ${r.models.length} 个模型`;
      } else out.textContent = r.error ? `读取失败：${r.error}` : '密钥通了，但没读到模型';
    });
    // 点进模型框时自动重扫——下载了新模型不用先点「扫描」
    app.querySelector('#mmodel').addEventListener('focus', () => { if (Date.now() - lastScan > 10e3) doScan(true); });
    app.querySelector('#smoke').onclick = async () => {
      app.querySelector('#smoke-out').textContent = '测试中…';
      const r = await api('/llm-smoke', { method: 'POST', body: JSON.stringify({ base_url: app.querySelector('#murl').value, model: app.querySelector('#mmodel').value, api_key: app.querySelector('#mkey').value }) });
      app.querySelector('#smoke-out').textContent = r.ok ? `连接成功，模型回复：${r.reply}` : `连接失败：${r.error}`;
    };
    app.querySelector('#save').onclick = async () => {
      const targets = [...app.querySelectorAll('[data-h]:checked')].map((x) => x.dataset.h);
      const r = await api('/config', { method: 'POST', body: JSON.stringify({ llm: { base_url: app.querySelector('#murl').value || null, model: app.querySelector('#mmodel').value || null, api_key: app.querySelector('#mkey').value || undefined, concurrency: 2, timeout_ms: 60000 }, default_targets: targets }) });
      app.querySelector('#save-out').textContent = r.ok ? `已保存到 config.yml${r.key_env ? '，密钥存入 .env' : ''}` : `保存失败：${r.error}`;
      refresh();
    };
  }
}
refresh();
