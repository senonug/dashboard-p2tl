import { esc, num, pct, rp, kpi, card, grid, table, empty, icon, IC, tglPendek, blthLabel, title } from './ui.js';
import { DATASETS } from './datasets.js';

const DB_LIMIT = 500 * 1024 * 1024;
const fmtSize = (b) => (b >= 1e9 ? num(b / 1e9, 2) + ' GB' : b >= 1e6 ? num(b / 1e6, 1) + ' MB' : num(b / 1e3) + ' KB');
const jobs = [];
const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
// Antrean penerapan: file diterapkan satu per satu; skor risiko dihitung sekali setelah antrean kosong
const antre = [];
let antreJalan = false;
let skorState = null; // null | 'hitung' | 'ok' | pesan galat

// Kalender bulan Jan–Des untuk DPM / OLAP (v1.8a)
function kalender(list, label) {
  const by = new Map(list.map((x) => [x.blth, x]));
  const now = new Date();
  const years = [...new Set([...list.map((x) => Math.floor(x.blth / 100)), now.getFullYear()])].sort((a, b) => b - a);
  const prevOf = (b) => (b % 100 === 1 ? b - 89 : b - 1);
  const rows = years.map((y) => `<tr><td class="mono" style="font-weight:700">${y}</td>${BLN.map((m, i) => {
    const b = y * 100 + i + 1, x = by.get(b);
    if (!x) return `<td class="calx" title="${m} ${y}: belum ada"><span class="cal0">–</span></td>`;
    const pv = by.get(prevOf(b));
    const ch = pv && pv.n ? (x.n - pv.n) / pv.n * 100 : null;
    const bad = x.status !== 'ok', turun = ch !== null && ch < -5;
    const tip = `${m} ${y}: ${num(x.n)} pelanggan${ch !== null ? ` (${ch >= 0 ? '+' : ''}${num(ch, 1)}% vs bulan sebelumnya` + (x.n_baru !== null && x.n_baru !== undefined ? `; ${num(x.n_baru)} baru, ${num(x.n_hilang)} tidak ada lagi` : '') + ')' : ''}${bad ? ' — UNGGAH TERPUTUS, unggah ulang' : ''}${x.file ? ` · ${x.file}` : ''}${x.oleh ? ` · ${x.oleh}` : ''}`;
    return `<td class="calx ${bad ? 'calbad' : turun ? 'calwarn' : 'calok'}" title="${esc(tip)}"><b>${num(x.n)}</b>${ch !== null ? `<small>${ch >= 0 ? '+' : ''}${num(ch, 1)}%</small>` : bad ? '<small>terputus</small>' : ''}</td>`;
  }).join('')}</tr>`).join('');
  return `<div style="font-weight:700;font-size:13px;margin:4px 0 6px">${label}</div><div class="tbox"><table class="tbl cal"><thead><tr><th></th>${BLN.map((m) => `<th>${m}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

// Target tahunan kWh TS terbayar (dipakai Ringkasan Eksekutif)
async function targetCard(ctx, isAdmin) {
  const box = ctx.el.querySelector('#tgt'); if (!box) return;
  let list;
  try { list = await ctx.rpc('f_target_list', {}, { cache: false }); }
  catch (e) { box.innerHTML = `<div class="note warn">Pengaturan target belum tersedia (${esc(e.message)}). Jalankan <b>supabase/update-v1.6.sql</b> di Supabase SQL Editor.</div>`; return; }
  if (!box.isConnected) return;
  const th = new Date().getFullYear();
  box.innerHTML = card('Target kWh TS terbayar per tahun', 'Dipakai blok capaian di Ringkasan Eksekutif. Target dibagi rata per hari (target ÷ jumlah hari dalam setahun).',
    (list.length ? table([{ h: 'Tahun', k: 'tahun' }, { h: 'Target (kWh)', k: 'kwh', r: 1, f: num }, { h: 'Per hari (kWh)', k: 'x', r: 1, f: (v, r) => num(r.kwh / (((r.tahun % 4 === 0 && r.tahun % 100 !== 0) || r.tahun % 400 === 0) ? 366 : 365)) },
      { h: 'Diubah', k: 'updated_at', f: (v, r) => `${v ? tglPendek(v) : '–'} <small style="color:var(--muted)">${esc(r.updated_by || '')}</small>` }], list) : empty('Belum ada target'))
    + (isAdmin ? `<form id="tgf" style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end">
      <div class="fld"><label for="tgy">TAHUN</label><input id="tgy" type="number" min="2020" max="2100" value="${th}" style="min-width:110px"></div>
      <div class="fld"><label for="tgk">TARGET (kWh)</label><input id="tgk" inputmode="numeric" placeholder="mis. 11.500.820" value="${list.find((x) => x.tahun === th) ? num(list.find((x) => x.tahun === th).kwh) : ''}"></div>
      <button class="btn pri" type="submit">Simpan target</button><span class="sub" id="tgm" style="margin:0"></span></form>` : '<p class="sub">Hanya admin yang dapat mengubah target.</p>'));
  const f = box.querySelector('#tgf'); if (!f) return;
  f.onsubmit = async (e) => {
    e.preventDefault();
    const y = Number(f.querySelector('#tgy').value), raw = f.querySelector('#tgk').value.replace(/[.\s]/g, '').replace(',', '.');
    const m = f.querySelector('#tgm');
    const kwh = Number(raw);
    if (!y || !raw || !Number.isFinite(kwh) || kwh <= 0) { m.textContent = 'Isi tahun dan target kWh yang valid.'; return; }
    if (!window.confirm(`Simpan target ${y}: ${num(kwh)} kWh?`)) return;
    m.textContent = 'Menyimpan…';
    try { await ctx.rpc('f_set_target', { p_tahun: y, p_kwh: kwh }, { cache: false }); await ctx.refresh(); targetCard(ctx, isAdmin); }
    catch (er) { m.textContent = er.message; }
  };
}

export async function dataPage(ctx) {
  const canUp = ['uploader', 'admin'].includes(ctx.me?.role);
  const isAdmin = ctx.me?.role === 'admin';
  const d = await ctx.rpc('f_datasets', {}, { cache: false });
  if (!ctx.alive()) return;
  const range = (a, b) => (a ? (a === b ? tglPendek(a) : `${tglPendek(a)} – ${tglPendek(b)}`) : 'Belum ada');
  const ringkasBulan = (arr) => {
    const ok = arr.filter((x) => x.status === 'ok');
    if (!ok.length) return arr.length ? '<span class="err">Unggah terputus, unggah ulang</span>' : 'Belum ada';
    const last = ok[ok.length - 1];
    const putus = arr.filter((x) => x.status !== 'ok');
    return `${blthLabel(ok[0].blth)} – ${blthLabel(last.blth)} · ${ok.length} bulan<br><span style="color:var(--muted)">Terakhir ${num(last.n)} pelanggan</span>${putus.length ? `<br><span class="err">Terputus: ${putus.map((x) => blthLabel(x.blth)).join(', ')}</span>` : ''}`;
  };
  const ds = [
    ['Data Pemeriksaan P2TL', 'Bulanan · rekap P2TL (157 kolom)', d.pemeriksaan.n ? `${num(d.pemeriksaan.n)} pemeriksaan` : '', range(d.pemeriksaan.min, d.pemeriksaan.max), !!d.pemeriksaan.n],
    ['DPM Baca Paskabayar', 'Bulanan · disimpan per tahun', '', ringkasBulan(d.paska), d.paska.some((x) => x.status === 'ok')],
    ['OLAP Prabayar', 'Bulanan · diringkas per pelanggan, disimpan per tahun', '', ringkasBulan(d.pra), d.pra.some((x) => x.status === 'ok')],
    ['Data Induk Langganan (DIL)', 'Berkala · menimpa data lama per IDPEL', d.dil.n ? `${num(d.dil.n)} pelanggan · ${num(d.dil.aktif)} aktif` : '', d.dil.snapshot || (d.dil.n ? 'Tersedia' : 'Belum ada'), !!d.dil.n],
    ['Laporan TS Terbayar', 'Bulanan · per bulan tanggal register', d.ts.n ? `${num(d.ts.n)} pelunasan` : '', range(d.ts.min, d.ts.max), !!d.ts.n],
  ];
  const used = d.db_size || 0;
  const cards = ds.map(([t, f, n, per, ok]) => `<section class="card" style="gap:10px"><div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div><h2>${t}</h2><p class="sub">${f}</p></div>
    <span class="chip ${ok ? 'good' : 'warn'}">${icon(ok ? IC.check : IC.alert, 13)}${ok ? 'Tersedia' : 'Belum ada'}</span></div>
    <div style="font-size:12.5px;line-height:1.65"><span class="lbl">Periode</span><br>${per}${n ? `<br><span style="color:var(--muted)">${n}</span>` : ''}</div></section>`).join('');
  const meter = `<div class="card" style="gap:8px"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><h2>Kapasitas database (paket gratis 500 MB)</h2><span class="mono">${fmtSize(used)} · ${pct((used / DB_LIMIT) * 100, 0)}</span></div>
    <div class="meter"><i style="width:${Math.min(100, (used / DB_LIMIT) * 100)}%;background:${used / DB_LIMIT > 0.85 ? '#d03b3b' : used / DB_LIMIT > 0.65 ? '#eda100' : '#1baf7a'}"></i></div>
    <p class="sub">Sejak v1.8a DPM dan OLAP disimpan per tahun: satu bulan DPM + OLAP menambah sekitar 10 MB (bisa sampai ±18 MB sebelum dirapikan, karena versi lama baris masih tersimpan). Bila meteran di atas ±75%, admin menjalankan <b>supabase/pemeliharaan.sql</b> di SQL Editor Supabase untuk merapikan ruang. Bila tetap penuh, hapus bulan pemakaian lama atau naikkan paket Supabase.</p>
    </div>`;
  const kal = card('Kalender data pemakaian', 'Jumlah pelanggan per bulan yang sudah diunggah. Kuning: turun lebih dari 5% dibanding bulan sebelumnya (periksa apakah file lengkap). Merah: unggah terputus, unggah ulang file bulan itu. Arahkan kursor ke kotak untuk rinciannya.',
    kalender(d.paska, 'DPM Paskabayar') + kalender(d.pra, 'OLAP Prabayar'));
  const up = canUp ? card('Unggah file baru', 'Tarik satu atau beberapa file sekaligus. Jenis data dikenali otomatis dari judul kolom. Format: .xlsx atau .csv. File dibaca di browser Anda, lalu hanya kolom yang dipakai dashboard yang dikirim dalam format CSV ringkas (sekitar setengah ukuran JSON). File aslinya tidak disimpan. NIK dan nomor HP dibuang.',
    `<label class="drop" id="drop" for="fi">${icon(IC.upload, 26, '#1c5cab')}<div style="margin-top:8px;font-weight:700">Tarik file ke sini atau klik untuk memilih</div><div class="sub" style="margin-top:4px">Pemeriksaan P2TL · DPM paskabayar · OLAP prabayar · DIL · Laporan TS terbayar</div></label>
     <input type="file" id="fi" multiple accept=".xlsx,.xlsm,.csv,.txt" class="hidden"><div id="jobs" style="display:flex;flex-direction:column;gap:12px"></div>`)
    : '<div class="note">Akun Anda berperan <b>viewer</b>: dapat melihat dashboard tetapi tidak dapat mengunggah. Hubungi admin untuk akses pengunggah.</div>';
  const mo = d.months || {};
  const opt = {
    pemeriksaan: (mo.pemeriksaan || []).map((x) => [x.blth, x.n]),
    paska: d.paska.map((x) => [x.blth, x.n]),
    pra: d.pra.map((x) => [x.blth, x.n]),
    ts: (mo.ts || []).map((x) => [x.blth, x.n]),
    dil: d.dil.n ? [['semua', d.dil.n]] : [],
  };
  const DSL = { pemeriksaan: 'Data Pemeriksaan P2TL', paska: 'DPM Baca Paskabayar', pra: 'OLAP Prabayar', ts: 'Laporan TS Terbayar', dil: 'Data Induk Langganan (seluruhnya)' };
  const del = isAdmin ? card('Hapus data (khusus admin)', 'Hapus satu bulan data yang salah. Untuk DPM/OLAP tidak perlu menghapus sebelum unggah ulang: bulan yang sama otomatis diganti. Mengosongkan DIL juga menghapus nama & alamat lama yang tidak bermasking. Tindakan ini tercatat di riwayat dan tidak bisa dibatalkan.',
    `<form id="delf" style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end">
      <div class="fld"><label for="dds">DATASET</label><select id="dds">${Object.entries(DSL).map(([k, t]) => `<option value="${k}" ${opt[k].length ? '' : 'disabled'}>${t}${opt[k].length ? '' : ' (kosong)'}</option>`).join('')}</select></div>
      <div class="fld"><label for="ddb">PERIODE</label><select id="ddb"></select></div>
      <button class="btn" type="submit" style="border-color:#d03b3b;color:#b42318">Hapus data</button><span class="sub" id="ddm" style="margin:0"></span></form>`) : '';
  const log = card('Riwayat unggahan', 'Semua pengguna melihat riwayat yang sama.', table([{ h: 'Waktu', k: 'created_at', f: (v) => `${tglPendek(v)} <small style="color:var(--muted)">${new Date(v).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</small>` },
    { h: 'Dataset', k: 'dataset', f: (v) => esc(DATASETS[v]?.label || v) }, { h: 'File', k: 'filename', f: (v) => `<span style="font-size:12px">${esc(v)}</span>` }, { h: 'Periode', k: 'periode', f: (v) => esc(String(v || '').replace(/\d{4}-\d{2}-\d{2}/g, (x) => tglPendek(x)).replace(/\b(20\d{2})(0[1-9]|1[0-2])\b/g, (x) => blthLabel(+x))) },
    { h: 'Baris', k: 'n_rows', r: 1, f: num }, { h: 'Oleh', k: 'uploaded_by', f: (v) => esc(v) }], d.log, { maxh: 380 }));
  ctx.el.innerHTML = `<div class="grid" style="--min:250px">${cards}</div>${kal}${meter}<div id="tgt"></div>${up}${del}${log}<div id="users"></div>`;
  targetCard(ctx, isAdmin);
  const df = ctx.el.querySelector('#delf');
  if (df) {
    const dsSel = df.querySelector('#dds'), bSel = df.querySelector('#ddb');
    const fill = () => { const o = opt[dsSel.value] || []; bSel.innerHTML = o.map(([b, n]) => `<option value="${b}">${b === 'semua' ? 'Semua' : blthLabel(+b)} · ${num(n)} baris</option>`).join(''); };
    const first = Object.keys(DSL).find((k) => opt[k].length); if (first) dsSel.value = first;
    fill(); dsSel.onchange = fill;
    df.onsubmit = async (e) => {
      e.preventDefault();
      const dsv = dsSel.value, b = bSel.value;
      if (!b) return;
      const label = `${DSL[dsv]} ${b === 'semua' ? '' : 'bulan ' + blthLabel(+b)}`;
      if (!window.confirm(`Hapus ${label}?\nTindakan ini tidak bisa dibatalkan.`)) return;
      const m = df.querySelector('#ddm'); m.textContent = 'Menghapus…';
      try {
        const n = await ctx.rpc('f_hapus_data', { p_dataset: dsv, p_blth: b === 'semua' ? null : Number(b) }, { cache: false });
        m.textContent = `${num(n)} baris dihapus.`;
        if (dsv === 'paska' || dsv === 'pra' || dsv === 'dil') {
          m.textContent += ' Menghitung ulang skor risiko (±20 detik)…';
          try { await ctx.rpc('f_hitung_skor', {}, { cache: false }); m.textContent = `${num(n)} baris dihapus. Skor risiko diperbarui.`; }
          catch (er2) { m.textContent = `${num(n)} baris dihapus. Skor risiko gagal dihitung: ${er2.message}`; }
        }
        await ctx.refresh(); dataPage(ctx);
      } catch (er) { m.textContent = er.message; }
    };
  }
  if (canUp) bindUpload(ctx);

  renderJobs(ctx);
  if (isAdmin) users(ctx);
}

function bindUpload(ctx) {
  const drop = ctx.el.querySelector('#drop'), fi = ctx.el.querySelector('#fi');
  const add = (files) => { for (const f of files) startJob(ctx, f); };
  fi.onchange = () => { add([...fi.files]); fi.value = ''; };
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => add([...e.dataTransfer.files]));
}

