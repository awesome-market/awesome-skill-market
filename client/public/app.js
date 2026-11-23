// skillmkt SPA — no build. token from ?token=; SSE live updates.
const T = new URLSearchParams(location.search).get('token') || '';
const api = async (p, opt) => (await fetch(`/api${p}${p.includes('?') ? '&' : '?'}token=${T}`, { headers: { authorization: `Bearer ${T}` }, ...opt })).json();
const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
let S = null, tab = 'skills';

async function refresh() {
  try { S = await api('/state'); }
  catch (e) { document.getElementById('app').innerHTML = `<p class="pill bad">/api/state failed: ${esc(e.message)} — daemon 挂了？skillmkt serve --stop 后重开</p>`; return; }
  if (S?.error) { document.getElementById('app').innerHTML = `<p class="pill bad">${esc(S.error)} — URL 里的 token 过期了，重跑 skillmkt serve 拿新链接</p>`; return; }
  render();
}
document.querySelectorAll('.tab').forEach((t) => t.onclick = () => { document.querySelectorAll('.tab').forEach((x) => x.classList.remove('on')); t.classList.add('on'); tab = t.dataset.t; render(); });
const es = new EventSource(`/api/events?token=${T}`);
es.addEventListener('decide', () => refresh());
es.onopen = () => document.getElementById('live').textContent = '●live';
es.onerror = () => document.getElementById('live').textContent = '○offline';

const pill = (v) => `<span class="pill ${v === 'clean' || v === 'installed' || v === 'active' ? 'ok' : v === 'malicious' || v === 'pending' ? 'bad' : 'warn'}">${esc(v)}</span>`;

