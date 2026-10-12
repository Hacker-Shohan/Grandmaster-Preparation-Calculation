/* Puzzle Habit: static site, no backend. Progress lives in localStorage.
   Puzzles come from a CSV (page, idx, puzzle_no, fen, turn_found, status) imported in the page,
   or from a puzzles.csv sitting next to index.html. */
(() => {
const K = 'puzzle-habit-v1', IV = {1: 1, 2: 3, 3: 7, 4: 21};
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => ymd(new Date());
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return ymd(new Date(y, m - 1, d + n)); };
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const defaults = () => ({goal: 5, theme: 'auto', puzzles: [], done: {}, log: {}, day: null, ids: [], skipped: [], dayDone: [], backup: 0});
let S = defaults(), view = 'today', revealed = false, msg = '';
try { Object.assign(S, JSON.parse(localStorage.getItem(K) || '{}')); } catch (e) {}
const save = () => { try { localStorage.setItem(K, JSON.stringify(S)); } catch (e) {} };

/* ---------- CSV import ---------- */
function parseCSV(t) {
  t = t.replace(/^\uFEFF/, '');
  const rows = []; let r = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { r.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; r.push(f); f = ''; rows.push(r); r = []; }
    else f += c;
  }
  if (f || r.length) { r.push(f); rows.push(r); }
  return rows.filter(x => x.length > 1 || x[0]);
}
function fenOK(fen) {
  const [pl, side] = fen.split(' ');
  if (!pl || !/^[wb]$/.test(side || '')) return false;
  const rk = pl.split('/');
  return rk.length === 8 && rk.every(r => /^[pnbrqkPNBRQK1-8]+$/.test(r) &&
    [...r].reduce((a, c) => a + (/\d/.test(c) ? +c : 1), 0) === 8);
}
function importCSV(text) {
  const rows = parseCSV(text), head = (rows.shift() || []).map(h => h.trim().toLowerCase());
  const col = n => head.indexOf(n);
  if (['page', 'idx', 'fen', 'status'].some(n => col(n) < 0)) return 'That CSV needs the columns page, idx, fen and status.';
  const seen = new Set(), list = []; let bad = 0, dup = 0;
  for (const r of rows) {
    const fen = (r[col('fen')] || '').trim();
    if (!(r[col('status')] || '').trim().toLowerCase().startsWith('ok') || !fenOK(fen)) { bad++; continue; }
    if (seen.has(fen)) { dup++; continue; }
    seen.add(fen);
    const tf = col('turn_found') < 0 || /^(true|1|yes)$/i.test((r[col('turn_found')] || '').trim());
    list.push(['p' + esc(r[col('page')].trim()) + '-' + esc(r[col('idx')].trim()), fen, tf ? 0 : 1,
      parseFloat(r[col('page')]) || 0, parseFloat(r[col('idx')]) || 0]);
  }
  if (!list.length) return 'No usable puzzles found. Rows need status "ok" and a valid FEN.';
  list.sort((a, b) => a[3] - b[3] || a[4] - b[4]);
  S.puzzles = list.map(p => p.slice(0, 3)); S.day = null; save();
  return `Imported ${list.length} puzzles. Skipped ${bad} invalid and ${dup} duplicates.`;
}

/* ---------- daily set and scheduling ---------- */
const pmap = () => new Map(S.puzzles.map(p => [p[0], p]));
function ensure() {
  const t = today();
  if (S.day === t && S.ids.length) return;
  const by = pmap();
  const due = Object.entries(S.done).filter(([id, d]) => d.box >= 1 && d.box <= 4 && d.due <= t && by.has(id))
    .sort((a, b) => (a[1].due < b[1].due ? -1 : 1)).map(e => e[0]);
  const cap = Math.floor(S.goal * 0.4), rev = due.slice(0, cap);
  const fresh = S.puzzles.filter(p => !S.done[p[0]]).slice(0, S.goal - rev.length).map(p => p[0]);
  let ids = rev.concat(fresh);
  if (ids.length < S.goal) ids = ids.concat(due.slice(cap, cap + S.goal - ids.length));
  Object.assign(S, {day: t, ids, skipped: [], dayDone: []}); save();
}
function curPuzzle() {
  const by = pmap(), open = S.ids.filter(id => !S.dayDone.includes(id) && by.has(id));
  const id = open.find(i => !S.skipped.includes(i)) || open[0];
  return id && by.get(id);
}
function grade(ok) {
  const p = curPuzzle(); if (!p) return;
  const id = p[0], t = today(), d = S.done[id], L = S.log[t] || (S.log[t] = {n: 0, ok: 0, rv: 0});
  if (!ok) S.done[id] = {box: 1, due: addDays(t, 1)};
  else if (d && d.box >= 1) { const nb = d.box + 1; S.done[id] = {box: nb, due: nb <= 4 ? addDays(t, IV[nb]) : ''}; }
  else S.done[id] = {box: 0};
  L.n++; if (ok) L.ok++; if (revealed) L.rv++;
  S.dayDone.push(id); revealed = false; save();
}
function streaks() {
  const t = today(), met = k => S.log[k] && S.log[k].n >= S.goal;
  let cur = 0, d = met(t) ? t : addDays(t, -1);
  while (met(d)) { cur++; d = addDays(d, -1); }
  let best = 0, run = 0, prev = '';
  for (const k of Object.keys(S.log).filter(met).sort()) { run = prev && addDays(prev, 1) === k ? run + 1 : 1; best = Math.max(best, run); prev = k; }
  return [cur, best];
}
const backupDue = () => S.puzzles.length && Object.keys(S.log).length && Date.now() - S.backup > 7 * 864e5;

