import { cakupan } from './peta.js';
import { hitungCapaian, capaianCard, kumulatifCard, komposisiCard, raporCard, periodeCard, bindPeriode, capaianNotes, printHead } from './eksekutif.js';
import { C, GOLC, GOL_ORDER, GOL_DESC, RAMP, esc, num, pct, rp, ratio, kpi, delta, card, grid, legend, empty, hbars, vbars, vstack, stack, table,
  golChip, lineChart, icon, IC, tglPendek, rentang, blthLabel, title, exportXlsx, jam } from './ui.js';

const DAYA_LBL = { 1: '≤450 VA', 2: '900 VA', 3: '1.300 VA', 4: '2.200 VA', 5: '3.500–5.500 VA', 6: '>5.500 VA' };
const sumBy = (a, k) => a.reduce((s, r) => s + (+r[k] || 0), 0);
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
let maps = [];
function dropMaps() { for (const m of maps) { try { m.remove(); } catch (e) { /* abaikan */ } } maps = []; }
function osm(el, opts = {}) {
  const m = window.L.map(el, { scrollWheelZoom: false, ...opts });
  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(m);
  maps.push(m);
  return m;
}
const gmaps = (lat, lon) => `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;

// pengelompokan tren: harian (≤62 hari), mingguan (≤200), bulanan
function trendMode(from, to) { const days = Math.round((new Date(to) - new Date(from)) / 864e5) + 1; return days <= 62 ? 'hari' : 'bulan'; }
function bucketKey(tgl, mode) {
  if (mode === 'minggu') { const dt = new Date(tgl); const dow = (dt.getDay() + 6) % 7; dt.setDate(dt.getDate() - dow); return dt.toISOString().slice(0, 10); }
  if (mode === 'bulan') return tgl.slice(0, 7);
  return tgl;
}
function bucketLabel(k, mode) { return mode === 'hari' ? String(+k.slice(8, 10)) : mode === 'minggu' ? tglPendek(k).replace(/ \d{4}$/, '') : blthLabel(+k.replace('-', '')); }
function bucketDaily(daily, from, to) {
  const mode = trendMode(from, to);
  const map = new Map();
  for (const d of daily) {
    let k = d.tgl, lab;
    if (mode === 'minggu') { const dt = new Date(d.tgl); const dow = (dt.getDay() + 6) % 7; dt.setDate(dt.getDate() - dow); k = dt.toISOString().slice(0, 10); }
    if (mode === 'bulan') k = d.tgl.slice(0, 7);
    const cur = map.get(k) || { k, n: 0, t: 0, rp: 0 };
    cur.n += d.n; cur.t += d.t; cur.rp += +d.rp; map.set(k, cur);
  }
  const out = [...map.values()].sort((a, b) => (a.k < b.k ? -1 : 1));
  for (const o of out) o.lab = mode === 'hari' ? String(+o.k.slice(8, 10)) : mode === 'minggu' ? tglPendek(o.k).replace(/ \d{4}$/, '') : blthLabel(+o.k.replace('-', ''));
  return { mode, rows: out };
}


// Komposisi P1–P4 dari Laporan TS terbayar (tanggal register dalam periode)
function golTsCard(d, ctx) {
  const MAIN = ['P1', 'P2', 'P3', 'P4', 'K1', 'K2'];
  const all = d.gol_ts || [];
  const g = all.filter((r) => MAIN.includes(r.gol));
  const other = all.filter((r) => !MAIN.includes(r.gol));
  const ts = d.ts || {};
  const sub = 'Sumber: Laporan TS terbayar, berdasarkan tanggal register dalam periode terpilih.';
  if (!g.length) {
    return card('Komposisi golongan P1–P4', sub, empty(ts.min ? `Tidak ada Laporan TS terbayar pada periode ini.<br>Data laporan TS tersedia ${rentang(ts.min, ts.max)}.` : 'Belum ada Laporan TS terbayar. Unggah di halaman Kelola Data.'));
  }
  const order = GOL_ORDER.filter((x) => g.find((r) => r.gol === x)).concat(g.map((r) => r.gol).filter((x) => !GOL_ORDER.includes(x)));
  const by = Object.fromEntries(g.map((r) => [r.gol, r]));
  const totRp = sumBy(g, 'rp'), totN = sumBy(g, 'n');
  return card('Komposisi golongan P1–P4', sub,
    `${legend(order.map((x) => [x, GOLC[x] || '#9AA3B2']))}
     <div><div class="lbl" style="margin-bottom:8px">Jumlah pelanggan · ${num(totN)}</div>${stack(order.map((x) => ({ l: x, v: by[x].n, c: GOLC[x] || '#9AA3B2', tip: `${x}: ${num(by[x].n)} pelanggan` })))}</div>
     <div><div class="lbl" style="margin-bottom:8px">Nilai Rp TS · ${rp(totRp)}</div>${stack(order.map((x) => ({ l: x, v: +by[x].rp, c: GOLC[x] || '#9AA3B2', tip: `${x}: ${rp(by[x].rp)}` })))}</div>
     ${table([{ h: 'Golongan', k: 'gol', wrapS: 1, f: (v) => `${golChip(v)}<br><small style="color:var(--muted)">${esc(GOL_DESC[v] || '')}</small>` }, { h: 'Pelanggan', k: 'n', r: 1, f: num },
       { h: 'kWh', k: 'kwh', r: 1, f: num }, { h: 'Rp TS', k: 'rp', r: 1, f: (v) => rp(v) }, { h: 'Total P2TL', k: 'total', r: 1, f: (v) => rp(v) }], order.map((x) => by[x]))}
     <p class="sub">Golongan "KWH" (koreksi kWh) digabung ke K2. DKRP dan UPDATEANGSURAN tidak ditampilkan.</p>`);
}

// ======================= RINGKASAN =======================
async function ringkasan(ctx) {
  const [d, cap] = await Promise.all([
    ctx.rpc('f_ringkasan', ctx.params(ctx.cmp ? { p_cmp_from: ctx.cmp[0], p_cmp_to: ctx.cmp[1] } : {})),
    ctx.rpc('f_capaian', { p_to: ctx.f.to }).catch((e) => ({ err: e.message })),
  ]);
  if (!ctx.alive()) return;
  const k = d.kpi, c = d.cmp;
  const o = cap.err ? null : hitungCapaian(cap, ctx.f.from, ctx.f.to);
  const hit = ratio(k.t, k.n), chit = c ? ratio(c.t, c.n) : null;
  const cmpTxt = ctx.cmp ? `<div class="note">Dibandingkan dengan ${rentang(ctx.cmp[0], ctx.cmp[1])}.</div>` : '';
  const ts = d.ts || {};
  const anom = k.anomali ? `<div class="note warn"><b>${num(k.anomali)} temuan bernilai TS tidak wajar</b> (total ${num(k.kwh_anomali)} kWh · ${rp(k.rp_anomali)}) dikeluarkan dari perhitungan kWh dan Rp. Nilainya melebihi batas wajar (kWh > 20.000 jam × kVA atau Rp > Rp60.000 per VA), kemungkinan salah input atau format angka di file sumber. <a href="#/detail" id="goanom">Lihat daftarnya</a>.</div>` : '';
  const tc = ctx.cmp ? (d.ts_cmp || {}) : null;
  const kp = grid([
    kpi('kWh TS TERBAYAR', ts.n ? num(ts.kwh) : '–', ts.n ? `${num(ts.n)} pelanggan (P1–P4, K1–K2)` : 'Tidak ada laporan TS pada periode ini', C.s6, tc ? delta(+ts.kwh || 0, +tc.kwh || 0) : ''),
    kpi('PELANGGAN DIPERIKSA', num(k.n), `${num(k.hari)} hari kerja · ${num(k.hari ? k.n / k.hari : 0)}/hari`, C.s1, c ? delta(k.n, c.n) : ''),
    kpi('TEMUAN', num(k.t), `Hit rate <b class="mono">${pct(hit)}</b>`, C.s2, c ? delta(hit, chit, 'up', 'pp') : ''),
    kpi('POTENSI TS (HASIL PERIKSA)', rp(k.rp), `${num(k.kwh)} kWh${k.anomali ? ` · ${num(k.anomali)} nilai tidak wajar dikecualikan` : ''}`, C.s3, c ? delta(k.rp, c.rp) : ''),
    kpi('TS TERBAYAR (LAPORAN TS)', ts.n ? rp(ts.total) : '–', ts.n ? `${num(ts.n)} pelanggan · Rp TS ${rp(ts.rp_ts)}` : 'Tidak ada laporan TS pada periode ini', C.s4, tc ? delta(+ts.total || 0, +tc.total || 0) : ''),
    kpi('CAKUPAN PELANGGAN AKTIF', pct(ratio(k.uniq, k.aktif), 2), `${num(k.uniq)} dari ${num(k.aktif)} pelanggan`, C.s7, c ? delta(ratio(k.uniq, k.aktif), ratio(c.uniq, k.aktif), 'up', 'pp') : ''),
  ].join(''), 160);
  // pemeriksaan & temuan per hari (dipakai tab Detail periode dan deteksi lonjakan)
  const b = bucketDaily(d.daily, ctx.f.from, ctx.f.to);
  const med = median(b.rows.map((r) => r.t));
  const spikes = b.rows.filter((r) => r.t >= 10 && r.t > 3 * Math.max(med, 1));
  const periksaHtml = b.rows.length ? `<div class="two"><div><div class="lbl" style="margin-bottom:6px">Pemeriksaan per hari</div>${vbars(b.rows.map((r) => ({ l: r.lab, v: r.n, tip: `${tglPendek(r.k)}: ${num(r.n)} pemeriksaan` })), { every: 'auto' })}</div>
     <div><div class="lbl" style="margin-bottom:6px">Temuan per hari</div>${vbars(b.rows.map((r) => ({ l: r.lab, v: r.t, c: spikes.includes(r) ? C.hl : C.s2, tip: `${tglPendek(r.k)}: ${num(r.t)} temuan` })), { color: C.s2, every: 'auto' })}</div></div>
     ${spikes.length ? `<div class="note"><b>Lonjakan temuan:</b> ${spikes.slice(0, 4).map((x) => `${tglPendek(x.k)} (${num(x.t)} temuan)`).join('; ')}. Batang berwarna gelap = lebih dari 3× median.</div>` : ''}` : empty('Tidak ada pemeriksaan pada periode ini');
  const ins = [];
  if (o) ins.push(...capaianNotes(o));
  const today = new Date(); const curM = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  if (ctx.f.to >= curM + '-01') ins.push(`Laporan TS bulan berjalan masih bertambah karena temuan baru tercatat setelah register; angka kWh dan Rp TS bulan ini bersifat <b>sementara</b>.`);
  if (spikes.length && b.mode === 'hari') ins.push(`Lonjakan temuan pada ${spikes.slice(0, 3).map((x) => `${tglPendek(x.k)} (${num(x.t)})`).join(', ')}, lebih dari 3× median harian. Periksa apakah ini input yang menumpuk sebelum ditafsirkan sebagai hasil lapangan.`);
  const gts = (d.gol_ts || []).filter((g) => /^[PK]\d$/.test(g.gol || ''));
  if (gts.length) {
    const tot = sumBy(gts, 'rp');
    const top = gts[0];
    ins.push(`Pada periode ini, <b>${esc(top.gol)}</b> menyumbang <b>${pct(ratio(top.rp, tot), 0)}</b> nilai Rp TS terbayar dari ${num(top.n)} pelanggan.`);
    const perCase = [...gts].sort((a, b2) => b2.rp / b2.n - a.rp / a.n)[0];
    if (perCase.gol !== top.gol) ins.push(`Nilai per pelanggan tertinggi: <b>${esc(perCase.gol)}</b>, ${rp(perCase.rp / perCase.n)} per pelanggan.`);
  }
  if (k.anomali) ins.push(`<b>${num(k.anomali)}</b> baris pemeriksaan bernilai TS tidak wajar sehingga tidak dihitung. Perbaiki di file sumber lalu unggah ulang file bulan tersebut; baris dengan ID_P2TL sama akan diperbarui.`);
  ins.push(`Cakupan <b>${pct(ratio(k.uniq, k.aktif), 2)}</b> pelanggan aktif pada periode ini. Lihat <a href="#/risiko">Profil Risiko</a> untuk menajamkan target operasi.`);
  if (c) ins.push(`Dibanding periode pembanding: pemeriksaan ${delta(k.n, c.n)}, temuan ${delta(k.t, c.t)}, nilai TS ${delta(k.rp, c.rp)}.`);
  const capHtml = o ? capaianCard(o) : `<div class="note warn">Blok capaian target belum tersedia (${esc(cap.err)}). Jalankan file <b>supabase/update-v1.6.sql</b> dan <b>update-v1.7.sql</b> di Supabase SQL Editor.</div>`;
  const notes = card('Catatan analis (otomatis)', null, `<ul class="ins">${ins.map((x) => `<li>${x}</li>`).join('')}</ul>`, 'data-print="notes"');
  ctx.el.innerHTML = printHead(ctx, ctx.CONFIG.unit) + cmpTxt + anom + capHtml + kp +
    `<div class="two">${o ? kumulatifCard(o) : ''}${komposisiCard(d, ctx)}</div>` +
    (o ? raporCard(o) : '') + periodeCard(d, o, ctx, periksaHtml) + notes;
  const ga = ctx.el.querySelector('#goanom'); if (ga) ga.onclick = () => { DQ.ap2t = 'ANOMALI'; DQ.page = 0; };
  bindPeriode(ctx.el);
}

// ======================= TEMUAN =======================
let exP4 = false;
async function temuan(ctx) {
  const d = await ctx.rpc('f_ringkasan', ctx.params());
  if (!ctx.alive()) return;
  const k = d.kpi;
  const gts = Object.fromEntries((d.gol_ts || []).filter((g) => /^[PK]\d$/.test(g.gol || '')).map((g) => [g.gol, g]));
  const top4 = GOL_ORDER.filter((g) => gts[g]).slice(0, 4);
  const kp = top4.length ? grid(top4.map((g) => kpi(`${g} · LAPORAN TS`, num(gts[g].n) + ' plg', `${rp(gts[g].rp)} · ${num(gts[g].kwh)} kWh<br><small>${esc(GOL_DESC[g])}</small>`, GOLC[g])).join(''), 200) : '';
  const gb = golTsCard(d, ctx);
  const lap = card('Status temuan di lapangan', 'Golongan sementara menurut hasil pemeriksaan (sebelum penetapan TS).', table([{ h: 'Golongan', k: 'gol', f: golChip }, { h: 'Kasus', k: 'n', r: 1, f: num }], d.gol));
  const dy = d.daya.map((r) => ({ l: DAYA_LBL[r.o], n: exP4 ? r.n_np4 : r.n, t: exP4 ? r.t_np4 : r.t }));
  const db = card('Hit rate per kelompok daya', 'Persentase pemeriksaan yang berujung temuan.',
    `<div class="seg"><button type="button" id="p4a" class="${exP4 ? '' : 'on'}">Semua temuan</button><button type="button" id="p4b" class="${exP4 ? 'on' : ''}">Kecualikan P4</button></div>` +
    hbars(dy.map((r) => ({ l: r.l, v: ratio(r.t, r.n) || 0, x: `(${num(r.t)}/${num(r.n)})`, tip: `${r.l}: ${num(r.t)} temuan dari ${num(r.n)} diperiksa` })), { fmt: (v) => pct(v), lw: 112, vw: 140 }) +
    (exP4 ? '' : '<div class="note">Kasus P4 (non-pelanggan) umumnya dicatat dengan daya kecil sehingga kelompok 450 VA tampak tinggi. Pilih "Kecualikan P4" untuk melihat profil pelanggan resmi.</div>'));
  const pb = card('Hit rate per peruntukan', null, hbars(d.peruntukan.map((r) => ({ l: title(r.k || '-'), v: ratio(r.t, r.n) || 0, x: `(${num(r.t)}/${num(r.n)})` })), { fmt: (v) => pct(v), lw: 110, vw: 140 }));
  const pm = d.pemutusan;
  const pc = { 'Tidak Diputus': C.light, Bongkar: C.s1, Diputus: C.dark };
  const tb = card('Tindakan di lokasi', `Dari ${num(k.t)} temuan.`, stack(pm.map((p) => ({ l: p.k, v: p.n, c: pc[p.k] || C.gray })), 32) + legend(pm.map((p) => [`${p.k || '-'} · ${num(p.n)}`, pc[p.k] || C.gray])));
  const lt = card('Prabayar vs paskabayar', null, table([{ h: 'Layanan', k: 'k', f: (v) => esc(title(v || '-')) }, { h: 'Diperiksa', k: 'n', r: 1, f: num }, { h: 'Temuan', k: 't', r: 1, f: num },
    { h: 'Hit rate', k: 'x', r: 1, f: (v, r) => pct(ratio(r.t, r.n)) }, { h: 'Rp TS', k: 'rp', r: 1, f: (v) => rp(v) }], d.layanan));
  const tt = card('Per tarif (min. 10 diperiksa)', null, table([{ h: 'Tarif', k: 'k' }, { h: 'Diperiksa', k: 'n', r: 1, f: num }, { h: 'Temuan', k: 't', r: 1, f: num },
    { h: 'Hit rate', k: 'x', r: 1, f: (v, r) => pct(ratio(r.t, r.n)) }, { h: 'Rp TS', k: 'rp', r: 1, f: (v) => rp(v) }], d.tarif, { maxh: 360 }));
  ctx.el.innerHTML = kp + `<div class="two">${gb}${db}${pb}${tb}${lap}${lt}${tt}</div>`;
  ctx.el.querySelector('#p4a').onclick = () => { exP4 = false; temuan(ctx); };
  ctx.el.querySelector('#p4b').onclick = () => { exP4 = true; temuan(ctx); };
}

// ======================= KINERJA =======================
let ptSort = { k: 'rp', d: -1 };
async function kinerja(ctx) {
  const d = await ctx.rpc('f_kinerja', ctx.params());
  if (!ctx.alive()) return;
  const all = d.petugas.map((p) => ({ ...p, hit: ratio(p.t, p.n) || 0, perhari: p.hari ? p.n / p.hari : 0 }));
  const maxN = Math.max(...all.map((p) => p.n), 1);
  const minN = Math.min(20, Math.max(5, Math.round(maxN * 0.04)));
  const pts = all.filter((p) => p.n >= minN);
  const tot = all.reduce((a, p) => ({ n: a.n + p.n, t: a.t + p.t }), { n: 0, t: 0 });
  const avg = ratio(tot.t, tot.n) || 0;
  const xMax = Math.ceil(maxN / 100) * 100 || 100;
  const yMax = Math.min(100, Math.max(10, Math.ceil(Math.max(...pts.map((p) => p.hit), avg) / 5) * 5 + 5));
  const sc = `<div class="scatter">
    <div style="position:absolute;left:0;right:0;bottom:${(avg / yMax) * 100}%;border-top:1px dashed #9AA3B2"></div>
    <div style="position:absolute;right:0;bottom:calc(${(avg / yMax) * 100}% + 3px);font-size:11px;color:var(--ink2)">rata-rata ${pct(avg)}</div>
    ${(() => { const placed = []; return [...pts].sort((a, b2) => b2.hit - a.hit).map((p) => { const x = (p.n / xMax) * 100, y = (p.hit / yMax) * 100;
      const px = x * 4.6, py = y * 3; const clash = placed.some(([qx, qy]) => Math.abs(qx - px) < 62 && Math.abs(qy - py) < 15);
      if (!clash) placed.push([px, py]);
      return `<div class="pt" style="left:${x}%;bottom:${y}%" data-tip="${esc(`${title(p.nama)} · Regu ${p.regu}\n${num(p.n)} periksa · ${num(p.t)} temuan · hit ${pct(p.hit)}\n${rp(p.rp)}`)}"></div>${clash ? '' : `<div class="pl" style="left:${x}%;bottom:${y}%">${esc(title(p.nama).split(' ')[0])}</div>`}`; }).join(''); })()}
    <div class="ax" style="left:-34px;top:-6px">${yMax}%</div><div class="ax" style="left:-16px;bottom:-6px">0</div><div class="ax" style="right:-4px;bottom:-20px">${num(xMax)}</div>
    <div style="position:absolute;left:50%;bottom:-24px;transform:translateX(-50%);font-size:11px;color:var(--muted)">Jumlah pemeriksaan →</div>
    <div style="position:absolute;left:-36px;top:50%;transform:rotate(-90deg) translateX(50%);transform-origin:left;font-size:11px;color:var(--muted)">Hit rate</div></div>`;
  const scat = card('Volume vs efektivitas petugas', `Mendatar: jumlah pemeriksaan. Tegak: hit rate. Petugas dengan kurang dari ${minN} pemeriksaan disembunyikan. Arahkan kursor ke titik untuk nama lengkap.`, sc +
    '<div class="note">Hit rate tinggi dengan volume kecil biasanya menandakan target khusus (TO hasil analisa). Baca hit rate bersama volume.</div>');
  const rg = d.regu.map((r) => ({ ...r, hit: ratio(r.t, r.n) }));
  const rb = card('Nilai Rp TS per regu', 'Diurutkan dari terbesar.', hbars(rg.map((r) => ({ l: `Regu ${r.regu}`, v: +r.rp, tip: `Regu ${r.regu}: ${num(r.n)} periksa, ${num(r.t)} temuan, hit ${pct(r.hit)}, ${r.p} petugas` })), { fmt: (v) => rp(v), lw: 70, vw: 86 }) +
    table([{ h: 'Regu', k: 'regu' }, { h: 'Petugas', k: 'p', r: 1 }, { h: 'Hari', k: 'hari', r: 1 }, { h: 'Diperiksa', k: 'n', r: 1, f: num }, { h: 'Temuan', k: 't', r: 1, f: num },
      { h: 'Hit rate', k: 'hit', r: 1, f: (v) => pct(v) }, { h: 'Rp TS', k: 'rp', r: 1, f: (v) => rp(v) }], rg));
  const rows = [...all].sort((a, b) => (a[ptSort.k] > b[ptSort.k] ? 1 : a[ptSort.k] < b[ptSort.k] ? -1 : 0) * ptSort.d);
  const pcols = [{ h: 'Petugas', k: 'nama', f: (v) => esc(title(v)) }, { h: 'Regu', k: 'regu', r: 1 }, { h: 'Hari', k: 'hari', r: 1 }, { h: 'Diperiksa', k: 'n', r: 1, f: num },
    { h: 'Per hari', k: 'perhari', r: 1, f: (v) => num(v, 1) }, { h: 'Temuan', k: 't', r: 1, f: num }, { h: 'Hit rate', k: 'hit', r: 1, f: (v) => pct(v) },
    { h: 'Rp TS', k: 'rp', r: 1, f: (v) => rp(v) }, { h: 'kWh TS', k: 'kwh', r: 1, f: num }, { h: 'Median durasi', k: 'dur', r: 1, f: (v) => num(v) + ' mnt' }];
  const pt = card('Peringkat petugas', 'Klik judul kolom untuk mengurutkan.',
    `<div style="display:flex;justify-content:flex-end"><button class="btn sm" id="xpt" type="button">${icon(IC.dl, 15)}Ekspor Excel</button></div>` + table(pcols, rows, { id: 'pt', sortKey: ptSort.k, sortDir: ptSort.d }));
  ctx.el.innerHTML = `<div class="two">${scat}${rb}</div>${pt}`;
  ctx.el.querySelectorAll('[data-tbl="pt"] th.sort').forEach((th) => th.onclick = () => { const kk = th.dataset.k; ptSort = { k: kk, d: ptSort.k === kk ? -ptSort.d : -1 }; kinerja(ctx); });
  ctx.el.querySelector('#xpt').onclick = () => exportXlsx(`kinerja_petugas_${ctx.f.from}_${ctx.f.to}.xlsx`, [['Petugas', rows.map((r) => ({ Petugas: title(r.nama), Regu: r.regu, Hari: r.hari, Diperiksa: r.n, Temuan: r.t, 'Hit rate (%)': +r.hit.toFixed(2), 'Rp TS': +r.rp, 'kWh TS': +r.kwh, 'Median durasi (mnt)': r.dur }))]]);
}


// ======================= PETA KERJA (lihat peta.js) =======================

// ======================= RISIKO =======================
let rkKat = 'Tinggi';
const JN_LBL = { 1: '<40 jam', 2: '40–80 jam', 3: '80–120 jam', 4: '120–200 jam', 5: '≥200 jam' };
const TERA_LBL = { 1: '≤2012', 2: '2013–16', 3: '2017–20', 4: '2021–23', 5: '2024+' };
async function risiko(ctx) {
  const d = await ctx.rpc('f_risiko', ctx.params({ p_kategori: rkKat || null, p_limit: 300 }));
  if (!ctx.alive()) return;
  const canUp = ['uploader', 'admin'].includes(ctx.me?.role);
  const btnSkor = canUp ? '<button class="btn" type="button" id="hskor">Hitung ulang skor</button><span class="sub" id="hskm" style="margin-left:8px"></span>' : '';
  const bindSkor = () => { const bt = ctx.el.querySelector('#hskor'); if (!bt) return; bt.onclick = async () => {
    bt.disabled = true; const m = ctx.el.querySelector('#hskm'); m.textContent = 'Menghitung (±20 detik)…';
    try { const n = await ctx.rpc('f_hitung_skor', {}, { cache: false }); await ctx.refresh(); m.textContent = `${num(n)} pelanggan berskor.`; risiko(ctx); }
    catch (e) { m.textContent = 'Gagal: ' + e.message; bt.disabled = false; } }; };
  if (!d.blth) { ctx.el.innerHTML = `<div class="note warn">Skor risiko belum tersedia. Pastikan DIL dan data pemakaian (DPM paskabayar / OLAP prabayar) sudah diunggah di <a href="#/data">Kelola Data</a>, lalu hitung skornya. ${btnSkor}</div>`; bindSkor(); return; }
  const mk = d.merk_hit.filter((m) => !/pilih|lain/i.test(m.k || ''));
  const blank = d.merk_hit.filter((m) => /pilih|lain/i.test(m.k || ''));
  const jn1 = d.jn_hit.find((r) => r.o === 1);
  const tot = d.jn_hit.reduce((a, r) => ({ n: a.n + r.n, t: a.t + r.t }), { n: 0, t: 0 });
  const sig = card('Sinyal dari hasil pemeriksaan', `Hit rate pemeriksaan pada periode terpilih, dikelompokkan per kondisi. Makin tinggi, makin layak dijadikan kriteria Target Operasi.`,
    `<div class="three">
      <div><div class="lbl" style="margin-bottom:10px">Jam nyala di bulan pemeriksaan</div>${hbars(d.jn_hit.map((r) => ({ l: JN_LBL[r.o], v: ratio(r.t, r.n) || 0, c: r.o === 1 ? C.s2 : C.s1, x: `(${num(r.t)}/${num(r.n)})` })), { fmt: (v) => pct(v), lw: 84, vw: 130 })}
        ${jn1 && tot.n ? `<p class="sub">Jam nyala di bawah 40 jam: hit rate <b>${pct(ratio(jn1.t, jn1.n))}</b>, dibanding rata-rata ${pct(ratio(tot.t, tot.n))}.</p>` : ''}</div>
      <div><div class="lbl" style="margin-bottom:10px">Merk meter (min. 30 diperiksa)</div>${hbars(mk.slice(0, 8).map((m) => ({ l: title(m.k || '-'), v: ratio(m.t, m.n) || 0, x: `(${num(m.t)}/${num(m.n)})` })), { fmt: (v) => pct(v), lw: 100, vw: 130 })}
        ${blank.length ? `<p class="sub">Merk tidak terisi (${blank.map((b) => esc(b.k)).join(', ')}): ${num(sumBy(blank, 't'))} temuan dari ${num(sumBy(blank, 'n'))}, umumnya kasus P4.</p>` : ''}</div>
      <div><div class="lbl" style="margin-bottom:10px">Tahun tera meter</div>${hbars(d.tera_hit.map((r) => ({ l: TERA_LBL[r.o], v: ratio(r.tm, r.n) || 0, x: `(${num(r.tm)}/${num(r.n)})` })), { fmt: (v) => pct(v), lw: 70, vw: 130 })}</div>
    </div>`);
  const pool = grid([
    kpi('PRABAYAR TIDAK BELI TOKEN', d.has_pra ? num(d.pool.nobuy) : '–', `Sepanjang ${blthLabel(d.blth)}, belum diperiksa 90 hari`, C.s2),
    kpi('PRABAYAR JAM NYALA <40', d.has_pra ? num(d.pool.prajn) : '–', 'kWh token ÷ kVA', C.s2),
    kpi('PASKABAYAR JAM NYALA <40', d.has_pas ? num(d.pool.pasjn) : '–', 'Kode baca normal', C.s2),
    kpi('KODE BACA BERMASALAH', d.has_pas ? num(d.pool.kd) : '–', 'Meter macet / tidak ada / MCB / tinggi', C.s2),
  ].join(''), 210);
  const kat = Object.fromEntries(d.kat.map((x) => [x.k, x.n]));
  const w = table([{ h: 'Sinyal', k: 'a' }, { h: 'Sumber data', k: 'b' }, { h: 'Bobot', k: 'c', r: 1 }], [
    { a: 'Jam nyala < 40 jam/bulan', b: 'DPM / OLAP prabayar', c: 35 }, { a: 'Prabayar tidak membeli token sebulan penuh', b: 'OLAP prabayar', c: 20 },
    { a: 'Kode baca bermasalah', b: 'DPM', c: 15 }, { a: 'Pemakaian turun ≥50% vs rata-rata 3 bulan sebelumnya', b: 'DPM / OLAP (multi-bulan)', c: 15 },
    { a: 'Daya ≥2.200 VA dengan jam nyala < 40', b: 'DIL + pemakaian', c: 10 }, { a: 'Meter tera ≤2012', b: 'DIL', c: 10 },
    { a: 'Ada temuan di gardu yang sama (6 bulan)', b: 'Pemeriksaan + DIL', c: 5 }]);
  const wc = card('Komponen skor risiko', `Skor 0–100 per pelanggan aktif, dihitung dari pemakaian ${blthLabel(d.blth)}. Pelanggan yang sudah diperiksa dalam 90 hari terakhir dikeluarkan dari daftar.`,
    w + `<div class="legend"><span class="chip crit">Tinggi ≥60 · ${num(kat.Tinggi || 0)}</span><span class="chip warn">Sedang 35–59 · ${num(kat.Sedang || 0)}</span><span class="chip">Rendah &lt;35 · ${num(kat.Rendah || 0)}</span></div>`);
  const chipK = (k) => `<span class="chip ${k === 'Tinggi' ? 'crit' : k === 'Sedang' ? 'warn' : ''}">${k}</span>`;
  const sigs = (r) => [r.jn !== null && r.jn < 40 ? `JN ${num(r.jn, 0)} jam` : '', r.layanan === 'PRABAYAR' && !r.beli ? 'Tidak beli token' : '',
    r.kd && r.kd !== 'NORMAL' ? title(r.kd) : '', r.prev_k > 0 && r.kwh < 0.5 * r.prev_k ? 'Turun ≥50%' : '', r.tahun_tera && r.tahun_tera <= 2012 ? `Tera ${r.tahun_tera}` : '']
    .filter(Boolean).map((s) => `<span class="chip">${esc(s)}</span>`).join(' ');
  const lc = card('Daftar calon Target Operasi', `Diurutkan dari skor tertinggi. Menampilkan ${num(d.list.length)} teratas.`,
    `<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end"><div class="fld"><label for="rk">KATEGORI</label><select id="rk"><option value="Tinggi" ${rkKat === 'Tinggi' ? 'selected' : ''}>Tinggi</option><option value="Sedang" ${rkKat === 'Sedang' ? 'selected' : ''}>Sedang</option><option value="" ${!rkKat ? 'selected' : ''}>Semua (skor &gt; 0)</option></select></div>
      <div class="spacer"></div><button class="btn pri" type="button" id="rkx">${icon(IC.dl, 16)}Ekspor ke Excel untuk regu (maks. 5.000)</button></div>` +
    table([{ h: 'IDPEL', k: 'idpel', f: (v) => `<span class="mono">${esc(v)}</span>` }, { h: 'Nama', k: 'nama', f: (v) => esc(title(v || '-')) }, { h: 'Tarif/Daya', k: 'tarif', f: (v, r) => `${esc(v)} / ${num(r.daya)}` },
      { h: 'Layanan', k: 'layanan', f: (v) => esc(title(v)) }, { h: 'Gardu', k: 'gardu' }, { h: 'Kelurahan', k: 'kelurahan', f: (v) => esc(title(v || '-')) },
      { h: 'kWh', k: 'kwh', r: 1, f: (v) => num(v, 1) }, { h: 'Sinyal', k: 'x', f: (v, r) => sigs(r) }, { h: 'Skor', k: 'skor', r: 1 }, { h: 'Risiko', k: 'kat', f: chipK },
      { h: '', k: 'lat', f: (v, r) => (r.lat ? `<a href="${gmaps(r.lat, r.lon)}" target="_blank" rel="noopener" aria-label="Lokasi di Google Maps">${icon(IC.pin, 15)}</a>` : '') }], d.list, { maxh: 560 }));
  ctx.el.innerHTML = sig + pool + `<div class="two">${wc}${card('Cara membaca', null, `<ul class="ins"><li>Skor dihitung untuk <b>pelanggan aktif di DIL</b> memakai pemakaian bulan ${blthLabel(d.blth)}${d.has_pra ? '' : ' (data prabayar bulan ini belum ada)'}${d.has_pas ? '' : ' (data paskabayar bulan ini belum ada)'}.</li><li>Sinyal "turun ≥50%" baru aktif bila sudah ada data 3 bulan sebelumnya.</li><li>Bobot awal ini bisa dikalibrasi ulang setelah beberapa bulan, dengan membandingkan skor dengan hit rate aktual di halaman ini.</li><li>Pelanggan yang tidak membeli token bisa juga berarti rumah kosong. Pastikan di lapangan.</li></ul>`)}</div>` + lc;
  ctx.el.querySelector('#rk').onchange = (e) => { rkKat = e.target.value; risiko(ctx); };
  if (canUp) { const w = ctx.el.querySelector('#rkx'); if (w) { w.insertAdjacentHTML('beforebegin', btnSkor); bindSkor(); } }
  ctx.el.querySelector('#rkx').onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = 'Menyiapkan…';
    try {
      const big = await ctx.rpc('f_risiko', ctx.params({ p_kategori: rkKat || null, p_limit: 5000 }), { cache: false });
      exportXlsx(`calon_TO_${rkKat || 'semua'}_${blthLabel(d.blth).replace(' ', '')}.xlsx`, [['Calon TO', big.list.map((r) => ({ IDPEL: r.idpel, Nama: r.nama, Tarif: r.tarif, Daya: r.daya, Layanan: r.layanan,
        Gardu: r.gardu, Kelurahan: r.kelurahan, Kecamatan: r.kecamatan, Merk: r.merk, 'Tahun tera': r.tahun_tera, 'Jam nyala': r.jn, kWh: r.kwh, 'Rata kWh 3 bln': r.prev_k,
        'Kode baca': r.kd, 'Beli token': r.layanan === 'PRABAYAR' ? (r.beli ? 'Ya' : 'Tidak') : '', Skor: r.skor, Risiko: r.kat, Lat: r.lat, Lon: r.lon, 'Google Maps': r.lat ? gmaps(r.lat, r.lon) : '' }))]]);
    } finally { e.target.disabled = false; e.target.innerHTML = `${icon(IC.dl, 16)}Ekspor ke Excel untuk regu (maks. 5.000)`; }
  };
}

// ======================= PEMBAYARAN =======================
async function pembayaran(ctx) {
  const d = await ctx.rpc('f_pembayaran', ctx.params());
  if (!ctx.alive()) return;
  const k = d.kpi, fu = d.funnel, tr = d.ts_range;
  let note = '';
  if (!tr.min) note = '<div class="note warn">Belum ada Laporan TS terbayar di database. Unggah di halaman <a href="#/data">Kelola Data</a>.</div>';
  else if (!k.n) note = `<div class="note warn">Tidak ada pembayaran TS pada periode ini. Data laporan TS tersedia untuk ${rentang(tr.min, tr.max)}. <button class="btn sm" type="button" id="tsgo">Tampilkan periode tersebut</button></div>`;
  const kp = grid([
    kpi('PELUNASAN / REGISTRASI', num(k.n), 'Berdasarkan tanggal register', C.s1),
    kpi('TOTAL P2TL TERBAYAR', rp(k.total), `Rp TS ${rp(k.rp_ts)} · ${num(k.kwh)} kWh`, C.s3),
    kpi('TUNAI', rp(k.tunai), `${num(k.n_tunai)} pelanggan lunas sekaligus`),
    kpi('ANGSURAN', rp(k.angsur), `${num(k.n_angsur)} pelanggan mencicil`),
  ].join(''), 210);
  const steps = [['Temuan pada periode', fu.temuan, fu.rp_temuan], ['Masuk AP2T', fu.ap2t, null], ['Punya No. Agenda P2TL', fu.sph, null], ['Sudah tercatat bayar', fu.lunas, fu.rp_lunas]];
  const mx = Math.max(fu.temuan, 1);
  const funnel = steps.map(([l, n, r]) => `<div data-tip="${esc(`${l}: ${num(n)}${r !== null ? ' · ' + rp(r) : ''}`)}" style="display:flex;align-items:center;gap:12px"><div style="flex:0 0 ${Math.max(18, (n / mx) * 100)}%;max-width:100%;height:44px;background:${C.s1};border-radius:8px;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 14px;font-size:13px;font-weight:700;gap:10px;min-width:150px"><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${l}</span><span class="mono">${num(n)}</span></div><div class="mono" style="font-size:12.5px;color:var(--ink2);white-space:nowrap">${pct(ratio(n, mx), 0)}${r !== null ? ' · ' + rp(r) : ''}</div></div>`).join('');
  const fc = card('Alur penyelesaian temuan', 'Temuan pada periode filter, dicocokkan dengan Laporan TS terbayar lewat No. Agenda, atau lewat IDPEL untuk pembayaran pertama sejak tanggal pemeriksaan.',
    `<div style="display:flex;flex-direction:column;gap:8px">${funnel}</div>` + (fu.temuan && !fu.lunas ? '<div class="note">Belum ada temuan periode ini yang tercatat bayar. Pastikan Laporan TS untuk bulan-bulan setelah pemeriksaan sudah diunggah.</div>' : '') +
    (fu.p4_tanpa_agenda ? `<p class="sub">${num(fu.p4_tanpa_agenda)} temuan belum punya No. Agenda.</p>` : ''));
  const AG = { 1: '<3 bulan', 2: '3–6 bulan', 3: '6–12 bulan', 4: '>12 bulan' };
  const tc = card('Tunai vs angsuran', 'Komposisi nilai Total P2TL pada periode.', stack([{ l: 'Tunai', v: +k.tunai, c: C.s1, tip: `Tunai ${rp(k.tunai)}` }, { l: 'Angsuran', v: +k.angsur, c: C.light, tip: `Angsuran ${rp(k.angsur)}` }], 32) +
    legend([[`Tunai · ${rp(k.tunai)} (${pct(ratio(k.tunai, k.total), 0)})`, C.s1], [`Angsuran · ${rp(k.angsur)} (${pct(ratio(k.angsur, k.total), 0)})`, C.light]]) +
    `<div><div class="lbl" style="margin:6px 0 8px">Umur piutang angsuran (semua data, sejak tanggal register)</div>${hbars(d.aging.map((a) => ({ l: AG[a.o], v: +a.rp, x: `· ${num(a.n)} plg` })), { fmt: (v) => rp(v), lw: 90, vw: 150 })}</div>`);
  const gc = card('Realisasi per golongan', null, hbars(d.gol.map((g) => ({ l: g.k || '-', v: +g.rp, c: GOLC[g.k] || '#9AA3B2', x: `· ${num(g.n)} plg` })), { fmt: (v) => rp(v), lw: 50, vw: 150 }) + '<p class="sub">Golongan "KWH" digabung ke K2. DKRP dan UPDATEANGSURAN tidak ditampilkan.</p>');
  const dc = card('Realisasi per tanggal register', null, vbars(d.daily.map((x) => ({ l: String(+x.tgl.slice(8, 10)), v: +x.rp, tip: `${x.tgl}: ${num(x.n)} pelunasan · ${rp(x.rp)}` })), { color: C.s3, fmt: (v) => rp(v), every: 'auto' }));
  const top = card('Pembayaran terbesar', null, table([{ h: 'No. Agenda', k: 'no_agenda', f: (v) => `<span class="mono" style="font-size:12px">${esc(v)}</span>` }, { h: 'Nama', k: 'nama', f: (v) => esc(title(v)) },
    { h: 'Gol.', k: 'golongan' }, { h: 'Tarif/Daya', k: 'tarif', f: (v, r) => `${esc(v)} / ${num(r.daya)}` }, { h: 'Tgl register', k: 'tgl_register', f: tglPendek },
    { h: 'Total P2TL', k: 'total_p2tl', r: 1, f: (v) => rp(v) }, { h: 'Tunai', k: 'tunai', r: 1, f: (v) => rp(v) }, { h: 'Angsuran', k: 'angsur', r: 1, f: (v) => rp(v) }], d.top));
  ctx.el.innerHTML = note + kp + `<div class="two">${fc}${tc}${gc}${dc}</div>` + top;
  const go = ctx.el.querySelector('#tsgo');
  if (go) go.onclick = () => { const f = ctx.f; f.from = tr.min; f.to = tr.max; f.preset = 'custom'; try { localStorage.setItem('p2tl_filters', JSON.stringify(f)); } catch (e) { /* abaikan */ } window.dispatchEvent(new HashChangeEvent('hashchange')); };
}

// ======================= RECOVERY =======================
async function recovery(ctx) {
  const d = await ctx.rpc('f_recovery', ctx.params());
  if (!ctx.alive()) return;
  const months = d.months || [];
  const enough = d.n_with_after > 0;
  const note = enough ? '' : `<div class="note warn">Analisis ini butuh data pemakaian <b>sebelum dan sesudah</b> bulan pemeriksaan (idealnya 3 bulan masing-masing). Data pemakaian yang ada saat ini: ${months.length ? months.map(blthLabel).join(', ') : 'belum ada'}. Grafik terisi otomatis begitu DPM dan OLAP bulan-bulan berikutnya diunggah.</div>`;
  const kp = grid([
    kpi('PELANGGAN DITERTIBKAN', num(d.n_tm), 'Temuan dengan IDPEL resmi (P4 tidak termasuk)', C.s1),
    kpi('PUNYA BASELINE', num(d.n_with_base), 'Ada pemakaian 1–3 bulan sebelum pemeriksaan', C.s3),
    kpi('KENAIKAN kWh RATA-RATA', enough ? pct(d.kpi.kenaikan) : '–', enough ? `${num(d.n_with_after)} pelanggan terukur` : 'Menunggu data sesudah pemeriksaan'),
    kpi('TAMBAHAN kWh / BULAN', enough ? num(d.kpi.tambah_kwh) : '–', 'Selisih rata-rata sesudah vs sebelum'),
  ].join(''), 210);
  const xs = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6];
  const ser = (tm, name, c) => ({ name, c, pts: xs.map((x) => { const r = d.index.find((i) => i.tm === tm && i.k === x); return [x, r ? r.med : null, r ? r.n : 0]; }) });
  const lc = card('Pola pemakaian sebelum dan sesudah P2TL', 'Median kWh per bulan, diindeks 100 = rata-rata 3 bulan sebelum pemeriksaan. Bulan 0 = bulan pemeriksaan.',
    lineChart([ser(true, 'Ditertibkan (temuan)', C.s2), ser(false, 'Pembanding: diperiksa, sesuai', '#6B7385')], { xs, mark: 0, xfmt: (x) => (x > 0 ? '+' + x : String(x)), yfmt: (v) => num(v, 0) }) +
    legend([['Ditertibkan (temuan)', C.s2], ['Pembanding: diperiksa, sesuai', '#6B7385']]));
  const gc = card('Recovery per golongan', 'Rata-rata perubahan kWh 3 bulan sesudah vs 3 bulan sebelum.', d.gol.length ? hbars(d.gol.map((g) => ({ l: g.k, v: Math.max(+g.chg, 0), c: GOLC[g.k], x: `· ${num(g.n)} plg`, tip: `${g.k}: ${pct(g.chg)} (${num(g.n)} pelanggan)` })), { fmt: (v) => pct(v), lw: 40, vw: 130 }) : empty('Menunggu data pemakaian sesudah pemeriksaan'));
  const low = card('Pelanggan dengan recovery terendah', 'Pemakaian tetap rendah setelah ditertibkan, kandidat pemeriksaan ulang.',
    table([{ h: 'IDPEL', k: 'idpel', f: (v) => `<span class="mono">${esc(v)}</span>` }, { h: 'Nama', k: 'nama', f: (v) => esc(title(v)) }, { h: 'Gol.', k: 'gol', f: golChip }, { h: 'Tarif/Daya', k: 'tarif', f: (v, r) => `${esc(v)} / ${num(r.daya)}` },
      { h: 'kWh sebelum', k: 'bk', r: 1, f: (v) => num(v, 1) }, { h: 'kWh sesudah', k: 'ak', r: 1, f: (v) => num(v, 1) }, { h: 'Perubahan', k: 'chg', r: 1, f: (v) => pct(v) }], d.low, { maxh: 420 }));
  ctx.el.innerHTML = note + kp + `<div class="two">${lc}${gc}</div>` + low;
}

// ======================= DETAIL =======================
const DQ = { q: '', gol: '', ap2t: '', tindakan: '', bayar: '', page: 0 };
async function detail(ctx) {
  const per = 50;
  const args = ctx.params({ p_q: DQ.q || null, p_gol: DQ.gol || null, p_ap2t: DQ.ap2t || null, p_tindakan: DQ.tindakan || null, p_bayar: DQ.bayar || null, p_limit: per, p_offset: DQ.page * per });
  const d = await ctx.rpc('f_detail', args);
  if (!ctx.alive()) return;
  const sel = (id, lab, v, opts) => `<div class="fld"><label for="${id}">${lab}</label><select id="${id}">${opts.map(([val, t]) => `<option value="${val}" ${v === val ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
  const bar = `<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end">
    <div class="fld" style="flex:1 1 260px"><label for="dq">CARI</label><input id="dq" value="${esc(DQ.q)}" placeholder="IDPEL, nama, no. agenda, catatan, petugas…" style="width:100%"></div>
    ${sel('dg', 'GOLONGAN', DQ.gol, [['', 'Semua'], ...GOL_ORDER.map((g) => [g, g])])}
    ${sel('da', 'AP2T / KUALITAS', DQ.ap2t, [['', 'Semua'], ['Ya', 'AP2T sudah'], ['-', 'AP2T belum'], ['ANOMALI', 'Nilai TS tidak wajar']])}
    ${sel('dt', 'TINDAKAN', DQ.tindakan, [['', 'Semua'], ['Tidak Diputus', 'Tidak diputus'], ['Bongkar', 'Bongkar'], ['Diputus', 'Diputus']])}
    ${sel('db', 'STATUS BAYAR', DQ.bayar, [['', 'Semua'], ['Sudah', 'Sudah bayar'], ['Belum', 'Belum tercatat']])}
    <button class="btn" type="button" id="dx">${icon(IC.dl, 16)}Ekspor Excel</button></div>`;
  const pages = Math.max(1, Math.ceil(d.total / per));
  const cols = [{ h: 'Waktu', k: 'waktu_periksa', f: (v) => `${tglPendek(v)} <small style="color:var(--muted)">${jam(v)}</small>` }, { h: 'IDPEL', k: 'idpel', f: (v) => `<span class="mono" style="font-size:12px">${esc(v)}</span>` },
    { h: 'Nama', k: 'nama', f: (v) => esc(title(v || '-')) }, { h: 'Tarif/Daya', k: 'tarif', f: (v, r) => `${esc(v)} / ${num(r.daya)}` }, { h: 'Gol.', k: 'gol', f: golChip },
    { h: 'Petugas', k: 'petugas', f: (v) => esc(title(v || '-')) }, { h: 'kWh TS', k: 'kwh_ts', r: 1, f: num }, { h: 'Rp TS', k: 'rupiah_ts', r: 1, f: (v, r) => (r.ts_wajar === false ? `<span class="chip crit" title="Nilai TS tidak wajar, tidak dihitung">${rp(v)} ⚠</span>` : rp(v)) },
    { h: 'Tindakan', k: 'pemutusan' }, { h: 'AP2T', k: 'ts_ap2t', f: (v) => (v === 'Ya' ? '<span class="chip good">Ya</span>' : '–') },
    { h: 'Bayar', k: 'paid', f: (v, r) => (v ? `<span class="chip good">${+r.angsur > 0 ? 'Angsur' : 'Lunas'}</span>` : '–') }];
  ctx.el.innerHTML = card(`${num(d.total)} temuan · diurutkan berdasarkan Rp TS`, 'Klik baris untuk membuka catatan petugas, data meter, riwayat pemakaian, dan status pembayaran. NIK dan nomor HP pelanggan tidak disimpan.',
    bar + table(cols, d.rows, { onRow: true }) +
    `<div class="pager"><span>Menampilkan ${num(d.total ? DQ.page * per + 1 : 0)}–${num(Math.min(d.total, (DQ.page + 1) * per))} dari ${num(d.total)}</span><span style="display:flex;gap:6px"><button class="btn sm" type="button" id="dp" ${DQ.page ? '' : 'disabled'}>Sebelumnya</button><span style="align-self:center">Hal. ${DQ.page + 1}/${pages}</span><button class="btn sm" type="button" id="dn" ${DQ.page + 1 < pages ? '' : 'disabled'}>Berikutnya</button></span></div>`);
  let t = null;
  const q = ctx.el.querySelector('#dq');
  q.oninput = () => { clearTimeout(t); t = setTimeout(() => { DQ.q = q.value.trim(); DQ.page = 0; detail(ctx).then(() => { const n = ctx.el.querySelector('#dq'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }); }, 400); };
  for (const [id, key] of [['dg', 'gol'], ['da', 'ap2t'], ['dt', 'tindakan'], ['db', 'bayar']]) ctx.el.querySelector('#' + id).onchange = (e) => { DQ[key] = e.target.value; DQ.page = 0; detail(ctx); };
  ctx.el.querySelector('#dp').onclick = () => { DQ.page--; detail(ctx); };
  ctx.el.querySelector('#dn').onclick = () => { DQ.page++; detail(ctx); };
  ctx.el.querySelectorAll('tr.click').forEach((tr) => tr.onclick = () => drawer(ctx, d.rows[+tr.dataset.i]));
  ctx.el.querySelector('#dx').onclick = async (e) => {
    e.currentTarget.disabled = true;
    const all = await ctx.rpc('f_detail', { ...args, p_limit: 20000, p_offset: 0 }, { cache: false });
    exportXlsx(`detail_temuan_${ctx.f.from}_${ctx.f.to}.xlsx`, [['Temuan', all.rows.map((r) => ({ Waktu: r.waktu_periksa, IDPEL: r.idpel, Nama: r.nama, Tarif: r.tarif, Daya: r.daya, Golongan: r.gol,
      Petugas: r.petugas, Regu: r.regu, 'kWh TS': +r.kwh_ts, 'Rp TS': +r.rupiah_ts, Tindakan: r.pemutusan, AP2T: r.ts_ap2t, 'No Agenda': r.no_agenda, Catatan: r.catatan,
      Gardu: r.gardu, Kelurahan: r.kelurahan, Kecamatan: r.kecamatan, Lat: r.lat, Lon: r.lon, 'Total bayar': r.paid, Tunai: r.tunai, Angsuran: r.angsur, 'Tgl register': r.tgl_register }))]]);
    e.target.disabled = false;
  };
}
async function drawer(ctx, r) {
  dropMaps();
  const bg = document.createElement('div'); bg.className = 'drawer-bg';
  const dr = document.createElement('aside'); dr.className = 'drawer'; dr.setAttribute('aria-label', 'Detail temuan');
  const close = () => { dropMaps(); bg.remove(); dr.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  bg.onclick = close; document.addEventListener('keydown', onKey);
  dr.innerHTML = `<button class="btn sm x" type="button" aria-label="Tutup">${icon(IC.x, 16)}</button>
    <div><div class="lbl">${esc(r.gol)} · ${esc(GOL_DESC[r.gol] || '')}</div><h2 style="margin:6px 0 0;font-size:20px">${esc(title(r.nama || '-'))}</h2><div class="mono" style="color:var(--muted);margin-top:2px">${esc(r.idpel)} · ${esc(r.tarif)}/${num(r.daya)} VA · ${esc(title(r.jenislayanan || ''))}</div></div>
    <div class="kv"><div><div class="lbl">WAKTU PERIKSA</div>${tglPendek(r.waktu_periksa)} ${jam(r.waktu_periksa)}</div><div><div class="lbl">PETUGAS</div>${esc(title(r.petugas || '-'))} · Regu ${esc(r.regu)}</div>
      <div><div class="lbl">kWh TS</div><span class="mono">${num(r.kwh_ts)}</span></div><div><div class="lbl">RP TS</div><span class="mono">${rp(r.rupiah_ts, true)}</span></div>
      <div><div class="lbl">TINDAKAN</div>${esc(r.pemutusan || '-')}</div><div><div class="lbl">NO. AGENDA</div><span class="mono" style="font-size:12px">${esc(r.no_agenda || '-')}</span></div></div>
    <div><div class="lbl">CATATAN PETUGAS</div><p style="margin:6px 0 0;line-height:1.55">${esc(r.catatan || '-')}</p></div>
    <div class="kv"><div><div class="lbl">METER</div>${esc(r.merk || '-')} · tera ${esc(r.tahun || '-')}</div><div><div class="lbl">GARDU / WILAYAH</div>${esc(r.gardu || '-')} · ${esc(title(r.kelurahan || '-'))}</div>
      <div><div class="lbl">STATUS DIL</div>${esc(r.dil_status || 'Tidak ada di DIL')}</div><div><div class="lbl">PEMBAYARAN TS (LAPORAN)</div>${r.paid ? `${rp(r.paid)} (${tglPendek(r.tgl_register)})<br>${esc(r.ts_gol || '')} · ${num(r.ts_kwh)} kWh · Rp TS ${rp(r.ts_rp)}<br>Tunai ${rp(r.tunai)} · Angsur ${rp(r.angsur)}` : 'Belum tercatat'}</div></div>
    ${r.paid && r.ts_wajar === false ? `<div class="note warn">Nilai di data pemeriksaan (${num(r.kwh_ts)} kWh · ${rp(r.rupiah_ts)}) tidak wajar. Nilai yang benar menurut Laporan TS: <b>${num(r.ts_kwh)} kWh · ${rp(r.ts_rp)}</b>.</div>` : ''}
    <div><div class="lbl" style="margin-bottom:6px">RIWAYAT PEMAKAIAN (kWh)</div><div id="uh"><span class="spin"></span></div></div>
    ${r.lat ? `<div class="leaf" id="dmap"></div><a class="btn" href="${gmaps(r.lat, r.lon)}" target="_blank" rel="noopener" style="align-self:flex-start">${icon(IC.ext, 16)}Buka di Google Maps</a>` : ''}`;
  document.body.append(bg, dr);
  dr.querySelector('.x').onclick = close;
  dr.querySelector('.x').focus();
  if (r.lat && window.L) { const m = osm(dr.querySelector('#dmap')); m.setView([r.lat, r.lon], 17); window.L.circleMarker([r.lat, r.lon], { radius: 8, color: '#fff', weight: 2, fillColor: GOLC[r.gol] || C.s2, fillOpacity: 1 }).addTo(m); }
  if (/^\d+$/.test(r.idpel || '')) {
    const h = await ctx.rpc('f_usage_hist', { p_idpel: r.idpel });
    const uh = dr.querySelector('#uh'); if (!uh) return;
    uh.innerHTML = h.length ? vbars(h.map((x) => ({ l: blthLabel(x.blth), v: +x.kwh, c: x.src === 'pra' ? C.s3 : C.s1, tip: `${blthLabel(x.blth)}: ${num(x.kwh, 1)} kWh${x.jam_nyala !== null ? ` · ${num(x.jam_nyala)} jam nyala` : ''} (${x.src === 'pra' ? 'token' : 'DPM'})` })), { h: 90 }) : empty('Belum ada data pemakaian untuk pelanggan ini');
  } else dr.querySelector('#uh').innerHTML = empty('Non-pelanggan (P4): tidak ada riwayat pemakaian');
}

export const PAGES = { ringkasan, temuan, kinerja, cakupan, risiko, pembayaran, recovery, detail };
