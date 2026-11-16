/* Frankenstein Annotated — watch with pause-at-annotation, notes, quiz, cards, overview, progress. */
'use strict';
const FK = window.FK;
const A = FK.ann;                        // sorted by t
const byId = new Map(A.map((a) => [a.id, a]));
const SECS = [...new Set(A.map((a) => a.sec))];
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (t) => { t = Math.max(0, Math.floor(t)); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60; return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; };
const short = (sec) => sec.replace('Chapter ', 'Ch. ');
const LT_SET = new Set(['World', 'History', 'Science', 'Grammar', 'Language', 'Psych', 'Ethics', 'Literature', 'Art']);
const LT_NAME = { Psych: 'Psychology' };
const ic = (id) => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;
const ICON = (lt) => ic(LT_SET.has(lt) ? 'c-' + lt : 'c-World');
const ROMAN = (n) => [['X', 10], ['IX', 9], ['V', 5], ['IV', 4], ['I', 1]].reduce((s, [r, v]) => { while (n >= v) { s += r; n -= v; } return s; }, '');
const secMark = (s) => s.startsWith('Letter') ? 'L' + s.split(' ')[1] : ROMAN(+s.split(' ')[1]);

/* ---------- storage: everything stays in this browser (works even if storage is blocked) ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem('fk.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('fk.' + k, JSON.stringify(v)); } catch {} },
};
const written = new Set(store.get('written', []));
const saveWritten = () => store.set('written', [...written]);
const settings = Object.assign({ autopause: true, skipDone: false, nudge: 0, speed: 1 }, store.get('settings', {}));
const saveSettings = () => store.set('settings', settings);
let qStats = store.get('qstats', {});      // qi -> [right, wrong]
let qHist = store.get('qhist', []);
let cardKnown = new Set(store.get('cards', []));

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 2600); }

/* ---------- save links: all progress packed into one string, so it moves between devices with no server ----------
   Format: "FK1" + "z" (deflate-raw) or "j" (plain JSON) + base64url. Nothing is sent anywhere; the link's #fragment
   never leaves the browser. */
const Save = {
  b64(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  unb64(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); },
  async pipe(bytes, Stream) { const st = new Blob([bytes]).stream().pipeThrough(new Stream('deflate-raw')); return new Uint8Array(await new Response(st).arrayBuffer()); },
  ranges(ids) {
    const out = [];
    for (const n of [...ids].map(Number).filter(Number.isInteger).sort((a, b) => a - b)) {
      const last = out[out.length - 1];
      if (last && last[1] === n - 1) last[1] = n; else if (!last || last[1] !== n) out.push([n, n]);
    }
    return out.map(([a, b]) => (a === b ? a : [a, b]));
  },
  unranges(r) {
    const out = [];
    for (const x of Array.isArray(r) ? r : []) {
      if (Array.isArray(x)) { for (let n = +x[0]; n <= +x[1] && out.length < 2000; n++) out.push(n); } else out.push(+x);
    }
    return out;
  },
  snapshot() {
    return {
      v: 1,
      p: Math.round(now()),
      w: this.ranges(written),
      c: this.ranges(cardKnown),
      s: [settings.autopause ? 1 : 0, settings.skipDone ? 1 : 0, settings.nudge, settings.speed],
      q: Object.entries(qStats).map(([i, [r, w]]) => [+i, r, w]),
      h: qHist.slice(-30).map((h) => [Math.round((h.d || 0) / 864e5), h.r, h.n]),
      k: QSECS.map((s, i) => (Q.pick.has(s) ? i : -1)).filter((i) => i >= 0),
    };
  },
  async encode() {
    const json = new TextEncoder().encode(JSON.stringify(this.snapshot()));
    if (window.CompressionStream) { try { return 'FK1z' + this.b64(await this.pipe(json, CompressionStream)); } catch {} }
    return 'FK1j' + this.b64(json);
  },
  async decode(text) {
    const m = String(text || '').replace(/\s+/g, '').match(/FK1[zj][A-Za-z0-9_-]+/);
    if (!m) throw new Error('shape');
    const bytes = this.unb64(m[0].slice(4));
    const raw = m[0][3] === 'z' ? await this.pipe(bytes, DecompressionStream) : bytes;
    const o = JSON.parse(new TextDecoder().decode(raw));
    if (!o || o.v !== 1) throw new Error('version');
    return o;
  },
  apply(o) {
    const ids = new Set(A.map((a) => a.id));
    const s = Array.isArray(o.s) ? o.s : [];
    const qs = {};
    for (const e of Array.isArray(o.q) ? o.q : []) if (Array.isArray(e) && QZ[e[0]]) qs[e[0]] = [Math.max(0, e[1] | 0), Math.max(0, e[2] | 0)];
    store.set('written', this.unranges(o.w).filter((id) => ids.has(id)));
    store.set('cards', this.unranges(o.c).filter((id) => ids.has(id)));
    store.set('pos', Math.max(0, Math.min(FK.duration, +o.p || 0)));
    store.set('settings', { autopause: s[0] !== 0, skipDone: s[1] === 1, nudge: Math.max(-10, Math.min(10, +s[2] || 0)), speed: [0.75, 1, 1.25, 1.5, 1.75, 2].includes(+s[3]) ? +s[3] : 1 });
    store.set('qstats', qs);
    store.set('qhist', (Array.isArray(o.h) ? o.h : []).filter(Array.isArray).map(([d, r, n]) => ({ d: (d | 0) * 864e5, r: Math.max(0, r | 0), n: Math.max(1, n | 0) })));
    if (Array.isArray(o.k)) store.set('qsecs', o.k.map((i) => QSECS[i]).filter(Boolean));
    store.set('loaded', 1);
  },
  describe(o) {
    const w = this.unranges(o.w).length, h = Array.isArray(o.h) ? o.h.length : 0;
    return `${w} of ${A.length} notes written, ${fmt(+o.p || 0)} into the audiobook${h ? `, ${h} quiz${h === 1 ? '' : 'zes'} taken` : ''}`;
  },
  link(code) { return location.origin + location.pathname + '#save=' + code; },
};
function hasProgress() { return written.size > 0 || qHist.length > 0 || cardKnown.size > 0 || store.get('pos', 0) > 60; }
function loadNow(o) { Save.apply(o); history.replaceState(null, '', location.pathname + location.search); location.reload(); }