async function render() {
  const app = document.getElementById('app');
  if (!S) return;
  if (tab === 'skills') {
    const skills = Object.entries(S.library.skills || {});
    app.innerHTML = `<h3>installed (${skills.length})</h3>` + (skills.map(([n, s]) => `
      <div class="card"><div class="row"><b>${esc(n)}</b><span class="mut">${esc(s.version || '-')}</span><span class="mut">${esc(s.source?.registry || '')}</span>${pill(s.audit || 'clean')}
      <span class="mut" style="margin-left:auto">${(s.targets || []).join(', ') || 'no targets'}</span>
      <button data-tg="${esc(n)}">targets</button></div>
      <div class="tgbox" data-box="${esc(n)}" style="display:none;margin-top:6px"></div></div>`).join('') || '<p class="mut">none</p>');
    // targets 编辑：勾选 harness → POST /api/targets 重投影
    app.querySelectorAll('[data-tg]').forEach((b) => b.onclick = () => {
      const box = app.querySelector(`[data-box="${b.dataset.tg}"]`);
      if (box.style.display === 'block') { box.style.display = 'none'; return; }
      const s = S.library.skills[b.dataset.tg];
      box.style.display = 'block';
      box.innerHTML = (S.harnesses || []).filter((x) => x.state === 'installed' && !x.detectOnly).map((x) =>
        `<label class="row" style="display:block"><input type="checkbox" data-th="${esc(x.id)}" ${(s.targets || []).includes(x.id) ? 'checked' : ''}> ${esc(x.id)} <span class="mut">${esc(x.primaryDir || '')}</span></label>`).join('')
        + `<div class="row" style="margin-top:6px"><button class="tgo">应用</button><span class="tout mut"></span></div>`;
      box.querySelector('.tgo').onclick = async () => {
        const ts = [...box.querySelectorAll('[data-th]:checked')].map((x) => x.dataset.th);
        const r = await api('/targets', { method: 'POST', body: JSON.stringify({ name: b.dataset.tg, targets: ts }) });
        box.querySelector('.tout').textContent = r.ok ? ' ✓' : ` ✗ ${r.error}`;
        refresh();
      };
    });
    app.innerHTML += `<h3>harnesses</h3>` + (S.harnesses || []).map((h) => `<div class="card row"><b>${esc(h.id)}</b>${pill(h.status)}<span class="mut">${esc(h.primaryDir || h.dirs?.[0] || '')}</span></div>`).join('');
    const up = S.upstream.skills || {};
    if (Object.keys(up).length) app.innerHTML += `<h3>upstream</h3>` + Object.entries(up).map(([n, u]) => `<div class="card row"><b>${esc(n)}</b>${u.outdated ? pill('outdated') : pill('clean')}<span class="mut">${esc(String(u.ref || '').slice(0, 8))}</span></div>`).join('');
  }
  if (tab === 'conflicts') {
    const cs = S.conflicts || [];
    app.innerHTML = `<h3>conflicts (${cs.filter((c) => c.status === 'pending').length} pending)</h3>`;
    for (const c of cs) {
      const card = el(`<div class="card"><div class="row"><b>${esc(c.id)}</b>${pill(c.status)}<span class="mut">${esc(c.domain || '')}</span></div>
        <div class="side a">A [${esc(c.sides[0].source)}] ${esc(c.sides[0].text)}</div>
        <div class="side b">B [${esc(c.sides[1].source)}] ${esc(c.sides[1].text)}</div>
        ${c.ai_explanation ? `<p class="mut">${esc(c.ai_explanation)}</p>` : ''}
        <div class="ev-imgs"></div>
        ${c.status === 'pending' ? `<div class="row" style="margin-top:8px">
          <button data-r="keep-a">keep A</button><button data-r="keep-b">keep B</button>
          <button data-r="merge">merge…</button><button data-r="dismissed">误报</button></div>
          <div class="editbox" style="display:none;margin-top:8px">
            <textarea rows="3" class="mtext"></textarea>
            <input class="reason" placeholder="reason（必填）">
            <div class="row" style="margin-top:6px"><button class="go">提交合并</button><button class="cancel">取消</button></div></div>` : ''}</div>`);
      if (c.evidence_files) card.querySelector('.ev-imgs').innerHTML = c.evidence_files.filter((f) => f.endsWith('.png')).map((f) => `<img class="ev" src="/evidence/${c.id}/${f}?token=${T}">`).join('');
      const post = async (resolution, custom) => {
        let reason = card.querySelector('.reason')?.value;
        if (!reason) reason = prompt('reason（必填）:', '') || '';
        if (!reason.trim()) return alert('reason 必填');
        await api('/decide', { method: 'POST', body: JSON.stringify({ id: c.id, resolution, custom, reason }) });
        refresh();
      };
      card.querySelectorAll('button[data-r]').forEach((b) => b.onclick = async () => {
        if (b.dataset.r === 'merge') {
          const box = card.querySelector('.editbox');
          box.style.display = 'block';
          box.querySelector('.mtext').value = `${c.sides[0].text}\n—— + ——\n${c.sides[1].text}`;
          box.querySelector('.mtext').focus();
          return;
        }
        post(b.dataset.r, null);
      });
      card.querySelector('.editbox .go')?.addEventListener('click', () => post('merge', card.querySelector('.mtext').value.trim()));
      card.querySelector('.editbox .cancel')?.addEventListener('click', () => { card.querySelector('.editbox').style.display = 'none'; });
      app.appendChild(card);
    }
    if (!cs.length) app.innerHTML += '<p class="mut">no conflicts — run skillmkt merge &lt;a&gt; &lt;b&gt;</p>';
  }
  if (tab === 'review') {
    app.innerHTML = `<h3>audit scans</h3>` + (S.scans || []).map((s) => `<div class="card row"><b>${esc(s.skill || s.name || '')}</b>${pill(s.verdict)}<span class="mut">${(s.findings || []).length} findings${s.llm ? ` · llm:${esc(s.llm.verdict)}` : ''}</span></div>`).join('') || '<p class="mut">none</p>';
  }
  if (tab === 'setup') {
    const h = S.harnesses || [];
    const cfg = await api('/config');
    const installed = h.filter((x) => x.state === 'installed' && !x.detectOnly).map((x) => x.id);
    const sel = new Set(cfg.default_targets?.length ? cfg.default_targets : installed);
    app.innerHTML = `<h3>setup / init</h3><div class="card">hub: <code>${esc(S.hub)}</code></div>
      <div class="card"><h3>LLM 端点</h3>
        <div class="row"><button id="probe">探测本地端点</button><span id="probe-out" class="mut">${cfg.llm?.model ? `当前: ${esc(cfg.llm.model)} @ ${esc(cfg.llm.base_url)}` : '未配置'}</span></div>
        <div id="eps"></div>
        <div class="row" style="margin-top:8px"><input id="murl" placeholder="base_url（手动，如 http://localhost:8001/v1）" value="${esc(cfg.llm?.base_url || '')}"></div>
        <div class="row"><input id="mmodel" placeholder="model id" value="${esc(cfg.llm?.model || '')}"></div>
        <div class="row"><input id="mkey" placeholder="api_key（env:VAR 引用，不存真值；留空=无 key）" value="${esc(cfg.llm?.api_key || '')}"></div>
        <div class="row"><button id="smoke">冒烟测试</button><span id="smoke-out" class="mut"></span></div></div>
      <div class="card"><h3>默认投影目标</h3>
        ${h.map((x) => `<label class="row" style="display:block"><input type="checkbox" data-h="${esc(x.id)}" ${sel.has(x.id) ? 'checked' : ''} ${x.state !== 'installed' ? 'disabled' : ''}> <b>${esc(x.id)}</b> ${pill(x.state || x.status)} <span class="mut">${esc(x.primaryDir || '')}</span></label>`).join('')}</div>
      <div class="card"><button id="save">保存配置</button><span id="save-out" class="mut"></span></div>`;
    app.querySelector('#probe').onclick = async () => {
      app.querySelector('#probe-out').textContent = 'probing…';
      const eps = await api('/probe');
      app.querySelector('#eps').innerHTML = eps.flatMap((e) => e.models.slice(0, 6).map((m) => `<div class="row" style="cursor:pointer" data-b="${esc(e.base_url)}" data-m="${esc(m)}">· ${esc(e.name)}:${e.port} — ${esc(m)}</div>`)).join('') || '<p class="mut">未发现（8001/11434/1234/8000/8080/1337/5000）</p>';
      app.querySelector('#probe-out').textContent = `${eps.length} 个端点`;
      app.querySelectorAll('#eps [data-b]').forEach((d) => d.onclick = () => { app.querySelector('#murl').value = d.dataset.b; app.querySelector('#mmodel').value = d.dataset.m; });
    };
    app.querySelector('#smoke').onclick = async () => {
      app.querySelector('#smoke-out').textContent = '…';
      const r = await api('/llm-smoke', { method: 'POST', body: JSON.stringify({ base_url: app.querySelector('#murl').value, model: app.querySelector('#mmodel').value, api_key: app.querySelector('#mkey').value }) });
      app.querySelector('#smoke-out').textContent = r.ok ? `✓ ${r.reply}` : `✗ ${r.error}`;
    };
    app.querySelector('#save').onclick = async () => {
      const targets = [...app.querySelectorAll('[data-h]:checked')].map((x) => x.dataset.h);
      const r = await api('/config', { method: 'POST', body: JSON.stringify({ llm: { base_url: app.querySelector('#murl').value || null, model: app.querySelector('#mmodel').value || null, api_key: app.querySelector('#mkey').value || undefined, concurrency: 2, timeout_ms: 60000 }, default_targets: targets }) });
      app.querySelector('#save-out').textContent = r.ok ? ' ✓ 已写入 config.yml' : ` ✗ ${r.error}`;
      refresh();
    };
  }
}
refresh();
