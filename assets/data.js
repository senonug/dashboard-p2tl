import { esc, num, pct, rp, kpi, card, grid, table, empty, icon, IC, tglPendek, blthLabel, title } from './ui.js';
import { DATASETS } from './datasets.js';

const DB_LIMIT = 500 * 1024 * 1024;
const fmtSize = (b) => (b >= 1e9 ? num(b / 1e9, 2) + ' GB' : b >= 1e6 ? num(b / 1e6, 1) + ' MB' : num(b / 1e3) + ' KB');
const jobs = [];

export async function dataPage(ctx) {
  const canUp = ['uploader', 'admin'].includes(ctx.me?.role);
  const isAdmin = ctx.me?.role === 'admin';
  const d = await ctx.rpc('f_datasets', {}, { cache: false });
  if (!ctx.alive()) return;
  const range = (a, b) => (a ? (a === b ? tglPendek(a) : `${tglPendek(a)} – ${tglPendek(b)}`) : 'Belum ada');
  const months = (arr) => (arr.length ? arr.map((x) => `${blthLabel(x.blth)} <small style="color:var(--muted)">(${num(x.n)})</small>`).join(', ') : 'Belum ada');
  const ds = [
    ['Data Pemeriksaan P2TL', 'Bulanan · rekap P2TL (157 kolom)', d.pemeriksaan.n ? `${num(d.pemeriksaan.n)} pemeriksaan` : '', range(d.pemeriksaan.min, d.pemeriksaan.max), !!d.pemeriksaan.n],
    ['DPM Baca Paskabayar', 'Bulanan · per BLTH', '', months(d.paska), d.paska.length > 0],
    ['OLAP Prabayar', 'Bulanan · diringkas per pelanggan', '', months(d.pra), d.pra.length > 0],
    ['Data Induk Langganan (DIL)', 'Berkala · menimpa data lama per IDPEL', d.dil.n ? `${num(d.dil.n)} pelanggan · ${num(d.dil.aktif)} aktif` : '', d.dil.snapshot || (d.dil.n ? 'Tersedia' : 'Belum ada'), !!d.dil.n],
    ['Laporan TS Terbayar', 'Bulanan · per bulan tanggal register', d.ts.n ? `${num(d.ts.n)} pelunasan` : '', range(d.ts.min, d.ts.max), !!d.ts.n],
  ];
  const used = d.db_size || 0;
  const cards = ds.map(([t, f, n, per, ok]) => `<section class="card" style="gap:10px"><div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div><h2>${t}</h2><p class="sub">${f}</p></div>
    <span class="chip ${ok ? 'good' : 'warn'}">${icon(ok ? IC.check : IC.alert, 13)}${ok ? 'Tersedia' : 'Belum ada'}</span></div>
    <div style="font-size:12.5px;line-height:1.65"><span class="lbl">Periode</span><br>${per}${n ? `<br><span style="color:var(--muted)">${n}</span>` : ''}</div></section>`).join('');
  const meter = `<div class="card" style="gap:8px"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><h2>Kapasitas database (paket gratis 500 MB)</h2><span class="mono">${fmtSize(used)} · ${pct((used / DB_LIMIT) * 100, 0)}</span></div>
    <div class="meter"><i style="width:${Math.min(100, (used / DB_LIMIT) * 100)}%;background:${used / DB_LIMIT > 0.85 ? '#d03b3b' : used / DB_LIMIT > 0.65 ? '#eda100' : '#1baf7a'}"></i></div>
    <p class="sub">Setiap bulan data pemakaian (DPM + OLAP) dan pemeriksaan menambah sekitar 35–40 MB. Bila mendekati penuh, hapus bulan pemakaian lama lewat menu Hapus data (admin) atau naikkan paket Supabase.</p>
    </div>`;
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
  const del = isAdmin ? card('Hapus data (khusus admin)', 'Hapus satu bulan data yang salah sebelum mengunggah ulang, atau kosongkan DIL sebelum mengganti snapshot. Tindakan ini tercatat di riwayat dan tidak bisa dibatalkan.',
    `<form id="delf" style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end">
      <div class="fld"><label for="dds">DATASET</label><select id="dds">${Object.entries(DSL).map(([k, t]) => `<option value="${k}" ${opt[k].length ? '' : 'disabled'}>${t}${opt[k].length ? '' : ' (kosong)'}</option>`).join('')}</select></div>
      <div class="fld"><label for="ddb">PERIODE</label><select id="ddb"></select></div>
      <button class="btn" type="submit" style="border-color:#d03b3b;color:#b42318">Hapus data</button><span class="sub" id="ddm" style="margin:0"></span></form>`) : '';
  const log = card('Riwayat unggahan', 'Semua pengguna melihat riwayat yang sama.', table([{ h: 'Waktu', k: 'created_at', f: (v) => `${tglPendek(v)} <small style="color:var(--muted)">${new Date(v).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</small>` },
    { h: 'Dataset', k: 'dataset', f: (v) => esc(DATASETS[v]?.label || v) }, { h: 'File', k: 'filename', f: (v) => `<span style="font-size:12px">${esc(v)}</span>` }, { h: 'Periode', k: 'periode', f: (v) => esc(String(v || '').replace(/\d{4}-\d{2}-\d{2}/g, (x) => tglPendek(x)).replace(/\b(20\d{2})(0[1-9]|1[0-2])\b/g, (x) => blthLabel(+x))) },
    { h: 'Baris', k: 'n_rows', r: 1, f: num }, { h: 'Oleh', k: 'uploaded_by', f: (v) => esc(v) }], d.log, { maxh: 380 }));
  ctx.el.innerHTML = `<div class="grid" style="--min:250px">${cards}</div>${meter}${up}${del}${log}<div id="users"></div>`;
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
    if (m.type === 'applied') { job.state = 'done'; job.sent = m.sent; job.bytes = m.bytes; job.w.terminate(); ctx.refresh().then(() => { if (document.getElementById('jobs')) return dataPage(ctx); }).catch((er) => console.warn(er)); }
    if (m.type === 'error') { job.state = 'error'; job.err = m.message; job.w.terminate(); }
    renderJobs(ctx);
  };
  job.w.onerror = (e) => { job.state = 'error'; job.err = e.message || 'Worker gagal dimuat'; renderJobs(ctx); };
  job.w.postMessage({ cmd: 'parse', file });
  renderJobs(ctx);
}