/* the Save progress dialog */
const dlg = $('#saveDlg');
const saveMsg = (text, bad) => { const m = $('#saveMsg'); m.textContent = text; m.classList.toggle('bad', !!bad); };
async function openSave() {
  saveMsg(''); $('#saveIn').value = ''; $('#saveConfirm').hidden = true; $('#saveLoadMsg').textContent = '';
  $('#saveNow').textContent = 'This link holds: ' + Save.describe(Save.snapshot()) + '.';
  $('#saveLink').value = 'Making your link…';
  if (W.ready && W.playing) W.player.pauseVideo();
  dlg.showModal();
  $('#saveLink').value = Save.link(await Save.encode());
}
$('#saveBtn').onclick = openSave;
$('#saveCopy').onclick = async () => {
  const el = $('#saveLink');
  try { await navigator.clipboard.writeText(el.value); saveMsg('Copied. Paste it somewhere you can reach from your other device, such as a message or note to yourself.'); }
  catch { el.focus(); el.select(); saveMsg('Your link is selected. Copy it with Ctrl+C, or press and hold, then tap Copy.'); }
};
if (navigator.share) {
  $('#saveShare').hidden = false;
  $('#saveShare').onclick = () => navigator.share({ title: 'My Frankenstein progress', text: 'Open this link to continue where I left off:', url: $('#saveLink').value }).catch(() => {});
}
$('#saveLink').addEventListener('focus', (e) => e.target.select());
$('#saveLoad').onclick = async () => {
  const box = $('#saveConfirm'), msg = $('#saveLoadMsg');
  box.hidden = true; msg.textContent = '';
  let o;
  try { o = await Save.decode($('#saveIn').value); }
  catch { msg.textContent = "That isn't a complete save link. Copy the whole link (it starts with https:// and is quite long) and paste it again."; return; }
  box.innerHTML = `<p>Found: <b>${esc(Save.describe(o))}</b>.${hasProgress() ? ' Loading it replaces the progress on this device.' : ''}</p><button class="btn primary" id="saveDoLoad">Load this progress</button>`;
  box.hidden = false;
  $('#saveDoLoad').onclick = () => loadNow(o);
};
$('#saveIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#saveLoad').click(); } });
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

/* opening a save link: load it, asking first if this device already has progress */
async function loadFromHash() {
  const m = location.hash.match(/^#save=(.+)$/);
  if (!m) return;
  let o;
  try { o = await Save.decode(m[1]); }
  catch { history.replaceState(null, '', location.pathname + location.search); toast('That save link is incomplete. Copy the whole link and try again.'); return; }
  if (!hasProgress()) return loadNow(o);
  const box = $('#resume');
  box.innerHTML = `<span>This save link has <b>${esc(Save.describe(o))}</b>. Load it? It replaces what's on this device now (${esc(Save.describe(Save.snapshot()))}).</span>
    <button class="btn primary" data-load>Load saved progress</button><button class="btn" data-keep>Keep this device's</button>`;
  box.hidden = false;
  box.querySelector('[data-load]').onclick = () => loadNow(o);
  box.querySelector('[data-keep]').onclick = () => { box.hidden = true; history.replaceState(null, '', location.pathname + location.search); };
}
addEventListener('hashchange', loadFromHash);
function welcome() {
  if (store.get('loaded', 0)) { store.set('loaded', 0); store.set('welcomed', 1); toast('Your saved progress is loaded.'); return; }
  if (store.get('welcomed', 0) || hasProgress() || location.hash.startsWith('#save=')) return;
  const box = $('#resume');
  box.innerHTML = `<span><b>How it works:</b> press Play. The audiobook stops at each of the 312 notes so you can underline and write them in your copy, then press “I wrote it, continue”. Your progress saves in this browser by itself. To carry on from a different phone or computer, use <b>Save progress</b> at the top.</span>
    <button class="btn primary" data-ok>Got it</button>`;
  box.hidden = false;
  box.querySelector('[data-ok]').onclick = () => { box.hidden = true; store.set('welcomed', 1); };
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && W.ready) store.set('pos', now()); });

