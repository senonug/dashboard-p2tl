// ======================= RINGKASAN EKSEKUTIF: capaian target (v1.6) =======================
// Target tahunan kWh TS terbayar (Laporan TS, tanggal register), dibagi rata per hari.
import { C, GOLC, GOL_ORDER, esc, num, pct, rp, ratio, card, legend, empty, stack, icon, IC, tglPendek, tglPanjang, title } from './ui.js';

const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const BLN_L = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const TGT_C = '#5F6879', REAL_C = C.s1;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const diy = (y) => ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365);
const doy = (s) => { const d = parse(s); return Math.round((d - new Date(d.getFullYear(), 0, 1)) / 864e5) + 1; };
const dim = (y, m) => new Date(y, m, 0).getDate();
export const jt = (v) => (Math.abs(v) >= 1e6 ? `${num(v / 1e6, 2)} jt` : Math.abs(v) >= 1e3 ? `${num(v / 1e3, 0)} rb` : num(v));
const niceMax = (v) => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); const f = v / p; return [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10].find((s) => f <= s) * p; };

// Hitung seluruh angka capaian dari hasil f_capaian; asof = min(sampai tanggal filter, hari ini)
export function hitungCapaian(cap, to) {
  const today = iso(new Date());
  const asof = to < today ? to : today;
  const th = cap.tahun, D = diy(th), n = doy(asof);
  const target = cap.target ? +cap.target : null, real = +cap.kwh || 0;
  const perMonth = Array.from({ length: 12 }, (_, i) => ({ b: i + 1, kwh: 0, rp: 0, n: 0, gol: {} }));
  for (const r of cap.bulan || []) { const m = perMonth[r.b - 1]; m.kwh += +r.kwh; m.rp += +r.rp; m.n += r.n; m.gol[r.gol] = (m.gol[r.gol] || 0) + (+r.kwh); }
  const o = { th, D, asof, n, real, target, perMonth, dataMax: cap.data_max, rpReal: +cap.rp || 0, nReal: cap.n || 0, curMonth: parse(asof).getMonth() + 1 };
  o.lajuHari = real / n;
  o.proyeksi = o.lajuHari * D;
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
        <div class="exec-scale"><span>0</span><span class="${mark > 80 ? 'r' : mark < 20 ? 'l' : ''}" style="left:${mark}%">▲ seharusnya ${pct(o.pctJalur)} (${jt(o.seharusnya)})</span></div>
      </div>
      <div class="exec-side">
        <div><span class="lbl">${o.selisih >= 0 ? 'LEBIH DARI JALUR' : 'KURANG DARI JALUR'}</span><b class="mono" style="color:var(--${st[0]})">${o.selisih >= 0 ? '+' : '−'}${num(Math.abs(o.selisih))} kWh</b><small>seharusnya ${num(o.seharusnya)} kWh</small></div>
        <div><span class="lbl">TARGET SISA</span><b class="mono">${o.sisaHari > 0 ? `${num(o.perluHari)} kWh/hari` : '–'}</b><small>${o.sisaHari > 0 ? `${num(o.sisa)} kWh dalam ${num(o.sisaHari)} hari · laju sekarang ${num(o.lajuHari)}/hari` : 'tahun sudah berakhir'}</small></div>
        <div><span class="lbl">PROYEKSI AKHIR TAHUN</span><b class="mono">${jt(o.proyeksi)} kWh</b><small>${pct(ratio(o.proyeksi, o.target))} target, bila laju tetap</small></div>
      </div>
    </div></section>`;
}

// Grafik kumulatif (garis) — satu sumbu, realisasi vs target pro-rata
function kumulatifSvg(o) {
  const W = 560, H = 230, L = 48, R = 74, T = 14, B = 26, iw = W - L - R, ih = H - T - B;
  const top = niceMax(Math.max(o.target || 0, o.real, o.proyeksi * 0.2) * 1.02);
  const x = (d) => L + (d / o.D) * iw, y = (v) => T + ih - (v / top) * ih;
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = top * i / 4; g += `<line x1="${L}" x2="${L + iw}" y1="${y(v)}" y2="${y(v)}" stroke="#E4E7EC" ${i ? 'stroke-dasharray="3 3"' : ''}/><text x="${L - 6}" y="${y(v) + 4}" font-size="10.5" text-anchor="end" fill="#5F6879">${jt(v)}</text>`; }
  let acc = 0;
  for (let m = 1; m <= 12; m++) { const mid = doy(`${o.th}-${String(m).padStart(2, '0')}-15`); g += `<text x="${x(mid)}" y="${H - 8}" font-size="10.5" text-anchor="middle" fill="#5F6879">${BLN[m - 1]}</text>`; }
  if (o.target) {
    g += `<line x1="${x(0)}" y1="${y(0)}" x2="${x(o.D)}" y2="${y(o.target)}" stroke="${TGT_C}" stroke-width="2" stroke-dasharray="6 4"/>`;
    g += `<text x="${x(o.D) + 6}" y="${y(o.target) + 4}" font-size="11" fill="${TGT_C}" font-weight="600">Target</text><text x="${x(o.D) + 6}" y="${y(o.target) + 17}" font-size="10.5" fill="${TGT_C}">${jt(o.target)}</text>`;
  }
  const pts = [[0, 0]], tips = [];
  for (let m = 1; m <= o.curMonth; m++) {
    acc += o.perMonth[m - 1].kwh;
    const d = m === o.curMonth ? o.n : doy(`${o.th}-${String(m).padStart(2, '0')}-${dim(o.th, m)}`);
    pts.push([d, acc]);
    tips.push([d, acc, m]);
  }
  g += `<polyline fill="none" stroke="${REAL_C}" stroke-width="2.5" stroke-linejoin="round" points="${pts.map(([d, v]) => `${x(d)},${y(v)}`).join(' ')}"/>`;
  for (const [d, v, m] of tips) {
    const seh = o.target ? o.target * d / o.D : null;
    g += `<circle cx="${x(d)}" cy="${y(v)}" r="4.5" fill="${REAL_C}" stroke="#fff" stroke-width="2"/><circle cx="${x(d)}" cy="${y(v)}" r="11" fill="transparent" data-tip="${esc(`${m === o.curMonth ? `s.d. ${tglPendek(o.asof)}` : `Akhir ${BLN_L[m - 1]}`}: ${num(v)} kWh kumulatif${seh ? `\nTarget kumulatif: ${num(seh)} kWh (${v >= seh ? '+' : '−'}${num(Math.abs(v - seh))})` : ''}`)}"/>`;
  }
  const last = pts[pts.length - 1];
  g += `<text x="${Math.min(x(last[0]) + 8, L + iw - 4)}" y="${y(last[1]) + (o.target && last[1] < o.target * last[0] / o.D ? 16 : -8)}" font-size="11" font-weight="700" fill="#0E1726">${jt(last[1])}</text>`;
  if (o.target) g += `<circle cx="${x(o.n)}" cy="${y(o.seharusnya)}" r="3.5" fill="#fff" stroke="${TGT_C}" stroke-width="2"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Kumulatif kWh TS terbayar ${o.th} dibanding target">${g}</svg>`;
}

