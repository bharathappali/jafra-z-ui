/**
 * ChatPane: a port of the mockup chat (jafra-z-dashboard.html 2211–2400: cards, msgHTML, renderMsgs, composer, queue,
 * renderChatState, openChat, resizer) driven by the real harness (src/kusma/harness.js):
 * Laya route → KUSMA on Jafra Z (reasoning ON) with the 8 analyzer tools → J/tools/{tool}. Streaming order as in the mockup:
 * run line "KUSMA is investigating…" → think step (open, spinner, "Thinking…" → "Thought for Ns") → tool steps
 * (spinner → ✓ + result) → reply → run line Done / Stopped.
 */
import { $, $$, app, chev, ctxJvm, esc, icon, jvmKey, jvmRef, mid, state } from '../app/core.js';
import { baseFor, getStatus, kusmaBlockers, SERVICES } from '../services/config.js';
import { openSettings } from '../app/shell.js';
import { buildContext } from './context.js';
import { startersFor } from './questions.js';
import { runKusma } from '../kusma/harness.js';
import { GROUP_COLOR, GROUP_LABEL, fmtUnit, metricLabel, tms } from '../charts/registry.js';

const key = () => jvmKey(state.selected);
function getChat(k = key()) { return state.chats[k] || (state.chats[k] = { msgs: [], queue: [], running: false, abort: null, draft: { text: '', cards: [] } }); }