/* ---------- tabs ---------- */
function showTab(name) {
  $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $$('.tab').forEach((t) => t.classList.toggle('on', t.id === 'tab-' + name));
  if (name === 'notes') renderNotes();
  if (name === 'progress') renderProgress();
  if (name === 'cards') renderCard();
  store.set('tab', name);
  if (name !== 'watch' && W.player && W.playing) W.player.pauseVideo();
}
$$('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

/* =====================================================================
   WATCH
   ===================================================================== */
const W = { player: null, ready: false, started: false, base: null, playing: false, lastT: 0, active: null, timer: null, lastSave: 0, pendingSeek: null };
const pauseAt = (a) => a.t + settings.nudge;

window.onYouTubeIframeAPIReady = function () {
  W.player = new YT.Player('player', {
    videoId: FK.video,
    playerVars: { rel: 0, modestbranding: 1, playsinline: 1, start: Math.floor(store.get('pos', 0)) },
    events: {
      onReady() {
        W.ready = true;
        W.lastT = W.base = store.get('pos', 0);
        W.player.setPlaybackRate(settings.speed);
        if (W.pendingSeek != null) { seek(W.pendingSeek.t, W.pendingSeek.play); W.pendingSeek = null; }
        W.timer = setInterval(tick, 200);
        tick(true);
      },
      onStateChange(e) {
        W.playing = e.data === YT.PlayerState.PLAYING;
        if (e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.BUFFERING) W.started = true;
        $('#bPlay').innerHTML = W.playing ? `${ic('i-pause')}<span>Pause</span>` : `${ic('i-play')}<span>Play</span>`;
        if (W.playing && W.active) { W.active = null; renderCard_(); }
      },
    },
  });
};

// Before the first Play, YouTube reports 0:00, so keep our own position until playback has started.
function now() { return W.ready && W.started && W.player.getCurrentTime ? W.player.getCurrentTime() || 0 : W.base != null ? W.base : store.get('pos', 0); }
function play() { if (!W.started) W.player.seekTo(W.base || 0, true); W.player.playVideo(); }
function seek(t, play) {
  if (!W.ready) { W.pendingSeek = { t, play }; return; }
  t = Math.max(0, t); W.lastT = t;
  if (!W.started) { W.base = t; if (play) { W.player.seekTo(t, true); W.player.playVideo(); } }
  else { W.player.seekTo(t, true); if (play) W.player.playVideo(); }
  W.active = null; tick(true);
}
function nextStopAfter(t) { return A.find((a) => pauseAt(a) > t + 0.05); }
function stopAt(t) { let cur = null; for (const a of A) { if (a.start <= t + 0.5) cur = a; else break; } return cur; }

function tick(force) {
  const t = now();
  const wallNow = performance.now(), wall = W.lastWall ? (wallNow - W.lastWall) / 1000 : 0.2;
  W.lastWall = wallNow;
  if (W.playing && settings.autopause && !W.active) {
    const dt = t - W.lastT;
    // Normal playback moves at most (real seconds passed x speed). Background tabs only check every
    // few seconds or once a minute, so allow for that; a bigger jump means the person dragged the
    // YouTube scrubber on purpose, which skips stops by design.
    const rate = W.ready && W.player.getPlaybackRate ? W.player.getPlaybackRate() || 1 : 1;
    if (dt > 0 && dt <= wall * rate * 1.25 + 3) {
      const hit = A.find((a) => pauseAt(a) > W.lastT && pauseAt(a) <= t && !(settings.skipDone && written.has(a.id)));
      if (hit) {
        W.player.pauseVideo();
        W.active = hit;
        // a slow check can land well past the stop: go back to it so nothing is missed
        if (t - pauseAt(hit) > 1.5) W.player.seekTo(pauseAt(hit), true);
        W.lastT = Math.min(t, pauseAt(hit));
        renderCard_();
        if (innerWidth <= 1060 && !document.fullscreenElement) $('#panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }
  }
  W.lastT = t;
  if (Date.now() - W.lastSave > 3000) { store.set('pos', t); W.lastSave = Date.now(); }
  // UI
  $('#clock').textContent = fmt(t);
  const pct = (t / FK.duration) * 100;
  $('#tlHead').style.left = pct + '%';
  const cur = stopAt(t);
  const secNow = cur ? cur.sec : 'Letter 1';
  $('#whereAmI').textContent = secNow;
  if (secNow !== W.secNow) { W.secNow = secNow; $$('#tlChapters span').forEach((el) => el.classList.toggle('cur', el.dataset.sec === secNow)); }
  $('#tlHead').classList.toggle('set', !!W.active);
  const nx = nextStopAfter(t);
  $('#nextIn').textContent = nx ? `Next note, #${nx.id}, in ${fmt((pauseAt(nx) - t) / (W.ready ? W.player.getPlaybackRate() : 1)).replace(/^0:/, '')}` : '';
  if (force || !W.active) {
    const key = W.active ? 'a' + W.active.id : 'u' + (nx ? nx.id : 0);
    if (key !== W.cardKey || force) renderCard_();
  }
}

function cardHTML(a, mode) {
  const done = written.has(a.id);
  const lt = LT_NAME[a.lt] || a.lt;
  const head = (status) => `<div class="card-head"><span class="num" aria-label="Annotation ${a.id}">${a.id}</span><span class="where">${esc(a.sec)} · ¶${a.p[0]}–${a.p[1]}</span>${status}<span class="tag">${esc(a.tag)}</span></div>`;
  if (mode === 'upcoming') {
    return `<div class="card upcoming">
      ${head('<span class="status">Up next</span>')}
      <div class="lbl">Keep listening</div>
      <p class="explain">The video stops at <b>${fmt(pauseAt(a))}</b>, after the passage ending “${esc(a.to.replace(/^… /, ''))}”</p>
      <p class="peek">${done ? `${ic('i-check')} Already written in your book.` : `${ic('i-pen')} Have your pen ready.`}</p>
    </div>`;
  }
  const status = mode === 'live' ? `<span class="status paused">${ic('i-pen')}Pen down</span>` : done ? `<span class="status ok">${ic('i-check')}Written</span>` : '';
  return `<div class="card ${mode === 'live' ? 'live' : ''}">
    ${head(status)}
    <div class="lbl">Underline</div>
    <p class="quote">“<mark>${esc(a.q)}</mark>”</p>
    <p class="find">Passage begins “${esc(a.from)}”</p>
    <div class="lbl">Write in the margin</div>
    <p class="margin-note">${esc(a.m)}</p>
    <div class="lbl">In the book</div>
    <p class="explain">${esc(a.b)}</p>
    <div class="link-box"><div class="lbl">${ICON(a.lt)}Beyond the book · ${esc(lt)}</div><p class="explain">${esc(a.l)}</p></div>
    <div class="card-actions">
      <button class="btn primary" data-act="done">${ic('i-check')}<span>${done ? 'Written, continue' : 'I wrote it, continue'}</span> <kbd>Enter</kbd></button>
      <button class="btn" data-act="replay" title="Replay this passage (R)">${ic('i-replay')}<span>Replay</span></button>
      <button class="btn" data-act="skip">${ic('i-skip')}<span>Skip</span></button>
    </div>
  </div>`;
}
function renderCard_() {
  const t = now();
  const a = W.active || nextStopAfter(t);
  W.cardKey = W.active ? 'a' + W.active.id : 'u' + (a ? a.id : 0);
  const html = a ? cardHTML(a, W.active ? 'live' : 'upcoming') : '<div class="card"><div class="lbl">Finis</div><p class="quote">The last annotation is behind you.</p><p class="explain" style="margin-top:10px">Test yourself in the Quiz and Cards tabs, or read the Overview before an essay.</p></div>';
  $('#card').innerHTML = html;
  $('#fsCard').innerHTML = W.active ? html : '';
  $('#fsCard').hidden = !W.active;
  markTicks();
}
function onCardAct(act) {
  const a = W.active;
  if (!a && act !== 'replay') return;
  if (act === 'done') { written.add(a.id); saveWritten(); W.active = null; W.lastT = now(); play(); }
  if (act === 'skip') { W.active = null; W.lastT = now(); play(); }
  if (act === 'replay') { const s = a || stopAt(now()); if (s) seek(s.start, true); }
  renderCard_();
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b && (b.closest('#card') || b.closest('#fsCard'))) onCardAct(b.dataset.act);
});

/* timeline */
function buildTimeline() {
  const ch = $('#tlChapters');
  SECS.forEach((s) => {
    const first = A.find((a) => a.sec === s), last = [...A].reverse().find((a) => a.sec === s);
    const end = A[A.indexOf(last) + 1] ? A[A.indexOf(last) + 1].start : FK.duration;
    const el = document.createElement('span');
    el.style.left = (first.start / FK.duration) * 100 + '%';
    el.style.width = ((end - first.start) / FK.duration) * 100 + '%';
    el.title = s; el.dataset.sec = s;
    el.innerHTML = `<b>${secMark(s)}</b>`;
    ch.append(el);
  });
  const fitMarks = () => $$('#tlChapters b').forEach((b) => (b.style.visibility = b.offsetWidth + 7 > b.parentElement.offsetWidth ? 'hidden' : ''));
  requestAnimationFrame(fitMarks); addEventListener('resize', fitMarks);
  $('#tlTicks').innerHTML = A.map((a) => `<i data-id="${a.id}" style="left:${(a.t / FK.duration) * 100}%"></i>`).join('');
  $('#timeline').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width) * FK.duration;
    // snap to a nearby annotation's passage start if the click is close to a tick
    const near = A.reduce((best, a) => (Math.abs(a.t - t) < Math.abs(best.t - t) ? a : best), A[0]);
    const px = (Math.abs(near.t - t) / FK.duration) * r.width;
    seek(px < 6 ? near.start : t, W.playing);
  });
  $('#timeline').addEventListener('mousemove', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width) * FK.duration;
    const s = stopAt(t);
    e.currentTarget.title = `${fmt(t)} · ${s ? s.sec : ''}`;
  });
  const sel = $('#chapterJump');
  sel.innerHTML = '<option value="">Chapter…</option>' + SECS.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  sel.addEventListener('change', () => {
    const f = A.find((a) => a.sec === sel.value);
    if (f) seek(Math.max(0, f.start - 2), true);
    sel.value = '';
  });
}
function markTicks() {
  const cur = W.active ? W.active.id : null;
  $$('#tlTicks i').forEach((i) => { const id = +i.dataset.id; i.className = (written.has(id) ? 'done' : '') + (id === cur ? ' cur' : ''); });
}