/* ---------- board ---------- */
const GL = {K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟'};
function board(fen, coords) {
  const [pl, turn] = fen.split(' '), flip = turn === 'b';
  const g = pl.split('/').map(r => { const a = []; for (const c of r) /\d/.test(c) ? a.push(...Array(+c).fill('')) : a.push(c); return a; });
  let s = `<svg class="bd" viewBox="0 0 8 8" role="img" aria-label="Chess position, ${turn === 'w' ? 'White' : 'Black'} to move">`;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const rr = flip ? 7 - r : r, cc = flip ? 7 - c : c, p = g[rr][cc], dk = (rr + cc) % 2;
    s += `<rect x="${c}" y="${r}" width="1" height="1" fill="var(--sq${dk ? 2 : 1})"/>`;
    if (coords && c === 0) s += `<text class="cd" x=".06" y="${r + .26}" fill="var(--sq${dk ? 1 : 2})">${8 - rr}</text>`;
    if (coords && r === 7) s += `<text class="cd" x="${c + .94}" y="7.95" text-anchor="end" fill="var(--sq${dk ? 1 : 2})">${'abcdefgh'[cc]}</text>`;
    if (p) s += `<text class="pc ${p === p.toUpperCase() ? 'w' : 'b'}" x="${c + .5}" y="${r + .79}">${GL[p.toUpperCase()]}\uFE0E</text>`;
  }
  return s + '</svg>';
}
const lichess = fen => 'https://lichess.org/analysis/' + fen.replace(/ /g, '_') + '?color=' + (fen.split(' ')[1] === 'w' ? 'white' : 'black');

