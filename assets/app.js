import { CONFIG } from './config.js';
import { esc, icon, IC, rentang, initTip, tglPendek } from './ui.js';
import { PAGES } from './pages.js';
import { dataPage } from './data.js';

const sb = window.supabase.createClient(CONFIG.url, CONFIG.key, { auth: { persistSession: true, autoRefreshToken: true } });
const root = document.getElementById('root');

const NAV = [
  ['ringkasan', 'Ringkasan Eksekutif', IC.sum, 'Gambaran cepat untuk SPV hingga Manager: volume, hasil, dan nilai pemeriksaan pada periode terpilih.'],
  ['temuan', 'Analisis Temuan', IC.bars, 'Jenis pelanggaran, nilai TS, dan profil pelanggan yang paling sering terkena temuan.'],
  ['kinerja', 'Kinerja Regu & Petugas', IC.team, 'Produktivitas (volume) dan efektivitas (hit rate, nilai TS) tiap regu dan petugas.'],
  ['cakupan', 'Peta Kerja', IC.map, 'Satu peta untuk menyusun sasaran lapangan: area yang belum disisir, titik temuan, calon TO berisiko, dan pelanggan di sekitar satu lokasi.'],
  ['risiko', 'Profil Risiko & Calon TO', IC.risk, 'Gabungan pemakaian (DPM, OLAP prabayar), DIL, dan hasil pemeriksaan untuk menyusun Target Operasi.'],
  ['pembayaran', 'Realisasi Pembayaran TS', IC.pay, 'Seberapa banyak nilai temuan yang benar-benar tertagih: tunai, angsuran, dan sisa piutang.'],
  ['recovery', 'Recovery Pemakaian', IC.up, 'Apakah pemakaian pelanggan naik setelah ditertibkan? Ukuran dampak jangka panjang P2TL.'],
  ['detail', 'Detail Temuan', IC.list, 'Tabel lengkap temuan yang bisa dicari dan difilter untuk tindak lanjut.'],
  ['data', 'Kelola & Unggah Data', IC.upload, 'Unggah pembaruan data dari mana saja. File divalidasi di browser lalu disimpan ke database bersama.'],
];

// ---------- state ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('p2tl_' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('p2tl_' + k, JSON.stringify(v)); } catch (e) { /* abaikan */ } },
};
const S = { session: null, me: null, meta: null, f: store.get('filters', null), cache: new Map() };

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
function presetRange(p, anchor) {
  const a = parse(anchor);
  if (p === 'hari') return [anchor, anchor];
  if (p === '7') return [addDays(anchor, -6), anchor];
  if (p === 'bulan') return [iso(new Date(a.getFullYear(), a.getMonth(), 1)), iso(new Date(a.getFullYear(), a.getMonth() + 1, 0))];
  if (p === 'tahun') return [iso(new Date(a.getFullYear(), 0, 1)), iso(new Date(a.getFullYear(), 11, 31))];
  return null;
}
function cmpRange(f) {
  if (f.cmp === 'prev') { const n = Math.round((parse(f.to) - parse(f.from)) / 864e5) + 1; return [addDays(f.from, -n), addDays(f.from, -1)]; }
  if (f.cmp === 'yoy') { const sh = (s) => { const d = parse(s); d.setFullYear(d.getFullYear() - 1); return iso(d); }; return [sh(f.from), sh(f.to)]; }
  return null;
}
export function params(extra = {}) {
  const f = S.f;
  return { p_from: f.from, p_to: f.to, p_regu: f.regu ? Number(f.regu) : null, p_kec: f.kec || null, p_layanan: f.layanan || null, ...extra };
}

// ---------- data ----------
export async function rpc(name, args = {}, { cache = true } = {}) {
  const key = name + JSON.stringify(args);
  if (cache && S.cache.has(key)) return S.cache.get(key);
  const p = sb.rpc(name, args).then(({ data, error }) => {
    if (error) { S.cache.delete(key); throw new Error(error.message || String(error)); }
    return data;
  });
  if (cache) S.cache.set(key, p);
  return p;
}
export function clearCache() { S.cache.clear(); }
export async function refreshMeta() { S.meta = await rpc('f_meta', {}, { cache: false }); return S.meta; }