// Kolom per bulan (bertumpuk per golongan) + garis pendek target bulanan
function bulananSvg(o) {
  const W = 560, H = 230, L = 48, R = 8, T = 14, B = 26, iw = W - L - R, ih = H - T - B, bw = iw / 12;
  const tgtM = (m) => (o.target ? o.target * dim(o.th, m) / o.D : 0);
  const top = niceMax(Math.max(...o.perMonth.map((m) => m.kwh), o.target ? tgtM(1) * 1.1 : 0) * 1.05);
  const y = (v) => T + ih - (v / top) * ih;
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = top * i / 4; g += `<line x1="${L}" x2="${L + iw}" y1="${y(v)}" y2="${y(v)}" stroke="#E4E7EC" ${i ? 'stroke-dasharray="3 3"' : ''}/><text x="${L - 6}" y="${y(v) + 4}" font-size="10.5" text-anchor="end" fill="#5F6879">${jt(v)}</text>`; }
  const keys = GOL_ORDER.slice().reverse().concat(Object.keys(GOLC).filter((k) => !GOL_ORDER.includes(k)));
  o.perMonth.forEach((m, i) => {
    const x0 = L + i * bw + bw * 0.18, w = bw * 0.64;
    const cur = m.b === o.curMonth, future = m.b > o.curMonth;
    let base = 0;
    const segs = keys.filter((k) => m.gol[k] > 0);
    segs.forEach((k, si) => {
      const v = m.gol[k], y1 = y(base + v), h = Math.max(0, y(base) - y1 - (si < segs.length - 1 ? 0 : 0));
      g += `<rect x="${x0}" y="${y1}" width="${w}" height="${Math.max(h - 1, 0.5)}" fill="${GOLC[k] || '#9AA3B2'}" ${cur ? 'fill-opacity="0.55"' : ''} rx="${si === segs.length - 1 ? 3 : 0}"/>`;
      base += v;
    });
    if (o.target) g += `<line x1="${x0 - 3}" x2="${x0 + w + 3}" y1="${y(tgtM(m.b))}" y2="${y(tgtM(m.b))}" stroke="${TGT_C}" stroke-width="2" stroke-dasharray="4 3"/>`;
    g += `<text x="${x0 + w / 2}" y="${H - 8}" font-size="10.5" text-anchor="middle" fill="${cur ? '#0E1726' : '#5F6879'}" ${cur ? 'font-weight="700"' : ''}>${BLN[i]}</text>`;
    if (cur && m.kwh) g += `<text x="${x0 + w / 2}" y="${y(m.kwh) - 5}" font-size="9.5" text-anchor="middle" fill="#5F6879">sementara</text>`;
    if (!future) {
      const tip = `${BLN_L[i]} ${o.th}${cur ? ` (s.d. ${tglPendek(o.asof)}, sementara)` : ''}: ${num(m.kwh)} kWh · ${num(m.n)} pelanggan · ${rp(m.rp)}` +
        (o.target ? `\nTarget bulan ini: ${num(tgtM(m.b))} kWh (${pct(ratio(m.kwh, tgtM(m.b)), 0)})` : '') +
        segs.slice().reverse().map((k) => `\n${k}: ${num(m.gol[k])} kWh`).join('');
      g += `<rect x="${L + i * bw}" y="${T}" width="${bw}" height="${ih}" fill="transparent" data-tip="${esc(tip)}"/>`;
    }
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="kWh TS terbayar per bulan ${o.th} dan target bulanan">${g}</svg>`;
}

export function bulananCard(o) {
  const used = GOL_ORDER.filter((g) => o.perMonth.some((m) => m.gol[g] > 0));
  const bulanOk = o.perMonth.filter((m) => m.b < o.curMonth && o.target && m.kwh >= o.target * dim(o.th, m.b) / o.D).length;
  return card(`Kinerja bulanan ${o.th} terhadap target`, `kWh TS terbayar menurut tanggal register, Januari s.d. ${tglPendek(o.asof)}. Arahkan kursor ke titik/kolom untuk rincian.`,
    `<div class="two exec-charts">
      <div><div class="lbl" style="margin-bottom:6px">Kumulatif vs target</div>${kumulatifSvg(o)}
        <div class="legend"><span><i class="ln" style="background:${REAL_C}"></i>Realisasi kumulatif</span>${o.target ? `<span><i class="ln dash" style="border-color:${TGT_C}"></i>Target pro-rata harian</span>` : ''}</div></div>
      <div><div class="lbl" style="margin-bottom:6px">Per bulan per golongan${o.target ? ` · ${num(bulanOk)} dari ${num(o.curMonth - 1)} bulan penuh mencapai target bulanan` : ''}</div>${bulananSvg(o)}
        ${legend(used.map((g) => [g, GOLC[g]]))}${o.target ? `<div class="legend" style="margin-top:4px"><span><i class="ln dash" style="border-color:${TGT_C}"></i>Target bulanan (${jt(o.target * 30 / o.D)}–${jt(o.target * 31 / o.D)})</span><span><i class="dot" style="background:${C.s1};opacity:.55"></i>Bulan berjalan (sementara)</span></div>` : ''}</div>
    </div>`, 'data-print="month"');
}

// Realisasi pembayaran pada periode filter (dari gol_ts f_ringkasan)
export function bayarCard(d) {
  const g = (d.gol_ts || []).filter((r) => /^[PK]\d$/.test(r.gol || ''));
  const tot = g.reduce((s, r) => s + (+r.total || 0), 0), tun = g.reduce((s, r) => s + (+r.tunai || 0), 0), ang = g.reduce((s, r) => s + (+r.angsur || 0), 0);
  const n = g.reduce((s, r) => s + r.n, 0);
  if (!n) return card('Realisasi pembayaran TS', 'Sumber: Laporan TS terbayar pada periode terpilih.', empty('Tidak ada Laporan TS terbayar pada periode ini'));
  const lain = Math.max(0, tot - tun - ang);
  return card('Realisasi pembayaran TS', `Sumber: Laporan TS terbayar pada periode terpilih (${num(n)} pelanggan, P1–P4 dan K1–K2).`,
    `<div class="exec-pay">
      <div><span class="lbl">TOTAL P2TL</span><b class="mono">${rp(tot)}</b></div>
      <div><span class="lbl">TUNAI</span><b class="mono">${rp(tun)}</b><small>${pct(ratio(tun, tot), 0)}</small></div>
      <div><span class="lbl">ANGSURAN</span><b class="mono">${rp(ang)}</b><small>${pct(ratio(ang, tot), 0)} · masih dicicil</small></div>
    </div>
    ${stack([{ l: 'Tunai', v: tun, c: C.s1, tip: `Tunai: ${rp(tun)} (${pct(ratio(tun, tot), 0)})` }, { l: 'Angsuran', v: ang, c: C.light, tip: `Angsuran: ${rp(ang)} (${pct(ratio(ang, tot), 0)})` }, { l: 'Lainnya', v: lain, c: C.gray, tip: `Lainnya: ${rp(lain)}` }], 26)}
    ${legend([['Tunai', C.s1], ['Angsuran', C.light]].concat(lain > 0 ? [['Lainnya', C.gray]] : []))}
    <p class="sub">Rincian aging angsuran dan perjalanan temuan sampai lunas ada di halaman <a href="#/pembayaran">Realisasi Pembayaran TS</a>.</p>`);
}

// Kalimat untuk Catatan analis
export function capaianNote(o) {
  if (!o.target) return `Target ${o.th} belum diisi; realisasi kWh TS terbayar s.d. ${tglPendek(o.asof)}: <b>${num(o.real)} kWh</b>.`;
  const arah = o.selisih >= 0 ? `<b>di atas jalur</b> ${num(o.selisih)} kWh` : `<b>di bawah jalur</b> ${num(-o.selisih)} kWh`;
  let s = `Capaian target ${o.th}: <b>${pct(o.pct)}</b> (${num(o.real)} dari ${num(o.target)} kWh) s.d. ${tglPendek(o.asof)}, ${arah} dari seharusnya ${pct(o.pctJalur)}.`;
  if (o.sisaHari > 0 && o.sisa > 0) s += ` Agar target tercapai dibutuhkan <b>${num(o.perluHari)} kWh/hari</b> (${pct(ratio(o.perluHari, o.lajuHari), 0)} dari laju rata-rata sejauh ini).`;
  return s;
}

export function printHead(ctx, unit) {
  const now = new Date();
  return `<div class="print-head"><div><b>Ringkasan Eksekutif P2TL · ${esc(unit)}</b><span>Periode ${esc(tglPanjang(ctx.f.from))} – ${esc(tglPanjang(ctx.f.to))}${ctx.cmp ? ` · dibandingkan ${esc(tglPendek(ctx.cmp[0]))} – ${esc(tglPendek(ctx.cmp[1]))}` : ''}</span></div>
    <div class="ph-r">Dicetak ${esc(tglPanjang(iso(now)))} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}${ctx.me?.nama ? ` · ${esc(title(ctx.me.nama))}` : ''}</div></div>`;
}
