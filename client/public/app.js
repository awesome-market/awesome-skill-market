// skillmkt SPA — no build. token from ?token=; SSE live updates.
const T = new URLSearchParams(location.search).get('token') || '';
const api = async (p, opt) => (await fetch(`/api${p}${p.includes('?') ? '&' : '?'}token=${T}`, { headers: { authorization: `Bearer ${T}` }, ...opt })).json();
const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
let S = null, tab = location.hash.slice(1).split('?')[0] || 'skills';

async function refresh() {
  try { S = await api('/state'); }
  catch (e) { document.getElementById('app').innerHTML = `<p class="pill bad">/api/state 请求失败：${esc(e.message)}——daemon 挂了？重跑 skillmkt serve</p>`; return; }
  if (S?.error) { document.getElementById('app').innerHTML = `<p class="pill bad">${esc(S.error)}——URL 里的 token 已失效，重跑 skillmkt serve 拿新链接</p>`; return; }
  if (!location.hash && !S.initialized) { tab = 'setup'; location.hash = 'setup'; }   // 未初始化→setup
  render();
}
const syncTabs = () => document.querySelectorAll('nav [data-t]').forEach((x) => x.classList.toggle('on', x.dataset.t === tab));
document.querySelectorAll('nav [data-t]').forEach((t) => t.onclick = () => { tab = t.dataset.t; location.hash = tab; syncTabs(); render(); });
const es = new EventSource(`/api/events?token=${T}`);
es.addEventListener('decide', () => refresh());
es.addEventListener('config', () => refresh());
es.addEventListener('targets', () => refresh());
es.onopen = () => document.getElementById('live').textContent = 'live';
es.onerror = () => document.getElementById('live').textContent = 'offline';

const pill = (v) => {
  const cls = ['clean', 'installed', 'active', 'managed', 'keep-a', 'keep-b'].includes(v) ? 'ok'
    : ['malicious', 'pending', 'missing', 'outdated'].includes(v) ? 'bad' : 'warn';
  return `<span class="pill ${cls}">${esc(v)}</span>`;
};