function startJob(ctx, file) {
  const job = { id: Math.random().toString(36).slice(2), file, phase: 'antri', done: 0, total: file.size, info: null, err: null, state: 'parsing' };
  jobs.unshift(job);
  if (/\.xls$/i.test(file.name)) { job.state = 'error'; job.err = 'Format .xls lama belum didukung. Buka di Excel lalu simpan sebagai .xlsx atau .csv.'; renderJobs(ctx); return; }
  job.w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  job.w.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'progress') { job.phase = m.phase; job.done = m.done; job.total = m.total; updateJob(job); return; }
    if (m.type === 'parsed') { job.state = 'review'; job.info = m; }
    if (m.type === 'applied') { job.state = 'done'; job.sent = m.sent; job.bytes = m.bytes; job.needSkor = m.needSkor; job.hasil = m.hasil || []; job.w.terminate(); if (job.selesai) job.selesai(); }
    if (m.type === 'error') { job.state = 'error'; job.err = m.message; job.w.terminate(); if (job.selesai) job.selesai(); }
    renderJobs(ctx);
  };
  job.w.onerror = (e) => { job.state = 'error'; job.err = e.message || 'Worker gagal dimuat'; renderJobs(ctx); };
  job.w.postMessage({ cmd: 'parse', file });
  renderJobs(ctx);
}

