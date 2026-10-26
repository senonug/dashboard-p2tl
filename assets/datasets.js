// Definisi 5 dataset: deteksi dari judul kolom, pemetaan ke kolom database, validasi.
const norm = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, ' ');

export const DATASETS = {
  pemeriksaan: { label: 'Data Pemeriksaan P2TL', table: 'pemeriksaan', key: 'id_p2tl', batch: 800, mode: 'upsert' },
  paska: { label: 'DPM Baca Paskabayar', table: 'pakai_paska', key: 'idpel,blth', batch: 4000, mode: 'replace-month' },
  pra: { label: 'OLAP Prabayar', table: 'pakai_pra', key: 'idpel,blth', batch: 4000, mode: 'replace-month' },
  dil: { label: 'Data Induk Langganan (DIL)', table: 'dil', key: 'idpel', batch: 2500, mode: 'upsert' },
  ts: { label: 'Laporan TS Terbayar', table: 'ts_bayar', key: 'no_agenda', batch: 1000, mode: 'upsert' },
};

export const SENSITIVE = ['NIK_PELANGGAN', 'MSISDN_PELANGGAN', 'NIK', 'NO HP', 'NOHP', 'MSISDN', 'NO_HP', 'TELEPON', 'NO TELP'];

export function detect(header) {
  const h = new Set(header.map(norm));
  if (h.has('ID_P2TL') && h.has('UPDATE_STATUS')) return 'pemeriksaan';
  if (h.has('PEMKWH') && h.has('JAMNYALA') && h.has('BLTH')) return 'paska';
  if (h.has('PEMKWH') && (h.has('TGLBAYAR') || h.has('KDSWITCHING') || h.has('RPPTL'))) return 'pra';
  if (h.has('IDPEL') && (h.has('KET KDPEMBMETER') || h.has('STATUS DIL'))) return 'dil';
  if (h.has('NO AGENDA') && h.has('TOTAL P2TL')) return 'ts';
  return null;
}

export const REQUIRED = {
  pemeriksaan: ['ID_P2TL', 'IDPEL', 'UPDATE_STATUS', 'WAKTU_PERIKSA', 'RUPIAH_TS', 'KWH_TS', 'REGU', 'NAMA_PETUGAS'],
  paska: ['IDPEL', 'BLTH', 'PEMKWH', 'JAMNYALA'],
  pra: ['IDPEL', 'BULAN', 'PEMKWH'],
  dil: ['IDPEL', 'TARIF', 'DAYA', 'STATUS DIL', 'NAMA GARDU', 'KOORDINAT X', 'KOORDINAT Y'],
  ts: ['NO AGENDA', 'IDPEL', 'GOLONGAN', 'TOTAL P2TL', 'TGL REGISTER'],
};

