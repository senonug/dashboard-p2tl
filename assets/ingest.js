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
  let rekapI = -1;

  const handle = (row, i) => {
    if (!header) {
      // baris judul = baris pertama yang mengandung IDPEL / ID_P2TL / NO AGENDA
      const cells = row.map((c) => String(c ?? '').trim().toUpperCase());
      if (!cells.some((c) => c === 'IDPEL' || c === 'ID_P2TL' || c === 'NO AGENDA')) { if (i > 20) throw new Error('Baris judul kolom tidak ditemukan dalam 20 baris pertama.'); return; }
      header = row.map((c) => (c === undefined ? '' : String(c)));
      ds = detect(header);
      if (!ds) throw new Error('Jenis data tidak dikenali dari judul kolom. Pastikan file adalah salah satu dari 5 format yang didukung.');
      mapper = makeMapper(ds, header);
      rekapI = ds === 'dil' ? header.findIndex((h) => String(h).trim().toUpperCase() === 'V_BULAN_REKAP') : -1;
      if (mapper.missing.length) throw new Error(`Kolom wajib tidak ditemukan untuk ${DATASETS[ds].label}: ${mapper.missing.join(', ')}`);
      stats = newStats(ds);
      return;
    }
    rowsSeen++;
    if (rekapI >= 0 && !stats.extra.rekap && row[rekapI] !== undefined && row[rekapI] !== '') stats.extra.rekap = String(row[rekapI]).trim();
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
  const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
  // sig = null: panggilan tidak bisa dibatalkan (dipakai saat penggabungan agar bulan tidak setengah jadi)
  const rpc = async (fn, body, tries = 1, sig = signal) => {
    for (let a = 0; ; a++) {
      const r = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(body), signal: sig || undefined });
      if (r.ok) return r.json();
      const t = await r.text();
      if (a + 1 < tries && (r.status >= 500 || r.status === 429 || /timeout/i.test(t))) { await sleep(2000 * (a + 1)); continue; }
      let msg = t;
      try { msg = JSON.parse(t).message || t; } catch (e) { /* teks biasa */ }
      throw new Error(`${fn}: ${msg}`);
    }
  };
  if (def.mode === 'replace-month') {
    for (const b of Object.keys(parsed.stats.blth)) await rpc('f_clear_month', { p_dataset: parsed.ds, p_blth: Number(b) });
  }
  const rows = parsed.records;
  const bulanan = def.mode === 'bulanan';
  const job = bulanan ? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` : null;
  if (parsed.ds === 'dil' && snapshot) for (const r of rows) r.snapshot = snapshot;
  if (bulanan) for (const r of rows) r.job = job;
  const n = rows.length;
  const cols = def.cols || (n ? Object.keys(rows[0]) : []);
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
      if (attempt < 3 && (r.status >= 500 || r.status === 429)) { await sleep(1500 * (attempt + 1)); return post(batch, attempt + 1); }
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
  const hasil = [];
  try {
    await Promise.all(Array.from({ length: conc }, worker));
  } catch (e) {
    // pengiriman ke penampung gagal: data di database belum berubah sama sekali
    if (bulanan) { try { await fetch(`${url}/rest/v1/rpc/f_buang_stg`, { method: 'POST', headers: H, body: JSON.stringify({ p_job: job }) }); } catch (e2) { /* abaikan */ } }
    if (bulanan && e.name !== 'AbortError') throw new Error(`${e.message} — Data di database belum berubah. Silakan unggah ulang.`);
    throw e;
  }
  if (bulanan) {
    // gabungkan per bulan, dalam beberapa bagian agar tiap panggilan singkat
    const perBulan = parsed.stats.blth;
    const bl = Object.keys(perBulan).map(Number).sort((a, b) => a - b);
    const totalParts = bl.reduce((s0, b) => s0 + Math.max(1, Math.ceil(perBulan[b] / 20000)), 0);
    let done = 0;
    onProgress('gabung', 0, totalParts);
    for (const b of bl) {
      const parts = Math.max(1, Math.ceil(perBulan[b] / 20000));
      try {
        for (let p = 0; p < parts; p++) {
          await rpc('f_simpan_bulan', { p_dataset: parsed.ds, p_job: job, p_blth: b, p_part: p, p_parts: parts }, 3, null);
          onProgress('gabung', ++done, totalParts);
        }
        const r = await rpc('f_selesai_bulan', { p_dataset: parsed.ds, p_job: job, p_blth: b, p_file: filename }, 3, null);
        hasil.push({ blth: b, ...r });
      } catch (e) {
        throw new Error(`Bulan ${b} belum tersimpan lengkap (${e.message}). ${hasil.length ? `Bulan ${hasil.map((x) => x.blth).join(', ')} sudah tersimpan. ` : ''}Unggah ulang file ini untuk melengkapinya.`);
      }
    }
  }
  try { await rpc('f_after_upload', { p_dataset: parsed.ds }); } catch (e) { /* tidak fatal */ }
  const log = { dataset: parsed.ds, filename, periode: parsed.periode, n_rows: n,
    info: { rowsSeen: parsed.stats.rowsSeen, dup: parsed.stats.dup, skipped: parsed.stats.skipped, sheet: parsed.stats.sheet,
            sensitive_dropped: parsed.stats.sensitive, trx: parsed.stats.extra.trx || null, status: parsed.stats.status, kirim_kb: Math.round(bytes / 1024),
            ...(hasil.length ? { bulan: hasil } : {}) } };
  const lr = await fetch(`${url}/rest/v1/upload_log`, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(log) });
  if (!lr.ok) throw new Error('Gagal mencatat riwayat unggah: ' + (await lr.text()));
  // skor risiko dihitung sekali oleh halaman setelah antrean unggah selesai
  return { sent: n, bytes, needSkor: ['dil', 'paska', 'pra'].includes(parsed.ds), hasil };
}

export { DATASETS, REQUIRED };