/* ---------- views ---------- */
function vImport() {
  return `<label class="drop" id="drop"><input type="file" accept=".csv,text/csv" data-in="csv">
    <h2>Add your puzzles</h2><p class="mu">Drop your CSV here or tap to choose it.<br>Columns: page, idx, puzzle_no, fen, turn_found, status.</p></label>
    ${msg ? `<p class="note" role="status">${esc(msg)}</p>` : ''}`;
}
function ring(n, goal) {
  const C = 2 * Math.PI * 28, off = C * (1 - Math.min(1, n / goal));
  return `<svg class="ring" width="76" height="76" viewBox="0 0 76 76" role="img" aria-label="${n} of ${goal} puzzles today"><circle class="bg" cx="38" cy="38" r="28"/><circle class="fg" cx="38" cy="38" r="28" stroke-dasharray="${C}" stroke-dashoffset="${off}" transform="rotate(-90 38 38)"/></svg>`;
}
function vToday() {
  if (!S.puzzles.length) return vImport();
  ensure();
  const L = S.log[today()] || {n: 0}, [cs] = streaks(), p = curPuzzle();
  let h = `<div class="card row">${ring(L.n, S.goal)}<div><span class="big">${L.n}/${S.goal}</span> today<br><span class="mu">${cs}-day streak</span></div></div>`;
  if (backupDue()) h += `<p class="note">It has been a week since your last backup. <button class="lnk" data-act="export">Export progress</button></p>`;
  if (!p) return h + `<div class="card"><h2>${L.n >= S.goal ? 'Goal reached.' : 'Nothing queued.'}</h2><p class="mu">${msg || 'Come back tomorrow, or train a few more now.'}</p><button class="btn wide" data-act="more">Add ${S.goal} more puzzles</button></div>`;
  const [id, fen, guess] = p, turn = fen.split(' ')[1], d = S.done[id], rv = d && d.box >= 1;
  return h + `<div class="meta"><span><i class="dot ${turn}"></i>${turn === 'w' ? 'White' : 'Black'} to move${guess ? '<span class="tag">side guessed</span>' : ''}${rv ? '<span class="tag rev">review</span>' : ''}</span><span class="mu">${esc(id.slice(1).replace('-', ' · '))}</span></div>
    ${board(fen, true)}
    <div class="btns"><a class="btn wide" href="${lichess(fen)}" target="_blank" rel="noopener" data-act="rev">Reveal on Lichess</a>
    ${revealed ? '<p class="note wide" style="grid-column:1/-1;margin:0">Revealed. Grade yourself honestly.</p>' : ''}
    <button class="btn ok" data-act="ok">I got it</button><button class="btn no" data-act="no">I missed it</button>
    <button class="btn wide" data-act="skip">Skip for now</button></div>`;
}
function vMiss() {
  const by = pmap(), m = Object.entries(S.done).filter(([id, d]) => d.box >= 1 && d.box <= 4 && by.has(id)).sort((a, b) => (a[1].due < b[1].due ? -1 : 1));
  if (!m.length) return `<div class="card"><h2>No open mistakes</h2><p class="mu">Puzzles you miss show up here and come back on a schedule.</p></div>`;
  return `<button class="btn wide" data-act="practice" style="width:100%;margin-bottom:12px">Practice all ${m.length} now</button><div class="grid">` +
    m.map(([id, d]) => `<div class="card">${board(by.get(id)[1])}<p>${esc(id.slice(1).replace('-', ' · '))} · box ${d.box} · due ${d.due}</p></div>`).join('') + '</div>';
}
function vStats() {
  const logs = Object.entries(S.log), sum = (days, k) => logs.filter(([d]) => d > addDays(today(), -days)).reduce((a, [, v]) => a + v[k], 0);
  const n = logs.reduce((a, [, v]) => a + v.n, 0), ok = logs.reduce((a, [, v]) => a + v.ok, 0), pc = (a, b) => b ? Math.round(100 * a / b) + '%' : '–';
  const left = S.puzzles.filter(p => !S.done[p[0]]).length, [cs, best] = streaks();
  const fin = left ? addDays(today(), Math.ceil(left / S.goal) - 1) : 'done';
  const d0 = new Date(); d0.setDate(d0.getDate() - d0.getDay() - 25 * 7);
  let hm = ''; const t = today();
  for (let i = 0; i < 182; i++) {
    const k = ymd(new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + i)), c = (S.log[k] || {}).n || 0;
    hm += k > t ? '<i class="x"></i>' : `<i class="${c ? 'l' + (c >= S.goal ? 4 : c >= S.goal * .6 ? 3 : c >= S.goal * .3 ? 2 : 1) : ''}" title="${k}: ${c}"></i>`;
  }
  const tile = (a, b) => `<div><span class="big">${a}</span><br><span class="mu">${b}</span></div>`;
  return `<div class="stats">${tile(cs, 'current streak')}${tile(best, 'longest streak')}${tile(n, 'puzzles done')}${tile(pc(ok, n), 'accuracy overall')}
    ${tile(pc(sum(7, 'ok'), sum(7, 'n')), 'accuracy, 7 days')}${tile(pc(sum(30, 'ok'), sum(30, 'n')), 'accuracy, 30 days')}
    ${tile(left, 'new puzzles left')}${tile(fin, 'finish at this pace')}</div>
    <div class="card" style="margin-top:12px"><h2>Last 26 weeks</h2><div class="hm" role="img" aria-label="Activity heatmap">${hm}</div></div>`;
}
function vSet() {
  return `<div class="card"><label class="f">Puzzles per day<input type="number" min="1" max="20" value="${S.goal}" data-set="goal"></label>
    <label class="f">Theme<select data-set="theme">${['auto', 'light', 'dark'].map(o => `<option${S.theme === o ? ' selected' : ''}>${o}</option>`).join('')}</select></label></div>
    <div class="card"><h2>Puzzles</h2><p class="mu">${S.puzzles.length} loaded. Importing a new CSV keeps your progress for puzzles that still exist.</p>
    <label class="f">Replace puzzles from CSV<input type="file" accept=".csv" data-in="csv"></label>${msg ? `<p class="note">${esc(msg)}</p>` : ''}</div>
    <div class="card"><h2>Your progress</h2><p class="mu">Saved in this browser only. Clearing site data erases it, so export a backup now and then.</p>
    <div class="btns"><button class="btn" data-act="export">Export</button><label class="btn">Import<input type="file" accept=".json" data-in="json" hidden></label>
    <button class="btn no wide" data-act="reset">Reset progress</button></div></div>`;
}
const VIEWS = {today: vToday, miss: vMiss, stats: vStats, set: vSet};
const TABS = [['today', 'Today'], ['miss', 'Mistakes'], ['stats', 'Stats'], ['set', 'Settings']];
function render() {
  const r = document.documentElement;
  S.theme === 'auto' ? r.removeAttribute('data-theme') : r.setAttribute('data-theme', S.theme);
  $('#tabs').innerHTML = TABS.map(([k, n]) => `<button data-tab="${k}"${k === view ? ' aria-current="page"' : ''}>${n}</button>`).join('');
  $('#app').innerHTML = VIEWS[view]();
}

