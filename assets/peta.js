// ======================= PETA KERJA (v1.8b) =======================
// Satu peta Leaflet: grid cakupan bertingkat (500/250/100 m), titik pemeriksaan per golongan,
// calon TO berisiko (dikelompokkan saat zoom jauh), pencarian pelanggan terdekat.
// Panel konteks di kanan berganti isi: panduan / hasil cari / detail sel / detail titik.
import { C, GOLC, GOL_ORDER, GOL_DESC, RAMP, esc, num, pct, rp, ratio, empty, golChip, icon, IC, tglPendek, blthLabel, title, exportXlsx, rentang, table } from './ui.js';

const FINE = 0.0005; // kotak dasar ±55 m; sel = FINE × k
const LVL = { 10: '±500 m', 5: '±250 m', 2: '±100 m' };
const autoK = (z) => (z < 14 ? 10 : z < 16 ? 5 : 2);
const Z_PT = 15; // mulai zoom ini calon TO tampil per titik; di bawahnya dikelompokkan
const BINS = [0.5, 1.5, 3, 5, 8, Infinity];
const COV_LBL = ['<0,5%', '0,5–1,5%', '1,5–3%', '3–5%', '5–8%', '≥8%'];
const EV_BINS = [5, 10, 20, 40, Infinity];
const EV_LBL = ['<5%', '5–10%', '10–20%', '20–40%', '≥40%'];
const EV_RAMP = ['#efe7fb', '#d5c3f4', '#b49bea', '#8f6fda', '#6a4bc4'];
const ZERO_FILL = '#F5A623', ZERO_LINE = '#B86E00';
const RISK_C = { Tinggi: '#b42318', Sedang: '#f08a24' };
const NON_DIL = '#7a3412';
const SES_C = '#7d8aa0';
const GOLS = ['Sesuai', ...GOL_ORDER];
const gmaps = (lat, lon) => `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
const L = () => window.L;

let pkMap = null;
const PK = {
  lay: { grid: true, periksa: true, risiko: true }, klik: 'sel', view: null, fitKey: null, entered: false, legOpen: null,
  lvl: 'auto', warna: 'cakupan', gol: new Set(GOL_ORDER), rkat: { Tinggi: true, Sedang: true },
  panel: 'intro', cell: null, det: null, ptSel: null,
  q: '', mode: 'dil', rad: 100, pt: null, results: null, near: null, msg: '',
};

const chipKat = (k) => `<span class="chip" style="background:${k === 'Tinggi' ? 'var(--crit-bg)' : 'var(--warn-bg)'};color:${k === 'Tinggi' ? 'var(--crit)' : 'var(--warn)'}">${k} </span>`;
const katOf = (s) => (s >= 60 ? 'Tinggi' : s >= 35 ? 'Sedang' : null);
const skorBadge = (s) => { const k = katOf(s); return k ? `<span class="chip" style="background:${k === 'Tinggi' ? 'var(--crit-bg)' : 'var(--warn-bg)'};color:${k === 'Tinggi' ? 'var(--crit)' : 'var(--warn)'}">Skor ${num(s)}</span>` : ''; };
const dot = (c, ring = false) => `<i class="dot" style="background:${c};${ring ? 'box-shadow:0 0 0 2px #0E1726;border-radius:50%' : 'border-radius:50%'}"></i>`;
const golCol = (g) => (g === 'Sesuai' ? SES_C : GOLC[g] || C.s3);

// halaman otomatis turun ke peta hanya saat pertama kali dibuka (bukan saat filter berganti)
window.addEventListener('hashchange', () => { if (!/^#\/?cakupan/.test(location.hash)) PK.entered = false; });

export async function cakupan(ctx) {
  if (pkMap) { try { PK.view = [pkMap.getCenter(), pkMap.getZoom()]; pkMap.remove(); } catch (e) { /* abaikan */ } pkMap = null; }
  const fitKey = `${ctx.f.kec || ''}|${ctx.f.layanan || ''}`;
  const startZ = PK.view && PK.fitKey === fitKey ? PK.view[1] : 12;
  const kOf = (z) => (PK.lvl === 'auto' ? autoK(z) : PK.lvl);
  const grids = new Map(); // k → Promise hasil f_grid (periode & filter ini)
  const loadGrid = (k) => { if (!grids.has(k)) grids.set(k, ctx.rpc('f_grid', ctx.params({ p_k: k }))); return grids.get(k); };
  const k0 = kOf(startZ);
  let d, g0;
  try { [d, g0] = await Promise.all([ctx.rpc('f_cakupan', ctx.params()), loadGrid(k0)]); }
  catch (e) {
    if (!ctx.alive()) return;
    ctx.el.innerHTML = `<div class="note warn">Peta Kerja gagal dimuat: ${esc(e.message)}${/f_grid/.test(e.message) ? '<br>Pastikan <b>supabase/update-v1.8b.sql</b> sudah dijalankan di Supabase SQL Editor.' : ''}</div>`;
    return;
  }
  if (!ctx.alive()) return;

  // ---------- data ----------
  const k = d.kpi;
  let G = null; // grid aktif: { k, cells, cellBy, risk, zero, dataMin }
  const mkGrid = (g) => {
    const kk = g.k;
    const cells = g.cells.map((c) => ({ i: c[0], j: c[1], k: kk, pop: c[2], ins: c[3], tm: c[4], pra: c[5], lat: +c[6], lon: +c[7], kel: c[8], kec: c[9],
      last: c[10], gardu: c[11] || null, ever: c[12], rt: c[13], rs: c[14], cov: ratio(c[3], c[2]), evp: ratio(c[12], c[2]) }));
    return { k: kk, cells, cellBy: new Map(cells.map((c) => [`${c.i},${c.j}`, c])), risk: g.risk.map((r) => ({ i: r[0], j: r[1], t: r[2], s: r[3], lat: +r[4], lon: +r[5] })),
      zero: g.zero, dataMin: g.data_min };
  };
  G = mkGrid(g0);
  const pts = (d.points || []).map((p) => ({ lat: +p[0], lon: +p[1], gol: p[2], idpel: p[3], nama: p[4], rp: p[5], tgl: p[6] })).filter((p) => p.lat && p.lon);
  const golN = d.gol_n || {};
  const riskTot = () => G.risk.reduce((a, r) => [a[0] + r.t, a[1] + r.s], [0, 0]);
  const area = () => (G.cells.length ? [[Math.min(...G.cells.map((c) => c.j)) * c5(G.k), Math.min(...G.cells.map((c) => c.i)) * c5(G.k)],
    [(Math.max(...G.cells.map((c) => c.j)) + 1) * c5(G.k), (Math.max(...G.cells.map((c) => c.i)) + 1) * c5(G.k)]] : null);
  function c5(kk) { return FINE * kk; }
  const area0 = area();
  const sinceTxt = () => (G.dataMin ? tglPendek(G.dataMin) : 'awal data');

  // ---------- kerangka halaman ----------
  const st = (id, lbl, v, foot, tip, col = '') => `<div class="pkst" id="${id}" data-tip="${esc(tip)}"><span class="lbl">${lbl}</span><b class="mono"${col ? ` style="color:${col}"` : ''}>${v}</b><small>${foot}</small></div>`;
  const kpiZero = () => (PK.warna === 'belum'
    ? st('pkz', 'BELUM PERNAH DIPERIKSA', num(G.zero.never_plg), `${num(G.zero.never_cells)} sel ${LVL[G.k]} kosong sama sekali`, `Pelanggan aktif yang belum pernah diperiksa sejak ${sinceTxt()} s.d. akhir periode`, '#6a4bc4')
    : st('pkz', 'BELUM TERSENTUH', num(G.zero.cells), `sel ${LVL[G.k]} · ${num(G.zero.pop)} pelanggan`, `Sel grid ${LVL[G.k]} tanpa pemeriksaan pada periode ini`, '#B86E00'));
  const kpiRisk = () => { const [t, s] = riskTot(); return st('pkr', 'CALON TO', num(t + s), `${num(t)} tinggi · ${num(s)} sedang`, 'Skor dari DPM/OLAP terbaru; pelanggan yang diperiksa 90 hari terakhir tidak dihitung', RISK_C.Tinggi); };
  const kp = `<div class="pkstat">
    <div class="pkst pkper"><span class="lbl">PERIODE</span><b>${esc(rentang(ctx.f.from, ctx.f.to))}</b><button type="button" class="pklink" id="pkper">Ubah filter ↑</button></div>
    ${st('pka', 'PELANGGAN AKTIF', num(k.aktif), `${num(k.pra)} prabayar`, `${num(k.pra)} prabayar · ${num(k.aktif - k.pra)} paskabayar (DIL)`)}
    ${st('pkd', 'DIPERIKSA', num(k.uniq), `cakupan ${pct(ratio(k.uniq_dil, k.aktif), 2)}`, `${num(k.uniq)} pelanggan diperiksa pada periode ini, ${num(k.uniq_dil)} cocok dengan DIL aktif`)}
    ${st('pkg', 'GARDU TERSENTUH', `${num(k.gardu_ins)}/${num(k.gardu_total)}`, `${pct(ratio(k.gardu_ins, k.gardu_total), 0)} gardu`, 'Gardu yang punya minimal satu pemeriksaan pada periode ini')}
    ${kpiZero()}${kpiRisk()}
  </div>`;

  const layBtn = (key, lbl, sw) => `<button type="button" class="pktog${PK.lay[key] ? ' on' : ''}" data-lay="${key}" aria-pressed="${PK.lay[key]}">${sw}${lbl}</button>`;
  const segBtn = (attr, val, lbl, on) => `<button type="button" data-${attr}="${val}" class="${on ? 'on' : ''}">${lbl}</button>`;
  const sesLbl = d.sesuai_semua ? 'Sesuai' : 'Sesuai (sampel)';
  const golBtn = (g) => `<button type="button" class="pkchip${PK.gol.has(g) ? ' on' : ''}" data-gol="${g}" aria-pressed="${PK.gol.has(g)}">${dot(golCol(g))}${g === 'Sesuai' ? sesLbl : g}<small>${num(golN[g] || 0)}</small></button>`;
  const katBtn = (kk) => `<button type="button" class="pkchip${PK.rkat[kk] ? ' on' : ''}" data-rkat="${kk}" aria-pressed="${PK.rkat[kk]}">${dot(RISK_C[kk], true)}${kk}</button>`;
  const bar = `<div class="pkbar">
    <form id="pkf" class="pksearch" role="search" aria-label="Cari pelanggan">
      <select id="pkm" aria-label="Cari berdasarkan"><option value="dil" ${PK.mode === 'dil' ? 'selected' : ''}>IDPEL / nama / alamat DIL</option><option value="geo" ${PK.mode === 'geo' ? 'selected' : ''}>Alamat bebas (OpenStreetMap)</option></select>
      <input id="pkq" value="${esc(PK.q)}" placeholder="mis. 547400169692 · KAHFI 1 RT1 · Jl. Lenteng Agung Raya 50" aria-label="Kata kunci">
      <select id="pkr" aria-label="Radius">${[25, 50, 75, 100].map((r) => `<option value="${r}" ${PK.rad === r ? 'selected' : ''}>${r} m</option>`).join('')}</select>
      <button class="btn pri" type="submit">${icon(IC.search, 16, '#fff')}Cari</button>
    </form>
    <div class="pkopts">
      <div class="pkgrp"><span class="lab">LAPISAN</span>
        ${layBtn('grid', 'Grid sel', `<i class="sw" style="background:linear-gradient(90deg,${RAMP[1]},${RAMP[4]})"></i>`)}
        ${layBtn('periksa', 'Pemeriksaan', `<i class="sw r" style="background:${C.s2}"></i>`)}
        ${layBtn('risiko', 'Calon TO', `<i class="sw r" style="background:${RISK_C.Tinggi};box-shadow:0 0 0 2px #0E1726"></i>`)}
      </div>
      <div class="pkgrp"><span class="lab">KLIK DI PETA</span><div class="seg">
        ${segBtn('klik', 'sel', 'Pilih sel', PK.klik === 'sel')}${segBtn('klik', 'cari', 'Cari sekitar titik', PK.klik === 'cari')}</div></div>
      <button type="button" class="btn" id="pkfit">${icon(IC.pin, 16)}Fokus UP3</button>
    </div>
    <div class="pkopts pkopts2">
      <div class="pkgrp"><span class="lab">PEMERIKSAAN</span>${GOLS.map(golBtn).join('')}
        <button type="button" class="pklink" id="pkgolall">Semua temuan</button><button type="button" class="pklink" id="pkgolnone">Kosongkan</button></div>
      <div class="pkgrp"><span class="lab">CALON TO</span>${katBtn('Tinggi')}${katBtn('Sedang')}</div>
    </div></div>`;

  const kecT = `<section class="card" id="pkkec"><div><h2>Cakupan per kecamatan</h2><p class="sub">Klik baris untuk memusatkan peta ke kecamatan tersebut.</p></div>${table([{ h: 'Kecamatan', k: 'k', f: (v) => (v ? esc(title(v)) : '<i style="color:var(--muted)">(kosong di DIL)</i>') }, { h: 'Pelanggan aktif', k: 'pop', r: 1, f: num }, { h: 'Diperiksa', k: 'ins', r: 1, f: num },
    { h: 'Cakupan', k: 'x', r: 1, f: (v, r) => pct(ratio(r.ins, r.pop), 2) }, { h: 'Temuan', k: 'tm', r: 1, f: num }, { h: 'Hit rate', k: 'y', r: 1, f: (v, r) => pct(ratio(r.tm, r.ins)) }], d.kec, { onRow: true })}</section>`;
  const kelT = `<section class="card" id="pkkel"><div><h2>Per kelurahan</h2><p class="sub">Diurutkan dari temuan terbanyak. Klik baris untuk memusatkan peta.</p></div>${table([{ h: 'Kelurahan', k: 'k', f: (v) => esc(title(v)) }, { h: 'Kecamatan', k: 'kec', f: (v) => esc(title(v)) },
    { h: 'Pelanggan aktif', k: 'pop', r: 1, f: num }, { h: 'Diperiksa', k: 'ins', r: 1, f: num }, { h: 'Cakupan', k: 'x', r: 1, f: (v, r) => pct(ratio(r.ins, r.pop), 2) }, { h: 'Temuan', k: 'tm', r: 1, f: num }], d.kel, { maxh: 460, onRow: true })}</section>`;

  ctx.el.innerHTML = `<div class="pk">
    <section class="card pkcard" aria-label="Peta Kerja">${kp}
      ${bar}
      <div class="pkwrap"><div class="pkmapbox"><div class="leaf pkmap" id="pkmap"></div><div class="pkleg" id="pkleg"></div>
        <div class="pkhint" id="pkhint" aria-hidden="true">Tahan <kbd>Ctrl</kbd> sambil memutar roda mouse untuk zoom</div>
        <div class="pkctl" role="group" aria-label="Pengaturan sel">
          <div class="pkctlr"><span class="lab">SEL</span><div class="seg sm">${segBtn('lvl', 'auto', 'Oto', PK.lvl === 'auto')}${[10, 5, 2].map((kk) => segBtn('lvl', kk, LVL[kk].replace('±', '').replace(' m', ''), PK.lvl === kk)).join('')}</div><small id="pklvlnow"></small></div>
          <div class="pkctlr"><span class="lab">WARNA</span><div class="seg sm">${segBtn('warna', 'cakupan', 'Cakupan periode', PK.warna === 'cakupan')}${segBtn('warna', 'belum', 'Belum pernah diperiksa', PK.warna === 'belum')}</div></div>
        </div>
        <div class="pkbusy" id="pkbusy" hidden><span class="spin"></span><span id="pkbusyt">Memuat…</span></div></div>
        <aside class="pkpanel" id="pkp" aria-live="polite" aria-label="Panel detail peta"></aside></div>
    </section>
    <div class="two">${kecT}${kelT}</div></div>`;

  const panel = ctx.el.querySelector('#pkp');
  const legEl = ctx.el.querySelector('#pkleg');
  const busyEl = ctx.el.querySelector('#pkbusy');
  if (!window.L) { panel.innerHTML = empty('Pustaka peta gagal dimuat'); return; }
  let busyN = 0;
  const busy = (on, txt) => { busyN = Math.max(0, busyN + (on ? 1 : -1)); if (txt) ctx.el.querySelector('#pkbusyt').textContent = txt; busyEl.hidden = busyN === 0; };

  // ---------- peta ----------
  const m = L().map(ctx.el.querySelector('#pkmap'), { preferCanvas: true, scrollWheelZoom: false, zoomSnap: 0.5 });
  L().tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(m);
  pkMap = m;
  const live = () => ctx.alive() && pkMap === m && panel.isConnected;
  const fitArea = () => { if (area0) m.fitBounds(area0, { padding: [16, 16] }); else m.setView([-6.30, 106.83], 12); };
  if (PK.view && PK.fitKey === fitKey) m.setView(PK.view[0], PK.view[1]); else fitArea();
  PK.fitKey = fitKey;
  // zoom hanya dengan Ctrl (⌘ di Mac) + roda mouse / pinch touchpad; roda mouse biasa tetap menggulir halaman
  {
    const cont = m.getContainer(), hintEl = ctx.el.querySelector('#pkhint');
    let acc = 0, lastZ = 0, hintT = null;
    cont.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        hintEl.classList.remove('on');
        acc += e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
        const now = Date.now();
        if (Math.abs(acc) < 50 || now - lastZ < 140) return;
        const dz = Math.max(-1, Math.min(1, -acc / 100)); acc = 0; lastZ = now;
        m.setZoomAround(m.mouseEventToContainerPoint(e), Math.min(19, Math.max(10, m.getZoom() + (Math.abs(dz) < 0.5 ? Math.sign(dz) * 0.5 : dz))));
      } else {
        hintEl.classList.add('on'); clearTimeout(hintT); hintT = setTimeout(() => hintEl.classList.remove('on'), 1400);
      }
    }, { passive: false });
  }
  let hitAt = 0; // penanda klik pada objek agar klik peta tidak ikut terpicu
  const hit = () => { hitAt = Date.now(); };

  const gridL = L().featureGroup(), perL = L().featureGroup(), riskL = L().featureGroup(), cellL = L().featureGroup(), srchL = L().featureGroup();
  const daysSince = (iso) => Math.max(0, Math.round((new Date(ctx.f.to) - new Date(iso)) / 864e5));
  const lastTxt = (c) => (!c.last ? `Belum pernah diperiksa sejak ${sinceTxt()}` : `Terakhir diperiksa ${tglPendek(c.last)} (${num(daysSince(c.last))} hari)`);
  // Poin prioritas sel: risiko tinggi ×3, sedang ×1, lama / belum pernah diperiksa, populasi besar
  const bigPop = () => (G.k === 10 ? 1000 : G.k === 5 ? 300 : 60);
  const prio = (c) => {
    let p = 3 * c.rt + c.rs; const why = [];
    if (c.rt) why.push(`<span class="chip crit">${num(c.rt)} tinggi</span>`);
    if (c.rs) why.push(`<span class="chip warn">${num(c.rs)} sedang</span>`);
    const dd = !c.last ? Infinity : daysSince(c.last);
    if (dd >= 180) { p += 2; why.push(`<span class="chip">${!c.last ? 'belum pernah diperiksa' : `${num(dd)} hari tanpa pemeriksaan`}</span>`); }
    else if (dd >= 90) { p += 1; why.push(`<span class="chip">${num(dd)} hari tanpa pemeriksaan</span>`); }
    if (c.pop >= bigPop()) { p += 1; why.push(`<span class="chip">${num(c.pop)} pelanggan</span>`); }
    return { p, why };
  };
  const cellBounds = (c) => [[c.j * c5(c.k), c.i * c5(c.k)], [(c.j + 1) * c5(c.k), (c.i + 1) * c5(c.k)]];
  const isSel = (c) => PK.cell && PK.cell.k === c.k && PK.cell.i === c.i && PK.cell.j === c.j;
  const fillOf = (c) => {
    if (PK.warna === 'belum') return c.ever ? EV_RAMP[EV_BINS.findIndex((b) => c.evp < b)] : ZERO_FILL;
    return c.ins ? RAMP[BINS.findIndex((b) => c.cov < b)] : ZERO_FILL;
  };
  const isZero = (c) => (PK.warna === 'belum' ? !c.ever : !c.ins);
  const cellStyle = (c) => {
    const z = m.getZoom(), op = z >= 17 ? 0.12 : z >= 16 ? 0.25 : z >= 15 ? 0.4 : 0.55;
    if (isZero(c)) return { color: ZERO_LINE, weight: G.k === 2 ? 0.8 : 1.2, opacity: 0.9, fillColor: ZERO_FILL, fillOpacity: op };
    return { color: '#ffffff', weight: G.k === 2 ? 0.4 : 0.8, opacity: 0.9, fillColor: fillOf(c), fillOpacity: op };
  };
  const cellTip = (c) => `<b>${esc(title(c.kel || '-'))}</b> · Kec. ${esc(title(c.kec || '-'))}${c.gardu ? ` · Gardu ${esc(c.gardu)}` : ''} <span style="color:#8a94a6">· sel ${LVL[c.k]}</span><br>${lastTxt(c)}<br>
    ${num(c.pop)} pelanggan aktif · ${num(c.ins)} diperiksa periode ini (${c.ins ? pct(c.cov, 2) : 'belum tersentuh'})<br>
    ${num(c.ever)} pernah diperiksa sejak ${sinceTxt()} (${pct(c.evp, 1)}) · ${num(c.tm)} temuan${c.rt || c.rs ? `<br><b style="color:${RISK_C.Tinggi}">${num(c.rt)} risiko tinggi</b> · ${num(c.rs)} sedang` : ''}`;
  function drawGrid() {
    gridL.clearLayers();
    for (const c of G.cells) {
      c.rect = L().rectangle(cellBounds(c), cellStyle(c)).bindTooltip(() => cellTip(c), { sticky: true, className: 'pktip' })
        .on('click', (e) => { hit(); if (PK.klik === 'cari') nearAt(e.latlng); else selectCell(c, false); }).addTo(gridL);
    }
    const now = ctx.el.querySelector('#pklvlnow'); if (now) now.textContent = PK.lvl === 'auto' ? `= ${LVL[G.k]}` : 'm';
  }
  const restyle = () => { for (const c of G.cells) c.rect && c.rect.setStyle(cellStyle(c)); };
  const refreshKpi = () => {
    const a = ctx.el.querySelector('#pkz'); if (a) a.outerHTML = kpiZero();
    const b = ctx.el.querySelector('#pkr'); if (b) b.outerHTML = kpiRisk();
  };

  // ganti ukuran sel (otomatis menurut zoom atau dipilih)
  let gridSeq = 0;
  async function ensureLevel() {
    const want = kOf(m.getZoom());
    if (want === G.k) return;
    const seq = ++gridSeq;
    busy(true, `Memuat sel ${LVL[want]}…`);
    let g;
    try { g = await loadGrid(want); } catch (e) { busy(false); grids.delete(want); return; }
    busy(false);
    if (!live() || seq !== gridSeq) return;
    G = mkGrid(g);
    drawGrid(); applyLayers(); refreshKpi(); drawRisk();
    if (PK.panel === 'intro') renderPanel();
  }

  // titik pemeriksaan menurut golongan yang dipilih
  function drawPeriksa() {
    perL.clearLayers();
    for (const p of pts) {
      if (!PK.gol.has(p.gol)) continue;
      const isT = p.gol !== 'Sesuai';
      L().circleMarker([p.lat, p.lon], { radius: isT ? 5.5 : 3.2, color: '#fff', weight: isT ? 1.2 : 0.6, fillColor: golCol(p.gol), fillOpacity: isT ? 0.95 : 0.8 })
        .bindTooltip(`${esc(title(p.nama || '-'))} · ${esc(p.gol)}${p.tgl ? ' · ' + tglPendek(p.tgl) : ''}`, { className: 'pktip' })
        .on('click', () => { hit(); selectPoint({ kind: 'periksa', ...p }); }).addTo(perL);
    }
  }

  // calon TO: dikelompokkan saat zoom jauh, titik per pelanggan saat diperbesar (dimuat sesuai layar)
  let riskPts = null, riskBox = null, riskSeq = 0, riskInfo = '';
  const katOn = (t, s) => (PK.rkat.Tinggi ? t : 0) + (PK.rkat.Sedang ? s : 0);
  function drawClusters() {
    riskL.clearLayers();
    const bins = new Map(), px = 64;
    for (const r of G.risk) {
      const n = katOn(r.t, r.s); if (!n) continue;
      const p = m.latLngToLayerPoint([r.lat, r.lon]);
      const key = `${Math.floor(p.x / px)},${Math.floor(p.y / px)}`;
      const b = bins.get(key) || { n: 0, t: 0, la: 0, lo: 0 };
      b.n += n; b.t += PK.rkat.Tinggi ? r.t : 0; b.la += r.lat * n; b.lo += r.lon * n; bins.set(key, b);
    }
    for (const b of bins.values()) {
      const la = b.la / b.n, lo = b.lo / b.n, sz = Math.round(22 + Math.min(26, Math.sqrt(b.n) * 1.6));
      const col = b.t ? RISK_C.Tinggi : RISK_C.Sedang;
      L().marker([la, lo], { icon: L().divIcon({ className: 'pkclu', html: `<span style="width:${sz}px;height:${sz}px;background:${col}">${b.n >= 1000 ? num(b.n / 1000, 1) + 'rb' : num(b.n)}</span>`, iconSize: [sz, sz] }), keyboard: false })
        .bindTooltip(`${num(b.n)} calon TO${b.t ? ` (${num(b.t)} tinggi)` : ''} · klik untuk memperbesar`, { className: 'pktip' })
        .on('click', () => { hit(); m.setView([la, lo], Math.max(Z_PT, m.getZoom() + 2)); }).addTo(riskL);
    }
    riskInfo = '';
    renderLegend();
  }
  function drawRiskPts() {
    riskL.clearLayers();
    for (const p of riskPts || []) {
      if (!PK.rkat[p.kat]) continue;
      L().circleMarker([p.lat, p.lon], { radius: p.kat === 'Tinggi' ? 7.5 : 6, color: '#0E1726', weight: 2, fillColor: RISK_C[p.kat], fillOpacity: 1 })
        .bindTooltip(`${esc(title(p.nama || '-'))} · skor ${num(p.skor)} (${p.kat})`, { className: 'pktip' })
        .on('click', () => { hit(); selectPoint({ kind: 'risiko', ...p }); }).addTo(riskL);
    }
    renderLegend();
  }
  let riskT = null;
  function drawRisk() {
    if (!PK.lay.risiko) { riskL.clearLayers(); return; }
    if (m.getZoom() < Z_PT) { drawClusters(); return; }
    const b = m.getBounds();
    if (riskPts && riskBox && riskBox.contains(b)) { drawRiskPts(); return; }
    clearTimeout(riskT);
    riskT = setTimeout(async () => {
      const bb = m.getBounds().pad(0.35), seq = ++riskSeq;
      busy(true, 'Memuat calon TO…');
      let r;
      try { r = await ctx.rpc('f_risiko_titik', { p_from: ctx.f.from, p_to: ctx.f.to, p_kec: ctx.f.kec || null, p_layanan: ctx.f.layanan || null,
        p_s: bb.getSouth(), p_w: bb.getWest(), p_n: bb.getNorth(), p_e: bb.getEast(), p_limit: 4000 }); }
      catch (e) { busy(false); return; }
      busy(false);
      if (!live() || seq !== riskSeq || m.getZoom() < Z_PT) return;
      riskBox = bb;
      riskPts = r.pts.map((p) => ({ lat: +p[0], lon: +p[1], idpel: p[2], nama: p[3], skor: p[4], kat: p[5], tarif: p[6], daya: p[7], layanan: p[8], gardu: p[9], alamat: p[10] }));
      riskInfo = r.n > riskPts.length ? `${num(riskPts.length)} skor tertinggi dari ${num(r.n)} di area ini — perbesar untuk melihat semua` : '';
      drawRiskPts();
    }, 250);
  }

  const applyLayers = () => {
    for (const l of [gridL, perL, riskL, cellL, srchL]) m.removeLayer(l);
    if (PK.lay.grid) gridL.addTo(m);
    cellL.addTo(m);
    if (PK.lay.periksa) perL.addTo(m);
    if (PK.lay.risiko) riskL.addTo(m);
    srchL.addTo(m);
    restyle(); renderLegend();
  };
  m.on('click', (e) => { if (Date.now() - hitAt < 80) return; if (PK.klik === 'cari') nearAt(e.latlng); });
  m.on('zoomend', () => { restyle(); ensureLevel(); drawRisk(); });
  m.on('moveend', () => { if (m.getZoom() >= Z_PT) drawRisk(); });

  // ---------- legenda ----------
  function renderLegend() {
    const rows = [];
    if (PK.lay.grid) {
      if (PK.warna === 'belum') rows.push(`<div class="pklg"><b>Pernah diperiksa</b><span><i class="sq" style="background:${ZERO_FILL};outline:1px solid ${ZERO_LINE}"></i>Belum pernah sama sekali</span>${EV_LBL.map((l, i) => `<span><i class="sq" style="background:${EV_RAMP[i]}"></i>${l}</span>`).join('')}</div>`);
      else rows.push(`<div class="pklg"><b>Cakupan sel</b><span><i class="sq" style="background:${ZERO_FILL};outline:1px solid ${ZERO_LINE}"></i>Belum tersentuh</span>${COV_LBL.map((l, i) => `<span><i class="sq" style="background:${RAMP[i]}"></i>${l}</span>`).join('')}</div>`);
    }
    if (PK.lay.periksa && PK.gol.size) rows.push(`<div class="pklg"><b>Pemeriksaan</b>${GOLS.filter((g) => PK.gol.has(g)).map((g) => `<span>${dot(golCol(g))}${g === 'Sesuai' ? sesLbl : g}</span>`).join('')}</div>`);
    if (PK.lay.risiko) rows.push(`<div class="pklg"><b>Calon TO</b>${PK.rkat.Tinggi ? `<span>${dot(RISK_C.Tinggi, true)}Tinggi</span>` : ''}${PK.rkat.Sedang ? `<span>${dot(RISK_C.Sedang, true)}Sedang</span>` : ''}<span style="color:var(--muted)">${m.getZoom() < Z_PT ? 'angka = jumlah calon; perbesar untuk titik' : esc(riskInfo)}</span></div>`);
    if (PK.det || PK.pt) rows.push(`<div class="pklg"><b>Pelanggan</b><span>${dot(C.gray)}Belum diperiksa</span><span>${dot(C.s1)}Diperiksa, sesuai</span><span>${dot(C.s2)}Temuan</span>${PK.pt ? `<span>${dot(NON_DIL)}Non-DIL (P4)</span>` : ''}</div>`);
    if (PK.legOpen === null) PK.legOpen = window.innerWidth >= 1500; // layar laptop: legenda terlipat agar peta lega
    legEl.innerHTML = `<button type="button" class="pklegbtn" id="pklegt" aria-expanded="${PK.legOpen}">Legenda <span aria-hidden="true">${PK.legOpen ? '▾' : '▸'}</span></button>${PK.legOpen ? rows.join('') : ''}`;
    legEl.classList.toggle('shut', !PK.legOpen);
    legEl.style.display = rows.length ? '' : 'none';
    legEl.querySelector('#pklegt').onclick = () => { PK.legOpen = !PK.legOpen; renderLegend(); };
  }

  // ---------- panel konteks ----------
  const head = (eyebrow, h, sub, chip = '') => `<div class="pkhd"><div style="min-width:0"><div class="lbl">${eyebrow}</div><h3>${h}</h3>${sub ? `<div class="pksub">${sub}</div>` : ''}</div>
    <button type="button" class="btn sm" data-close aria-label="Tutup panel">${icon(IC.x, 15)}</button></div>${chip ? `<div>${chip}</div>` : ''}`;
  const stat = (lbl, v, col = '') => `<div><div class="lbl">${lbl}</div><div class="mono pkv"${col ? ` style="color:${col}"` : ''}>${v}</div></div>`;

  function renderPanel() {
    if (!live()) return;
    let h = '';
    if (PK.panel === 'cell') h = cellPanel();
    else if (PK.panel === 'pt') h = pointPanel();
    else if (PK.panel === 'cari') h = searchPanel();
    else h = introPanel();
    panel.innerHTML = h;
    panel.scrollTop = 0;
    panel.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => closePanel());
    bindPanel();
    renderLegend();
  }
  function closePanel() {
    PK.panel = 'intro'; PK.cell = null; PK.det = null; PK.ptSel = null; PK.pt = null; PK.near = null; PK.results = null; PK.msg = '';
    cellL.clearLayers(); srchL.clearLayers(); renderPanel();
  }

  // intro: panduan + sel prioritas
  function introPanel() {
    const pr = G.cells.map((c) => ({ c, ...prio(c) })).sort((a, b) => (b.p - a.p) || (b.c.pop - a.c.pop)).slice(0, 10);
    return `<div class="pkhd"><div><div class="lbl">PANDUAN</div><h3>Mulai dari sini</h3></div></div>
      <ul class="pkhow"><li><b>Klik sel</b> di peta untuk melihat pelanggan, semua pemeriksaan, dan calon TO di sel itu.</li>
        <li>Ukuran sel <b>otomatis</b> mengecil saat diperbesar (500 → 250 → 100 m), atau pilih sendiri di kotak <b>SEL</b> pojok kanan atas peta.</li>
        <li><b>WARNA "Belum pernah diperiksa"</b> menandai area yang sama sekali belum disentuh sejak ${sinceTxt()}.</li>
        <li>Pilih golongan di baris <b>PEMERIKSAAN</b>: hanya yang dipilih yang tampil di peta.</li>
        <li><b>Cari</b> IDPEL, nama, atau alamat di bilah atas untuk melihat pelanggan dalam radius ${PK.rad} m. Zoom: tombol +/− atau <b>Ctrl + roda mouse</b>.</li></ul>
      <div><div class="lbl" style="margin-bottom:6px">SEL PRIORITAS DISISIR · ${LVL[G.k]}</div>
      <div class="pksub" style="margin-bottom:8px">Poin = risiko tinggi ×3 + sedang ×1 + belum diperiksa ≥180 hari / belum pernah (+2) atau 90–179 hari (+1) + ≥${num(bigPop())} pelanggan (+1).</div>
      ${pr.length ? `<div class="pklist">${pr.map(({ c, p, why }, i) => `<button type="button" class="pkrow pkprio" data-cell="${c.i},${c.j}"><span class="pkn">${i + 1}</span><span class="pkrm"><b>${esc(title(c.kel || '-'))} <span class="pkpt">${num(p)} poin</span></b>
        <small>Kec. ${esc(title(c.kec || '-'))}${c.gardu ? ` · Gardu ${esc(c.gardu)}` : ''} · ${c.ins ? 'cakupan ' + pct(c.cov, 2) : 'belum tersentuh periode ini'}</small>
        <span class="pkwhy">${why.join('') || '<span class="chip">cakupan terendah</span>'}</span></span></button>`).join('')}</div>` : empty('Koordinat DIL belum tersedia')}</div>`;
  }

  // detail sel
  function cellPanel() {
    const c = PK.cell.c;
    const det = PK.det;
    const rt = det ? det.risk.t : c.rt, rs = det ? det.risk.s : c.rs;
    let body = '<div class="loading" style="padding:16px"><span class="spin"></span>Memuat pelanggan & pemeriksaan di sel ini…</div>';
    if (det) {
      const top = det.pts.filter((q) => q[10] >= 35).sort((a, b) => b[10] - a[10]);
      const belum = det.pts.filter((q) => !q[9]).length;
      const per = det.periksa;
      const perN = {}; for (const q of per) perN[q[3]] = (perN[q[3]] || 0) + 1;
      body = `<div class="pk2"><div><div class="lbl">GARDU TERBANYAK</div><div class="pktx">${det.gardu.map((g) => `${esc(g.k || '-')} (${num(g.n)})`).join(', ') || '–'}</div></div>
          <div><div class="lbl">TARIF</div><div class="pktx">${det.tarif.map((g) => `${esc(g.k || '-')} (${num(g.n)})`).join(', ') || '–'}</div></div></div>
        <div class="pksub">${num(belum)} pelanggan belum diperiksa 12 bulan terakhir.</div>
        <div><div class="lbl" style="margin-bottom:8px">PEMERIKSAAN DI SEL INI · ${num(det.n_periksa)} (${esc(rentang(ctx.f.from, ctx.f.to))})</div>
        ${per.length ? `<div class="pkwhy" style="margin:0 0 8px">${GOLS.filter((g) => perN[g]).map((g) => `<span class="chip" style="background:#fff;border:1px solid var(--line)">${dot(golCol(g))} ${g} ${num(perN[g])}</span>`).join('')}</div>
          <div class="pklist pkscroll">${per.slice(0, 300).map((q, ix) => `<button type="button" class="pkrow" data-pi="${ix}"><span class="pkrm"><b>${dot(golCol(q[3]))} ${esc(title(q[2] || '-'))}</b><small class="mono">${esc(q[1] || '-')} · ${tglPendek(q[4])} · Regu ${esc(q[7] ?? '-')}${q[8] ? ' · ' + esc(title(q[8])) : ''}</small></span><span class="pkrr">${q[3] === 'Sesuai' ? '<span class="chip">Sesuai</span>' : golChip(q[3])}</span></button>`).join('')}</div>
          ${per.length > 300 ? `<div class="pksub">+${num(per.length - 300)} lainnya ada di file ekspor.</div>` : ''}`
          : '<div class="pksub">Belum ada pemeriksaan di sel ini pada periode terpilih.</div>'}</div>
        <div><div class="lbl" style="margin-bottom:8px">CALON TO DI SEL INI</div>
        ${top.length ? `<div class="pklist">${top.slice(0, 15).map((q) => `<button type="button" class="pkrow" data-go="${q[6]},${q[7]}" data-id="${esc(q[0])}"><span class="pkrm"><b>${esc(title(q[1] || '-'))}</b><small class="mono">${esc(q[0])} · ${esc(q[2] || '')}/${num(q[3])} VA · ${esc(q[5] || '-')}</small></span><span class="pkrr">${skorBadge(q[10])}</span></button>`).join('')}</div>${top.length > 15 ? `<div class="pksub">+${num(top.length - 15)} lainnya ada di file ekspor.</div>` : ''}`
          : `<div class="pksub">Tidak ada pelanggan berisiko tinggi/sedang yang belum diperiksa 90 hari terakhir.</div>`}</div>`;
    }
    return head(`SEL GRID ${LVL[c.k]}`, esc(title(c.kel || '-')), `Kec. ${esc(title(c.kec || '-'))}${c.gardu ? ` · Gardu dominan ${esc(c.gardu)}` : ''}<br>${lastTxt(c)}`,
      c.ins ? `<span class="chip info">Cakupan ${pct(c.cov, 2)}</span>` : '<span class="chip warn">Belum tersentuh periode ini</span>') +
      `<div class="pkkv">${stat('PELANGGAN AKTIF', num(c.pop))}${stat('DIPERIKSA PERIODE INI', num(c.ins))}${stat('PERNAH DIPERIKSA', `${num(c.ever)} <small style="font-size:12px;color:var(--muted)">${pct(c.evp, 1)}</small>`, c.ever ? '' : '#B86E00')}${stat('TEMUAN', num(c.tm))}
        ${stat('RISIKO TINGGI', num(rt), rt ? RISK_C.Tinggi : '')}${stat('RISIKO SEDANG', num(rs), rs ? '#b05d00' : '')}</div>
      <div class="pkbtns"><button type="button" class="btn pri" id="pkx" ${det ? '' : 'disabled'}>${icon(IC.dl, 16, '#fff')}Ekspor Excel</button>
        <a class="btn" href="${gmaps(c.lat, c.lon)}" target="_blank" rel="noopener">${icon(IC.ext, 16)}Google Maps</a>
        <button type="button" class="btn" id="pkzoom">${icon(IC.search, 16)}Perbesar ke sel</button></div>${body}`;
  }

  // detail titik (pemeriksaan atau calon TO)
  function pointPanel() {
    const p = PK.ptSel;
    if (p.kind === 'periksa') {
      const isT = p.gol !== 'Sesuai';
      return head(isT ? 'TITIK TEMUAN' : 'PEMERIKSAAN SESUAI', esc(title(p.nama || '-')), `<span class="mono">IDPEL ${esc(p.idpel || '-')}</span>${p.tgl ? ` · ${tglPendek(p.tgl)}` : ''}${p.regu ? ` · Regu ${esc(p.regu)}` : ''}${p.petugas ? ` · ${esc(title(p.petugas))}` : ''}`, isT ? golChip(p.gol) : '<span class="chip">Sesuai</span>') +
        `${isT ? `<div class="pksub">${esc(GOL_DESC[p.gol] || '')}</div>${p.rp !== undefined ? `<div class="pkkv">${stat('RP TS (DATA PERIKSA)', rp(p.rp))}</div>` : p.kwh !== undefined ? `<div class="pkkv">${stat('kWh TS (DATA PERIKSA)', num(p.kwh))}</div>` : ''}` : ''}
        <div class="pkbtns"><a class="btn" href="${gmaps(p.lat, p.lon)}" target="_blank" rel="noopener">${icon(IC.ext, 16)}Google Maps</a>
        <button type="button" class="btn pri" id="pknear">${icon(IC.search, 16, '#fff')}Pelanggan dalam ${PK.rad} m</button></div>
        <div class="pksub">Detail lengkap pemeriksaan ada di halaman <a href="#/detail">Detail Temuan</a>.</div>`;
    }
    return head('CALON TO', esc(title(p.nama || '-')), `<span class="mono">IDPEL ${esc(p.idpel)}</span>`, chipKat(p.kat) + ' ' + skorBadge(p.skor)) +
      `<div class="pktx">${esc(p.alamat || '-')}</div>
      <div class="pkkv">${stat('TARIF / DAYA', `${esc(p.tarif || '-')} / ${num(p.daya)}`)}${stat('LAYANAN', esc(title(p.layanan || '-')))}${stat('GARDU', esc(p.gardu || '-'))}${stat('SKOR', num(p.skor), RISK_C[p.kat])}</div>
      <div class="pkbtns"><a class="btn" href="${gmaps(p.lat, p.lon)}" target="_blank" rel="noopener">${icon(IC.ext, 16)}Google Maps</a>
      <button type="button" class="btn pri" id="pknear">${icon(IC.search, 16, '#fff')}Pelanggan dalam ${PK.rad} m</button></div>
      <div class="pksub">Pelanggan yang diperiksa dalam 90 hari terakhir tidak masuk daftar. Rincian sinyal skor ada di halaman <a href="#/risiko">Profil Risiko</a>.</div>`;
  }

  // hasil cari + pelanggan terdekat
  const colOf = (p) => (p.status === 'NON-DIL' ? NON_DIL : p.last_gol && p.last_gol !== 'Sesuai' ? C.s2 : p.last_tgl ? C.s1 : C.gray);
  function searchPanel() {
    let h = '';
    const R = PK.results;
    if (!PK.pt) {
      if (PK.msg) h = `<div class="pksub">${esc(PK.msg)}</div>`;
      else if (!R) h = '<div class="loading" style="padding:16px"><span class="spin"></span>Mencari…</div>';
      else if (!R.length) h = '<div class="pksub">Tidak ada hasil. Coba kata kunci lain atau ganti mode pencarian.</div>';
      else h = `<div class="lbl">${num(R.length)} HASIL · PILIH SALAH SATU</div><div class="pklist">${R.map((r, i) => `<button type="button" class="pkrow" data-ri="${i}"><span class="pkrm"><b>${esc(title(r.nama || r.label || ''))}</b><small>${r.idpel ? `<span class="mono">${esc(r.idpel)}</span> · ` : ''}${esc(r.alamat || '')}${r.status && r.status !== 'AKTIF' ? ` · ${esc(r.status)}` : ''}</small></span></button>`).join('')}</div>`;
      return head('PENCARIAN', `“${esc(PK.q)}”`, PK.mode === 'geo' ? 'Alamat bebas (OpenStreetMap)' : 'IDPEL / nama / alamat DIL') + h;
    }
    const nr = PK.near;
    const back = R && R.length > 1 ? `<button type="button" class="btn sm" id="pkback">‹ Hasil cari lain (${num(R.length)})</button>` : '';
    if (!nr) return head('PELANGGAN SEKITAR', esc(PK.pt.label || 'Titik'), `Radius ${PK.rad} m`) + back + '<div class="loading" style="padding:16px"><span class="spin"></span>Mencari pelanggan terdekat…</div>';
    const tm = nr.filter((p) => p.last_gol && p.last_gol !== 'Sesuai').length, ins = nr.filter((p) => p.last_tgl).length, rsk = nr.filter((p) => p.skor >= 35).length;
    const stt = (p) => (p.status === 'NON-DIL' ? `<span class="chip" style="background:#F6E7DF;color:${NON_DIL}">Non-DIL</span>` : p.last_tgl ? (p.last_gol && p.last_gol !== 'Sesuai' ? golChip(p.last_gol) : '<span class="chip">Sesuai</span>') : '<span class="chip">Belum</span>');
    return head('PELANGGAN SEKITAR', esc(PK.pt.label || 'Titik'), `Radius ${PK.rad} m dari titik merah`) + back +
      `<div class="pkkv">${stat('PELANGGAN', num(nr.length))}${stat('PERNAH DIPERIKSA', num(ins))}${stat('TEMUAN', num(tm), tm ? C.s2 : '')}${stat('BERISIKO', num(rsk), rsk ? RISK_C.Tinggi : '')}</div>
      <div class="pkbtns"><button class="btn pri" type="button" id="pksx">${icon(IC.dl, 16, '#fff')}Ekspor Excel</button><a class="btn" href="${gmaps(PK.pt.lat, PK.pt.lon)}" target="_blank" rel="noopener">${icon(IC.ext, 16)}Google Maps</a></div>
      ${nr.length ? `<div class="pklist">${nr.map((p, i) => `<button type="button" class="pkrow" data-ni="${i}"><span class="pkd">${num(p.jarak)} m</span><span class="pkrm"><b>${dot(colOf(p))} ${esc(title(p.nama || '-'))}</b><small><span class="mono">${esc(p.idpel)}</span> · ${esc(p.tarif || '-')}/${num(p.daya)} VA${p.alamat ? ' · ' + esc(p.alamat) : ''}${p.last_tgl ? ` · periksa ${tglPendek(p.last_tgl)}` : ''}</small></span><span class="pkrr">${stt(p)}${skorBadge(p.skor)}</span></button>`).join('')}</div>`
        : '<div class="pksub">Tidak ada pelanggan dalam radius ini. Perbesar radius atau pilih titik lain.</div>'}`;
  }

  function bindPanel() {
    panel.querySelectorAll('[data-cell]').forEach((b) => b.onclick = () => { const c = G.cellBy.get(b.dataset.cell); if (c) selectCell(c, true); });
    panel.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => { const [la, lo] = b.dataset.go.split(',').map(Number); if (la) { m.setView([la, lo], 19); flash(la, lo); } });
    panel.querySelectorAll('[data-pi]').forEach((b) => b.onclick = () => { const q = PK.det.periksa[+b.dataset.pi]; if (q && q[5]) { m.setView([+q[5], +q[6]], 19); flash(+q[5], +q[6]); } });
    panel.querySelectorAll('[data-ri]').forEach((b) => b.onclick = () => { const r = PK.results[+b.dataset.ri]; pickResult(r); });
    panel.querySelectorAll('[data-ni]').forEach((b) => b.onclick = () => { const p = PK.near[+b.dataset.ni]; if (p.lat) { m.setView([p.lat, p.lon], 19); const mk = srchL._pk && srchL._pk[+b.dataset.ni]; if (mk) mk.openPopup(); } });
    const back = panel.querySelector('#pkback'); if (back) back.onclick = () => { PK.pt = null; PK.near = null; srchL.clearLayers(); renderPanel(); };
    const nb = panel.querySelector('#pknear'); if (nb) nb.onclick = () => nearAt({ lat: PK.ptSel.lat, lng: PK.ptSel.lon }, `${PK.ptSel.idpel || ''} · ${title(PK.ptSel.nama || '')}`, PK.ptSel.idpel);
    const zb = panel.querySelector('#pkzoom'); if (zb) zb.onclick = () => { const c = PK.cell && PK.cell.c; if (c) m.fitBounds(cellBounds(c), { padding: [24, 24], maxZoom: 19 }); };
    const xb = panel.querySelector('#pkx');
    if (xb) xb.onclick = () => {
      const c = PK.cell.c, det = PK.det; if (!det) return;
      const row = (q) => ({ IDPEL: q[0], Nama: q[1], Alamat: q[11], Tarif: q[2], Daya: q[3], Layanan: q[4], Gardu: q[5], 'Skor risiko': q[10], Kategori: katOf(q[10]) || (q[10] ? 'Rendah' : ''),
        'Diperiksa terakhir (12 bln)': q[9] || '', 'Hasil periode ini': q[8] || '', Lat: q[6], Lon: q[7], 'Google Maps': q[6] ? gmaps(q[6], q[7]) : '' });
      const calon = det.pts.filter((q) => !q[9]).sort((a, b) => (b[10] || 0) - (a[10] || 0) || (b[3] || 0) - (a[3] || 0));
      const per = det.periksa.map((q) => ({ 'ID P2TL': q[0], IDPEL: q[1], Nama: q[2], Golongan: q[3], Tanggal: q[4], Regu: q[7], Petugas: q[8], 'kWh TS': q[9], Tarif: q[10], Daya: q[11], Tindakan: q[12], Lat: q[5], Lon: q[6], 'Google Maps': q[5] ? gmaps(q[5], q[6]) : '' }));
      exportXlsx(`peta_kerja_${title(c.kel || 'sel').replace(/\s+/g, '_')}_${LVL[c.k].replace(/[±\s]/g, '')}_${c.i}_${c.j}.xlsx`,
        [['Calon TO (belum diperiksa)', calon.map(row)], ['Pemeriksaan periode ini', per], ['Semua pelanggan aktif', det.pts.map(row)]]);
    };
    const sx = panel.querySelector('#pksx');
    if (sx) sx.onclick = () => exportXlsx(`pelanggan_sekitar_${(PK.pt.idpel || 'titik')}_${PK.rad}m.xlsx`, [['Sekitar', PK.near.map((p) => ({ 'Jarak (m)': +p.jarak, IDPEL: p.idpel, Nama: p.nama, Alamat: p.alamat, Tarif: p.tarif, Daya: p.daya, Layanan: p.layanan, Gardu: p.gardu,
      Status: p.status, 'Periksa terakhir': p.last_tgl, 'Golongan terakhir': p.last_gol, 'Skor risiko': p.skor, Kategori: katOf(p.skor) || '', Lat: p.lat, Lon: p.lon, 'Google Maps': p.lat ? gmaps(p.lat, p.lon) : '' }))]]);
  }
  function flash(la, lo) {
    const r = L().circleMarker([la, lo], { radius: 16, color: '#0E1726', weight: 2.5, fill: false, dashArray: '4 3' }).addTo(srchL);
    setTimeout(() => { try { srchL.removeLayer(r); } catch (e) { /* abaikan */ } }, 2500);
  }

  // ---------- aksi ----------
  async function selectCell(c, fly) {
    PK.cell = { i: c.i, j: c.j, k: c.k, c }; PK.det = null; PK.panel = 'cell'; PK.ptSel = null; PK.pt = null; PK.near = null;
    cellL.clearLayers(); srchL.clearLayers();
    L().rectangle(cellBounds(c), { color: '#0E1726', weight: 3, opacity: 1, fill: false, interactive: false }).addTo(cellL);
    if (fly) m.fitBounds(cellBounds(c), { padding: [40, 40], maxZoom: c.k === 2 ? 19 : 17 });
    renderPanel();
    let det;
    try { det = await ctx.rpc('f_cell2', { p_i: c.i, p_j: c.j, p_k: c.k, p_from: ctx.f.from, p_to: ctx.f.to }); }
    catch (e) { if (live()) panel.querySelector('.loading')?.replaceWith(Object.assign(document.createElement('div'), { className: 'err', textContent: e.message })); return; }
    if (!live() || !PK.cell || PK.cell.c !== c) return;
    PK.det = det; c.rt = det.risk.t; c.rs = det.risk.s;
    for (const q of det.pts) {
      const [idpel, nama, tarif, daya, lay, gardu, lat, lon, g, last, skor] = q;
      if (!lat || !lon) continue;
      const kat = katOf(skor);
      const col = g ? (g.split(',').some((x) => x !== 'Sesuai') ? C.s2 : C.s1) : last ? C.s1 : C.gray;
      L().circleMarker([lat, lon], kat ? { radius: 5.5, color: '#0E1726', weight: 1.6, fillColor: RISK_C[kat], fillOpacity: 1 } : { radius: 3.5, color: '#fff', weight: 0.6, fillColor: col, fillOpacity: 0.9 })
        .bindPopup(`<b>${esc(title(nama || '-'))}</b><br>IDPEL ${esc(idpel)} · ${esc(tarif)}/${num(daya)} VA<br>${esc(title(lay || ''))} · Gardu ${esc(gardu || '-')}<br>${last ? 'Diperiksa terakhir ' + tglPendek(last) : 'Belum diperiksa 12 bulan terakhir'}${kat ? `<br><b style="color:${RISK_C[kat]}">Skor risiko ${num(skor)} (${kat})</b>` : ''}<br><a href="${gmaps(lat, lon)}" target="_blank" rel="noopener">Google Maps</a>`)
        .on('click', hit).addTo(cellL);
    }
    // semua pemeriksaan di sel (termasuk Sesuai), tampil walau golongannya tidak dipilih di filter
    for (const q of det.periksa) {
      const [id, idpel, nama, g, tgl, lat, lon, regu, petugas, kwh] = q;
      if (!lat || !lon) continue;
      const isT = g !== 'Sesuai';
      L().circleMarker([+lat, +lon], { radius: isT ? 6 : 4.2, color: '#fff', weight: 1.4, fillColor: golCol(g), fillOpacity: 1 })
        .bindTooltip(`${esc(title(nama || '-'))} · ${esc(g)} · ${tglPendek(tgl)}`, { className: 'pktip' })
        .on('click', () => { hit(); selectPoint({ kind: 'periksa', lat: +lat, lon: +lon, gol: g, idpel, nama, tgl, regu, petugas, kwh }, true); }).addTo(cellL);
    }
    renderPanel();
  }
  function selectPoint(p, keepCell = false) {
    PK.ptSel = p; PK.panel = 'pt'; PK.pt = null; PK.near = null;
    if (!keepCell) { PK.cell = null; PK.det = null; cellL.clearLayers(); }
    srchL.clearLayers(); flash(p.lat, p.lon);
    renderPanel();
  }
  function pickResult(r) {
    nearAt({ lat: +r.lat, lng: +r.lon }, r.idpel ? `${r.idpel} · ${title(r.nama || '')}` : r.label, r.idpel || null);
  }
  async function nearAt(ll, label, idpel = null) {
    PK.pt = { lat: ll.lat, lon: ll.lng, label: label || `Titik ${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`, idpel };
    PK.near = null; PK.panel = 'cari'; PK.cell = null; PK.det = null; PK.ptSel = null;
    if (!label) PK.results = null;
    cellL.clearLayers();
    drawNear(); renderPanel();
    let nr;
    try { nr = await ctx.rpc('f_sekitar', { p_lat: PK.pt.lat, p_lon: PK.pt.lon, p_radius: PK.rad }, { cache: false }); }
    catch (e) { PK.near = []; if (live()) { renderPanel(); panel.insertAdjacentHTML('beforeend', `<div class="err">${esc(e.message)}</div>`); } return; }
    if (!live() || !PK.pt || PK.pt.lat !== ll.lat || PK.pt.lon !== ll.lng) return;
    PK.near = nr; drawNear(); renderPanel();
  }
  function drawNear() {
    srchL.clearLayers(); srchL._pk = [];
    if (!PK.pt) return;
    L().circle([PK.pt.lat, PK.pt.lon], { radius: PK.rad, color: '#0E1726', weight: 1.5, fill: true, fillOpacity: 0.04, dashArray: '5 4', interactive: false }).addTo(srchL);
    (PK.near || []).forEach((p, i) => {
      if (!p.lat) return;
      const kat = katOf(p.skor);
      srchL._pk[i] = L().circleMarker([p.lat, p.lon], kat ? { radius: 6.5, color: '#0E1726', weight: 2, fillColor: colOf(p), fillOpacity: 1 } : { radius: 5.5, color: '#fff', weight: 1.2, fillColor: colOf(p), fillOpacity: 0.95 })
        .bindPopup(`<b>${esc(title(p.nama || '-'))}</b><br>IDPEL ${esc(p.idpel)} · ${esc(p.tarif || '')}/${num(p.daya)} VA<br>${esc(p.alamat || '')}<br>${p.last_tgl ? `Diperiksa ${tglPendek(p.last_tgl)} (${esc(p.last_gol)})` : 'Belum pernah diperiksa'}${kat ? `<br><b style="color:${RISK_C[kat]}">Skor risiko ${num(p.skor)} (${kat})</b>` : ''}<br>Jarak ${num(p.jarak)} m · <a href="${gmaps(p.lat, p.lon)}" target="_blank" rel="noopener">Google Maps</a>`)
        .on('click', hit).addTo(srchL);
    });
    L().circleMarker([PK.pt.lat, PK.pt.lon], { radius: 8, color: '#fff', weight: 2.5, fillColor: '#d03b3b', fillOpacity: 1 }).bindTooltip(esc(PK.pt.label || 'Titik cari'), { className: 'pktip' }).on('click', hit).addTo(srchL);
    const z = PK.rad <= 50 ? 19 : 18;
    if (m.getZoom() < z - 0.5 || !m.getBounds().contains([PK.pt.lat, PK.pt.lon])) m.setView([PK.pt.lat, PK.pt.lon], z);
  }

  // ---------- kontrol ----------
  const box = ctx.el;
  box.querySelector('#pkf').onsubmit = async (e) => {
    e.preventDefault();
    PK.q = box.querySelector('#pkq').value.trim(); PK.mode = box.querySelector('#pkm').value;
    PK.pt = null; PK.near = null; PK.results = null; PK.msg = ''; PK.cell = null; PK.det = null; PK.ptSel = null; PK.panel = 'cari';
    cellL.clearLayers(); srchL.clearLayers();
    if (PK.q.length < 3) { PK.msg = 'Isi minimal 3 karakter.'; renderPanel(); return; }
    renderPanel();
    const q = PK.q;
    try {
      let res;
      if (PK.mode === 'dil') res = await ctx.rpc('f_cari', { p_q: q }, { cache: false });
      else {
        const a = area0;
        const vb = a ? `${a[0][1]},${a[1][0]},${a[1][1]},${a[0][0]}` : '106.74,-6.19,106.93,-6.43';
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&countrycodes=id&accept-language=id&viewbox=${vb}&q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } });
        res = (await r.json()).map((g) => ({ lat: +g.lat, lon: +g.lon, label: g.display_name }));
      }
      if (!live() || PK.q !== q) return;
      PK.results = res;
      if (res.length === 1) { pickResult(res[0]); return; }
    } catch (er) { if (!live()) return; PK.results = null; PK.msg = 'Pencarian gagal: ' + er.message; }
    renderPanel();
  };
  box.querySelector('#pkr').onchange = (e) => { PK.rad = Number(e.target.value); if (PK.pt) nearAt({ lat: PK.pt.lat, lng: PK.pt.lon }, PK.pt.label, PK.pt.idpel); else renderPanel(); };
  box.querySelectorAll('[data-lay]').forEach((b) => b.onclick = () => {
    const kk = b.dataset.lay; PK.lay[kk] = !PK.lay[kk];
    b.classList.toggle('on', PK.lay[kk]); b.setAttribute('aria-pressed', PK.lay[kk]);
    applyLayers(); if (kk === 'risiko') drawRisk();
  });
  box.querySelectorAll('[data-klik]').forEach((b) => b.onclick = () => {
    PK.klik = b.dataset.klik;
    box.querySelectorAll('[data-klik]').forEach((x) => x.classList.toggle('on', x === b));
    m.getContainer().classList.toggle('pkcross', PK.klik === 'cari');
  });
  box.querySelectorAll('[data-lvl]').forEach((b) => b.onclick = () => {
    PK.lvl = b.dataset.lvl === 'auto' ? 'auto' : Number(b.dataset.lvl);
    box.querySelectorAll('[data-lvl]').forEach((x) => x.classList.toggle('on', x === b));
    ensureLevel(); const now = box.querySelector('#pklvlnow'); if (now) now.textContent = PK.lvl === 'auto' ? `= ${LVL[G.k]}` : 'm';
  });
  box.querySelectorAll('[data-warna]').forEach((b) => b.onclick = () => {
    PK.warna = b.dataset.warna;
    box.querySelectorAll('[data-warna]').forEach((x) => x.classList.toggle('on', x === b));
    if (!PK.lay.grid) { PK.lay.grid = true; const gb = box.querySelector('[data-lay="grid"]'); gb.classList.add('on'); gb.setAttribute('aria-pressed', true); applyLayers(); }
    restyle(); refreshKpi(); renderLegend();
  });
  const syncGol = () => {
    box.querySelectorAll('[data-gol]').forEach((x) => { const on = PK.gol.has(x.dataset.gol); x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
    if (PK.gol.size && !PK.lay.periksa) { PK.lay.periksa = true; const pb = box.querySelector('[data-lay="periksa"]'); pb.classList.add('on'); pb.setAttribute('aria-pressed', true); applyLayers(); }
    drawPeriksa(); renderLegend();
  };
  box.querySelectorAll('[data-gol]').forEach((b) => b.onclick = () => { const g = b.dataset.gol; if (PK.gol.has(g)) PK.gol.delete(g); else PK.gol.add(g); syncGol(); });
  box.querySelector('#pkgolall').onclick = () => { PK.gol = new Set(GOL_ORDER); syncGol(); };
  box.querySelector('#pkgolnone').onclick = () => { PK.gol = new Set(); syncGol(); };
  box.querySelectorAll('[data-rkat]').forEach((b) => b.onclick = () => {
    const kk = b.dataset.rkat; PK.rkat[kk] = !PK.rkat[kk];
    b.classList.toggle('on', PK.rkat[kk]); b.setAttribute('aria-pressed', PK.rkat[kk]);
    drawRisk(); renderLegend();
  });
  box.querySelector('#pkfit').onclick = fitArea;
  const zoomTo = (pred) => {
    const cs = G.cells.filter(pred); if (!cs.length) return;
    const s = c5(G.k);
    m.fitBounds([[Math.min(...cs.map((c) => c.j)) * s, Math.min(...cs.map((c) => c.i)) * s], [(Math.max(...cs.map((c) => c.j)) + 1) * s, (Math.max(...cs.map((c) => c.i)) + 1) * s]], { padding: [20, 20] });
    box.querySelector('.pkcard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  box.querySelectorAll('#pkkec tbody tr').forEach((tr) => tr.onclick = () => { const r = d.kec[+tr.dataset.i]; zoomTo((c) => c.kec === r.k); });
  box.querySelectorAll('#pkkel tbody tr').forEach((tr) => tr.onclick = () => { const r = d.kel[+tr.dataset.i]; zoomTo((c) => c.kel === r.k && c.kec === r.kec); });

  box.querySelector('#pkper').onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  // ---------- keadaan awal ----------
  drawGrid(); drawPeriksa(); applyLayers(); drawRisk();
  ensureLevel(); // bila zoom awal ternyata butuh ukuran sel lain
  if (!PK.entered) {
    PK.entered = true;
    const card = box.querySelector('.pkcard');
    requestAnimationFrame(() => { if (card.isConnected) window.scrollTo({ top: Math.max(0, card.getBoundingClientRect().top + window.scrollY - 10), behavior: 'auto' }); });
  }
  const cur = PK.cell && PK.cell.k === G.k && G.cellBy.get(`${PK.cell.i},${PK.cell.j}`);
  if (PK.panel === 'cell' && cur) selectCell(cur, false);
  else if (PK.panel === 'cari' && PK.pt) { drawNear(); renderPanel(); if (!PK.near) nearAt({ lat: PK.pt.lat, lng: PK.pt.lon }, PK.pt.label, PK.pt.idpel); }
  else if (PK.panel === 'pt' && PK.ptSel) { flash(PK.ptSel.lat, PK.ptSel.lon); renderPanel(); }
  else { if (PK.panel !== 'cari') PK.panel = 'intro'; PK.cell = null; renderPanel(); }
  setTimeout(() => { if (live()) m.invalidateSize(); }, 50);
}