/* controls */
$('#bPlay').onclick = () => { if (!W.ready) return; if (W.playing) W.player.pauseVideo(); else { W.active = null; W.lastT = now(); play(); } };
$('#bBack').onclick = () => seek(now() - 10, W.playing);
$('#bFwd').onclick = () => seek(now() + 10, W.playing);
$('#bNextStop').onclick = () => { const t = now(); const n = A.find((a) => a.start > t + 1); if (n) seek(n.start, true); };
$('#bPrevStop').onclick = () => { const t = now(); const c = stopAt(t); const i = c ? A.indexOf(c) : 0; const p = c && t - c.start > 8 ? c : A[Math.max(0, i - 1)]; seek(p.start, true); };
function syncSettingsUI() {
  $('#speed').value = String(settings.speed);
  $('#optPause').checked = settings.autopause;
  $('#optSkipDone').checked = settings.skipDone;
  showNudge();
  if (W.ready) W.player.setPlaybackRate(settings.speed);
}
$('#speed').value = String(settings.speed);
$('#speed').onchange = (e) => { settings.speed = +e.target.value; saveSettings(); if (W.ready) W.player.setPlaybackRate(settings.speed); };
$('#bFs').onclick = toggleFs;
function toggleFs() {
  const st = $('#stage');
  if (document.fullscreenElement) document.exitFullscreen();
  else if (st.requestFullscreen) st.requestFullscreen().catch(() => toast('Fullscreen not available here'));
  else if (st.webkitRequestFullscreen) st.webkitRequestFullscreen();
}
$('#optPause').checked = settings.autopause;
$('#optSkipDone').checked = settings.skipDone;
$('#optPause').onchange = (e) => { settings.autopause = e.target.checked; saveSettings(); };
$('#optSkipDone').onchange = (e) => { settings.skipDone = e.target.checked; saveSettings(); };
const showNudge = () => ($('#nudgeVal').textContent = (settings.nudge > 0 ? '+' : '') + settings.nudge + 's');
showNudge();
$$('[data-nudge]').forEach((b) => (b.onclick = () => { settings.nudge = Math.max(-10, Math.min(10, settings.nudge + +b.dataset.nudge)); saveSettings(); showNudge(); toast(settings.nudge < 0 ? `Pausing ${-settings.nudge}s earlier` : settings.nudge > 0 ? `Pausing ${settings.nudge}s later` : 'Pausing right at the end of each passage'); }));