/* ---------- events ---------- */
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], {type: 'application/json'})); a.download = name; a.click();
}
document.addEventListener('click', e => {
  const tb = e.target.closest('[data-tab]');
  if (tb) { view = tb.dataset.tab; msg = ''; return render(); }
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'rev') { revealed = true; return setTimeout(render, 0); }
  if (a === 'ok' || a === 'no') grade(a === 'ok');
  else if (a === 'skip') { const p = curPuzzle(); if (p) S.skipped.push(p[0]); revealed = false; save(); }
  else if (a === 'more') {
    const add = S.puzzles.filter(p => !S.done[p[0]] && !S.ids.includes(p[0])).slice(0, S.goal).map(p => p[0]);
    msg = add.length ? '' : 'You have worked through the whole book.'; S.ids = S.ids.concat(add); save();
  }
  else if (a === 'practice') { const by = pmap(); S.ids = S.ids.concat(Object.entries(S.done).filter(([id, d]) => d.box >= 1 && d.box <= 4 && by.has(id) && !S.ids.includes(id)).map(x => x[0])); view = 'today'; save(); }
  else if (a === 'export') { S.backup = Date.now(); save(); download('puzzle-habit-progress.json', JSON.stringify({done: S.done, log: S.log, goal: S.goal, theme: S.theme})); }
  else if (a === 'reset') { if (!confirm('Erase all progress? Your puzzle list stays.')) return; Object.assign(S, {done: {}, log: {}, day: null, ids: [], skipped: [], dayDone: [], backup: 0}); save(); }
  render();
});
document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.set === 'goal') { S.goal = Math.min(20, Math.max(1, +el.value || 5)); if (!S.dayDone.length) S.day = null; }
  else if (el.dataset.set === 'theme') S.theme = el.value;
  else if (el.dataset.in === 'csv' && el.files[0]) msg = importCSV(await el.files[0].text());
  else if (el.dataset.in === 'json' && el.files[0]) {
    try { const j = JSON.parse(await el.files[0].text()); Object.assign(S, {done: j.done || {}, log: j.log || {}, goal: j.goal || S.goal, theme: j.theme || S.theme, day: null}); msg = 'Progress restored.'; }
    catch (x) { msg = 'That file is not a progress export.'; }
  } else return;
  save(); render();
});
['dragover', 'drop'].forEach(ev => document.addEventListener(ev, async e => {
  if (view !== 'today' && view !== 'set') return;
  e.preventDefault();
  if (ev === 'drop' && e.dataTransfer.files[0]) { msg = importCSV(await e.dataTransfer.files[0].text()); render(); }
}));
document.addEventListener('keydown', e => {
  if (view !== 'today' || /INPUT|SELECT/.test(e.target.tagName) || e.metaKey || e.ctrlKey || !curPuzzle()) return;
  const k = e.key.toLowerCase();
  if (k === 'y' || k === 'enter') { if (e.target.tagName === 'BUTTON') return; grade(true); }
  else if (k === 'n') grade(false);
  else if (k === 's') { S.skipped.push(curPuzzle()[0]); revealed = false; save(); }
  else if (k === 'r') { window.open(lichess(curPuzzle()[1]), '_blank', 'noopener'); revealed = true; }
  else return;
  render();
});

render();
if (!S.puzzles.length) fetch('puzzles.csv').then(r => r.ok ? r.text() : '').then(t => { if (t) { msg = importCSV(t); render(); } }).catch(() => {});
})();