async function render() {
  const app = document.getElementById('app');
  document.getElementById('foot').textContent = `hub: ${S.hub}`;
  syncTabs();

  if (tab === 'skills') {
    const skills = Object.entries(S.library.skills || {});
    app.innerHTML = `<h2>已安装 skills（${skills.length}）</h2>` + (skills.map(([n, s]) => `
      <div class="card"><div class="row"><b>${esc(n)}</b><span class="mut">${esc(s.version || '-')}</span><span class="mut">${esc(s.source?.registry || '')}</span>${pill(s.audit || 'clean')}
      <span class="mut" style="margin-left:auto">装在：${(s.targets || []).join('、') || '无'}</span>
      <button data-tg="${esc(n)}">安装位置</button></div>
      <div class="tgbox" data-box="${esc(n)}" style="display:none;margin-top:8px"></div></div>`).join('') || '<p class="mut">还没有受管 skill——skillmkt install &lt;ref&gt;</p>');
    app.querySelectorAll('[data-tg]').forEach((b) => b.onclick = () => {
      const box = app.querySelector(`[data-box="${b.dataset.tg}"]`);
      if (box.style.display === 'block') { box.style.display = 'none'; return; }
      const s = S.library.skills[b.dataset.tg];
      box.style.display = 'block';
      box.innerHTML = `<label class="field">装到这些 agent（勾选后立即复制生效）</label>` +
        (S.harnesses || []).filter((x) => x.state === 'installed' && !x.detectOnly).map((x) =>
          `<label class="row"><input type="checkbox" data-th="${esc(x.id)}" ${(s.targets || []).includes(x.id) ? 'checked' : ''}> ${esc(x.id)} <span class="mut">${esc(x.primaryDir || '')}</span></label>`).join('')
        + `<div class="row" style="margin-top:8px"><button class="primary tgo">应用目标</button><span class="tout mut"></span></div>`;
      box.querySelector('.tgo').onclick = async () => {
        const ts = [...box.querySelectorAll('[data-th]:checked')].map((x) => x.dataset.th);
        const r = await api('/targets', { method: 'POST', body: JSON.stringify({ name: b.dataset.tg, targets: ts }) });
        box.querySelector('.tout').textContent = r.ok ? '已应用' : `失败：${r.error}`;
        refresh();
      };
    });
    app.innerHTML += `<h2>检测到的 agent</h2>` + (S.harnesses || []).map((h) => `<div class="card row"><b>${esc(h.id)}</b>${pill(h.state)}<span class="mut">${esc(h.primaryDir || h.dirs?.[0] || '')}</span></div>`).join('');
    const up = S.upstream.skills || {};
    if (Object.keys(up).length) app.innerHTML += `<h2>可更新</h2>` + Object.entries(up).map(([n, u]) => `<div class="card row"><b>${esc(n)}</b>${u.outdated ? pill('outdated') : pill('clean')}<span class="mut">${esc(String(u.ref || '').slice(0, 8))}</span></div>`).join('');
  }

  if (tab === 'conflicts') {
    const cs = S.conflicts || [];
    const pendN = cs.filter((c) => c.status === 'pending').length;
    app.innerHTML = `<h2>冲突队列（${pendN} 待裁决）</h2>`;
    for (const c of cs) {
      const card = el(`<div class="card"><div class="row"><b>${esc(c.id)}</b>${pill(c.status)}<span class="mut">${esc(c.domain || '')}</span></div>
        <div class="side a">A · ${esc(c.sides[0].source)}<br>${esc(c.sides[0].text)}</div>
        <div class="side b">B · ${esc(c.sides[1].source)}<br>${esc(c.sides[1].text)}</div>
        ${c.ai_explanation ? `<p class="mut">${esc(c.ai_explanation)}</p>` : ''}
        ${c.dismiss_reason ? `<p class="mut">dismiss：${esc(c.dismiss_reason)}</p>` : ''}
        <div class="ev-imgs"></div>
        ${c.status === 'pending' ? `<div class="row" style="margin-top:8px">
          <button data-r="keep-a">保留 A</button><button data-r="keep-b">保留 B</button>
          <button data-r="merge">合并两条…</button><button data-r="dismissed">标为误报</button></div>
          <div class="editbox" style="display:none;margin-top:8px">
            <label class="field">合并后的规则文本</label><textarea class="mtext"></textarea>
            <label class="field">裁决理由（必填）</label><input type="text" class="reason">
            <div class="row" style="margin-top:8px"><button class="primary go">提交合并</button><button class="cancel">取消</button></div></div>` : ''}</div>`);
      if (c.evidence_files) card.querySelector('.ev-imgs').innerHTML = c.evidence_files.filter((f) => f.endsWith('.png')).map((f) => `<img class="ev" src="/evidence/${c.id}/${f}?token=${T}" alt="evidence ${esc(f)}">`).join('');
      const post = async (resolution, custom) => {
        let reason = card.querySelector('.reason')?.value;
        if (!reason) reason = prompt('裁决理由（必填）：', '') || '';
        if (!reason.trim()) return alert('裁决理由必填');
        await api('/decide', { method: 'POST', body: JSON.stringify({ id: c.id, resolution, custom, reason }) });
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
    if (!cs.length) app.innerHTML += '<p class="mut">无冲突记录——skillmkt merge &lt;a&gt; &lt;b&gt; 生成队列</p>';
  }

  if (tab === 'review') {
    const scans = S.scans || [];
    app.innerHTML = `<h2>审核记录（${scans.length}）</h2>` + (scans.map((s) => `<div class="card row"><b>${esc(s.skill || s.name || '')}</b>${pill(s.verdict)}<span class="mut">${(s.findings || []).length} findings${s.llm ? `，llm: ${esc(s.llm.verdict)}` : ''}</span></div>`).join('') || '<p class="mut">无审核记录</p>');
    const decs = (S.decisions || []).filter((d) => d.status === 'active');
    if (decs.length) app.innerHTML += `<h2>已生效裁决（${decs.length}）</h2>` + decs.map((d) => `<div class="card"><div class="row"><b>${esc(d.id)}</b>${pill(d.resolution)}<span class="mut">by ${esc(d.decided_by)}</span></div><p class="mut">${esc(d.reason)}</p></div>`).join('');
  }

  if (tab === 'setup') {
    const h = S.harnesses || [];
    const cfg = await api('/config');
    const installed = h.filter((x) => x.state === 'installed' && !x.detectOnly).map((x) => x.id);
    const sel = new Set(cfg.default_targets?.length ? cfg.default_targets : installed);
    app.innerHTML = `<h2>初始化与配置</h2>
      <div class="card"><b>LLM 端点</b><span class="mut" id="cur">${cfg.llm?.model ? `（当前：${esc(cfg.llm.model)} @ ${esc(cfg.llm.base_url)}）` : '（未配置）'}</span>
        <div class="row" style="margin-top:8px"><button id="probe">扫描本地 LLM 服务</button><span id="probe-out" class="mut"></span></div>
        <div id="eps"></div>
        <label class="field">base_url</label><input type="text" id="murl" value="${esc(cfg.llm?.base_url || '')}">
        <label class="field">model</label><input type="text" id="mmodel" value="${esc(cfg.llm?.model || '')}">
        <label class="field">api_key（env:VAR 引用，不存真值；留空=无 key）</label><input type="text" id="mkey" value="${esc(cfg.llm?.api_key || '')}">
        <div class="row" style="margin-top:8px"><button id="smoke">测试连接</button><span id="smoke-out" class="mut"></span></div></div>
      <div class="card"><b>skill 装到哪些 agent</b><span class="mut">（勾选后，新装的 skill 会复制进这些 agent 的 skills 目录）</span>
        ${h.map((x) => `<label class="row"><input type="checkbox" data-h="${esc(x.id)}" ${sel.has(x.id) ? 'checked' : ''} ${x.state !== 'installed' ? 'disabled' : ''}> ${esc(x.id)} ${pill(x.state)} <span class="mut">${esc(x.primaryDir || '')}</span></label>`).join('')}</div>
      <div class="card"><button class="primary" id="save">保存配置</button><span id="save-out" class="mut"></span></div>`;
    app.querySelector('#probe').onclick = async () => {
      app.querySelector('#probe-out').textContent = '扫描中…';
      const eps = await api('/probe');
      app.querySelector('#eps').innerHTML = eps.flatMap((e) => e.models.slice(0, 6).map((m) => `<div class="ep" data-b="${esc(e.base_url)}" data-m="${esc(m)}">${esc(e.name)}:${e.port} — <code>${esc(m)}</code></div>`)).join('') || '<p class="mut">未发现（8001 / 11434 / 1234 / 8000 / 8080 / 1337 / 5000）</p>';
      app.querySelector('#probe-out').textContent = `${eps.length} 个端点`;
      app.querySelectorAll('#eps [data-b]').forEach((d) => d.onclick = () => { app.querySelector('#murl').value = d.dataset.b; app.querySelector('#mmodel').value = d.dataset.m; });
    };
    app.querySelector('#smoke').onclick = async () => {
      app.querySelector('#smoke-out').textContent = '调用中…';
      const r = await api('/llm-smoke', { method: 'POST', body: JSON.stringify({ base_url: app.querySelector('#murl').value, model: app.querySelector('#mmodel').value, api_key: app.querySelector('#mkey').value }) });
      app.querySelector('#smoke-out').textContent = r.ok ? `通过：${r.reply}` : `失败：${r.error}`;
    };
    app.querySelector('#save').onclick = async () => {
      const targets = [...app.querySelectorAll('[data-h]:checked')].map((x) => x.dataset.h);
      const r = await api('/config', { method: 'POST', body: JSON.stringify({ llm: { base_url: app.querySelector('#murl').value || null, model: app.querySelector('#mmodel').value || null, api_key: app.querySelector('#mkey').value || undefined, concurrency: 2, timeout_ms: 60000 }, default_targets: targets }) });
      app.querySelector('#save-out').textContent = r.ok ? ' 已写入 config.yml' : ` 失败：${r.error}`;
      refresh();
    };
  }
}
refresh();