document.addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input,select,textarea')) return;
  const tab = $('.tab.on').id;
  if (tab === 'tab-watch') {
    const k = e.key;
    if (k === ' ') { e.preventDefault(); $('#bPlay').click(); }
    else if (k === 'Enter' && W.active) { e.preventDefault(); onCardAct('done'); }
    else if (k === 'ArrowLeft') $('#bBack').click();
    else if (k === 'ArrowRight') $('#bFwd').click();
    else if (k === 'n' || k === 'N') $('#bNextStop').click();
    else if (k === 'p' || k === 'P') $('#bPrevStop').click();
    else if (k === 'r' || k === 'R') onCardAct('replay');
    else if (k === 'f' || k === 'F') toggleFs();
  } else if (tab === 'tab-cards') {
    if (e.key === ' ') { e.preventDefault(); flip(); }
    else if (e.key === '1') cardAnswer(false);
    else if (e.key === '2') cardAnswer(true);
  } else if (tab === 'tab-quiz' && Q.run) {
    if (/^[1-4]$/.test(e.key)) { const b = $$('.opt')[+e.key - 1]; if (b && !b.disabled) b.click(); }
    else if (e.key === 'Enter') { const n = $('#qNext'); if (n) n.click(); }
  }
});
window.addEventListener('beforeunload', () => store.set('pos', now()));

/* =====================================================================
   ANNOTATIONS LIST
   ===================================================================== */
function fillSelects() {
  const opts = SECS.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  $('#noteSec').insertAdjacentHTML('beforeend', opts);
  $('#cardSec').insertAdjacentHTML('beforeend', opts);
  const lts = [...new Set(A.map((a) => a.lt))].sort();
  $('#noteLt').insertAdjacentHTML('beforeend', lts.map((l) => `<option value="${l}">${LT_NAME[l] || l}</option>`).join(''));
}
function renderNotes() {
  const q = $('#noteSearch').value.trim().toLowerCase();
  const sec = $('#noteSec').value, lt = $('#noteLt').value, dn = $('#noteDone').value;
  const list = A.filter((a) => (!sec || a.sec === sec) && (!lt || a.lt === lt) && (!dn || (dn === 'done') === written.has(a.id)) &&
    (!q || [a.q, a.m, a.b, a.l, a.tag, a.lt, a.sec].join(' ').toLowerCase().includes(q)));
  $('#noteCount').textContent = `${list.length} annotation${list.length === 1 ? '' : 's'} · ${written.size} of ${A.length} written in your book`;
  let html = '', lastSec = '';
  for (const a of list) {
    if (a.sec !== lastSec) {
      const all = A.filter((x) => x.sec === a.sec);
      html += `<h3 class="sec-h">${esc(a.sec)} <small>${all.filter((x) => written.has(x.id)).length}/${all.length} written</small></h3>`;
      lastSec = a.sec;
    }
    html += `<div class="note ${written.has(a.id) ? 'done' : ''}">
      <input type="checkbox" data-w="${a.id}" ${written.has(a.id) ? 'checked' : ''} title="Written in my book" aria-label="Annotation ${a.id} written in my book">
      <div><div class="n-q">“${esc(a.q)}”</div><div class="n-m">${esc(a.m)}</div>
        <div class="n-meta"><span>#${a.id}</span><span>¶${a.p[0]}–${a.p[1]}</span><span>${esc(a.tag)}</span><span>${ICON(a.lt)}${esc(LT_NAME[a.lt] || a.lt)}</span><span title="The passage starts at ${fmt(a.start)}">stops at ${fmt(pauseAt(a))}</span></div></div>
      <button class="btn play" data-play="${a.id}">${ic('i-play')}<span>Play</span></button>
      <details><summary>Explanation</summary><p><b>In the book.</b> ${esc(a.b)}</p><p><b>Beyond the book.</b> ${esc(a.l)}</p><p class="muted">Passage starts: “${esc(a.from)}”</p></details>
    </div>`;
  }
  $('#noteList').innerHTML = html || '<p class="muted">No annotations match.</p>';
}
['#noteSearch', '#noteSec', '#noteLt', '#noteDone'].forEach((s) => $(s).addEventListener('input', renderNotes));
$('#noteList').addEventListener('change', (e) => {
  const id = +e.target.dataset.w; if (!id) return;
  e.target.checked ? written.add(id) : written.delete(id); saveWritten();
  e.target.closest('.note').classList.toggle('done', e.target.checked);
  markTicks();
});
$('#noteList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-play]'); if (!b) return;
  const a = byId.get(+b.dataset.play); showTab('watch'); seek(a.start, true);
});
$('#bPrint').onclick = () => { $$('#noteList details').forEach((d) => (d.open = true)); window.print(); };

