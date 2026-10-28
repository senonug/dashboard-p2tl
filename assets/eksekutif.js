// ======================= RINGKASAN EKSEKUTIF (v1.7) =======================
// Target tahunan kWh TS terbayar (Laporan TS, tanggal register), dibagi rata per hari.
// Bagian: capaian target · kumulatif · komposisi golongan · rapor bulanan · detail periode (≤ 2 bulan)
import { C, GOLC, GOL_ORDER, esc, num, pct, rp, ratio, card, empty, icon, IC, tglPendek, tglPanjang, title } from './ui.js';

const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const BLN_L = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const HARI = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const TGT_C = '#5F6879', REAL_C = C.s1;
const KWH_GOL = ['K2', 'P4', 'P3', 'P2', 'K1']; // urutan baris; P1 selalu 0 kWh (ditagih dalam Rp)
const BIG = 50000; // batas kasus besar (kWh per pelanggan)
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const addD = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const diy = (y) => ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365);
const doy = (s) => { const d = parse(s); return Math.round((d - new Date(d.getFullYear(), 0, 1)) / 864e5) + 1; };
const dim = (y, m) => new Date(y, m, 0).getDate();
const days = (a, b) => Math.round((parse(b) - parse(a)) / 864e5) + 1;
export const jt = (v) => (Math.abs(v) >= 1e6 ? `${num(v / 1e6, 2)} jt` : Math.abs(v) >= 1e3 ? `${num(v / 1e3, 0)} rb` : num(v));
const sgn = (v) => (v >= 0 ? '+' : '−') + num(Math.abs(v));
const niceMax = (v) => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); const f = v / p; return [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10].find((s) => f <= s) * p; };
const capChip = (p) => (p >= 100 ? 'good' : p >= 50 ? 'warn' : 'crit');

// ---------- perhitungan ----------
export function hitungCapaian(cap, from, to) {
  const today = iso(new Date());
  const asof = to < today ? to : today;
  const th = cap.tahun, D = diy(th), n = doy(asof);
  const target = cap.target ? +cap.target : null, real = +cap.kwh || 0;
  const perMonth = Array.from({ length: 12 }, (_, i) => ({ b: i + 1, kwh: 0, rp: 0, n: 0, gol: {}, big: null, top5: null, belum: null, belumN: null }));
  for (const r of cap.bulan || []) { const m = perMonth[r.b - 1]; m.kwh += +r.kwh; m.rp += +r.rp; m.n += r.n; m.gol[r.gol] = (m.gol[r.gol] || 0) + (+r.kwh); }
  const hasRisk = Array.isArray(cap.risk);
  for (const r of cap.risk || []) { const m = perMonth[r.b - 1]; m.big = r.big; m.top5 = +r.top5; }
  for (const r of cap.belum || []) { const m = perMonth[r.b - 1]; m.belum = +r.kwh; m.belumN = r.n; }
  const o = { th, D, asof, n, real, target, perMonth, hasRisk, dataMax: cap.data_max, rpReal: +cap.rp || 0, nReal: cap.n || 0, curMonth: parse(asof).getMonth() + 1 };
  // bulan yang tercakup filter (untuk disorot di rapor)
  const fy = +from.slice(0, 4), ty = +to.slice(0, 4);
  o.sel = new Set();
  for (let m = 1; m <= 12; m++) {
    const a = `${th}-${String(m).padStart(2, '0')}-01`, z = `${th}-${String(m).padStart(2, '0')}-${dim(th, m)}`;
    if (!(z < from || a > to) && fy <= th && ty >= th) o.sel.add(m);
  }
  if (o.sel.size === 12) o.sel.clear(); // satu tahun penuh: tak perlu sorotan
  o.lajuHari = real / n;
  o.proyeksi = o.lajuHari * D;
  o.tgtM = (m) => (target ? target * dim(th, m) / D : 0);
  if (target) {
    o.harian = target / D;
    o.seharusnya = target * n / D;
    o.selisih = real - o.seharusnya;
    o.pct = ratio(real, target);
    o.pctJalur = ratio(o.seharusnya, target);
    o.sisaHari = D - n;
    o.sisa = Math.max(0, target - real);
    o.perluHari = o.sisaHari > 0 ? o.sisa / o.sisaHari : 0;
    o.status = o.selisih >= 0 ? 'good' : real >= 0.9 * o.seharusnya ? 'warn' : 'crit';
  }
  return o;
}