// ---------- auth ----------
function loginView(msg = '') {
  root.innerHTML = `<div class="login"><form id="lf" autocomplete="on">
    <div class="brand" style="padding:0"><div class="logo">${icon(IC.bolt, 18, '#fff')}</div><div><b style="color:var(--ink)">Dashboard P2TL</b><span style="color:var(--muted)">${esc(CONFIG.unit)}</span></div></div>
    <div><h1 style="font-size:20px">Masuk</h1><p class="ph-sub">Gunakan akun yang sudah didaftarkan admin.</p></div>
    <div class="fld"><label for="em">EMAIL</label><input id="em" type="email" required autocomplete="username"></div>
    <div class="fld"><label for="pw">KATA SANDI</label><input id="pw" type="password" required autocomplete="current-password"></div>
    <div class="err" id="lerr">${esc(msg)}</div>
    <button class="btn pri" type="submit" style="height:42px;justify-content:center">Masuk</button>
    <button class="btn" type="button" id="forgot" style="justify-content:center">Lupa kata sandi</button>
  </form></div>`;
  document.getElementById('lf').onsubmit = async (e) => {
    e.preventDefault();
    const err = document.getElementById('lerr'); err.textContent = 'Memeriksa…';
    const { error } = await sb.auth.signInWithPassword({ email: document.getElementById('em').value.trim(), password: document.getElementById('pw').value });
    if (error) err.textContent = error.message === 'Invalid login credentials' ? 'Email atau kata sandi salah.' : error.message;
  };
  document.getElementById('forgot').onclick = async () => {
    const em = document.getElementById('em').value.trim();
    const err = document.getElementById('lerr');
    if (!em) { err.textContent = 'Isi email terlebih dahulu.'; return; }
    const { error } = await sb.auth.resetPasswordForEmail(em, { redirectTo: location.origin + location.pathname });
    err.textContent = error ? error.message : 'Tautan atur ulang kata sandi telah dikirim ke email.';
  };
}

function setPasswordView() {
  root.innerHTML = `<div class="login"><form id="pf"><div><h1 style="font-size:20px">Atur kata sandi baru</h1><p class="ph-sub">Minimal 8 karakter.</p></div>
    <div class="fld"><label for="np">KATA SANDI BARU</label><input id="np" type="password" minlength="8" required autocomplete="new-password"></div>
    <div class="err" id="perr"></div><button class="btn pri" type="submit" style="height:42px;justify-content:center">Simpan</button></form></div>`;
  document.getElementById('pf').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: document.getElementById('np').value });
    if (error) document.getElementById('perr').textContent = error.message;
    else { history.replaceState(null, '', location.pathname); boot(); }
  };
}

// ---------- shell ----------
function shell() {
  const role = S.me?.role;
  root.innerHTML = `<div class="app">
  <nav class="side" aria-label="Menu dashboard">
    <div class="brand"><div class="logo">${icon(IC.bolt, 18, '#fff')}</div><div><b>Dashboard P2TL</b><span>${esc(CONFIG.unit)}</span></div>
      <button class="btn sm burger" id="burger" aria-label="Buka menu" style="margin-left:auto">${icon(IC.menu, 16)}</button></div>
    <div class="nav" id="nav">${NAV.map(([k, t, ic]) => `<a href="#/${k}" data-k="${k}">${icon(ic)}<span>${t}</span></a>`).join('')}</div>
    <div class="side-foot"><div>${icon(IC.user, 13, '#9FB0C6')} ${esc(S.me?.nama || S.session.user.email)}</div><div>Peran: ${esc(role || '-')}</div>
      <div id="lastup"></div><button type="button" id="logout">Keluar</button></div>
  </nav>
  <main class="main" id="main"></main></div>`;
  document.getElementById('logout').onclick = async () => { await sb.auth.signOut(); };
  document.getElementById('burger').onclick = () => document.getElementById('nav').classList.toggle('open');
  updateFoot();
}
function updateFoot() {
  const el = document.getElementById('lastup');
  if (el && S.meta) el.textContent = S.meta.last_upload ? 'Data terakhir diunggah ' + tglPendek(S.meta.last_upload) : 'Belum ada data';
}