/* =====================================================================
   QUIZ
   ===================================================================== */
const QZ = FK.quiz.map((q, i) => Object.assign({ i }, q));
const QSECS = [...new Set(QZ.map((q) => q.s))];
const Q = { pick: new Set(store.get('qsecs', QSECS)), run: null };
function renderQuizSetup() {
  $('#quizSecs').innerHTML = `<button data-all>All</button>` + QSECS.map((s) => `<button data-s="${esc(s)}" class="${Q.pick.has(s) ? 'on' : ''}">${esc(short(s))}</button>`).join('');
  const pool = quizPool();
  $('#quizAvail').textContent = `${pool.length} question${pool.length === 1 ? '' : 's'} available with these settings.`;
}
function quizPool() {
  return QZ.filter((q) => Q.pick.has(q.s) && (!$('#quizMissed').checked || (qStats[q.i] && qStats[q.i][1] > 0)));
}
$('#quizSecs').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.hasAttribute('data-all')) { if (Q.pick.size === QSECS.length) Q.pick.clear(); else QSECS.forEach((s) => Q.pick.add(s)); }
  else { const s = b.dataset.s; Q.pick.has(s) ? Q.pick.delete(s) : Q.pick.add(s); }
  store.set('qsecs', [...Q.pick]); renderQuizSetup();
});
$('#quizMissed').onchange = renderQuizSetup;
$('#bQuizStart').onclick = () => {
  const pool = quizPool();
  if (!pool.length) return toast('No questions — pick some chapters first.');
  const n = Math.min(+$('#quizN').value, pool.length);
  const qs = pool.slice().sort(() => Math.random() - 0.5).slice(0, n).map((q) => {
    const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    return { q, order, picked: null };
  });
  Q.run = { qs, k: 0, mode: $('#quizMode').value };
  $('#quizSetup').hidden = true; $('#quizRun').hidden = false; renderQ();
};
function renderQ() {
  const R = Q.run, it = R.qs[R.k], q = it.q;
  const answered = it.picked != null, show = answered && R.mode === 'practice';
  $('#quizRun').innerHTML = `
    <div class="qmeta"><span>Question ${R.k + 1} of ${R.qs.length}</span><span>·</span><span>${esc(q.s)}</span><span>·</span><span>${esc(q.t)}</span></div>
    <div class="qbar"><i style="width:${(R.k / R.qs.length) * 100}%"></i></div>
    <div class="qcard"><div class="qtext">${esc(q.q)}</div>
      ${it.order.map((oi, n) => {
        let cls = '';
        if (show) cls = oi === q.a ? 'right' : oi === it.picked ? 'wrong' : '';
        else if (answered && oi === it.picked) cls = 'pick';
        return `<button class="opt ${cls}" data-o="${oi}" ${show ? 'disabled' : ''}><b>${n + 1}</b><span>${esc(q.o[oi])}</span></button>`;
      }).join('')}
      ${show ? `<div class="expl"><b>${it.picked === q.a ? 'Correct.' : 'Not quite.'}</b> ${esc(q.e)}</div>` : ''}
    </div>
    <div class="qnav"><button class="btn" id="qQuit">Quit</button>
      ${answered ? `<button class="btn primary" id="qNext">${R.k + 1 < R.qs.length ? 'Next question' : 'See results'} <kbd>Enter</kbd></button>` : ''}</div>`;
  $$('.opt').forEach((b) => (b.onclick = () => {
    it.picked = +b.dataset.o;
    if (R.mode === 'exam') { if (R.k + 1 < R.qs.length) { R.k++; } else return finishQuiz(); }
    renderQ();
  }));
  $('#qQuit').onclick = () => { Q.run = null; $('#quizRun').hidden = true; $('#quizSetup').hidden = false; renderQuizSetup(); };
  const nx = $('#qNext'); if (nx) nx.onclick = () => { if (R.k + 1 < R.qs.length) { R.k++; renderQ(); } else finishQuiz(); };
}
function finishQuiz() {
  const R = Q.run; let right = 0;
  R.qs.forEach((it) => {
    const ok = it.picked === it.q.a; if (ok) right++;
    const s = qStats[it.q.i] || [0, 0]; s[ok ? 0 : 1]++; qStats[it.q.i] = s;
  });
  store.set('qstats', qStats);
  qHist.push({ d: Date.now(), r: right, n: R.qs.length }); qHist = qHist.slice(-50); store.set('qhist', qHist);
  const pct = Math.round((right / R.qs.length) * 100);
  const wrong = R.qs.filter((it) => it.picked !== it.q.a);
  $('#quizRun').innerHTML = `<h2>Results</h2><div class="score">${pct}%</div><p>${right} of ${R.qs.length} correct.</p>
    ${wrong.length ? `<h3>Review</h3><ol class="review">${wrong.map((it) => `<li><b>${esc(it.q.q)}</b><br>Answer: ${esc(it.q.o[it.q.a])}${it.picked != null ? ` <span class="muted">(you said: ${esc(it.q.o[it.picked])})</span>` : ''}<br><span class="muted">${esc(it.q.e)}</span></li>`).join('')}</ol>` : '<p>Perfect score.</p>'}
    <div class="qnav"><button class="btn" id="qAgain">New quiz</button>${wrong.length ? '<button class="btn primary" id="qRetry">Retry the ones I missed</button>' : ''}</div>`;
  $('#qAgain').onclick = () => { Q.run = null; $('#quizRun').hidden = true; $('#quizSetup').hidden = false; renderQuizSetup(); };
  const rt = $('#qRetry'); if (rt) rt.onclick = () => { Q.run = { qs: wrong.map((it) => ({ q: it.q, order: it.order.slice().sort(() => Math.random() - 0.5), picked: null })), k: 0, mode: R.mode }; renderQ(); };
  Q.run = null;
}