// ---------- 1. blok capaian target ----------
export function capaianCard(o) {
  const asofTxt = tglPendek(o.asof);
  const dataTxt = o.dataMax ? `Data Laporan TS s.d. ${tglPendek(o.dataMax)}` : 'Belum ada Laporan TS tahun ini';
  if (!o.target) {
    return `<section class="card exec-cap"><div><h2>Realisasi kWh TS terbayar ${o.th}</h2><p class="sub">${dataTxt}.</p></div>
      <div class="exec-hero"><b class="mono">${num(o.real)} kWh</b><span>s.d. ${asofTxt} · ${num(o.nReal)} pelanggan · ${rp(o.rpReal)}</span></div>
      <div class="note warn">Target ${o.th} belum diisi. Admin dapat mengisinya di <a href="#/data">Kelola Data</a>.</div></section>`;
  }
  const st = { good: ['good', IC.check, 'Di atas jalur target'], warn: ['warn', IC.alert, 'Sedikit di bawah jalur'], crit: ['crit', IC.alert, 'Di bawah jalur target'] }[o.status];
  const fill = Math.min(100, o.pct), mark = Math.min(100, o.pctJalur);
  return `<section class="card exec-cap" aria-label="Capaian target">
    <div class="exec-top"><div><h2>Capaian target kWh TS terbayar ${o.th}</h2>
      <p class="sub">Target ${num(o.target)} kWh setahun, dibagi rata ${num(o.harian)} kWh per hari. ${dataTxt}.</p></div>
      <span class="chip ${st[0]} exec-st">${icon(st[1], 14)}${st[2]}</span></div>
    <div class="exec-grid">
      <div class="exec-main">
        <div class="exec-hero"><b class="mono">${pct(o.pct)}</b><span><b class="mono">${num(o.real)}</b> dari ${num(o.target)} kWh · s.d. ${asofTxt}</span></div>
        <div class="exec-bar" role="img" aria-label="Realisasi ${pct(o.pct)} dari target; seharusnya ${pct(o.pctJalur)}">
          <i style="width:${fill}%"></i><em style="left:${mark}%" data-tip="Seharusnya s.d. ${asofTxt}: ${num(o.seharusnya)} kWh (${pct(o.pctJalur)})"></em>
        </div>
        <div class="exec-scale"><span>0</span><span class="${mark > 80 ? 'r' : mark < 20 ? 'l' : ''}" style="left:${mark}%">▲ seharusnya ${pct(o.pctJalur)} (${num(o.seharusnya)} kWh)</span></div>
      </div>
      <div class="exec-side">
        <div><span class="lbl">${o.selisih >= 0 ? 'LEBIH DARI JALUR' : 'KURANG DARI JALUR'}</span><b class="mono" style="color:var(--${st[0]})">${sgn(o.selisih)} kWh</b><small>seharusnya ${num(o.seharusnya)} kWh</small></div>
        <div><span class="lbl">TARGET SISA</span><b class="mono">${o.sisaHari > 0 ? `${num(o.perluHari)} kWh/hari` : '–'}</b><small>${o.sisaHari > 0 ? `${num(o.sisa)} kWh dalam ${num(o.sisaHari)} hari · laju sekarang ${num(o.lajuHari)}/hari` : 'tahun sudah berakhir'}</small></div>
        <div><span class="lbl">PROYEKSI AKHIR TAHUN</span><b class="mono">${num(o.proyeksi)} kWh</b><small>${pct(ratio(o.proyeksi, o.target))} target, bila laju tetap</small></div>
      </div>
    </div></section>`;
}