const PH = { periksa: 'Memeriksa struktur file', baca: 'Membaca baris', kirim: 'Mengirim ke database', antri: 'Menyiapkan' };
function updateJob(job) {
  const el = document.querySelector(`[data-job="${job.id}"]`);
  if (!el) return;
  const p = job.total ? Math.min(100, (job.done / job.total) * 100) : 0;
  const bar = el.querySelector('.prog i'); if (bar) bar.style.width = p.toFixed(1) + '%';
  const t = el.querySelector('.ptxt'); if (t) t.textContent = `${PH[job.phase] || job.phase} · ${pct(p, 0)}${job.phase === 'kirim' ? ` (${num(job.done)} / ${num(job.total)} baris)` : ''}`;
}

function renderJobs(ctx) {
  const box = document.getElementById('jobs');
  if (!box) return;
  box.innerHTML = jobs.slice(0, 8).map((j) => {
    const head = `<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><div><b>${esc(j.file.name)}</b> <small style="color:var(--muted)">${fmtSize(j.file.size)}</small></div>`;
    if (j.state === 'parsing' || j.state === 'sending') {
      return `<div class="job" data-job="${j.id}">${head}<span class="chip info"><span class="spin" style="width:12px;height:12px;border-width:2px;margin:0"></span>${j.state === 'sending' ? 'Mengirim' : 'Membaca'}</span></div><div class="prog"><i></i></div><div class="ptxt sub" style="margin:0">${PH[j.phase] || ''}</div>
        ${j.state === 'sending' ? '<div><button class="btn sm" type="button" data-cancel>Batalkan pengiriman</button></div>' : ''}</div>`;
    }
    if (j.state === 'error') return `<div class="job" data-job="${j.id}">${head}<span class="chip crit">Gagal</span></div><div class="err">${esc(j.err)}</div><div><button class="btn sm" type="button" data-dismiss>Tutup</button></div></div>`;
    if (j.state === 'done') return `<div class="job" data-job="${j.id}">${head}<span class="chip good">${icon(IC.check, 13)}Tersimpan</span></div><div class="sub" style="margin:0">${num(j.sent)} baris ${esc(DATASETS[j.info.ds].label)} tersimpan${j.bytes ? ` (data terkirim ${fmtSize(j.bytes)})` : ''}. Semua halaman dashboard sudah memakai data terbaru.</div><div><button class="btn sm" type="button" data-dismiss>Tutup</button></div></div>`;
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
      ['Cara simpan', def.mode === 'replace-month' ? `Data bulan yang sama di database <b>diganti</b> (${Object.keys(st.blth).map((b) => blthLabel(+b)).join(', ')})` : 'Ditambahkan; baris dengan kunci sama <b>diperbarui</b>'],
      ['Rincian', statusRows || '–'],
    ];
    const lost = st.csvLines && st.csvRecords < st.csvLines * 0.98 ? st.csvLines - st.csvRecords : 0;
    const warnHtml = lost ? `<div class="note warn"><b>Peringatan:</b> file CSV berisi ${num(st.csvLines)} baris teks, tetapi hanya ${num(st.csvRecords)} baris data yang terbaca. Kemungkinan ada tanda kutip (") yang tidak berpasangan di sumbernya. Sebaiknya gunakan file .xlsx untuk data ini.</div>` : '';
    const snap = m.ds === 'dil' ? `<div class="fld"><label for="snap-${j.id}">LABEL SNAPSHOT DIL</label><input id="snap-${j.id}" value="${esc(j.file.name.replace(/\.[^.]+$/, ''))}"></div>` : '';
    return `<div class="job" data-job="${j.id}">${head}<span class="chip info">Periksa sebelum diterapkan</span></div>
      <div class="tbox"><table class="tbl"><tbody>${rows.map(([a, b]) => `<tr><td style="color:var(--muted);width:240px">${a}</td><td class="wrap">${b}</td></tr>`).join('')}</tbody></table></div>
      ${warnHtml}${snap}<div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn" type="button" data-dismiss>Batalkan</button><button class="btn pri" type="button" data-apply>Terapkan data</button></div></div>`;
  }).join('');
  box.querySelectorAll('[data-job]').forEach((el) => {
    const j = jobs.find((x) => x.id === el.dataset.job);
    updateJob(j);
    const ap = el.querySelector('[data-apply]');
    if (ap) ap.onclick = async () => {
      const { data } = await ctx.sb.auth.getSession();
      const snapEl = el.querySelector(`#snap-${j.id}`);
      j.state = 'sending'; j.phase = 'kirim'; j.done = 0; j.total = j.info.n; renderJobs(ctx);
      j.w.postMessage({ cmd: 'apply', cfg: { url: ctx.CONFIG.url, apikey: ctx.CONFIG.key, token: data.session.access_token, filename: j.file.name, snapshot: snapEl ? snapEl.value : null } });
    };
    const ds = el.querySelector('[data-dismiss]');
    if (ds) ds.onclick = () => { try { j.w && j.w.terminate(); } catch (e) { /* abaikan */ } jobs.splice(jobs.indexOf(j), 1); renderJobs(ctx); };
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