/* =====================================================================
   FLASHCARDS (built from the annotations)
   ===================================================================== */
const C = { deck: [], k: 0, flipped: false };
function buildDeck() {
  const sec = $('#cardSec').value;
  const pool = A.filter((a) => !sec || a.sec === sec);
  const unknown = pool.filter((a) => !cardKnown.has(a.id)), known = pool.filter((a) => cardKnown.has(a.id));
  C.deck = unknown.concat(known); C.k = 0; C.flipped = false;
}
function renderCard() {
  if (!C.deck.length) buildDeck();
  const a = C.deck[C.k % C.deck.length];
  const mode = $('#cardMode').value;
  const pool = C.deck.length, kn = C.deck.filter((x) => cardKnown.has(x.id)).length;
  $('#cardStat').textContent = `${kn}/${pool} known · card ${(C.k % pool) + 1}`;
  if (!a) { $('#flash').innerHTML = '<p class="muted">No cards.</p>'; return; }
  const front = mode === 'quote'
    ? `<div class="muted">#${a.id} · ${esc(a.sec)} · ${esc(a.tag)}</div><div class="f-q">“${esc(a.q)}”</div><div class="f-hint">What did you write in the margin here? Tap to flip.</div>`
    : `<div class="muted">#${a.id} · ${esc(a.sec)}</div><div class="f-m">${esc(a.m)}</div><div class="f-hint">Which line of the book does this note go with? Tap to flip.</div>`;
  const back = `<div class="muted">#${a.id} · ${esc(a.sec)} · ${esc(a.tag)}</div><div class="f-q">“${esc(a.q)}”</div><div class="f-m">${esc(a.m)}</div>
    <p class="explain">${esc(a.b)}</p><p class="explain muted">${ICON(a.lt)}${esc(a.l)}</p>`;
  $('#flash').innerHTML = C.flipped ? back : front;
}
function flip() { C.flipped = !C.flipped; renderCard(); }
function cardAnswer(ok) {
  const a = C.deck[C.k % C.deck.length]; if (!a) return;
  ok ? cardKnown.add(a.id) : cardKnown.delete(a.id); store.set('cards', [...cardKnown]);
  if (!ok) { C.deck.splice(C.k % C.deck.length, 1); C.deck.splice(Math.min(C.k + 4, C.deck.length), 0, a); } else C.k++;
  C.flipped = false; renderCard();
}
$('#flash').onclick = flip;
$('#bFlip').onclick = flip;
$('#bAgain').onclick = () => cardAnswer(false);
$('#bGot').onclick = () => cardAnswer(true);
$('#cardSec').onchange = () => { buildDeck(); renderCard(); };
$('#cardMode').onchange = () => { C.flipped = false; renderCard(); };
$('#bCardShuffle').onclick = () => { C.deck.sort(() => Math.random() - 0.5); C.k = 0; C.flipped = false; renderCard(); };

/* =====================================================================
   OVERVIEW
   ===================================================================== */
