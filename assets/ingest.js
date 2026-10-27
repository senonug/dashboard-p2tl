// Inti pengolahan file unggahan: baca → deteksi → petakan → ringkas → validasi → kirim batch.
// Dipakai oleh web worker (browser) dan skrip uji (Node).
import { inspectXlsx, streamSheet, streamCsv } from './xlsxstream.js';
import { DATASETS, detect, makeMapper, newStats, track, REQUIRED } from './datasets.js';

let rowSeq = 0;
function keyOf(ds, r) {
  if (ds === 'paska' || ds === 'pra') return r.idpel + '|' + r.blth;
  if (ds === 'ts') return 'r' + (rowSeq++); // setiap baris pembayaran disimpan
  return r[DATASETS[ds].key];
}

// src: { name, size, stream: () => ReadableStream }
export async function parseFile(src, onProgress = () => {}) {
  const lower = src.name.toLowerCase();
  const isCsv = /\.(csv|txt)$/.test(lower);
  let header = null, ds = null, mapper = null, sheetName = null;
  const recs = new Map();
  let stats = null;
  let rowsSeen = 0;
  let csvInfo = null;

  const handle = (row, i) => {
    if (!header) {
      // baris judul = baris pertama yang mengandung IDPEL / ID_P2TL / NO AGENDA
      const cells = row.map((c) => String(c ?? '').trim().toUpperCase());
      if (!cells.some((c) => c === 'IDPEL' || c === 'ID_P2TL' || c === 'NO AGENDA')) { if (i > 20) throw new Error('Baris judul kolom tidak ditemukan dalam 20 baris pertama.'); return; }
      header = row.map((c) => (c === undefined ? '' : String(c)));
      ds = detect(header);
      if (!ds) throw new Error('Jenis data tidak dikenali dari judul kolom. Pastikan file adalah salah satu dari 5 format yang didukung.');
      mapper = makeMapper(ds, header);
      if (mapper.missing.length) throw new Error(`Kolom wajib tidak ditemukan untuk ${DATASETS[ds].label}: ${mapper.missing.join(', ')}`);
      stats = newStats(ds);
      return;
    }
    rowsSeen++;
    const r = mapper.map(row);
    if (!r) { stats.skipped++; return; }
    const k = keyOf(ds, r);
    if (mapper.aggregate) {
      const cur = recs.get(k);
      if (cur) { cur.kwh += r.kwh; cur.rp += r.rp; cur.n_beli++; if (!cur.daya && r.daya) cur.daya = r.daya; }
      else { r.n_beli = 1; recs.set(k, r); }
      stats.extra.trx = (stats.extra.trx || 0) + 1;
    } else {
      if (recs.has(k)) stats.dup++;
      recs.set(k, r);
    }
  };

  if (isCsv) {
    csvInfo = await streamCsv(src.stream, src.size, handle, (d, t) => onProgress('baca', d, t));
  } else {
    onProgress('periksa', 0, src.size);
    const info = await inspectXlsx(src.stream, src.size, (d, t) => onProgress('periksa', d, t));
    // pilih sheet: yang dikenali dan barisnya terbanyak
    let best = null;
    for (const sh of info.sheets) {
      for (let ri = 0; ri < sh.firstRows.length; ri++) {
        const hd = (sh.firstRows[ri] || []).map((c) => (c === undefined ? '' : String(c)));
        const d = detect(hd);
        if (d && (!best || (sh.approxRows || 0) > (best.approxRows || 0) || (d === best.ds && false))) {
          const mp = makeMapper(d, hd);
          if (!mp.missing.length && (!best || (sh.approxRows || 0) > (best.approxRows || 0))) best = { ...sh, ds: d };
        }
      }
    }
    if (!best) {
      const names = info.sheets.map((s) => s.name).join(', ');
      throw new Error(`Tidak ada sheet yang dikenali (${names}). Periksa judul kolom pada baris pertama.`);
    }
    sheetName = best.name;
    await streamSheet(src.stream, src.size, info, best.path, handle, (d, t) => onProgress('baca', d, t));
  }
  if (!ds) throw new Error('File kosong atau baris judul tidak ditemukan.');
  for (const r of recs.values()) track(stats, r);
  stats.rowsSeen = rowsSeen;
  stats.sheet = sheetName;
  stats.sensitive = mapper.sensitive;
  stats.unique = recs.size;
  if (csvInfo) { stats.csvLines = csvInfo.lines; stats.csvRecords = csvInfo.records; }
  const periode = describePeriod(ds, stats);
  return { ds, header, records: Array.from(recs.values()), stats, periode };
}