// ---------- konversi nilai ----------
const pad = (n) => String(n).padStart(2, '0');
function excelSerialToParts(v) {
  const ms = Math.round((v - 25569) * 86400000);
  const d = new Date(ms);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()];
}
export function toTimestamp(v) {
  if (v === undefined || v === null || v === '' || v === '-') return null;
  if (typeof v === 'number') {
    if (v < 1000 || v > 80000) return null;
    const p = excelSerialToParts(v);
    return `${p[0]}-${pad(p[1])}-${pad(p[2])} ${pad(p[3])}:${pad(p[4])}:${pad(p[5])}`;
  }
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())} ${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`;
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])} ${pad(m[4] || 0)}:${pad(m[5] || 0)}:${pad(m[6] || 0)}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])} ${pad(m[4] || 0)}:${pad(m[5] || 0)}:${pad(m[6] || 0)}`;
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]} 00:00:00`;
  return null;
}
export const toDate = (v) => { const t = toTimestamp(v); return t ? t.slice(0, 10) : null; };
export function toNum(v) {
  if (v === undefined || v === null || v === '' || v === '-') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/\s/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
export const toInt = (v) => { const n = toNum(v); return n === null ? null : Math.round(n); };
export function toText(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}
export function toIdpel(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return String(Math.round(v));
  const s = String(v).trim();
  if (/^\d+\.0+$/.test(s)) return s.split('.')[0];
  if (/^\d(\.\d+)?e\+\d+$/i.test(s)) return String(Math.round(Number(s)));
  return s;
}
function toCoord(v, lo, hi) { const n = toNum(v); return n !== null && n >= lo && n <= hi ? n : null; }
const toLat = (v) => toCoord(v, -11, 6);
const toLon = (v) => toCoord(v, 94, 142);
function toBlth(v) {
  const n = toInt(v);
  if (n && n > 199000 && n < 210000) return n;
  const d = toDate(v);
  return d ? Number(d.slice(0, 4) + d.slice(5, 7)) : null;
}

export function golOf(status) {
  const s = String(status || '');
  const m = /Temuan\s*-\s*([A-Z]\d)/i.exec(s);
  return m ? m[1].toUpperCase() : 'Sesuai';
}

// ---------- pemetaan baris ----------
export function makeMapper(ds, header) {
  const idx = {};
  header.forEach((h, i) => { const k = norm(h); if (k && idx[k] === undefined) idx[k] = i; });
  const g = (row, name) => { const i = idx[name]; return i === undefined ? undefined : row[i]; };
  const missing = (REQUIRED[ds] || []).filter((c) => idx[c] === undefined);
  const sensitive = header.map(norm).filter((h) => SENSITIVE.includes(h));

  if (ds === 'pemeriksaan') {
    return { missing, sensitive, map(row) {
      const id = toText(g(row, 'ID_P2TL'));
      if (!id) return null;
      const w = toTimestamp(g(row, 'WAKTU_PERIKSA'));
      const regu = /REGU_?(\d+)/i.exec(String(g(row, 'REGU') || ''));
      const th = toInt(g(row, 'TAHUN_MTR_SDH')) || toInt(g(row, 'TAHUN_MTR_BLM'));
      return {
        id_p2tl: id, idpel: toIdpel(g(row, 'IDPEL')), nama: toText(g(row, 'NAMA')), tarif: toText(g(row, 'TARIF')),
        daya: toInt(g(row, 'DAYA')), gardu: toText(g(row, 'GARDU')), lat: toLat(g(row, 'LATITUDE')), lon: toLon(g(row, 'LONGITUDE')),
        sesuai_merk: toText(g(row, 'SESUAI_MERK')), merk_meter: toText(g(row, 'MERK_METER')), update_status: toText(g(row, 'UPDATE_STATUS')),
        gol: golOf(g(row, 'UPDATE_STATUS')), peruntukan: toText(g(row, 'PERUNTUKAN')), catatan: toText(g(row, 'CATATAN')),
        pemutusan: toText(g(row, 'PEMUTUSAN')), kwh_ts: toNum(g(row, 'KWH_TS')) || 0, rupiah_ts: toNum(g(row, 'RUPIAH_TS')) || 0,
        rupiah_kwh: toNum(g(row, 'RUPIAH_KWH')) || 0, waktu_periksa: w, tgl: w ? w.slice(0, 10) : null,
        regu: regu ? Number(regu[1]) : toInt(g(row, 'REGU')), petugas: toText(g(row, 'NAMA_PETUGAS')) || toText(g(row, 'USERNAME')),
        sumber: toText(g(row, 'SUMBER')), dlpd: toText(g(row, 'DLPD')), jenislayanan: toText(g(row, 'JENISLAYANAN')),
        status_kwh: toText(g(row, 'STATUS_KWH')), ganti_material: toText(g(row, 'GANTI_MATERIAL')), durasi: toInt(g(row, 'DURASI_PERIKSA')),
        ts_ap2t: toText(g(row, 'TS_AP2T')), no_agenda: toText(g(row, 'NO_AGENDA')), tgl_sph: toDate(g(row, 'TANGGAL_SPH')),
        tindaklanjut: toText(g(row, 'TINDAKLANJUT_PEMERIKSAAN')), nomor_meter: toText(g(row, 'NOMOR_METER')),
        tahun_meter: th && th > 1980 && th < 2100 ? th : null,
      };
    } };
  }
  if (ds === 'paska') {
    return { missing, sensitive, map(row) {
      const idpel = toIdpel(g(row, 'IDPEL')); const blth = toBlth(g(row, 'BLTH'));
      if (!idpel || !blth) return null;
      return { idpel, blth, tarif: toText(g(row, 'TARIF')), daya: toInt(g(row, 'DAYA')), kwh: toNum(g(row, 'PEMKWH')),
        jam_nyala: toNum(g(row, 'JAMNYALA')), kdbaca: toText(g(row, 'KDBACA2')) || toText(g(row, 'KDBACA')), tgl_baca: toDate(g(row, 'TGLBACA')) };
    } };
  }
  if (ds === 'pra') {
    // diringkas per IDPEL per bulan
    return { missing, sensitive, aggregate: true, map(row) {
      const idpel = toIdpel(g(row, 'IDPEL')); const blth = toBlth(g(row, 'BULAN')) || toBlth(String(g(row, 'TGLBAYAR') || '').slice(0, 6));
      if (!idpel || !blth) return null;
      return { idpel, blth, daya: toInt(g(row, 'DAYA')), kwh: toNum(g(row, 'PEMKWH')) || 0,
        rp: toNum(g(row, 'RPPENJ')) ?? toNum(g(row, 'RPPTL')) ?? 0 };
    } };
  }
  if (ds === 'dil') {
    return { missing, sensitive, map(row) {
      const idpel = toIdpel(g(row, 'IDPEL'));
      if (!idpel) return null;
      const pemb = toText(g(row, 'KET KDPEMBMETER'));
      const th = toInt(g(row, 'TAHUN TERA METER KWH'));
      return { idpel, nama: toText(g(row, 'NAMA')) === '0' ? null : toText(g(row, 'NAMA')), alamat: toText(g(row, 'NAMAPNJ')),
        tarif: toText(g(row, 'TARIF')), daya: toInt(g(row, 'DAYA')), layanan: pemb && /PRABAYAR/i.test(pemb) ? 'PRABAYAR' : 'PASKABAYAR',
        pembmeter: pemb, status: toText(g(row, 'STATUS DIL')), gardu: toText(g(row, 'NAMA GARDU')),
        kecamatan: toText(g(row, 'NAMA KECAMATAN')), kelurahan: toText(g(row, 'NAMA KELURAHAN')), merk: toText(g(row, 'MERK METER KWH')),
        tahun_tera: th && th > 1950 && th < 2100 ? th : null, lat: toLat(g(row, 'KOORDINAT X')), lon: toLon(g(row, 'KOORDINAT Y')),
        keperluan: toText(g(row, 'KET KEPERLUAN')), tgl_nyala: toDate(g(row, 'TGLNYALA PB')) };
    } };
  }
  if (ds === 'ts') {
    return { missing, sensitive, map(row) {
      const ag = toText(g(row, 'NO AGENDA'));
      if (!ag) return null;
      return { no_agenda: ag, idpel: toIdpel(g(row, 'IDPEL')), nama: toText(g(row, 'NAMA')), golongan: toText(g(row, 'GOLONGAN')),
        alamat: toText(g(row, 'ALAMAT')), tarif: toText(g(row, 'TARIP')) || toText(g(row, 'TARIF')), daya: toInt(g(row, 'DAYA')),
        kwh: toNum(g(row, 'KWH')), rp_kwh: toNum(g(row, 'RP KWH')), rp_beban: toNum(g(row, 'RP BEBAN')), rp_ts: toNum(g(row, 'RP TS')),
        rp_materai: toNum(g(row, 'RP METERAI')), rp_material: toNum(g(row, 'RP MATERIAL')), total_p2tl: toNum(g(row, 'TOTAL P2TL')),
        tunai: toNum(g(row, 'TUNAI')), angsur: toNum(g(row, 'RP TOTAL ANGSUR')), rp_ppj: toNum(g(row, 'RP PPJ')), rp_ppn: toNum(g(row, 'RP PPN')),
        rp_ujl: toNum(g(row, 'RP UJL')), tgl_register: toDate(g(row, 'TGL REGISTER')), no_sph: toText(g(row, 'NO SPH')), tgl_sph: toDate(g(row, 'TGL SPH')) };
    } };
  }
  throw new Error('dataset tidak dikenal');
}

// Kumpulkan statistik untuk layar validasi
export function newStats(ds) {
  return { ds, rows: 0, skipped: 0, dup: 0, minDate: null, maxDate: null, blth: {}, status: {}, extra: {} };
}
export function track(st, rec) {
  st.rows++;
  const d = rec.tgl || rec.tgl_register || null;
  if (d) { if (!st.minDate || d < st.minDate) st.minDate = d; if (!st.maxDate || d > st.maxDate) st.maxDate = d; }
  if (rec.blth) st.blth[rec.blth] = (st.blth[rec.blth] || 0) + 1;
  if (st.ds === 'pemeriksaan') st.status[rec.gol] = (st.status[rec.gol] || 0) + 1;
  if (st.ds === 'dil') st.status[rec.status || '-'] = (st.status[rec.status || '-'] || 0) + 1;
  if (st.ds === 'ts') st.status[rec.golongan || '-'] = (st.status[rec.golongan || '-'] || 0) + 1;
  if (st.ds === 'paska') st.status[rec.kdbaca || '-'] = (st.status[rec.kdbaca || '-'] || 0) + 1;
}