function renderOverview() {
  const O = FK.ov;
  const parts = [
    ['ctx', 'Context', `<dl>${O.context.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`],
    ['struct', 'Structure', `<p class="struct">${esc(O.structure)}</p>`],
    ['sum', 'Chapter summaries', O.summaries.map(([k, v]) => {
      const sec = k === 'Letters 1–4' ? 'Letter 1' : k;
      const n = A.filter((a) => (k === 'Letters 1–4' ? a.sec.startsWith('Letter') : a.sec === k)).length;
      return `<div class="sum"><b>${esc(k)}</b><span>${esc(v)}</span><button class="btn" data-sec="${esc(sec)}">${ic('i-play')}<span>Watch, ${n} notes</span></button></div>`;
    }).join('')],
    ['chars', 'Characters', `<div class="grid">${O.characters.map(([k, v]) => `<div class="box"><h3>${esc(k)}</h3><p>${esc(v)}</p></div>`).join('')}</div>`],
    ['themes', 'Themes', `<div class="grid">${O.themes.map(([k, v]) => `<div class="box"><h3>${esc(k)}</h3><p>${esc(v)}</p></div>`).join('')}</div>`],
    ['symbols', 'Symbols & motifs', `<div class="grid">${O.symbols.map(([k, v]) => `<div class="box"><h3>${esc(k)}</h3><p>${esc(v)}</p></div>`).join('')}</div>`],
    ['essays', 'Essay questions', `<div class="grid">${O.essays.map(([k, v]) => `<div class="box"><h3>${esc(k)}</h3><p>${esc(v)}</p></div>`).join('')}</div>`],
  ];
  $('#ovNav').innerHTML = parts.map(([id, t]) => `<a href="#ov-${id}">${t}</a>`).join('');
  $('#ov').innerHTML = parts.map(([id, t, h]) => `<h2 id="ov-${id}">${t}</h2>${h}`).join('');
  $('#ov').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sec]'); if (!b) return;
    const f = A.find((a) => a.sec === b.dataset.sec); showTab('watch'); seek(Math.max(0, f.start - 2), true);
  });
}

/* =====================================================================
   PROGRESS
   ===================================================================== */
function renderProgress() {
  const totalAns = Object.values(qStats).reduce((s, [r, w]) => s + r + w, 0);
  const totalRight = Object.values(qStats).reduce((s, [r]) => s + r, 0);
  const best = qHist.reduce((b, h) => Math.max(b, Math.round((h.r / h.n) * 100)), 0);
  const pos = now();
  const rows = SECS.map((s) => {
    const all = A.filter((a) => a.sec === s), w = all.filter((a) => written.has(a.id)).length;
    const qs = QZ.filter((q) => q.s === s || (s === 'Letter 1' && q.s === 'Letters'));
    let r = 0, n = 0; qs.forEach((q) => { const st = qStats[q.i]; if (st) { r += st[0]; n += st[0] + st[1]; } });
    return { s, w, n: all.length, qr: r, qn: n, letter: s.startsWith('Letter') };
  });
  const missed = QZ.filter((q) => qStats[q.i] && qStats[q.i][1] > qStats[q.i][0]);
  $('#prog').innerHTML = `
    <div class="p-top">
      <div class="stat"><b>${written.size}<small>/${A.length}</small></b><span>annotations written in your book</span></div>
      <div class="stat"><b>${Math.round((pos / FK.duration) * 100)}%</b><span>through the audiobook (${fmt(pos)} of ${fmt(FK.duration)})</span></div>
      <div class="stat"><b>${totalAns ? Math.round((totalRight / totalAns) * 100) + '%' : '—'}</b><span>quiz accuracy (${totalAns} answers)</span></div>
      <div class="stat"><b>${qHist.length ? best + '%' : '—'}</b><span>best quiz score · ${qHist.length} quiz${qHist.length === 1 ? '' : 'zes'} taken</span></div>
      <div class="stat"><b>${cardKnown.size}</b><span>flashcards you know</span></div>
    </div>
    <table class="p-table"><thead><tr><th>Section</th><th>Annotations written</th><th></th><th>Quiz accuracy</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${esc(r.s)}</td><td><div class="pbar"><i style="width:${(r.w / r.n) * 100}%"></i></div></td><td class="num-cell">${r.w}/${r.n}</td><td class="num-cell">${r.qn ? Math.round((r.qr / r.qn) * 100) + '% (' + r.qn + ')' : '—'}</td></tr>`).join('')}
    </tbody></table>
    ${missed.length ? `<h3 class="p-h">Questions you keep missing</h3><ul>${missed.map((q) => `<li>${esc(q.q)} — <b>${esc(q.o[q.a])}</b> <span class="muted">(${esc(q.s)})</span></li>`).join('')}</ul>` : ''}
    <div class="p-actions"><button class="btn" id="rsW">Reset written checkmarks</button><button class="btn" id="rsQ">Reset quiz stats</button><button class="btn" id="rsC">Reset flashcards</button></div>
    <div class="p-save"><p class="muted">Your progress is saved in this browser. To continue on another phone or computer, or to keep a backup, make a save link.</p><button class="btn primary" id="pSave">Save progress</button></div>`;
  $('#pSave').onclick = openSave;
  $('#rsW').onclick = () => { if (confirmTwice('rsW')) { written.clear(); saveWritten(); markTicks(); renderProgress(); } };
  $('#rsQ').onclick = () => { if (confirmTwice('rsQ')) { qStats = {}; qHist = []; store.set('qstats', {}); store.set('qhist', []); renderProgress(); } };
  $('#rsC').onclick = () => { if (confirmTwice('rsC')) { cardKnown = new Set(); store.set('cards', []); renderProgress(); } };
}
// no blocking dialogs: press a reset button twice within 3 s
function confirmTwice(id) {
  if (confirmTwice.armed === id) { confirmTwice.armed = null; toast('Reset.'); return true; }
  confirmTwice.armed = id; toast('Press again to confirm reset'); setTimeout(() => (confirmTwice.armed = null), 3000); return false;
}

/* ---------- boot ---------- */
buildTimeline();
fillSelects();
renderQuizSetup();
renderOverview();
renderCard_();
welcome();
loadFromHash();
const t0 = store.get('tab', 'watch'); if (t0 !== 'watch') showTab(t0);
setInterval(() => { if (!W.ready) tick(); }, 1000);