function filterBar(pageKey) {
  const f = S.f, m = S.meta;
  const regu = (m.regu || []).map((r) => `<option value="${r}" ${String(f.regu) === String(r) ? 'selected' : ''}>Regu ${r}</option>`).join('');
  const kec = (m.kecamatan || []).map((k) => `<option ${f.kec === k ? 'selected' : ''}>${esc(k)}</option>`).join('');
  const pr = [['hari', 'Hari terakhir'], ['7', '7 hari'], ['bulan', 'Bulan'], ['tahun', 'Tahun']];
  return `<div class="filters" role="search">
    <div class="fld"><span class="lab">PERIODE CEPAT</span><div class="seg">${pr.map(([k, t]) => `<button type="button" data-p="${k}" class="${f.preset === k ? 'on' : ''}">${t}</button>`).join('')}</div></div>
    <div class="fld"><label for="fd">DARI TANGGAL</label><input id="fd" type="date" value="${f.from}"></div>
    <div class="fld"><label for="ft">SAMPAI TANGGAL</label><input id="ft" type="date" value="${f.to}"></div>
    ${pageKey === 'ringkasan' ? `<div class="fld"><label for="fc">BANDINGKAN DENGAN</label><select id="fc"><option value="none">— tidak ada —</option><option value="prev" ${f.cmp === 'prev' ? 'selected' : ''}>Periode sebelumnya</option><option value="yoy" ${f.cmp === 'yoy' ? 'selected' : ''}>Periode sama tahun lalu</option></select></div>` : ''}
    <div class="fld"><label for="fr">REGU</label><select id="fr"><option value="">Semua regu</option>${regu}</select></div>
    <div class="fld"><label for="fk">KECAMATAN</label><select id="fk"><option value="">Semua kecamatan</option>${kec}</select></div>
    <div class="fld"><label for="fl">JENIS LAYANAN</label><select id="fl"><option value="">Prabayar + Paskabayar</option><option ${f.layanan === 'PRABAYAR' ? 'selected' : ''} value="PRABAYAR">Prabayar</option><option ${f.layanan === 'PASKABAYAR' ? 'selected' : ''} value="PASKABAYAR">Paskabayar</option></select></div>
    <div class="spacer"></div>
    <button class="btn" type="button" id="fprint" title="Cetak / simpan PDF">${icon(IC.print, 16)}Cetak</button>
  </div>`;
}
function bindFilters() {
  const set = (patch) => { Object.assign(S.f, patch); store.set('filters', S.f); route(); };
  document.querySelectorAll('.filters [data-p]').forEach((b) => b.onclick = () => {
    const anchor = S.meta.periksa_max || iso(new Date());
    const [a, z] = presetRange(b.dataset.p, b.dataset.p === 'bulan' || b.dataset.p === 'tahun' ? (S.f.to > anchor ? anchor : S.f.to) : anchor);
    set({ preset: b.dataset.p, from: a, to: z });
  });
  const fd = document.getElementById('fd'), ft = document.getElementById('ft');
  const onDate = () => { if (!fd.value || !ft.value) return; let a = fd.value, z = ft.value; if (a > z) [a, z] = [z, a]; set({ preset: 'custom', from: a, to: z }); };
  fd.onchange = onDate; ft.onchange = onDate;
  const fc = document.getElementById('fc'); if (fc) fc.onchange = (e) => set({ cmp: e.target.value });
  document.getElementById('fr').onchange = (e) => set({ regu: e.target.value });
  document.getElementById('fk').onchange = (e) => set({ kec: e.target.value });
  document.getElementById('fl').onchange = (e) => set({ layanan: e.target.value });
  document.getElementById('fprint').onclick = () => window.print();
}