// ---------- 2. kumulatif vs target ----------
function kumulatifSvg(o) {
  const W = 560, H = 230, L = 52, R = 74, T = 14, B = 26, iw = W - L - R, ih = H - T - B;
  const top = niceMax(Math.max(o.target || 0, o.real) * 1.02);
  const x = (d) => L + (d / o.D) * iw, y = (v) => T + ih - (v / top) * ih;
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = top * i / 4; g += `<line x1="${L}" x2="${L + iw}" y1="${y(v)}" y2="${y(v)}" stroke="#E4E7EC" ${i ? 'stroke-dasharray="3 3"' : ''}/><text x="${L - 6}" y="${y(v) + 4}" font-size="10.5" text-anchor="end" fill="#5F6879">${jt(v)}</text>`; }
  for (let m = 1; m <= 12; m++) g += `<text x="${x(doy(`${o.th}-${String(m).padStart(2, '0')}-15`))}" y="${H - 8}" font-size="10.5" text-anchor="middle" fill="#5F6879">${BLN[m - 1]}</text>`;
  if (o.target) {
    g += `<line x1="${x(0)}" y1="${y(0)}" x2="${x(o.D)}" y2="${y(o.target)}" stroke="${TGT_C}" stroke-width="2" stroke-dasharray="6 4"/>`;
    g += `<text x="${x(o.D) + 6}" y="${y(o.target) + 4}" font-size="11" fill="${TGT_C}" font-weight="600">Target</text><text x="${x(o.D) + 6}" y="${y(o.target) + 17}" font-size="10.5" fill="${TGT_C}">${jt(o.target)}</text>`;
  }
  let acc = 0; const pts = [[0, 0]], tips = [];
  for (let m = 1; m <= o.curMonth; m++) {
    acc += o.perMonth[m - 1].kwh;
    const d = m === o.curMonth ? o.n : doy(`${o.th}-${String(m).padStart(2, '0')}-${dim(o.th, m)}`);
    pts.push([d, acc]); tips.push([d, acc, m]);
  }
  g += `<polyline fill="none" stroke="${REAL_C}" stroke-width="2.5" stroke-linejoin="round" points="${pts.map(([d, v]) => `${x(d)},${y(v)}`).join(' ')}"/>`;
  for (const [d, v, m] of tips) {
    const seh = o.target ? o.target * d / o.D : null;
    g += `<circle cx="${x(d)}" cy="${y(v)}" r="4.5" fill="${REAL_C}" stroke="#fff" stroke-width="2"/><circle cx="${x(d)}" cy="${y(v)}" r="11" fill="transparent" data-tip="${esc(`${m === o.curMonth ? `s.d. ${tglPendek(o.asof)}` : `Akhir ${BLN_L[m - 1]}`}: ${num(v)} kWh kumulatif${seh ? `\nTarget kumulatif: ${num(seh)} kWh (${sgn(v - seh)})` : ''}`)}"/>`;
  }
  const last = pts[pts.length - 1];
  g += `<text x="${Math.min(x(last[0]) + 8, L + iw - 4)}" y="${y(last[1]) + (o.target && last[1] < o.target * last[0] / o.D ? 16 : -8)}" font-size="11" font-weight="700" fill="#0E1726">${jt(last[1])}</text>`;
  if (o.target) g += `<circle cx="${x(o.n)}" cy="${y(o.seharusnya)}" r="3.5" fill="#fff" stroke="${TGT_C}" stroke-width="2" data-tip="Seharusnya s.d. ${tglPendek(o.asof)}: ${num(o.seharusnya)} kWh"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Kumulatif kWh TS terbayar ${o.th} dibanding target">${g}</svg>`;
}
export function kumulatifCard(o) {
  return card(`Kumulatif kWh TS terbayar vs target ${o.th}`, o.target ? `Realisasi s.d. ${tglPendek(o.asof)} ${num(o.real)} kWh · seharusnya ${num(o.seharusnya)} kWh · ${sgn(o.selisih)} kWh` : `Realisasi s.d. ${tglPendek(o.asof)} ${num(o.real)} kWh`,
    `<div class="exec-charts">${kumulatifSvg(o)}</div>
     <div class="legend"><span><i class="ln" style="background:${REAL_C}"></i>Realisasi kumulatif</span>${o.target ? `<span><i class="ln dash" style="border-color:${TGT_C}"></i>Target pro-rata harian</span>` : ''}</div>`);
}

// ---------- 3. komposisi golongan (periode filter) ----------
export function komposisiCard(d, ctx) {
  const g = (d.gol_ts || []).filter((r) => /^[PK]\d$/.test(r.gol || ''));
  const sub = `Laporan TS terbayar, ${rentangPendek(ctx.f.from, ctx.f.to)}.`;
  if (!g.length) return card('Komposisi golongan', sub, empty('Tidak ada Laporan TS terbayar pada periode ini'));
  const order = GOL_ORDER.filter((x) => g.find((r) => r.gol === x));
  const by = Object.fromEntries(g.map((r) => [r.gol, r]));
  const bar = (lbl, key, fmt) => {
    const tot = order.reduce((s, x) => s + (+by[x][key] || 0), 0);
    return `<div class="exec-cbar"><div><span>${lbl}</span><b class="mono">${fmt(tot)}</b></div>
      <div class="stack">${order.filter((x) => +by[x][key] > 0).map((x) => `<i style="flex:${(+by[x][key] / tot).toFixed(5)} 1 0;height:22px;background:${GOLC[x]}" data-tip="${esc(`${x}: ${fmt(+by[x][key])} (${pct(ratio(+by[x][key], tot), 0)})`)}"></i>`).join('')}</div></div>`;
  };
  return card('Komposisi golongan', sub,
    bar('kWh TS terbayar', 'kwh', (v) => `${num(v)} kWh`) + bar('Total P2TL', 'total', (v) => rp(v)) + bar('Jumlah pelanggan', 'n', num) +
    `<div class="exec-cleg">${order.map((x) => `<div style="border-top-color:${GOLC[x]}"><b>${x}</b><span class="mono">${num(by[x].kwh)} kWh</span><span class="mono">${rp(by[x].total)} · ${num(by[x].n)} plg</span></div>`).join('')}</div>`,
    'data-print="comp"');
}
function rentangPendek(a, b) { return a === b ? tglPendek(a) : `${tglPendek(a)} – ${tglPendek(b)}`; }