export function describePeriod(ds, st) {
  const bl = Object.keys(st.blth).map(Number).sort();
  if (ds === 'ts') return st.minDate ? `${st.minDate} s/d ${st.maxDate}` : '-';
  if (ds === 'paska' || ds === 'pra') return bl.length ? bl.join(', ') : '-';
  if (ds === 'dil') return 'Snapshot';
  return st.minDate ? (st.minDate === st.maxDate ? st.minDate : `${st.minDate} s/d ${st.maxDate}`) : '-';
}

// Ubah baris ke CSV (lebih ringkas dari JSON karena nama kolom tidak diulang di setiap baris)
export function toCsv(rows, cols) {
  const cell = (v) => {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    const t = String(v);
    return /[",\r\n]|^\s|\s$|^NULL$/.test(t) || t === '' ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  let out = cols.join(',') + '\n';
  for (const r of rows) out += cols.map((c) => cell(r[c])).join(',') + '\n';
  return out;
}

// Kirim ke Supabase/PostgREST memakai fetch (tanpa supabase-js agar bisa di worker)
export async function applyRecords(parsed, cfg, onProgress = () => {}, signal) {
  const { url, apikey, token, filename, snapshot } = cfg;
  const def = DATASETS[parsed.ds];
  const H = { apikey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const rpc = async (fn, body) => {
    const r = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(body), signal });
    if (!r.ok) throw new Error(`${fn}: ${r.status} ${await r.text()}`);
    return r.json();
  };
  if (def.mode === 'replace-month') {
    for (const b of Object.keys(parsed.stats.blth)) await rpc('f_clear_month', { p_dataset: parsed.ds, p_blth: Number(b) });
  }
  const rows = parsed.records;
  if (parsed.ds === 'dil' && snapshot) for (const r of rows) r.snapshot = snapshot;
  const n = rows.length;
  const cols = n ? Object.keys(rows[0]) : [];
  let sent = 0, bytes = 0;
  const conc = 3;
  let next = 0;
  const post = async (batch, attempt = 0) => {
    const body = toCsv(batch, cols);
    bytes += body.length;
    const r = await fetch(`${url}/rest/v1/${def.table}${def.key ? `?on_conflict=${def.key}` : ''}`, {
      method: 'POST', headers: { ...H, 'Content-Type': 'text/csv', Prefer: def.key ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal' }, body, signal });
    if (!r.ok) {
      const t = await r.text();
      if (attempt < 3 && (r.status >= 500 || r.status === 429)) { await new Promise((ok) => setTimeout(ok, 1500 * (attempt + 1))); return post(batch, attempt + 1); }
      throw new Error(`Gagal mengirim data (${r.status}): ${t.slice(0, 300)}`);
    }
  };
  const worker = async () => {
    for (;;) {
      const i = next; next += def.batch;
      if (i >= n) return;
      await post(rows.slice(i, i + def.batch));
      sent += Math.min(def.batch, n - i);
      onProgress('kirim', sent, n);
    }
  };
  await Promise.all(Array.from({ length: conc }, worker));
  try { await rpc('f_after_upload', { p_dataset: parsed.ds }); } catch (e) { /* tidak fatal */ }
  const log = { dataset: parsed.ds, filename, periode: parsed.periode, n_rows: n,
    info: { rowsSeen: parsed.stats.rowsSeen, dup: parsed.stats.dup, skipped: parsed.stats.skipped, sheet: parsed.stats.sheet,
            sensitive_dropped: parsed.stats.sensitive, trx: parsed.stats.extra.trx || null, status: parsed.stats.status, kirim_kb: Math.round(bytes / 1024) } };
  const lr = await fetch(`${url}/rest/v1/upload_log`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(log), signal });
  if (!lr.ok) throw new Error('Gagal mencatat riwayat unggah: ' + (await lr.text()));
  return { sent: n, bytes };
}

export { DATASETS, REQUIRED };
