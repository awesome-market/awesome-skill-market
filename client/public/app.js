// skillmkt SPA — no build. token from ?token=; SSE live updates.
const T = new URLSearchParams(location.search).get('token') || '';
const api = async (p, opt) => (await fetch(`/api${p}${p.includes('?') ? '&' : '?'}token=${T}`, { headers: { authorization: `Bearer ${T}` }, ...opt })).json();
const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
let S = null, tab = 'skills';

async function refresh() { S = await api('/state'); render(); }
document.querySelectorAll('.tab').forEach((t) => t.onclick = () => { document.querySelectorAll('.tab').forEach((x) => x.classList.remove('on')); t.classList.add('on'); tab = t.dataset.t; render(); });
const es = new EventSource(`/api/events?token=${T}`);
es.addEventListener('decide', () => refresh());
es.onopen = () => document.getElementById('live').textContent = '●live';
es.onerror = () => document.getElementById('live').textContent = '○offline';

const pill = (v) => `<span class="pill ${v === 'clean' || v === 'installed' || v === 'active' ? 'ok' : v === 'malicious' || v === 'pending' ? 'bad' : 'warn'}">${esc(v)}</span>`;

function render() {
  const app = document.getElementById('app');
  if (!S) return;
  if (tab === 'skills') {
    const skills = Object.entries(S.library.skills || {});
    app.innerHTML = `<h3>installed (${skills.length})</h3>` + (skills.map(([n, s]) => `
      <div class="card"><div class="row"><b>${esc(n)}</b><span class="mut">${esc(s.version || '-')}</span><span class="mut">${esc(s.source?.registry || '')}</span>${pill(s.audit || 'clean')}
      <span class="mut" style="margin-left:auto">${(s.targets || []).join(', ') || 'no targets'}</span></div></div>`).join('') || '<p class="mut">none</p>');
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
          <button data-r="merge">merge…</button><button data-r="dismissed">误报</button></div>` : ''}</div>`);
      if (c.evidence_files) card.querySelector('.ev-imgs').innerHTML = c.evidence_files.filter((f) => f.endsWith('.png')).map((f) => `<img class="ev" src="/evidence/${c.id}/${f}?token=${T}">`).join('');
      card.querySelectorAll('button').forEach((b) => b.onclick = async () => {
        let custom = null;
        if (b.dataset.r === 'merge') { custom = prompt('合并文本:', `${c.sides[0].text} + ${c.sides[1].text}`); if (!custom) return; }
        const reason = prompt('reason:', '') || 'web decision';
        await api('/decide', { method: 'POST', body: JSON.stringify({ id: c.id, resolution: b.dataset.r, custom, reason }) });
        refresh();
      });
      app.appendChild(card);
    }
    if (!cs.length) app.innerHTML += '<p class="mut">no conflicts — run skillmkt merge &lt;a&gt; &lt;b&gt;</p>';
  }
  if (tab === 'review') {
    app.innerHTML = `<h3>audit scans</h3>` + (S.scans || []).map((s) => `<div class="card row"><b>${esc(s.skill || s.name || '')}</b>${pill(s.verdict)}<span class="mut">${(s.findings || []).length} findings${s.llm ? ` · llm:${esc(s.llm.verdict)}` : ''}</span></div>`).join('') || '<p class="mut">none</p>';
  }
  if (tab === 'setup') {
    const h = S.harnesses || [];
    app.innerHTML = `<h3>setup</h3><div class="card">hub: <code>${esc(S.hub)}</code></div>
      ${h.map((x) => `<div class="card row"><b>${esc(x.id)}</b>${pill(x.status)}<span class="mut">${esc(x.primaryDir || '')}</span></div>`).join('')}
      <p class="mut">CLI 是主操作面；本面板用于可视裁决与矩阵审阅。token 只在本地 daemon 生命周期内有效。</p>`;
  }
}
refresh();