const PH = { periksa: 'Memeriksa struktur file', baca: 'Membaca baris', kirim: 'Mengirim ke database', gabung: 'Menggabungkan ke data tahunan', antri: 'Menyiapkan' };

// Jalankan antrean penerapan satu per satu, lalu hitung skor risiko sekali
async function jalankanAntre(ctx) {
  if (antreJalan) return;
  antreJalan = true;
  let perluSkor = false;
  try {
    while (antre.length) {
      const j = antre.shift();
      if (j.state !== 'queued') continue;
      const { data } = await ctx.sb.auth.getSession(); // token baru tiap file (antrean bisa lama)
      j.state = 'sending'; j.phase = 'kirim'; j.done = 0; j.total = j.info.n; renderJobs(ctx);
      await new Promise((ok) => {
        j.selesai = ok;
        j.w.postMessage({ cmd: 'apply', cfg: { url: ctx.CONFIG.url, apikey: ctx.CONFIG.key, token: data.session.access_token, filename: j.file.name, snapshot: j.snapshot } });
      });
      if (j.state === 'done' && j.needSkor) perluSkor = true;
      renderJobs(ctx);
    }
    if (perluSkor) {
      skorState = 'hitung'; renderJobs(ctx);
      try { await ctx.rpc('f_hitung_skor', {}, { cache: false }); skorState = 'ok'; }
      catch (e) { skorState = e.message || String(e); }
    }
  } finally {
    antreJalan = false;
  }
  try { await ctx.refresh(); } catch (e) { console.warn(e); }
  if (document.getElementById('jobs')) dataPage(ctx);
}
function updateJob(job) {
  const el = document.querySelector(`[data-job="${job.id}"]`);
  if (!el) return;
  const p = job.total ? Math.min(100, (job.done / job.total) * 100) : 0;
  const bar = el.querySelector('.prog i'); if (bar) bar.style.width = p.toFixed(1) + '%';
  const t = el.querySelector('.ptxt'); if (t) t.textContent = `${PH[job.phase] || job.phase} · ${pct(p, 0)}${job.phase === 'kirim' ? ` (${num(job.done)} / ${num(job.total)} baris)` : job.phase === 'gabung' ? ` (bagian ${num(job.done)} / ${num(job.total)}) — jangan tutup halaman` : ''}`;
  const cb = el.querySelector('.cancelbox'); if (cb) cb.style.display = job.phase === 'kirim' ? '' : 'none';
}