/* ---------------- context cards (mockup cardHTML / attachCard; one card at a time) ---------------- */
function sparkSVG(c, w, h) {
  const ys = (c.spark || []).map((p) => (Array.isArray(p) ? p[1] : p?.v) || 0);
  if (ys.length < 2) return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><rect x="2" y="${h / 2 - 2}" width="${w - 4}" height="4" rx="2" fill="${GROUP_COLOR[c.group] || '#9FA1FF'}" opacity=".4"/></svg>`;
  const mn = Math.min(...ys); const mx = Math.max(...ys); const n = ys.length - 1; const step = Math.max(1, Math.floor(ys.length / 60));
  const pts = ys.map((v, i) => (i % step ? null : `${(i / n * (w - 4) + 2).toFixed(1)},${(h - 3 - (v - mn) / (mx - mn || 1) * (h - 8)).toFixed(1)}`)).filter(Boolean).join(' ');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${GROUP_COLOR[c.group] || '#7F81F2'}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}
function cardHTML(c, { removable = false, hist = false, idx = 0 } = {}) {
  const x = removable ? `<button type="button" class="cx" aria-label="Remove attachment" data-rm="${idx}">${icon('x', 'width:12px;height:12px')}</button>` : '';
  const tag = hist ? 'button' : 'div'; const attrs = hist ? `type="button" data-hc="${idx}" aria-label="${c.type === 'reply' ? 'Scroll to the original answer' : 'Show this on the chart'}"` : '';
  if (c.type === 'reply') return `<${tag} class="ccard reply" ${attrs}><div class="cbody"><div class="ck">${icon('reply', 'width:12px;height:12px')}Replying to KUSMA</div><div class="cq">${esc(c.snippet)}</div></div>${x}</${tag}>`;
  return `<${tag} class="ccard chartc" ${attrs}>${sparkSVG(c, hist ? 44 : 64, hist ? 24 : 40)}<div class="cbody"><div class="ck">${icon('chart', 'width:12px;height:12px')}${esc(c.label)}</div>${hist ? `<div class="ct">${esc(c.when || '')}</div>` : `<div class="ct">${esc(c.when || '')}</div><div class="ct det" title="${esc(c.details || '')}">${esc(c.details || '')}</div>`}</div>${x}</${tag}>`;
}
export function attachCard(card) {
  if (!state.selected || !card) return;
  getChat().draft.cards = [card];
  if (!state.chatOpen && innerWidth > 760) openChat(true);
  renderDraftCards(); showCtxPreview();
  const el = $('#draftCards .ccard'); if (el) { el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap'); }
}
function renderDraftCards() { const d = state.selected ? getChat().draft : { cards: [] }; $('#draftCards').innerHTML = d.cards.map((c, i) => cardHTML(c, { removable: true, idx: i })).join(''); }

/* ---------------- context block (decision 4) ---------------- */
function summaryLine() {
  const r = state.report; if (!r) return null;
  const bad = (r.groups || []).filter((g) => g.state === 'critical' || g.state === 'warning');
  return bad.length ? bad.map((g) => `${GROUP_LABEL[g.group] || g.group} ${g.state}: ${metricLabel(g.metric)} ${fmtUnit(g.value, g.unit)}${g.normal != null ? ` (normal ${fmtUnit(g.normal, g.unit)})` : ''}`).join('; ') : 'All subsystems within normal in this window.';
}
export function contextFor(card) {
  // The real window the charts show (timeline/report window), not the "15m"/"1h" label in the range picker.
  let w = state.timeline?.window || state.report?.window || {};
  if (w.from == null || w.to == null) {
    const r = state.range || {}; const m = /^(\d+)(s|m|h|d)$/.exec(r.last || '');
    if (r.from != null && r.to != null) w = { from: r.from, to: r.to };
    else if (m) { const to = Date.now(); w = { from: to - +m[1] * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2]], to, last: r.last }; }
  }
  const chartCard = card && card.type !== 'reply' ? card : null;
  return buildContext({ jvm: ctxJvm(state.selected), range: { from: w.from, to: w.to, last: w.last || (state.range?.last && !state.range?.from ? state.range.last : undefined) }, chart: chartCard ? chartCard.chart : null, selection: chartCard ? chartCard.selection : null,
    summary: summaryLine(), openIncidents: (state.incidents || []).filter((x) => x.status === 'open').map((x) => ({ id: x.id, type: x.type, group: x.group, level: x.level, t0: x.t0, headline: x.headline })), persona: state.persona });
}
function showCtx(ctx, note) {
  const show = state.dev || kusmaBlockers().length > 0;
  $('#ctxDev').hidden = !show || !ctx; if (!ctx) return;
  state.lastContext = ctx; $('#ctxDevPre').textContent = JSON.stringify(ctx, null, 2); $('#ctxDevNote').textContent = note || '';
}
function showCtxPreview() {
  const d = state.selected && getChat().draft; if (!d) return;
  const locked = kusmaBlockers().length > 0;
  if (state.dev || locked) showCtx(contextFor(d.cards[0]), locked ? 'not sent: KUSMA is locked; this is what would be sent' : 'preview: sent with the next question');
}

/* ---------------- messages (mockup msgHTML / renderMsgs / patchMsg) ---------------- */
function msgHTML(m, ci) {
  switch (m.role) {
    case 'day': return `<div class="day">${esc(m.text)}</div>`;
    case 'user': return `<div class="umsg" data-mid="${m.id}">${m.cards?.length ? `<div class="hist-cards">${m.cards.map((c, i) => cardHTML(c, { hist: true, idx: `${ci}:${i}` })).join('')}</div>` : ''}<div class="msg user">${esc(m.text)}</div><span class="persona-tag ${m.persona}"><i></i>${m.persona}</span></div>`;
    case 'think': return `<details class="step think" data-mid="${m.id}" ${m.open ? 'open' : ''}><summary>${m.live ? '<div class="spinner"></div>' : icon('brain', 'width:15px;height:15px')}<span>${m.live ? 'Thinking…' : `Thought for ${m.secs}s`}</span>${chev()}</summary><div class="body-in ${m.live ? 'caret' : ''}">${esc(m.text)}</div>${m.ctx ? `<div class="audit"><div class="audit-k">Context sent to KUSMA</div><pre>${esc(JSON.stringify(m.ctx, null, 2))}</pre></div>` : ''}</details>`;
    case 'tool': return `<details class="step tool" data-mid="${m.id}" ${m.open ? 'open' : ''}><summary>${m.running ? '<div class="spinner"></div>' : icon('tool', 'width:15px;height:15px')}<span class="tname">${esc(m.name)}</span><span class="targs">${esc(m.args)}</span>${m.running ? '' : m.err ? '<span class="ok" style="color:var(--err)" aria-label="failed">!</span>' : '<span class="ok" aria-label="done">✓</span>'}${chev()}</summary><div class="body-in">${m.sent ? `<div class="audit"><div class="audit-k">Request</div><pre>GET ${esc(m.sent.url)}</pre><div class="audit-k">Arguments (model → sent)</div><pre>${esc(JSON.stringify({ model: m.sent.args, sent: m.sent.query }, null, 2))}</pre><div class="audit-k">Context</div><pre>${esc(JSON.stringify(m.sent.context, null, 2))}</pre><div class="audit-k">Result</div></div>` : ''}<pre>${esc(m.result || '…')}</pre></div></details>`;
    case 'reply': return `<div class="msg reply" data-mid="${m.id}"><div class="rtext ${m.live ? 'caret' : ''}">${m.html}</div>${m.live ? '' : `<div class="msg-actions"><button type="button" data-reply="${m.id}">${icon('reply', 'width:12px;height:12px')}Reply</button><button type="button" data-copy="${m.id}">${icon('copy', 'width:12px;height:12px')}Copy</button></div>`}</div>`;
    case 'run': return `<div class="run-head" data-mid="${m.id}">${m.done ? icon(m.text === 'Stopped' ? 'stop' : 'check', 'width:13px;height:13px') : '<div class="spinner"></div>'}<span>${esc(m.text)}</span></div>`;
    default: return '';
  }
}
function renderMsgs() {
  const box = $('#msgs'); const j = state.selected; if (!j) { box.innerHTML = ''; return; }
  const ch = getChat();
  if (!ch.msgs.length) {
    const starters = startersFor(state.persona, state.starters);
    box.innerHTML = `<div class="chat-empty">${icon('sparkle', 'width:28px;height:28px')}<h4>New chat for ${esc(j.pod)}</h4><div>This chat only sees this JVM. Try:</div>${starters.map((s) => `<button type="button" class="starter"${kusmaBlockers().length ? ' disabled aria-disabled="true"' : ''}>${esc(s)}</button>`).join('')}</div>`;
    return;
  }
  box.innerHTML = ch.msgs.map((m, i) => msgHTML(m, i)).join(''); box.scrollTop = box.scrollHeight;
}
function patchMsg(k, m) {
  if (key() !== k) return;
  const el = document.querySelector(`#msgs [data-mid="${m.id}"]`); if (!el) { renderMsgs(); return; }
  const t = document.createElement('div'); t.innerHTML = msgHTML(m, 0); const n = t.firstElementChild; n.classList.add('noanim'); el.replaceWith(n);
  const box = $('#msgs'); box.scrollTop = box.scrollHeight;
}
function mdLite(s) { return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join(''); }
const argText = (a) => { const s = JSON.stringify(a || {}); return s.length > 90 ? `${s.slice(0, 88)}…` : s; };