// ---------- 4. rapor bulanan (grafik + tabel sejajar) ----------
export function raporCard(o) {
  const H = 230;
  const tgts = o.perMonth.map((m) => o.tgtM(m.b));
  const top = niceMax(Math.max(...o.perMonth.map((m) => m.kwh), ...tgts) * 1.12);
  const gols = KWH_GOL.filter((g) => o.perMonth.some((m) => m.gol[g] > 0));
  const done = o.perMonth.filter((m) => m.b <= o.curMonth);
  const full = done.filter((m) => m.b < o.curMonth);
  const ok = full.filter((m) => o.target && m.kwh >= o.tgtM(m.b)).length;
  const totK = done.reduce((s, m) => s + m.kwh, 0);
  const topG = gols.map((g) => [g, done.reduce((s, m) => s + (m.gol[g] || 0), 0)]).sort((a, b) => b[1] - a[1])[0];
  const dep = o.hasRisk ? done.filter((m) => m.kwh > 0 && m.top5 / m.kwh >= 0.5).length : null;
  const cls = (m) => `${m.b === o.curMonth ? ' cur' : ''}${m.b > o.curMonth ? ' fut' : ''}${o.sel.has(m.b) ? ' sel' : ''}`;
  // grafik
  let y = '';
  for (let i = 0; i <= 4; i++) { const v = top * i / 4; y += `<span style="bottom:${(v / top * H).toFixed(1)}px">${jt(v)}</span>`; }
  const cols = o.perMonth.map((m) => {
    const tg = tgts[m.b - 1], fut = m.b > o.curMonth;
    const ghost = o.target ? `<div class="rg" style="height:${(tg / top * H).toFixed(1)}px"></div>` : '';
    if (fut) return `<div class="rc${cls(m)}" data-tip="${esc(`${BLN_L[m.b - 1]} ${o.th}: target ${num(tg)} kWh`)}">${ghost}</div>`;
    const segs = gols.slice().reverse().filter((g) => m.gol[g] > 0);
    const p = o.target ? Math.round(m.kwh / tg * 100) : null;
    const tip = `${BLN_L[m.b - 1]} ${o.th}${m.b === o.curMonth ? ` (s.d. ${tglPendek(o.asof)}, sementara)` : ''}: ${num(m.kwh)} kWh` + (o.target ? ` dari target ${num(tg)} (${p}%)` : '') +
      gols.filter((g) => m.gol[g] > 0).map((g) => `\n${g}: ${num(m.gol[g])} kWh`).join('');
    return `<div class="rc${cls(m)}" data-tip="${esc(tip)}">${ghost}<div class="rs">${segs.map((g, i) => `<i style="height:${(m.gol[g] / top * H).toFixed(1)}px;background:${GOLC[g]}${i ? '' : ';border-radius:3px 3px 0 0'}"></i>`).join('')}</div>
      ${p !== null ? `<span class="chip ${capChip(p)} rp" style="bottom:${(Math.max(m.kwh, tg) / top * H + 5).toFixed(1)}px">${p >= 100 ? '✓ ' : ''}${p}%</span>` : ''}</div>`;
  }).join('');
  // tabel
  const cell = (m, t, c = '') => `<span class="${(cls(m) + ' ' + c).trim()}">${t}</span>`;
  const row = (lbl, f, tot, rc = '') => `<div class="rr ${rc}"><span class="rl">${lbl}</span>${o.perMonth.map(f).join('')}<span class="rt">${tot}</span></div>`;
  const kw = (v) => (v ? num(v) : '—');
  let rows = `<div class="rr rh"><span class="rl"></span>${o.perMonth.map((m) => cell(m, BLN[m.b - 1] + (m.b === o.curMonth ? '*' : ''))).join('')}<span class="rt">Total</span></div>`;
  rows += `<div class="rsec">kWh TS TERBAYAR (kWh)</div>`;
  for (const g of gols) {
    rows += row(`<i class="dot" style="background:${GOLC[g]}"></i>${g}`, (m) => cell(m, m.b > o.curMonth ? '' : kw(m.gol[g] || 0), (m.gol[g] || 0) >= 500000 ? 'b' : ''), num(done.reduce((s, m) => s + (m.gol[g] || 0), 0)));
  }
  rows += row('Total kWh', (m) => cell(m, m.b > o.curMonth ? '' : num(m.kwh), 'b'), num(totK), 'tot');
  if (o.target) {
    rows += row('Target bulan itu', (m) => cell(m, num(tgts[m.b - 1]), 'mut'), num(done.reduce((s, m) => s + tgts[m.b - 1], 0)), 'mut');
    rows += row('Selisih', (m) => { if (m.b > o.curMonth) return cell(m, ''); const v = m.kwh - tgts[m.b - 1]; return cell(m, sgn(v), v >= 0 ? 'pos' : 'neg'); },
      (() => { const v = totK - done.reduce((s, m) => s + tgts[m.b - 1], 0); return `<span class="${v >= 0 ? 'pos' : 'neg'}">${sgn(v)}</span>`; })());
  }
  rows += `<div class="rsec">PELANGGAN &amp; RISIKO CAPAIAN</div>`;
  rows += row('Pelanggan', (m) => cell(m, m.b > o.curMonth ? '' : num(m.n)), num(done.reduce((s, m) => s + m.n, 0)));
  if (o.hasRisk) {
    rows += row(`Kasus ≥ ${num(BIG)} kWh`, (m) => cell(m, m.b > o.curMonth ? '' : m.big ? num(m.big) : '—', m.big ? 'b' : ''), num(done.reduce((s, m) => s + (m.big || 0), 0)));
    rows += row('Porsi 5 kasus terbesar', (m) => { if (m.b > o.curMonth || !m.kwh) return cell(m, m.b > o.curMonth ? '' : '—'); const p = Math.round(m.top5 / m.kwh * 100); return cell(m, `${p}%`, p >= 50 ? 'hl' : ''); }, '');
    const bel = done.reduce((s, m) => s + (m.belum || 0), 0);
    rows += row('Temuan belum tercatat bayar (kWh)', (m) => cell(m, m.b > o.curMonth ? '' : m.belum ? num(m.belum) : '0', (m.belum || 0) >= 500000 ? 'neg b' : ''), num(bel));
  }
  const chips = [
    o.target ? `<span class="chip ${ok >= full.length / 2 ? 'good' : 'warn'}">${num(ok)} dari ${num(full.length)} bulan penuh tercapai</span>` : '',
    topG && totK ? `<span class="chip" style="background:#FDF0EA;color:#A3401A">${topG[0]} = ${pct(ratio(topG[1], totK), 0)} kWh</span>` : '',
    dep ? `<span class="chip warn">${num(dep)} bulan bergantung kasus besar</span>` : '',
  ].join('');
  return `<section class="card exec-rapor" data-print="rapor" aria-label="Rapor bulanan">
    <div class="exec-top"><div><h2>Rapor bulanan ${o.th}</h2>
      <p class="sub">Laporan TS terbayar menurut tanggal register; grafik dan tabel sejajar per bulan. Bulan berjalan (*) s.d. ${tglPendek(o.asof)}, sementara.${o.sel.size ? ' Kolom berbingkai = bulan pada periode filter.' : ''}</p></div>
      <div class="exec-chips">${chips}</div></div>
    <div class="rapor-scroll"><div class="rapor">
      <div class="rr rchart"><div class="ry">${y}</div>${cols}<div class="rsum"><span>Jan–${BLN[o.curMonth - 1]}</span><b class="mono">${num(totK)}</b>${o.target ? `<span>${pct(ratio(totK, o.target))} target tahunan</span>` : ''}</div></div>
      ${rows}
    </div></div>
    <div class="legend">${gols.map((g) => `<span><i class="dot" style="background:${GOLC[g]}"></i>${g}</span>`).join('')}${o.target ? '<span><i class="tg-sw"></i>Target bulan itu (batang abu-abu)</span>' : ''}<span>% = capaian terhadap target bulan itu</span></div>
    ${o.hasRisk ? `<p class="sub">Kasus besar = ≥ ${num(BIG)} kWh per pelanggan. Temuan belum tercatat bayar dihitung per bulan pemeriksaan dari potensi kWh hasil pemeriksaan yang belum cocok dengan Laporan TS (No. Agenda atau IDPEL); P4 tanpa IDPEL tidak selalu bisa dicocokkan, dan angka besar yang ditandai merah perlu dicek.</p>` : '<p class="sub">Baris risiko (kasus besar, temuan belum tercatat bayar) muncul setelah update database v1.7 dijalankan.</p>'}
  </section>`;
}