function renderJobs(ctx) {
  const box = document.getElementById('jobs');
  if (!box) return;
  box.innerHTML = jobs.slice(0, 8).map((j) => {
    const head = `<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><div><b>${esc(j.file.name)}</b> <small style="color:var(--muted)">${fmtSize(j.file.size)}</small></div>`;
    if (j.state === 'queued') return `<div class="job" data-job="${j.id}">${head}<span class="chip">Menunggu giliran</span></div><div class="sub" style="margin:0">Diterapkan setelah file sebelumnya selesai.</div><div><button class="btn sm" type="button" data-dismiss>Batalkan</button></div></div>`;
    if (j.state === 'parsing' || j.state === 'sending') {
      return `<div class="job" data-job="${j.id}">${head}<span class="chip info"><span class="spin" style="width:12px;height:12px;border-width:2px;margin:0"></span>${j.state === 'sending' ? 'Mengirim' : 'Membaca'}</span></div><div class="prog"><i></i></div><div class="ptxt sub" style="margin:0">${PH[j.phase] || ''}</div>
        ${j.state === 'sending' ? '<div class="cancelbox"><button class="btn sm" type="button" data-cancel>Batalkan pengiriman</button></div>' : ''}</div>`;
    }
    if (j.state === 'error') return `<div class="job" data-job="${j.id}">${head}<span class="chip crit">Gagal</span></div><div class="err">${esc(j.err)}</div><div><button class="btn sm" type="button" data-dismiss>Tutup</button></div></div>`;
    if (j.state === 'done') {
      const bl = (j.hasil || []).map((x) => `${blthLabel(x.blth)}: <b>${num(x.n)}</b> pelanggan${x.n_prev ? ` (bulan sebelumnya ${num(x.n_prev)}${x.n_baru !== null && x.n_baru !== undefined ? `; ${num(x.n_baru)} baru, ${num(x.n_hilang)} tidak ada lagi` : ''})` : ''}${x.n_prev && (x.n - x.n_prev) / x.n_prev < -0.05 ? ' <span class="chip warn">turun &gt;5%, periksa kelengkapan file</span>' : ''}`).join('<br>');
      const sk = !j.needSkor ? '' : skorState === 'hitung' ? '<br><span class="spin" style="width:11px;height:11px;border-width:2px;margin:0 4px -1px 0;display:inline-block"></span>Menghitung ulang skor risiko…'
        : skorState === 'ok' ? '<br>Skor risiko sudah diperbarui.' : antreJalan ? '<br>Skor risiko dihitung setelah antrean selesai.'
        : skorState ? `<br><span class="err">Skor risiko belum terhitung (${esc(skorState)}). Buka halaman Profil Risiko lalu klik "Hitung ulang skor".</span>` : '';
      return `<div class="job" data-job="${j.id}">${head}<span class="chip good">${icon(IC.check, 13)}Tersimpan</span></div><div class="sub" style="margin:0">${num(j.sent)} baris ${esc(DATASETS[j.info.ds].label)} tersimpan${j.bytes ? ` (data terkirim ${fmtSize(j.bytes)})` : ''}.${bl ? `<br>${bl}` : ''}${sk}</div><div><button class="btn sm" type="button" data-dismiss>Tutup</button></div></div>`;
    }
    if (j.state === 'cancelled') return `<div class="job" data-job="${j.id}">${head}<span class="chip">Dibatalkan</span></div><div><button class="btn sm" type="button" data-dismiss>Tutup</button></div></div>`;
    // review
    const m = j.info, st = m.stats, def = DATASETS[m.ds];
    const statusRows = Object.entries(st.status || {}).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${esc(k)} <b class="mono">${num(v)}</b>`).join(' · ');
    const rows = [
      ['Jenis data terdeteksi', `<b>${esc(def.label)}</b>${st.sheet ? ` · sheet "${esc(st.sheet)}"` : ''}`],
      ['Periode', esc(m.ds === 'paska' || m.ds === 'pra' ? m.periode.split(', ').map((b) => blthLabel(+b)).join(', ') : m.periode.replace(/\d{4}-\d{2}-\d{2}/g, (x) => tglPendek(x)))],
      ['Baris dibaca', num(st.rowsSeen) + (st.extra?.trx ? ` transaksi → <b>${num(m.n)}</b> pelanggan setelah diringkas` : '')],
      ['Baris yang akan disimpan', `<b>${num(m.n)}</b>`],
      ['Duplikat di dalam file', st.dup ? `${num(st.dup)} (yang terakhir dipakai)` : '0'],
      ['Baris dilewati (kunci kosong)', num(st.skipped)],
      ['Kolom sensitif', st.sensitive?.length ? `<span class="chip warn">${esc(st.sensitive.join(', '))}</span> dibuang, tidak dikirim` : 'Tidak ada'],
      ['Cara simpan', def.mode === 'bulanan' ? `Bulan ${Object.keys(st.blth).map((b) => blthLabel(+b)).join(', ')} di database <b>diganti</b> seluruhnya oleh isi file ini. Bila pengiriman gagal di tengah jalan, data lama tidak berubah.`
        : def.mode === 'replace-month' ? `Data bulan yang sama di database <b>diganti</b> (${Object.keys(st.blth).map((b) => blthLabel(+b)).join(', ')})` : 'Ditambahkan; baris dengan kunci sama <b>diperbarui</b>'],
      ...(m.ds === 'pemeriksaan' ? [['Koordinat terbaca', `${num(st.extra.koord || 0)} dari ${num(m.n)} pemeriksaan (${pct(((st.extra.koord || 0) / Math.max(1, m.n)) * 100, 1)})${(st.extra.koord || 0) < m.n * 0.5 ? ' <span class="chip warn">sebagian besar tanpa koordinat — titik tidak tampil di peta</span>' : ''}`]] : []),
      ...(m.ds === 'dil' ? [['Koordinat terbaca', `${num(st.extra.koord || 0)} dari ${num(m.n)} pelanggan (${pct(((st.extra.koord || 0) / Math.max(1, m.n)) * 100, 1)})`],
        ['Nama bermasking (*)', st.extra.masking ? `${num(st.extra.masking)} pelanggan. Nama & alamat lama di database yang tidak bermasking <b>dipertahankan</b>.` : 'Tidak ada']] : []),
      ['Rincian', statusRows || '–'],
    ];
    const lost = st.csvLines && st.csvRecords < st.csvLines * 0.98 ? st.csvLines - st.csvRecords : 0;
    const warnHtml = lost ? `<div class="note warn"><b>Peringatan:</b> file CSV berisi ${num(st.csvLines)} baris teks, tetapi hanya ${num(st.csvRecords)} baris data yang terbaca. Kemungkinan ada tanda kutip (") yang tidak berpasangan di sumbernya. Sebaiknya gunakan file .xlsx untuk data ini.</div>` : '';
    const snapDef = st.extra?.rekap && /^20\d{4}$/.test(st.extra.rekap) ? `DIL ${blthLabel(+st.extra.rekap)}` : j.file.name.replace(/\.[^.]+$/, '');
    const snap = m.ds === 'dil' ? `<div class="fld"><label for="snap-${j.id}">LABEL SNAPSHOT DIL</label><input id="snap-${j.id}" value="${esc(snapDef)}"></div>` : '';
    return `<div class="job" data-job="${j.id}">${head}<span class="chip info">Periksa sebelum diterapkan</span></div>
      <div class="tbox"><table class="tbl"><tbody>${rows.map(([a, b]) => `<tr><td style="color:var(--muted);width:240px">${a}</td><td class="wrap">${b}</td></tr>`).join('')}</tbody></table></div>
      ${warnHtml}${snap}<div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn" type="button" data-dismiss>Batalkan</button><button class="btn pri" type="button" data-apply>Terapkan data</button></div></div>`;
  }).join('');
  box.querySelectorAll('[data-job]').forEach((el) => {
    const j = jobs.find((x) => x.id === el.dataset.job);
    updateJob(j);
    const ap = el.querySelector('[data-apply]');
    if (ap) ap.onclick = () => {
      const snapEl = el.querySelector(`#snap-${j.id}`);
      j.snapshot = snapEl ? snapEl.value : null;
      j.state = 'queued'; antre.push(j); skorState = null; renderJobs(ctx);
      jalankanAntre(ctx);
    };
    const ds = el.querySelector('[data-dismiss]');
    if (ds) ds.onclick = () => { try { j.w && j.w.terminate(); } catch (e) { /* abaikan */ } if (j.state === 'queued') j.state = 'cancelled'; jobs.splice(jobs.indexOf(j), 1); renderJobs(ctx); };
    const cc = el.querySelector('[data-cancel]');
    if (cc) cc.onclick = () => { j.w.postMessage({ cmd: 'cancel' }); };
  });
}

async function users(ctx) {
  const box = document.getElementById('users');
  const { data, error } = await ctx.sb.from('app_user').select('*').order('created_at');
  if (error) { box.innerHTML = `<div class="note warn">${esc(error.message)}</div>`; return; }
  box.innerHTML = card('Pengguna dashboard (khusus admin)', 'Langkah menambah pengguna: (1) undang emailnya di Supabase › Authentication › Users › Invite user, lalu (2) daftarkan email yang sama di sini beserta perannya.',
    `<form id="uf" style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end">
      <div class="fld"><label for="ue">EMAIL</label><input id="ue" type="email" required></div><div class="fld"><label for="un">NAMA</label><input id="un"></div>
      <div class="fld"><label for="ur">PERAN</label><select id="ur"><option value="viewer">viewer (lihat saja)</option><option value="uploader">uploader (lihat + unggah)</option><option value="admin">admin</option></select></div>
      <button class="btn pri" type="submit">Simpan pengguna</button><span class="err" id="uerr"></span></form>` +
    table([{ h: 'Email', k: 'email' }, { h: 'Nama', k: 'nama', f: (v) => esc(v || '-') }, { h: 'Peran', k: 'role', f: (v) => `<span class="chip ${v === 'admin' ? 'crit' : v === 'uploader' ? 'info' : ''}">${esc(v)}</span>` },
      { h: '', k: 'email', f: (v) => (v === ctx.me.email ? '<small style="color:var(--muted)">Anda</small>' : `<button class="btn sm" type="button" data-del="${esc(v)}">Hapus</button>`) }], data));
  box.querySelector('#uf').onsubmit = async (e) => {
    e.preventDefault();
    const row = { email: box.querySelector('#ue').value.trim().toLowerCase(), nama: box.querySelector('#un').value.trim() || null, role: box.querySelector('#ur').value };
    const { error: er } = await ctx.sb.from('app_user').upsert(row);
    if (er) box.querySelector('#uerr').textContent = er.message; else users(ctx);
  };
  box.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!window.confirm(`Hapus akses ${b.dataset.del}?`)) return;
    const { error: er } = await ctx.sb.from('app_user').delete().eq('email', b.dataset.del);
    if (er) window.alert(er.message); else users(ctx);
  });
}