/* ---------------- composer / queue / run ---------------- */
function autoGrow() { const t = $('#input'); t.style.height = 'auto'; t.style.height = `${Math.min(180, t.scrollHeight)}px`; }
export function setInput(v) { $('#input').value = v; autoGrow(); saveDraft(); }
export function saveDraft() { if (state.selected) getChat().draft.text = $('#input').value; }
export function submit() {
  if (!state.selected || kusmaBlockers().length) return;
  const ch = getChat(); const text = $('#input').value.trim(); if (!text) return;
  const msg = { text, persona: state.persona, cards: ch.draft.cards.slice() };
  ch.draft = { text: '', cards: [] }; $('#input').value = ''; autoGrow(); renderDraftCards();
  sendUser(key(), msg);
}
function sendUser(k, msg) {
  const ch = getChat(k);
  if (ch.running) { ch.queue.push(msg); renderQueue(); return; }
  ch.msgs.push({ id: mid(), role: 'user', ...msg }); if (key() === k) renderMsgs();
  run(k, msg);
}
function renderQueue() {
  const ch = state.selected ? getChat() : { queue: [] };
  $('#queue').hidden = !ch.queue.length; $('#queueTitle').textContent = `Queued (${ch.queue.length})`;
  $('#queueList').innerHTML = ch.queue.map((m, i) => `<li>${m.cards.length ? `<em>${m.cards.length} ctx</em>` : ''}<span title="${esc(m.text)}">${esc(m.text)}</span><button type="button" aria-label="Remove queued message" data-i="${i}">${icon('x', 'width:13px;height:13px')}</button></li>`).join('');
}
async function run(k, msg) {
  const ch = getChat(k); const j = state.selected; ch.running = true; const ac = new AbortController(); ch.abort = ac;
  if (key() === k) renderChatState();
  const card = msg.cards.find((c) => c.type !== 'reply') || null; const reply = msg.cards.find((c) => c.type === 'reply');
  const ctx = contextFor(card); showCtx(ctx, `sent ${new Date().toISOString().slice(11, 19)}Z`);
  const runM = { id: mid(), role: 'run', text: 'KUSMA is investigating…' }; ch.msgs.push(runM); if (key() === k) renderMsgs();
  let think = null; let reply_ = null; const tools = {}; let t0 = Date.now();
  const startThink = () => { if (!think || !think.live) { think = { id: mid(), role: 'think', open: true, live: true, text: '', secs: 0, ctx: ch.msgs.some((x) => x.role === 'think' && x.runId === runM.id) ? null : ctx, runId: runM.id }; t0 = Date.now(); ch.msgs.push(think); renderMsgsIf(k); } return think; };
  const endThink = () => { if (think && think.live) { think.live = false; think.open = false; think.secs = Math.max(1, Math.round((Date.now() - t0) / 1000)); patchMsg(k, think); } };
  const prevUser = [...ch.msgs].reverse().filter((m) => m.role === 'user')[1];
  const lastAns = [...ch.msgs].reverse().find((m) => m.role === 'reply' && !m.live);
  try {
    await runKusma({
      urls: { analyzer: baseFor('analyzer'), laya: baseFor('laya'), jafraz: baseFor('jafraz') }, jvm: jvmRef(j), message: msg.text, context: ctx, persona: msg.persona,
      previous: prevUser ? prevUser.text : 'none', lastAnswer: reply ? reply.snippet : lastAns ? lastAns.text : 'none', signal: ac.signal,
      onEvent: (name, p) => {
        if (name === 'route' && p.route !== 'jafra_z') { endThink(); }
        else if (name === 'thought_delta') { const t = startThink(); t.text += p.text; patchMsg(k, t); }
        else if (name === 'thought') { /* already streamed */ }
        else if (name === 'tool_call') {
          endThink();
          if (reply_ && reply_.live && reply_.text) { reply_.live = false; ch.msgs.splice(ch.msgs.indexOf(reply_), 1); const n = { id: mid(), role: 'think', open: false, live: false, text: reply_.text, secs: 0 }; ch.msgs.splice(ch.msgs.length, 0, n); reply_ = null; renderMsgsIf(k); }
          if (p.phase === 'start') { const m = { id: mid(), role: 'tool', name: p.name, args: argText(p.query || p.args), running: true, result: '', sent: p.sent || null }; tools[p.id] = m; ch.msgs.push(m); renderMsgsIf(k); }
          else { const m = tools[p.id]; if (m) { m.running = false; m.err = !!p.result?.error; m.result = JSON.stringify(p.result, null, 1).slice(0, 6000); patchMsg(k, m); } }
        } else if (name === 'answer_delta') {
          endThink();
          if (!reply_) { reply_ = { id: mid(), role: 'reply', live: true, text: '', html: '' }; ch.msgs.push(reply_); renderMsgsIf(k); }
          reply_.text += p.text; reply_.html = mdLite(reply_.text); patchMsg(k, reply_);
        }
      },
    });
    endThink(); if (reply_) { reply_.live = false; patchMsg(k, reply_); }
    runM.text = 'Done'; runM.done = true;
  } catch (e) {
    endThink(); if (reply_) { reply_.live = false; patchMsg(k, reply_); }
    Object.values(tools).forEach((m) => { if (m.running) { m.running = false; m.err = true; m.result = 'stopped'; patchMsg(k, m); } });
    if (e.name === 'AbortError') { runM.text = 'Stopped'; runM.done = true; }
    else { runM.text = 'Stopped'; runM.done = true; ch.msgs.push({ id: mid(), role: 'reply', text: e.message, html: `<p><b>KUSMA could not answer.</b> ${esc(e.message)}</p>` }); }
  }
  patchMsg(k, runM); renderMsgsIf(k);
  // mockup finish(): "Done" shows for 600 ms and is removed; "Stopped" stays in the thread.
  if (runM.text === 'Done') setTimeout(() => { const i = ch.msgs.indexOf(runM); if (i >= 0) { ch.msgs.splice(i, 1); renderMsgsIf(k); } }, 600);
  ch.running = false; ch.abort = null; if (key() === k) renderChatState();
  const next = ch.queue.shift(); if (key() === k) renderQueue();
  if (next && !kusmaBlockers().length) sendUser(k, next);
}
function renderMsgsIf(k) { if (key() === k) renderMsgs(); }