// ---------- 5. detail periode (≤ 2 bulan; layar saja) ----------
let periodeView = 'kwh';
export function periodeCard(d, o, ctx, periksaHtml) {
  const from = ctx.f.from, to = ctx.f.to, nd = days(from, to);
  if (nd > 62) return '';
  const today = iso(new Date()), asof = to < today ? to : today; // target hanya s.d. hari ini
  const tDays = (a, z) => { const zz = z < asof ? z : asof; return zz < a ? 0 : days(a, zz); };
  const harian = o && o.target ? o.harian : null;
  const byDay = new Map();
  for (const x of d.ts_daily || []) { const cur = byDay.get(x.tgl) || {}; cur[x.gol] = (cur[x.gol] || 0) + (+x.kwh || 0); byDay.set(x.tgl, cur); }
  const perHari = nd <= 14;
  const items = [];
  if (perHari) {
    for (let t = from; t <= to; t = addD(t, 1)) items.push({ lbl: `${HARI[parse(t).getDay()]} ${+t.slice(8, 10)}`, a: t, z: t, n: 1 });
  } else {
    let a = from;
    while (a <= to) {
      const dow = (parse(a).getDay() + 6) % 7; // 0 = Senin
      let z = addD(a, 6 - dow); if (z > to) z = to;
      items.push({ lbl: a === z ? tglPendek(a).replace(/ \d{4}$/, '') : `${+a.slice(8, 10)}–${tglPendek(z).replace(/ \d{4}$/, '')}`, a, z, n: days(a, z) });
      a = addD(z, 1);
    }
  }
  for (const it of items) {
    it.v = {};
    for (let t = it.a; t <= it.z; t = addD(t, 1)) { const o2 = byDay.get(t); if (o2) for (const [g, v] of Object.entries(o2)) it.v[g] = (it.v[g] || 0) + v; }
    it.kwh = Object.values(it.v).reduce((s, v) => s + v, 0);
    it.tg = harian ? harian * tDays(it.a, it.z) : null;
  }
  const gols = KWH_GOL.filter((g) => items.some((it) => it.v[g] > 0));
  const all = items.reduce((s, it) => s + it.kwh, 0), allT = harian ? harian * tDays(from, to) : null;
  const H = 200, top = niceMax(Math.max(...items.map((it) => Math.max(it.kwh, it.tg || 0)), 1) * 1.15);
  let y = ''; for (let i = 0; i <= 4; i++) { const v = top * i / 4; y += `<span style="bottom:${(v / top * H).toFixed(1)}px">${num(v)}</span>`; }
  const cols = items.map((it) => {
    const p = it.tg ? Math.round(it.kwh / it.tg * 100) : null;
    const tip0 = `${it.a === it.z ? tglPanjang(it.a) : `${tglPendek(it.a)} – ${tglPendek(it.z)}`}: ${num(it.kwh)} kWh${it.tg ? ` dari target ${num(it.tg)} (${p}%)` : ''}` + gols.filter((g) => it.v[g] > 0).map((g) => `\n${g}: ${num(it.v[g])} kWh`).join('');
    const tip = it.a > asof ? `${tglPendek(it.a)}: belum terjadi` : tip0;
    return `<div class="rc${it.a > asof ? ' fut' : ''}" data-tip="${esc(tip)}">${it.tg ? `<div class="rg" style="height:${(it.tg / top * H).toFixed(1)}px"></div>` : ''}<div class="rs">${gols.slice().reverse().filter((g) => it.v[g] > 0).map((g, i) => `<i style="height:${(it.v[g] / top * H).toFixed(1)}px;background:${GOLC[g]}${i ? '' : ';border-radius:3px 3px 0 0'}"></i>`).join('')}</div>
      ${p !== null ? `<span class="chip ${capChip(p)} rp" style="bottom:${(Math.max(it.kwh, it.tg) / top * H + 5).toFixed(1)}px">${p}%</span>` : ''}</div>`;
  }).join('');
  const gt = `grid-template-columns: 120px repeat(${items.length}, minmax(0, 1fr)) 96px`;
  const row = (lbl, f, tot, rc = '') => `<div class="rr ${rc}" style="${gt}"><span class="rl">${lbl}</span>${items.map((it) => `<span>${f(it)}</span>`).join('')}<span class="rt">${tot}</span></div>`;
  let tbl = `<div class="rr rh" style="${gt}"><span class="rl"></span>${items.map((it) => `<span>${it.lbl}</span>`).join('')}<span class="rt">Total</span></div>`;
  for (const g of gols) tbl += row(`<i class="dot" style="background:${GOLC[g]}"></i>${g}`, (it) => (it.v[g] ? num(it.v[g]) : '—'), num(items.reduce((s, it) => s + (it.v[g] || 0), 0)));
  tbl += row('Total kWh', (it) => num(it.kwh), num(all), 'tot');
  if (allT) {
    tbl += row('Target', (it) => (it.tg ? num(it.tg) : '—'), num(allT), 'mut');
    tbl += row('Selisih', (it) => (it.tg ? `<b class="${it.kwh >= it.tg ? 'pos' : 'neg'}">${sgn(it.kwh - it.tg)}</b>` : '—'), `<span class="${all >= allT ? 'pos' : 'neg'}">${sgn(all - allT)}</span>`);
  }
  // kumulatif mini
  let cum = '';
  if (allT) {
    const W = 320, Hh = 150, L = 30, R = 10, T = 14, B = 20, iw = W - L - R, ih = Hh - T - B, mx = Math.max(all, allT) * 1.1;
    let acc = 0; const pts = [[L, T + ih]];
    items.forEach((it, k) => { acc += it.kwh; pts.push([L + (k + 1) / items.length * iw, T + ih - acc / mx * ih]); });
    const ty = T + ih - allT / mx * ih, ry = T + ih - all / mx * ih;
    cum = `<svg viewBox="0 0 ${W} ${Hh}" width="100%" role="img" aria-label="Kumulatif periode terhadap target">
      <line x1="${L}" y1="${T + ih}" x2="${L + iw}" y2="${T + ih}" stroke="#C9CDD4"/>
      <line x1="${L}" y1="${T + ih}" x2="${L + iw}" y2="${ty}" stroke="${TGT_C}" stroke-width="2" stroke-dasharray="6 4"/>
      <polyline fill="none" stroke="${REAL_C}" stroke-width="2.5" points="${pts.map((p) => p.join(',')).join(' ')}"/>
      ${pts.slice(1).map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="${REAL_C}" stroke="#fff" stroke-width="1.5"/>`).join('')}
      <text x="${L + iw}" y="${ty - 6}" font-size="10.5" text-anchor="end" fill="${TGT_C}" font-weight="700">target ${num(allT)}</text>
      <text x="${L + iw}" y="${Math.min(ry + 16, T + ih - 4)}" font-size="10.5" text-anchor="end" fill="${REAL_C}" font-weight="700">${num(all)}</text>
      <text x="${L}" y="${Hh - 4}" font-size="10" fill="#5F6879">${tglPendek(from).replace(/ \d{4}$/, '')}</text><text x="${L + iw}" y="${Hh - 4}" font-size="10" text-anchor="end" fill="#5F6879">${tglPendek(to).replace(/ \d{4}$/, '')}</text></svg>`;
  }
  const pAll = allT ? Math.round(all / allT * 100) : null;
  const kwhPanel = `<div class="per-grid">
      <div style="min-width:0"><div class="rapor per" style="--cols:${items.length}"><div class="rr rchart" style="${gt.replace('96px', '0px')};--h:${H}px"><div class="ry">${y}</div>${cols}<div></div></div></div>
        <div class="per-tbl"><div class="rapor per">${tbl}</div></div></div>
      <div class="per-side"><div class="lbl">KUMULATIF PERIODE vs TARGET</div>
        <div class="exec-hero" style="gap:10px"><b class="mono" style="font-size:26px">${num(all)}</b>${allT ? `<span>dari target ${num(allT)} kWh</span><span class="chip ${capChip(pAll)}">${pAll}%</span>` : '<span>kWh</span>'}</div>
        ${cum}
        ${asof < to ? `<p class="sub">Target dihitung s.d. ${tglPendek(asof)} (hari ini).</p>` : ''}
        <p class="sub">Register Laporan TS sering berkelompok, sehingga angka ${perHari ? 'per hari' : 'per minggu'} bisa naik-turun tajam. Angka kumulatif lebih adil untuk dibandingkan dengan target.</p></div>
    </div>
    <div class="legend">${gols.map((g) => `<span><i class="dot" style="background:${GOLC[g]}"></i>${g}</span>`).join('')}${allT ? `<span><i class="tg-sw"></i>Target ${perHari ? 'harian' : 'minggu itu'} (${num(harian)} kWh/hari)</span>` : ''}</div>`;
  return `<section class="card exec-per" data-print="hide" id="execper">
    <div class="exec-top"><div><h2>Detail periode · ${perHari ? 'per hari' : 'per minggu (Senin–Minggu)'}</h2><p class="sub">${rentangPendek(from, to)} · muncul bila rentang filter ≤ 2 bulan, tidak ikut dicetak.</p></div>
      <div class="seg" role="tablist"><button type="button" role="tab" data-pv="kwh" class="${periodeView === 'kwh' ? 'on' : ''}" aria-selected="${periodeView === 'kwh'}">kWh TS terbayar</button><button type="button" role="tab" data-pv="periksa" class="${periodeView === 'periksa' ? 'on' : ''}" aria-selected="${periodeView === 'periksa'}">Pemeriksaan &amp; temuan</button></div></div>
    <div data-pp="kwh" ${periodeView === 'kwh' ? '' : 'hidden'}>${items.length && (d.ts_daily || []).length ? kwhPanel : empty(d.ts?.min ? `Tidak ada Laporan TS terbayar pada periode ini. Data tersedia ${tglPendek(d.ts.min)} – ${tglPendek(d.ts.max)}.` : 'Belum ada Laporan TS terbayar.')}</div>
    <div data-pp="periksa" ${periodeView === 'periksa' ? '' : 'hidden'}>${periksaHtml}</div>
  </section>`;
}
export function bindPeriode(el) {
  el.querySelectorAll('[data-pv]').forEach((b) => b.onclick = () => {
    periodeView = b.dataset.pv;
    el.querySelectorAll('[data-pv]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); });
    el.querySelectorAll('[data-pp]').forEach((p) => { p.hidden = p.dataset.pp !== periodeView; });
  });
}

// ---------- catatan ----------
export function capaianNotes(o) {
  const out = [];
  if (!o.target) out.push(`Target ${o.th} belum diisi; realisasi kWh TS terbayar s.d. ${tglPendek(o.asof)}: <b>${num(o.real)} kWh</b>.`);
  else {
    const arah = o.selisih >= 0 ? `<b>di atas jalur</b> ${num(o.selisih)} kWh` : `<b>di bawah jalur</b> ${num(-o.selisih)} kWh`;
    let s = `Capaian target ${o.th}: <b>${pct(o.pct)}</b> (${num(o.real)} dari ${num(o.target)} kWh) s.d. ${tglPendek(o.asof)}, ${arah} dari seharusnya ${pct(o.pctJalur)}.`;
    if (o.sisaHari > 0 && o.sisa > 0) s += ` Agar target tercapai dibutuhkan <b>${num(o.perluHari)} kWh/hari</b> (${pct(ratio(o.perluHari, o.lajuHari), 0)} dari laju rata-rata sejauh ini).`;
    out.push(s);
  }
  if (o.hasRisk) {
    const done = o.perMonth.filter((m) => m.b <= o.curMonth && m.kwh > 0);
    const dep = done.filter((m) => m.top5 / m.kwh >= 0.5);
    if (dep.length) out.push(`Capaian bergantung pada kasus besar: pada ${dep.map((m) => BLN[m.b - 1]).join(', ')}, 5 kasus terbesar menyumbang ≥ 50% kWh bulan itu.`);
    const bm = o.perMonth.filter((m) => m.b <= o.curMonth);
    const bel = bm.reduce((s, m) => s + (m.belum || 0), 0);
    const odd = bm.filter((m) => (m.belum || 0) >= 500000);
    if (bel > 0) out.push(`Potensi kWh temuan ${o.th} yang belum tercatat bayar: <b>${num(bel)} kWh</b>${odd.length ? `, termasuk ${odd.map((m) => `${num(m.belum)} kWh di ${BLN[m.b - 1]}`).join(', ')} yang perlu dicek (kemungkinan kasus besar masih berproses atau salah input); di luar itu <b>${num(bel - odd.reduce((s, m) => s + m.belum, 0))} kWh</b>` : ''}. Angka ini indikasi karena pencocokan dengan Laporan TS tidak sempurna.`);
  }
  return out;
}

export function printHead(ctx, unit) {
  const now = new Date();
  return `<div class="print-head"><div><b>Ringkasan Eksekutif P2TL · ${esc(unit)}</b><span>Periode ${esc(tglPanjang(ctx.f.from))} – ${esc(tglPanjang(ctx.f.to))}${ctx.cmp ? ` · dibandingkan ${esc(tglPendek(ctx.cmp[0]))} – ${esc(tglPendek(ctx.cmp[1]))}` : ''}</span></div>
    <div class="ph-r">Dicetak ${esc(tglPanjang(iso(now)))} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}${ctx.me?.nama ? ` · ${esc(title(ctx.me.nama))}` : ''}</div></div>`;
}