let routeSeq = 0;
async function route() {
  const k = (location.hash.replace(/^#\/?/, '').split('?')[0]) || 'ringkasan';
  const nav = NAV.find((n) => n[0] === k) || NAV[0];
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.k === nav[0]));
  document.getElementById('nav').classList.remove('open');
  const main = document.getElementById('main');
  const seq = ++routeSeq;
  const noData = !S.meta.n_periksa && nav[0] !== 'data';
  main.innerHTML = `<header><div class="ph-eyebrow">Pemeriksaan P2TL · ${nav[0] === 'data' ? 'pengelolaan data' : rentang(S.f.from, S.f.to)}</div><h1>${nav[1]}</h1><p class="ph-sub">${nav[3]}</p></header>
    ${nav[0] === 'data' || noData ? '' : filterBar(nav[0])}<div id="page" style="display:flex;flex-direction:column;gap:18px"><div class="loading"><span class="spin"></span>Memuat data…</div></div>`;
  if (nav[0] !== 'data' && !noData) bindFilters();
  const page = document.getElementById('page');
  const ctx = { el: page, rpc, params, f: S.f, meta: S.meta, me: S.me, cmp: cmpRange(S.f), alive: () => seq === routeSeq, sb, CONFIG, refresh: async () => { clearCache(); await refreshMeta(); updateFoot(); } };
  try {
    if (noData) { page.innerHTML = `<div class="note warn">Belum ada data pemeriksaan di database. Buka <a href="#/data">Kelola &amp; Unggah Data</a> untuk mengunggah file pertama.</div>`; return; }
    if (nav[0] === 'data') await dataPage(ctx);
    else await PAGES[nav[0]](ctx);
  } catch (e) {
    if (seq !== routeSeq) return;
    console.error(e);
    page.innerHTML = `<div class="note warn"><b>Gagal memuat data.</b> ${esc(e.message)}</div>`;
  }
}

async function boot() {
  const { data } = await sb.auth.getSession();
  S.session = data.session;
  if (!S.session) { loginView(); return; }
  root.innerHTML = '<div class="loading"><span class="spin"></span>Memuat…</div>';
  try { await refreshMeta(); } catch (e) {
    const msg = /Akses ditolak/.test(e.message) ? 'Akun Anda sudah login tetapi belum didaftarkan di dashboard. Hubungi admin.' : e.message;
    root.innerHTML = `<div class="login"><div class="card" style="max-width:440px"><h2>Tidak bisa membuka dashboard</h2><p class="sub">${esc(msg)}</p><button class="btn" id="lo2" type="button">Keluar</button></div></div>`;
    document.getElementById('lo2').onclick = () => sb.auth.signOut();
    return;
  }
  S.me = S.meta.me;
  if (!S.f || !S.f.from) {
    const anchor = S.meta.periksa_max || iso(new Date());
    const [a, z] = presetRange('bulan', anchor);
    S.f = { preset: 'bulan', from: a, to: z, cmp: 'none', regu: '', kec: '', layanan: '' };
  }
  shell();
  route();
}

let booted = false;
const needPw = /type=(invite|recovery)/.test(location.hash);
sb.auth.onAuthStateChange((ev, session) => {
  if (ev === 'PASSWORD_RECOVERY' || (needPw && ev === 'SIGNED_IN' && !booted)) { booted = true; S.session = session; setTimeout(setPasswordView, 0); return; }
  if (ev === 'SIGNED_OUT') { S.session = null; S.meta = null; S.cache.clear(); routeSeq++; loginView(); return; }
  if (ev === 'SIGNED_IN' && (!booted || !S.session)) { booted = true; S.session = session; boot(); }
  if (ev === 'TOKEN_REFRESHED') S.session = session;
});
window.addEventListener('hashchange', () => { if (S.session && S.meta && document.getElementById('main')) route(); });
initTip();
window.addEventListener('unhandledrejection', (e) => { if (!S.session) e.preventDefault(); console.warn('Permintaan tertunda:', e.reason?.message || e.reason); e.preventDefault(); });
if (!needPw) boot().then(() => { booted = true; });

export function session() { return S.session; }