/* ---------------- state: KUSMA lock (needs Analyzer + Laya + Jafra Z) ---------------- */
export function renderChatState() {
  const b = $('#chatBanner'); const blockers = kusmaBlockers(); const locked = blockers.length > 0;
  const needLJ = blockers.some((x) => x.id !== 'analyzer');
  const running = state.selected && getChat().running;
  document.body.dataset.kusma = locked ? 'locked' : 'ready';
  if (locked) {
    const all = SERVICES.filter((s) => s.id !== 'analyzer' || blockers.some((x) => x.id === 'analyzer'));
    const word = (st) => (st === 'unset' ? 'not configured' : st === 'unhealthy' ? 'unreachable' : st === 'checking' ? 'checking…' : 'healthy');
    b.innerHTML = `<div class="chat-banner kusma-lock" role="status">${icon('alert', 'color:var(--err)')}<div><h4>${needLJ ? 'KUSMA needs Analyzer, Laya and Jafra Z' : 'KUSMA needs the Analyzer'}</h4>
      <ul>${all.map((s) => { const st = getStatus(s.id); return `<li><i class="dot" data-state="${{ unset: 'unset', checking: 'connecting', healthy: 'connected', unhealthy: 'down' }[st.state]}"></i><b class="brand">${s.label}</b> <span>${word(st.state)}</span>${st.state === 'unhealthy' && st.error ? ` <em>${esc(st.error)}</em>` : ''}</li>`; }).join('')}</ul>
      <p class="muted">Charts and incidents still work with the Analyzer alone.</p><button type="button" class="btn sm" data-open-settings>Open settings</button></div></div>`;
  } else b.innerHTML = '';
  $('#chat').classList.toggle('unavailable', locked);
  $('#input').disabled = locked; $('#sendBtn').disabled = locked;
  $('#input').placeholder = locked ? (needLJ ? 'Configure Analyzer, Laya and Jafra Z in Settings to ask KUSMA' : 'Configure the Analyzer in Settings to ask Kusma') : running ? 'KUSMA is working… new messages go to the queue' : 'Ask KUSMA about this workload…';
  $('#stopBtn').hidden = !running;
  $('#composerHint').textContent = locked ? 'KUSMA is locked' : running ? 'Running · Enter adds to queue' : 'Enter to send · Shift+Enter new line';
  $$('#msgs .starter').forEach((s) => { s.disabled = locked; });
  showCtxPreview();
}
export function openChat(open) {
  state.chatOpen = open; $('#chatWrap').hidden = !open; $('#askBtn').setAttribute('aria-pressed', open);
  document.body.classList.toggle('sheet-open', open && innerWidth <= 760);
  setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
}
export function renderChat() {
  const j = state.selected; $('#ctxText').textContent = j ? `${j.pod} / ${j.container}` : 'no workload';
  $('#input').value = j ? getChat().draft.text : ''; autoGrow();
  renderMsgs(); renderDraftCards(); renderQueue(); renderChatState();
}

