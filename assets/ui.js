// Komponen tampilan & grafik (HTML/CSS murni, tanpa pustaka chart)
export const C = { s1: '#2a78d6', s2: '#eb6834', s3: '#1baf7a', s4: '#eda100', s5: '#e87ba4', s6: '#008300', s7: '#6250d6', s8: '#e34948',
  gray: '#B7BDC7', light: '#86b6ef', dark: '#0d366b', hl: '#b84a1e' };
export const GOLC = { P4: C.s1, K2: C.s2, P1: C.s3, P3: C.s4, P2: C.s5, K1: C.s6, DKRP: '#9AA3B2' };
export const GOL_ORDER = ['P4', 'K2', 'P1', 'P3', 'P2', 'K1'];
export const GOL_DESC = { P1: 'Pelanggaran batas daya', P2: 'Pelanggaran pengukuran energi', P3: 'Pelanggaran batas daya & pengukuran',
  P4: 'Pemakaian tanpa alas hak (non-pelanggan)', K1: 'Kelainan: lebih tagih', K2: 'Kelainan: kurang tagih', DKRP: 'Koreksi rekening' };
export const RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#104281'];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf0 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const num = (v, d = 0) => (d = typeof d === 'number' ? d : 0, v === null || v === undefined || Number.isNaN(+v) ? '–' : (d === 0 ? nf0 : d === 1 ? nf1 : nf2).format(+v));
export const pct = (v, d = 1) => (d = typeof d === 'number' ? d : 1, v === null || v === undefined || !Number.isFinite(+v) ? '–' : num(v, d) + '%');
export function rp(v, full = false) {
  if (v === null || v === undefined) return '–';
  v = +v;
  if (full) return 'Rp' + nf0.format(v);
  const a = Math.abs(v);
  if (a >= 1e9) return 'Rp' + nf2.format(v / 1e9) + ' M';
  if (a >= 1e6) return 'Rp' + nf1.format(v / 1e6) + ' jt';
  if (a >= 1e3) return 'Rp' + nf0.format(v / 1e3) + ' rb';
  return 'Rp' + nf0.format(v);
}
export const ratio = (a, b) => (b ? (a / b) * 100 : null);
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const BULAN_L = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
export function tglPanjang(iso) { if (!iso) return '–'; const [y, m, d] = iso.slice(0, 10).split('-'); return `${+d} ${BULAN_L[+m - 1]} ${y}`; }
export function tglPendek(iso) { if (!iso) return '–'; const [y, m, d] = iso.slice(0, 10).split('-'); return `${+d} ${BULAN[+m - 1]} ${y}`; }
export function rentang(a, b) {
  if (!a) return '–';
  const [ya, ma, da] = a.split('-'), [yb, mb, db] = b.split('-');
  if (a === b) return tglPanjang(a);
  if (ya === yb && ma === mb) return `${+da}–${+db} ${BULAN_L[+ma - 1]} ${ya}`;
  if (ya === yb) return `${+da} ${BULAN[+ma - 1]} – ${+db} ${BULAN[+mb - 1]} ${ya}`;
  return `${tglPendek(a)} – ${tglPendek(b)}`;
}
export const blthLabel = (b) => (b ? `${BULAN[(b % 100) - 1]} ${Math.floor(b / 100)}` : '–');
export const jam = (iso) => (iso ? iso.slice(11, 16) : '');
export const title = (s) => String(s ?? '').toLowerCase().replace(/(^|[\s(/.-])([a-z])/g, (m, a, b) => a + b.toUpperCase());

export function icon(d, size = 18, color = 'currentColor') {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"></path></svg>`;
}
export const IC = {
  sum: 'M3 12h4l3-8 4 16 3-8h4', bars: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  team: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14', risk: 'M12 3 2 21h20L12 3zM12 10v5M12 18h.01',
  pay: 'M2 7h20v12H2zM2 11h20M6 15h4', up: 'M3 17l6-6 4 4 8-8M15 7h6v6', list: 'M4 6h16M4 12h16M4 18h10',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16', bolt: 'M13 2 4 14h7l-1 8 9-12h-7l1-8z', dl: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  ext: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3', x: 'M18 6 6 18M6 6l12 12',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3', pin: 'M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5',
  check: 'M20 6 9 17l-5-5', alert: 'M12 8v5M12 16h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', menu: 'M4 6h16M4 12h16M4 18h16',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', print: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
};

export function kpi(label, value, foot = '', accent = null, delta = '') {
  return `<div class="kpi">${accent ? `<div class="bar" style="background:${accent}"></div>` : ''}<div class="lab">${label}</div>
  <div class="val" title="${esc(value)}">${value}</div><div class="foot">${foot}${delta}</div></div>`;
}
// delta % antara cur dan prev; good = arah naik baik
export function delta(cur, prev, good = 'up', unit = '%') {
  if (prev === null || prev === undefined) return '';
  if (!prev) return cur ? ' <span class="delta eq">baru</span>' : '';
  const d = unit === 'pp' ? cur - prev : ((cur - prev) / Math.abs(prev)) * 100;
  if (Math.abs(d) < 0.05) return ' <span class="delta eq">±0</span>';
  const isGood = (d > 0) === (good === 'up');
  return ` <span class="delta ${isGood ? 'up' : 'dn'}" title="dibanding periode pembanding">${d > 0 ? '▲' : '▼'} ${num(Math.abs(d), 1)}${unit === 'pp' ? ' poin' : '%'}</span>`;
}
export function card(titleTxt, sub, inner, attrs = '') {
  return `<section class="card" ${attrs}><div><h2>${titleTxt}</h2>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${inner}</section>`;
}
export function grid(inner, min = 210) { return `<div class="grid" style="--min:${min}px">${inner}</div>`; }
export function legend(items) { return `<div class="legend">${items.map(([t, c]) => `<span><i class="dot" style="background:${c}"></i>${esc(t)}</span>`).join('')}</div>`; }
export function empty(msg) { return `<div class="empty">${msg}</div>`; }

// rows: {l, v, c?, tip?, x? (teks tambahan)}
export function hbars(rows, { fmt = num, lw = 110, vw = 96, max = null, color = C.s1 } = {}) {
  if (!rows.length) return empty('Tidak ada data pada periode ini');
  const mx = (max ?? Math.max(...rows.map((r) => r.v || 0), 0)) || 1;
  return `<div class="hbars" style="--lw:${lw}px;--vw:${vw}px">${rows.map((r) => {
    const w = Math.max(((r.v || 0) / mx) * 100, r.v ? 0.8 : 0);
    return `<div class="hb" data-tip="${esc(r.tip ?? `${r.l}: ${fmt(r.v)}`)}"><div class="l">${r.lh ?? esc(r.l)}</div><div class="t"><i style="width:${w.toFixed(2)}%;background:${r.c || color}"></i></div><div class="v">${fmt(r.v)}${r.x ? ` <small>${r.x}</small>` : ''}</div></div>`;
  }).join('')}</div>`;
}
// vals: [{l, v, tip?, c?}]
export function vbars(vals, { h = 140, color = C.s1, fmt = num, every = 1 } = {}) {
  if (!vals.length) return empty('Tidak ada data pada periode ini');
  const mx = Math.max(...vals.map((x) => x.v || 0)) || 1;
  const step = Math.max(1, every === 'auto' ? Math.ceil(vals.length / 16) : every);
  return `<div class="vbars"><div class="max">${fmt(mx)}</div><div class="gl" style="top:18px"></div><div class="gl" style="top:${18 + h / 2}px"></div><div class="base" style="top:${18 + h}px"></div>
  <div class="cols">${vals.map((x, i) => `<div class="col" data-tip="${esc(x.tip ?? `${x.l}: ${fmt(x.v)}`)}" style="height:${h + 18}px"><i style="height:${Math.max(((x.v || 0) / mx) * h, x.v ? 1.5 : 0).toFixed(1)}px;background:${x.c || color}"></i><span>${i % step === 0 ? esc(x.l) : ''}</span></div>`).join('')}</div></div>`;
}
export function stack(parts, h = 28) {
  const tot = parts.reduce((a, p) => a + (p.v || 0), 0);
  if (!tot) return empty('Tidak ada data');
  return `<div class="stack">${parts.filter((p) => p.v > 0).map((p) => `<i data-tip="${esc(p.tip ?? `${p.l}: ${num(p.v)}`)}" style="flex:${(p.v / tot).toFixed(5)} 1 0;height:${h}px;background:${p.c}"></i>`).join('')}</div>`;
}
// cols: [{h, k, r?(kanan), f?(fmt), sort?}]
export function table(cols, rows, { onRow = false, maxh = null, sortKey = null, sortDir = -1, id = '' } = {}) {
  if (!rows.length) return empty('Tidak ada data');
  const th = cols.map((c) => `<th scope="col" class="${c.r ? 'r ' : ''}${c.sort !== false && id ? 'sort' : ''}" data-k="${c.k}">${c.h}${sortKey === c.k ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
  const tr = rows.map((r, i) => `<tr${onRow ? ` class="click" data-i="${i}"` : ''}>${cols.map((c) => `<td class="${c.r ? 'r' : ''}${c.wrap ? ' wrap' : ''}${c.wrapS ? ' wraps' : ''}">${c.f ? c.f(r[c.k], r) : esc(r[c.k])}</td>`).join('')}</tr>`).join('');
  return `<div class="tbox" ${maxh ? `style="--maxh:${maxh}px"` : ''}><table class="tbl" ${id ? `data-tbl="${id}"` : ''}><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}
export function golChip(g) { return `<span class="chip"><i class="dot" style="background:${GOLC[g] || '#9AA3B2'}"></i>${esc(g)}</span>`; }

// Garis indeks sederhana (SVG) untuk Recovery
export function lineChart(series, { xs, h = 220, yfmt = (v) => num(v), xfmt = (x) => x, mark = null } = {}) {
  const all = series.flatMap((s) => s.pts.map((p) => p[1])).filter((v) => v !== null && Number.isFinite(v));
  if (!all.length) return empty('Belum cukup data pemakaian untuk menggambar grafik');
  let lo = Math.min(...all, 100), hi = Math.max(...all, 100);
  const pad = (hi - lo) * 0.12 || 10; lo -= pad; hi += pad;
  const W = 640, L = 44, R = 12, T = 12, B = 28, iw = W - L - R, ih = h - T - B;
  const xi = (x) => L + ((x - xs[0]) / (xs[xs.length - 1] - xs[0] || 1)) * iw;
  const yi = (v) => T + (1 - (v - lo) / (hi - lo)) * ih;
  const ticks = [lo + pad, (lo + hi) / 2, hi - pad];
  let g = ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${yi(t)}" y2="${yi(t)}" stroke="#E4E7EC" stroke-dasharray="3 3"/><text x="${L - 6}" y="${yi(t) + 4}" font-size="10.5" text-anchor="end" fill="#5F6879">${yfmt(t)}</text>`).join('');
  g += xs.map((x) => `<text x="${xi(x)}" y="${h - 8}" font-size="10.5" text-anchor="middle" fill="#5F6879">${xfmt(x)}</text>`).join('');
  if (mark !== null) g += `<line x1="${xi(mark)}" x2="${xi(mark)}" y1="${T}" y2="${T + ih}" stroke="#eb6834" stroke-width="1.5" stroke-dasharray="4 3"/>`;
  g += `<line x1="${L}" x2="${W - R}" y1="${yi(100)}" y2="${yi(100)}" stroke="#9AA3B2"/>`;
  for (const s of series) {
    const pts = s.pts.filter((p) => p[1] !== null && Number.isFinite(p[1]));
    if (!pts.length) continue;
    g += `<polyline fill="none" stroke="${s.c}" stroke-width="2" points="${pts.map((p) => `${xi(p[0])},${yi(p[1])}`).join(' ')}"/>`;
    g += pts.map((p) => `<circle cx="${xi(p[0])}" cy="${yi(p[1])}" r="4.5" fill="${s.c}" stroke="#fff" stroke-width="2" data-tip="${esc(`${s.name} · bulan ${xfmt(p[0])}: indeks ${num(p[1], 1)}${p[2] ? ` (n=${p[2]})` : ''}`)}"/>`).join('');
  }
  return `<svg viewBox="0 0 ${W} ${h}" width="100%" role="img" aria-label="Grafik indeks pemakaian">${g}</svg>`;
}

// Tooltip global: elemen apa pun dengan data-tip
export function initTip() {
  const tip = document.createElement('div'); tip.id = 'tip'; document.body.appendChild(tip);
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el) { tip.style.display = 'none'; return; }
    tip.textContent = el.getAttribute('data-tip'); tip.style.display = 'block';
  });
  document.addEventListener('mousemove', (e) => {
    if (tip.style.display !== 'block') return;
    const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
    const y = e.clientY + 16 + tip.offsetHeight > window.innerHeight ? e.clientY - tip.offsetHeight - 10 : e.clientY + 16;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  });
  document.addEventListener('scroll', () => { tip.style.display = 'none'; }, true);
}

// Ekspor ke Excel (SheetJS dimuat global)
export function exportXlsx(filename, sheets) {
  const wb = window.XLSX.utils.book_new();
  for (const [name, rows] of sheets) window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(rows), name.slice(0, 31));
  window.XLSX.writeFile(wb, filename);
}