export function wireChat() {
  Object.assign(app, { attachCard, openChat, setInput, submit, saveDraft, renderChat, renderChatState });
  $('#draftCards').onclick = (e) => { const b = e.target.closest('[data-rm]'); if (b) { getChat().draft.cards.splice(+b.dataset.rm, 1); renderDraftCards(); showCtxPreview(); } };
  $('#msgs').addEventListener('toggle', (e) => { const d = e.target.closest('details[data-mid]'); if (!d || !state.selected) return; const m = getChat().msgs.find((x) => x.id === d.dataset.mid); if (m) m.open = d.open; }, true);
  $('#msgs').onclick = (e) => {
    if (!state.selected) return; const ch = getChat();
    const st = e.target.closest('.starter'); if (st) { if (kusmaBlockers().length) return; ch.draft.cards = []; renderDraftCards(); setInput(st.textContent); $('#input').focus(); return; }
    const r = e.target.closest('[data-reply]'); if (r) { const m = ch.msgs.find((x) => x.id === r.dataset.reply); attachCard({ type: 'reply', key: `reply:${m.id}`, msgId: m.id, snippet: m.text.length > 140 ? `${m.text.slice(0, 138)}…` : m.text }); $('#input').focus(); return; }
    const cp = e.target.closest('[data-copy]'); if (cp) { const m = ch.msgs.find((x) => x.id === cp.dataset.copy); navigator.clipboard?.writeText(m.text).catch(() => {}); cp.lastChild.textContent = 'Copied'; return; }
    const hc = e.target.closest('[data-hc]'); if (hc) { const [mi, ci] = hc.dataset.hc.split(':').map(Number); const c = ch.msgs[mi].cards[ci];
      if (c.type === 'reply') { const el = document.querySelector(`#msgs [data-mid="${c.msgId}"]`); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      else if (c.selection?.kind === 'incident') app.openIncident?.(c.selection.id); }
  };
  const checkSel = () => { const b = $('#selAsk'); const s = getSelection(); if (!s || s.isCollapsed || !s.rangeCount) { b.hidden = true; return; }
    const node = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement); const rep = node && node.closest('.msg.reply'); const txt = s.toString().trim();
    if (!rep || !txt) { b.hidden = true; return; } const rr = s.getRangeAt(0).getBoundingClientRect(); const cr = $('#chat').getBoundingClientRect();
    b.hidden = false; b.style.left = `${Math.max(8, Math.min(cr.width - 140, rr.left - cr.left + rr.width / 2 - 60))}px`; b.style.top = `${rr.top - cr.top - 38}px`; b.dataset.mid = rep.dataset.mid; b.dataset.txt = txt; };
  $('#msgs').addEventListener('mouseup', () => setTimeout(checkSel, 0));
  $('#selAsk').onclick = () => { const b = $('#selAsk'); attachCard({ type: 'reply', key: `reply:${b.dataset.mid}`, msgId: b.dataset.mid, snippet: b.dataset.txt.slice(0, 140) }); b.hidden = true; getSelection().removeAllRanges(); $('#input').focus(); };
  $('#input').addEventListener('input', () => { autoGrow(); saveDraft(); });
  $('#input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
  $('#composer').onsubmit = (e) => { e.preventDefault(); submit(); };
  $('#stopBtn').onclick = () => { const ch = getChat(); ch.queue = []; renderQueue(); ch.abort?.abort(); };
  $('#queueList').onclick = (e) => { const b = e.target.closest('button'); if (b) { getChat().queue.splice(+b.dataset.i, 1); renderQueue(); } };
  const setP = (p) => { state.persona = p; localStorage.setItem('jz.persona', p); document.body.dataset.persona = p; $$('#persona [data-p]').forEach((x) => x.setAttribute('aria-checked', x.dataset.p === p)); app.onPersonaChange?.(); renderMsgs(); };
  setP(state.persona);
  $('#persona').onclick = (e) => { const b = e.target.closest('[data-p]'); if (b) setP(b.dataset.p); };
  $('#askBtn').onclick = () => openChat(!state.chatOpen);
  $('#closeChat').onclick = () => openChat(false);
  $('#ctxDevClose').onclick = () => { state.dev = false; localStorage.setItem('jz.ctxdev', 'off'); $('#ctxDev').hidden = true; syncDevSeg(); };
  $('#ctxDevCopy').onclick = () => navigator.clipboard?.writeText($('#ctxDevPre').textContent).catch(() => {});
  const syncDevSeg = () => $$('#devSeg button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === (state.dev ? 'on' : 'off')));
  syncDevSeg();
  $('#devSeg').onclick = (e) => { const v = e.target.dataset.v; if (!v) return; state.dev = v === 'on'; localStorage.setItem('jz.ctxdev', v); syncDevSeg(); if (state.dev) showCtxPreview(); else if (!kusmaBlockers().length) $('#ctxDev').hidden = true; };
  const h = $('#resizer'); let sx; let sw;
  const move = (x) => { const w = Math.max(360, Math.min(innerWidth * 0.6, sw + (sx - x))); document.documentElement.style.setProperty('--chat-w', `${w}px`); window.dispatchEvent(new Event('resize')); };
  h.addEventListener('pointerdown', (e) => { sx = e.clientX; sw = $('#chatWrap').offsetWidth; h.classList.add('dragging'); h.setPointerCapture(e.pointerId); h.onpointermove = (ev) => move(ev.clientX); });
  h.addEventListener('pointerup', () => { h.classList.remove('dragging'); h.onpointermove = null; });
  openChat(state.chatOpen);
  void openSettings; void tms;
}
