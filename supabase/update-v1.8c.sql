-- =====================================================================
--  Dashboard P2TL — pembaruan v1.8c (lebih ringan)
--
--  Isi:
--   1. f_meta: tidak lagi membaca seluruh tabel DIL setiap halaman dibuka
--   2. f_ringkasan: jumlah pelanggan aktif dari ringkasan dil_sel (bukan seluruh DIL)
--   3. Kelola Data: angka DIL dari tabel kecil dil_info (diisi saat DIL diunggah)
--   0. f_base (dipakai semua halaman): dilebur ke kueri pemanggil + tidak membaca DIL bila kecamatan tidak dipilih
--      (periode 10 bulan: ±7 detik → ±0,6 detik)
--   4. Peta Kerja: titik Sesuai dimuat terpisah (f_titik_sesuai), sel 100 m sebatas layar,
--      calon TO ringkas (maks 1.500 per layar; rincian lewat f_calon), isi sel ringkas
--
--  Cara pakai: Supabase › SQL Editor › New query › tempel SELURUH isi file › Run.
--  Prasyarat: v1.8b sudah terpasang. Seluruh isi berjalan dalam satu transaksi.
-- =====================================================================
begin;

create or replace function f_base(p_from date, p_to date, p_regu int, p_kec text, p_layanan text)
returns setof pemeriksaan
-- v1.8c: tanpa security definer / set search_path agar bisa "dilebur" ke kueri pemanggil (jauh lebih cepat),
-- dan filter kecamatan memakai EXISTS sehingga DIL tidak dibaca bila kecamatan tidak dipilih.
-- Fungsi ini hanya dipanggil dari fungsi security definer lain (tidak lewat API).
language sql stable as $$
  select p.* from public.pemeriksaan p
  where p.tgl between p_from and p_to
    and (p_regu is null or p.regu = p_regu)
    and (p_kec is null or exists (select 1 from public.dil d where d.idpel = p.idpel and d.kecamatan = p_kec))
    and (p_layanan is null or p.jenislayanan = p_layanan)
$$;
revoke execute on function f_base(date, date, int, text, text) from public, anon, authenticated;

create table if not exists dil_info (n integer, aktif integer, snapshot text, masking integer);
alter table dil_info enable row level security;   -- hanya lewat fungsi security definer
revoke all on dil_info from anon;
create index if not exists pemeriksaan_regu_idx on pemeriksaan (regu);

create or replace function f_meta() returns json
language plpgsql stable security definer set search_path = public as $$
declare r json;
begin
  perform guard();
  select json_build_object(
    'me', my_role(),
    'periksa_min', (select min(tgl) from pemeriksaan),
    'periksa_max', (select max(tgl) from pemeriksaan),
    -- tanpa membaca seluruh tabel pemeriksaan: cukup tahu ada/tidaknya data, dan daftar regu lewat indeks
    'n_periksa', (select count(*) from (select 1 from pemeriksaan limit 1) x),
    'regu', (with recursive r as (select min(regu) v from pemeriksaan
                                  union all select (select min(regu) from pemeriksaan where regu > r.v) from r where r.v is not null)
             select coalesce(json_agg(v order by v), '[]') from r where v is not null),
    'kecamatan', (select coalesce(json_agg(k order by n desc), '[]') from (select kecamatan k, sum(n) n from dil_sel where kecamatan is not null group by 1 having sum(n) > 500) x),
    'paska_blth', (select coalesce(json_agg(blth order by blth), '[]') from bulan_data where dataset = 'paska' and status = 'ok'),
    'pra_blth', (select coalesce(json_agg(blth order by blth), '[]') from bulan_data where dataset = 'pra' and status = 'ok'),
    'ts_min', (select min(tgl_register) from ts_bayar),
    'ts_max', (select max(tgl_register) from ts_bayar),
    'ts_n', (select count(*) from ts_bayar),
    'last_upload', (select max(created_at) from upload_log)
  ) into r;
  return r;
end $$;

create or replace function f_ringkasan(p_from date, p_to date, p_regu int default null, p_kec text default null, p_layanan text default null,
                                      p_cmp_from date default null, p_cmp_to date default null)
returns json
language plpgsql stable security definer set search_path = public as $$
declare r json;
begin
  perform guard();
  with b as (select * from f_base(p_from, p_to, p_regu, p_kec, p_layanan)),
  c as (select * from f_base(coalesce(p_cmp_from, '1900-01-01'), coalesce(p_cmp_to, '1900-01-01'), p_regu, p_kec, p_layanan)),
  aktif as (select coalesce(sum(n), 0) n from dil_sel where (p_kec is null or kecamatan = p_kec)
            and (p_layanan is null or layanan = p_layanan))
  select json_build_object(
    'kpi', (select json_build_object(
        'n', count(*), 't', count(*) filter (where gol <> 'Sesuai'),
        'rp', coalesce(sum(rp_ts_ok), 0), 'kwh', coalesce(sum(kwh_ts_ok), 0),
        'bongkar', count(*) filter (where pemutusan = 'Bongkar' and gol <> 'Sesuai'),
        'putus', count(*) filter (where pemutusan = 'Diputus' and gol <> 'Sesuai'),
        'ap2t', count(*) filter (where ts_ap2t = 'Ya'),
        'hari', count(distinct tgl), 'uniq', count(distinct idpel),
        'anomali', count(*) filter (where not ts_wajar), 'rp_anomali', coalesce(sum(rupiah_ts) filter (where not ts_wajar), 0),
        'kwh_anomali', coalesce(sum(kwh_ts) filter (where not ts_wajar), 0),
        'aktif', (select n from aktif)) from b),
    'ts', (select json_build_object('n', count(*), 'rp_ts', coalesce(sum(rp_ts), 0), 'total', coalesce(sum(total_p2tl), 0), 'kwh', coalesce(sum(kwh), 0),
        'min', (select min(tgl_register) from ts_bayar where gol_ts is not null), 'max', (select max(tgl_register) from ts_bayar where gol_ts is not null))
        from ts_bayar where tgl_register between p_from and p_to and gol_ts is not null),
    'ts_cmp', (select case when p_cmp_from is null then null else json_build_object('n', count(*), 'rp_ts', coalesce(sum(rp_ts), 0),
        'total', coalesce(sum(total_p2tl), 0), 'kwh', coalesce(sum(kwh), 0)) end
        from ts_bayar where tgl_register between p_cmp_from and p_cmp_to and gol_ts is not null),
    'gol_ts', (select coalesce(json_agg(x order by x.rp desc), '[]') from (
        select gol_ts gol, count(*) n, coalesce(sum(rp_ts), 0) rp, coalesce(sum(total_p2tl), 0) total, coalesce(sum(kwh), 0) kwh,
               coalesce(sum(tunai), 0) tunai, coalesce(sum(angsur), 0) angsur
        from ts_bayar where tgl_register between p_from and p_to and gol_ts is not null group by 1) x),
    'ts_daily', (select coalesce(json_agg(x order by x.tgl), '[]') from (
        select tgl_register tgl, gol_ts gol, count(*) n, coalesce(sum(kwh), 0) kwh, coalesce(sum(rp_ts), 0) rp
        from ts_bayar where tgl_register between p_from and p_to and gol_ts is not null group by 1, 2) x),
    'cmp', (select case when p_cmp_from is null then null else json_build_object(
        'n', count(*), 't', count(*) filter (where gol <> 'Sesuai'),
        'rp', coalesce(sum(rp_ts_ok), 0), 'kwh', coalesce(sum(kwh_ts_ok), 0),
        'bongkar', count(*) filter (where pemutusan = 'Bongkar' and gol <> 'Sesuai'),
        'ap2t', count(*) filter (where ts_ap2t = 'Ya'), 'uniq', count(distinct idpel)) end from c),
    'daily', (select coalesce(json_agg(x order by x.tgl), '[]') from (
        select tgl, count(*) n, count(*) filter (where gol <> 'Sesuai') t, coalesce(sum(rp_ts_ok), 0) rp from b group by tgl) x),
    'gol', (select coalesce(json_agg(x order by x.rp desc), '[]') from (
        select gol, count(*) n, coalesce(sum(rp_ts_ok), 0) rp, coalesce(sum(kwh_ts_ok), 0) kwh from b where gol <> 'Sesuai' group by gol) x),
    'layanan', (select coalesce(json_agg(x), '[]') from (
        select jenislayanan k, count(*) n, count(*) filter (where gol <> 'Sesuai') t, coalesce(sum(rp_ts_ok), 0) rp from b group by 1 order by 2 desc) x),
    'peruntukan', (select coalesce(json_agg(x), '[]') from (
        select peruntukan k, count(*) n, count(*) filter (where gol <> 'Sesuai') t, coalesce(sum(rp_ts_ok), 0) rp from b group by 1 order by 2 desc) x),
    'daya', (select coalesce(json_agg(x order by x.o), '[]') from (
        select case when daya <= 450 then 1 when daya <= 900 then 2 when daya <= 1300 then 3 when daya <= 2200 then 4 when daya <= 5500 then 5 else 6 end o,
               count(*) n, count(*) filter (where gol <> 'Sesuai') t, count(*) filter (where gol <> 'Sesuai' and gol <> 'P4') t_np4,
               count(*) filter (where gol <> 'P4') n_np4, coalesce(sum(rp_ts_ok), 0) rp from b group by 1) x),
    'tarif', (select coalesce(json_agg(x), '[]') from (
        select tarif k, count(*) n, count(*) filter (where gol <> 'Sesuai') t, coalesce(sum(rp_ts_ok), 0) rp from b group by 1 having count(*) >= 10 order by 2 desc) x),
    'pemutusan', (select coalesce(json_agg(x), '[]') from (
        select pemutusan k, count(*) n from b where gol <> 'Sesuai' group by 1 order by 2 desc) x)
  ) into r;
  return r;
end $$;

create or replace function f_datasets() returns json
language plpgsql stable security definer set search_path = public as $$
declare r json;
begin
  perform guard();
  select json_build_object(
    'pemeriksaan', json_build_object('n', (select count(*) from pemeriksaan), 'min', (select min(tgl) from pemeriksaan), 'max', (select max(tgl) from pemeriksaan)),
    'paska', (select coalesce(json_agg(x order by x.blth), '[]') from (select blth, n, status, file, oleh, waktu, n_baru, n_hilang from bulan_data where dataset = 'paska') x),
    'pra', (select coalesce(json_agg(x order by x.blth), '[]') from (select blth, n, status, file, oleh, waktu, n_baru, n_hilang from bulan_data where dataset = 'pra') x),
    'dil', (select json_build_object('n', n, 'aktif', aktif, 'snapshot', snapshot, 'masking', masking) from dil_info limit 1),
    'ts', json_build_object('n', (select count(*) from ts_bayar), 'min', (select min(tgl_register) from ts_bayar), 'max', (select max(tgl_register) from ts_bayar)),
    'months', json_build_object(
       'pemeriksaan', (select coalesce(json_agg(x order by x.blth), '[]') from (select blth_of(tgl) blth, count(*) n from pemeriksaan where tgl is not null group by 1) x),
       'ts', (select coalesce(json_agg(x order by x.blth), '[]') from (select blth_of(tgl_register) blth, count(*) n from ts_bayar where tgl_register is not null group by 1) x)),
    'log', (select coalesce(json_agg(x order by x.created_at desc), '[]') from (select * from upload_log order by created_at desc limit 30) x),
    'db_size', pg_database_size(current_database())
  ) into r;
  return r;
end $$;

create or replace function f_refresh_dil_sel_internal() returns integer
language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  truncate dil_sel;
  insert into dil_sel (gx, gy, inbox, kecamatan, kelurahan, layanan, gardu, n, slat, slon)
  select gx, gy, coalesce(lat between -6.6 and -6.1 and lon between 106.6 and 107.0, false) inbox,
         kecamatan, kelurahan, layanan, gardu, count(*), sum(lat), sum(lon)
  from dil where status = 'AKTIF' group by 1, 2, 3, 4, 5, 6, 7;
  get diagnostics n = row_count;
  truncate dil_sel_h;
  insert into dil_sel_h (fx, fy, kecamatan, layanan, n, slat, slon)
  select floor(lon / 0.0005)::int, floor(lat / 0.0005)::int, kecamatan, layanan, count(*), sum(lat), sum(lon)
  from dil where status = 'AKTIF' and lat between -6.6 and -6.1 and lon between 106.6 and 107.0
  group by 1, 2, 3, 4;
  -- ringkasan DIL untuk Kelola Data (agar halaman itu tidak membaca seluruh DIL)
  delete from dil_info where true;
  insert into dil_info (n, aktif, snapshot, masking)
  select count(*), count(*) filter (where status = 'AKTIF'),
         (select snapshot from dil where snapshot is not null group by 1 order by count(*) desc limit 1),
         count(*) filter (where position('*' in coalesce(nama, '')) > 0)
  from dil;
  analyze dil_sel; analyze dil_sel_h;
  return n;
end $$;

create or replace function f_hapus_data(p_dataset text, p_blth int default null) returns integer
language plpgsql volatile security definer set search_path = public set statement_timeout = '120s' as $$
declare n int := 0; v_y smallint; v_m int; v_bit int;
begin
  if not is_admin() then raise exception 'Akses ditolak: hanya admin'; end if;
  if p_dataset in ('paska', 'pra') then
    if p_blth is null then raise exception 'Pilih bulan yang akan dihapus'; end if;
    v_y := p_blth / 100; v_m := p_blth % 100; v_bit := 1 << (v_m - 1);
  end if;
  if p_dataset = 'pemeriksaan' then delete from pemeriksaan where blth_of(tgl) = p_blth; get diagnostics n = row_count;
  elsif p_dataset = 'paska' then
    update pakai_paska_th set daya[v_m] = null, kwh[v_m] = null, jn[v_m] = null, kd[v_m] = null, ada = ada & ~v_bit
    where tahun = v_y and ada & v_bit <> 0;
    get diagnostics n = row_count;
    delete from pakai_paska_th where tahun = v_y and ada = 0;
    delete from bulan_data where dataset = 'paska' and blth = p_blth;
  elsif p_dataset = 'pra' then
    update pakai_pra_th set daya[v_m] = null, kwh[v_m] = null, ada = ada & ~v_bit
    where tahun = v_y and ada & v_bit <> 0;
    get diagnostics n = row_count;
    delete from pakai_pra_th where tahun = v_y and ada = 0;
    delete from bulan_data where dataset = 'pra' and blth = p_blth;
  elsif p_dataset = 'ts' then delete from ts_bayar where blth_of(tgl_register) = p_blth; get diagnostics n = row_count;
  elsif p_dataset = 'dil' then delete from dil where true; get diagnostics n = row_count; delete from dil_sel where true; delete from dil_sel_h where true; delete from dil_info where true;
  else raise exception 'dataset tidak dikenal'; end if;
  insert into upload_log (dataset, filename, periode, n_rows, info, uploaded_by)
  values (p_dataset, '(dihapus)', coalesce(p_blth::text, 'semua'), -n, '{"hapus": true}', me_email());
  return n;
end $$;

create or replace function f_cakupan(p_from date, p_to date, p_regu int default null, p_kec text default null, p_layanan text default null)
returns json
language plpgsql stable security definer set search_path = public as $$
declare r json; v_all boolean;
begin
  perform guard();
  v_all := p_to - p_from <= 92;   -- periode ≤ 3 bulan: semua pemeriksaan Sesuai ditampilkan
  with b as (select * from f_base(p_from, p_to, p_regu, p_kec, p_layanan)),
  bi as (select idpel, bool_or(gol <> 'Sesuai') tm from b group by idpel),
  bl as materialized (select b.id_p2tl, b.gol, b.idpel, b.nama, b.rupiah_ts, b.tgl, coalesce(b.lat, d.lat) lat, coalesce(b.lon, d.lon) lon
         from b left join dil d on d.idpel = b.idpel and b.lat is null),
  ia as materialized (select d.gardu, d.kecamatan, d.kelurahan, bi.tm from bi join dil d on d.idpel = bi.idpel
         where d.status = 'AKTIF' and (p_kec is null or d.kecamatan = p_kec) and (p_layanan is null or d.layanan = p_layanan)
           and d.lat between -6.6 and -6.1 and d.lon between 106.6 and 107.0),
  s as materialized (select * from dil_sel where inbox and (p_kec is null or kecamatan = p_kec) and (p_layanan is null or layanan = p_layanan))
  select json_build_object(
    'kpi', json_build_object(
       'aktif', (select coalesce(sum(n), 0) from s), 'pra', (select coalesce(sum(n), 0) from s where layanan = 'PRABAYAR'),
       'uniq', (select count(*) from bi), 'uniq_dil', (select count(*) from ia),
       'gardu_total', (select count(distinct gardu) from s), 'gardu_ins', (select count(distinct gardu) from ia)),
    'kec', (select coalesce(json_agg(x order by x.pop desc), '[]') from (
       select p.k, p.pop, coalesce(i.ins, 0) ins, coalesce(i.tm, 0) tm
       from (select kecamatan k, sum(n) pop from s group by 1 having sum(n) > 500) p
       left join (select kecamatan k, count(*) ins, count(*) filter (where tm) tm from ia group by 1) i on i.k is not distinct from p.k) x),
    'kel', (select coalesce(json_agg(x order by x.tm desc, x.ins desc), '[]') from (
       select p.k, p.kec, p.pop, coalesce(i.ins, 0) ins, coalesce(i.tm, 0) tm
       from (select kelurahan k, kecamatan kec, sum(n) pop from s group by 1, 2 having sum(n) > 300) p
       left join (select kelurahan k, kecamatan kec, count(*) ins, count(*) filter (where tm) tm from ia group by 1, 2) i
         on i.k is not distinct from p.k and i.kec is not distinct from p.kec) x),
    'gol_n', (select coalesce(json_object_agg(gol, n), '{}') from (select gol, count(*) n from bl where lat is not null group by 1) x),
    'sesuai_semua', v_all,
    -- hanya temuan; titik Sesuai dimuat terpisah (f_titik_sesuai) saat chip Sesuai dinyalakan
    'points', (select coalesce(json_agg(json_build_array(round(lat::numeric, 5), round(lon::numeric, 5), gol, idpel, nama, rupiah_ts, tgl)), '[]') from
       bl where gol <> 'Sesuai' and lat is not null)
  ) into r;
  return r;
end $$;

create or replace function f_titik_sesuai(p_from date, p_to date, p_regu int default null, p_kec text default null, p_layanan text default null)
returns json
language plpgsql stable security definer set search_path = public as $$
declare r json; v_all boolean;
begin
  perform guard();
  v_all := p_to - p_from <= 92;   -- periode ≤ 3 bulan: semua; selebihnya sampel 4.000
  with b as (select * from f_base(p_from, p_to, p_regu, p_kec, p_layanan) where gol = 'Sesuai'),
  bl as (select b.id_p2tl, b.idpel, b.tgl, coalesce(b.lat, d.lat) lat, coalesce(b.lon, d.lon) lon
         from b left join dil d on d.idpel = b.idpel and b.lat is null)
  select json_build_object('semua', v_all, 'pts', coalesce(json_agg(json_build_array(round(lat::numeric, 5), round(lon::numeric, 5), idpel, tgl)), '[]'))
  into r from (select * from bl where lat is not null order by md5(id_p2tl) limit case when v_all then null else 4000 end) x;
  return r;
end $$;

-- tanda tangan fungsi berubah: hapus versi lama dulu
drop function if exists f_grid(date, date, int, text, text, int);
drop function if exists f_cell2(int, int, int, date, date);

create or replace function f_grid(p_from date, p_to date, p_regu int default null, p_kec text default null, p_layanan text default null, p_k int default 10,
                                  p_s double precision default null, p_w double precision default null, p_n double precision default null, p_e double precision default null)
returns json
language plpgsql stable security definer set search_path = public as $$
declare r json; v_min int; v_box boolean; fx0 int; fx1 int; fy0 int; fy1 int;
begin
  perform guard();
  if p_k not in (2, 5, 10) then raise exception 'Ukuran sel tidak dikenal'; end if;
  v_min := case p_k when 10 then 30 when 5 then 10 else 3 end;
  -- batas layar (dipakai untuk sel 100 m agar hanya area yang terlihat yang dikirim)
  v_box := p_s is not null and p_w is not null and p_n is not null and p_e is not null;
  if v_box then
    fx0 := floor(p_w / 0.0005)::int; fx1 := floor(p_e / 0.0005)::int; fy0 := floor(p_s / 0.0005)::int; fy1 := floor(p_n / 0.0005)::int;
  else
    fx0 := -2147483647; fx1 := 2147483647; fy0 := -2147483647; fy1 := 2147483647;
  end if;
  with b as (select * from f_base(p_from, p_to, p_regu, p_kec, p_layanan)),
  bi as (select idpel, bool_or(gol <> 'Sesuai') tm from b group by idpel),
  s as materialized (select fdiv(fx, p_k) i, fdiv(fy, p_k) j, layanan, n, slat, slon from dil_sel_h
                     where (p_kec is null or kecamatan = p_kec) and (p_layanan is null or layanan = p_layanan)
                       and fx between fx0 and fx1 and fy between fy0 and fy1),
  cp as (select i, j, sum(n) pop, coalesce(sum(n) filter (where layanan = 'PRABAYAR'), 0) pra, sum(slat) / sum(n) lat, sum(slon) / sum(n) lon
         from s group by i, j having sum(n) >= v_min),
  -- tiap pelanggan yang pernah diperiksa s.d. akhir periode (+ apakah diperiksa / ada temuan pada periode)
  ev as (select e.idpel, e.tgl, bi.idpel is not null per, coalesce(bi.tm, false) tm
         from (select idpel, max(tgl) tgl from pemeriksaan where tgl <= p_to and idpel is not null group by idpel) e
         left join bi on bi.idpel = e.idpel),
  evc as (select fdiv(floor(d.lon / 0.0005)::int, p_k) i, fdiv(floor(d.lat / 0.0005)::int, p_k) j,
                 count(*) ever, max(ev.tgl) last, count(*) filter (where ev.per) ins, count(*) filter (where ev.tm) tm
          from ev join dil d on d.idpel = ev.idpel
          where d.status = 'AKTIF' and (p_kec is null or d.kecamatan = p_kec) and (p_layanan is null or d.layanan = p_layanan)
            and d.lat between -6.6 and -6.1 and d.lon between 106.6 and 107.0
            and (not v_box or (d.lon between p_w - 0.001 and p_e + 0.001 and d.lat between p_s - 0.001 and p_n + 0.001))
          group by 1, 2),
  -- label (kelurahan, kecamatan, gardu dominan) dari sel 500 m induknya
  ckel as (select distinct on (gx, gy) gx, gy, kelurahan kel, kecamatan kec from (
           select gx, gy, kelurahan, kecamatan, sum(n) n from dil_sel where inbox and kelurahan is not null group by 1, 2, 3, 4) z order by gx, gy, n desc, kelurahan),
  cgar as (select distinct on (gx, gy) gx, gy, gardu from (
           select gx, gy, gardu, sum(n) n from dil_sel where inbox and gardu is not null group by 1, 2, 3) z order by gx, gy, n desc, gardu),
  -- calon TO per sel (logika sama dengan Profil Risiko)
  hist as (select distinct idpel from pemeriksaan where tgl > greatest(p_to, current_date) - 90 and idpel is not null),
  gtem as (select distinct d.gardu from pemeriksaan p join dil d on d.idpel = p.idpel where p.gol <> 'Sesuai' and p.tgl > p_to - 180 and d.gardu is not null),
  rk as (select fdiv(floor(s.lon / 0.0005)::int, p_k) i, fdiv(floor(s.lat / 0.0005)::int, p_k) j, s.lat, s.lon,
                s.skor0 + case when g.gardu is not null then 5 else 0 end skor
         from skor_dasar s left join gtem g on g.gardu = s.gardu
         where s.skor0 >= 30 and s.lat between -6.6 and -6.1 and s.lon between 106.6 and 107.0
           and (not v_box or (s.lon between p_w - 0.001 and p_e + 0.001 and s.lat between p_s - 0.001 and p_n + 0.001))
           and (p_kec is null or s.kecamatan = p_kec) and (p_layanan is null or s.layanan = p_layanan)
           and not exists (select 1 from hist h where h.idpel = s.idpel)),
  crk as (select i, j, count(*) filter (where skor >= 60) t, count(*) filter (where skor >= 35 and skor < 60) s, avg(lat) lat, avg(lon) lon
          from rk where skor >= 35 group by 1, 2),
  cells as materialized (
    select cp.i, cp.j, cp.pop, coalesce(ce.ins, 0) ins, coalesce(ce.tm, 0) tm, cp.pra, cp.lat, cp.lon, ck.kel, ck.kec, ce.last, cg.gardu,
           coalesce(ce.ever, 0) ever, coalesce(cr.t, 0) rt, coalesce(cr.s, 0) rs
    from cp left join evc ce using (i, j) left join crk cr using (i, j)
    left join ckel ck on ck.gx = fdiv(cp.i * p_k, 10) and ck.gy = fdiv(cp.j * p_k, 10)
    left join cgar cg on cg.gx = fdiv(cp.i * p_k, 10) and cg.gy = fdiv(cp.j * p_k, 10))
  select json_build_object(
    'k', p_k, 'box', v_box,
    'data_min', (select min(tgl) from pemeriksaan),
    'cells', (select coalesce(json_agg(json_build_array(i, j, pop, ins, tm, pra, round(lat::numeric, 5), round(lon::numeric, 5), kel, kec, last, gardu, ever, rt, rs)), '[]') from cells),
    'risk', (select coalesce(json_agg(json_build_array(i, j, t, s, round(lat::numeric, 5), round(lon::numeric, 5))), '[]') from crk),
    'zero', (select json_build_object('cells', count(*) filter (where ins = 0), 'pop', coalesce(sum(pop) filter (where ins = 0), 0),
                                      'never_cells', count(*) filter (where ever = 0), 'never_pop', coalesce(sum(pop) filter (where ever = 0), 0),
                                      'never_plg', coalesce(sum(greatest(pop - ever, 0)), 0)) from cells)
  ) into r;
  return r;
end $$;

create or replace function f_risiko_titik(p_from date, p_to date, p_kec text, p_layanan text,
                                          p_s double precision, p_w double precision, p_n double precision, p_e double precision, p_limit int default 1500)
returns json
language plpgsql stable security definer set search_path = public as $$
declare r json;
begin
  perform guard();
  with hist as (select distinct idpel from pemeriksaan where tgl > greatest(p_to, current_date) - 90 and idpel is not null),
  gtem as (select distinct d.gardu from pemeriksaan p join dil d on d.idpel = p.idpel where p.gol <> 'Sesuai' and p.tgl > p_to - 180 and d.gardu is not null),
  uc as (select s.idpel, s.nama, s.alamat, s.tarif, s.daya, s.layanan, s.gardu, s.lat, s.lon,
                s.skor0 + case when g.gardu is not null then 5 else 0 end skor
         from skor_dasar s left join gtem g on g.gardu = s.gardu
         where s.skor0 >= 30 and s.lat between p_s and p_n and s.lon between p_w and p_e
           and (p_kec is null or s.kecamatan = p_kec) and (p_layanan is null or s.layanan = p_layanan)
           and not exists (select 1 from hist h where h.idpel = s.idpel)),
  rk as (select *, case when skor >= 60 then 'Tinggi' else 'Sedang' end kat from uc where skor >= 35)
  select json_build_object(
    'n', (select count(*) from rk),
    -- ringkas: koordinat, IDPEL, skor; rincian pelanggan dimuat saat titik diklik (f_calon)
    'pts', (select coalesce(json_agg(json_build_array(round(lat::numeric, 5), round(lon::numeric, 5), idpel, skor)), '[]') from (
        select * from rk order by skor desc, daya desc nulls last limit greatest(1, least(p_limit, 3000))) x)
  ) into r;
  return r;
end $$;

create or replace function f_calon(p_idpel text) returns json
language plpgsql stable security definer set search_path = public as $$
declare r json;
begin
  perform guard();
  select json_build_object('idpel', s.idpel, 'nama', s.nama, 'alamat', s.alamat, 'tarif', s.tarif, 'daya', s.daya, 'layanan', s.layanan,
                           'gardu', s.gardu, 'kelurahan', s.kelurahan, 'jn', s.jn, 'kwh', s.kwh, 'kd', s.kd, 'beli', s.beli, 'prev_k', s.prev_k, 'blth', s.blth)
  into r from skor_dasar s where s.idpel = p_idpel;
  return r;
end $$;

create or replace function f_cell2(p_i int, p_j int, p_k int, p_from date, p_to date, p_full boolean default null) returns json
language plpgsql stable security definer set search_path = public as $$
declare r json; g0 int; g1 int; h0 int; h1 int; v_full boolean;
begin
  perform guard();
  if p_k not in (2, 5, 10) then raise exception 'Ukuran sel tidak dikenal'; end if;
  -- sel 100 m: semua pelanggan dikirim; sel 250/500 m: hanya yang berisiko atau pernah diperiksa 12 bulan (sisanya dihitung)
  v_full := coalesce(p_full, p_k = 2);
  -- sel 500 m (kolom gx/gy ber-indeks) yang menaungi sel ini, ±1 untuk batas pembulatan
  g0 := fdiv(p_i * p_k, 10) - 1; g1 := fdiv((p_i + 1) * p_k, 10) + 1;
  h0 := fdiv(p_j * p_k, 10) - 1; h1 := fdiv((p_j + 1) * p_k, 10) + 1;
  with d0 as materialized (
         select d.* from dil d
         where d.gx between g0 and g1 and d.gy between h0 and h1 and d.status = 'AKTIF'
           and fdiv(floor(d.lon / 0.0005)::int, p_k) = p_i and fdiv(floor(d.lat / 0.0005)::int, p_k) = p_j),
  gtem as materialized (select distinct d.gardu from pemeriksaan p join dil d on d.idpel = p.idpel
                        where p.gol <> 'Sesuai' and p.tgl > p_to - 180 and d.gardu in (select gardu from d0)),
  a as (select d.idpel, d.nama, d.tarif, d.daya, d.layanan, d.gardu, d.kelurahan, d.kecamatan, d.lat, d.lon, d.alamat,
               x.gol, x.last_periksa,
               case when s.idpel is null or x.baru then null
                    else s.skor0 + case when d.gardu in (select gardu from gtem) then 5 else 0 end end skor
        from d0 d
        left join lateral (select string_agg(distinct q.gol, ',') filter (where q.tgl between p_from and p_to) gol,
                                  max(q.tgl) filter (where q.tgl between p_to - 365 and p_to) last_periksa,
                                  coalesce(bool_or(q.tgl > greatest(p_to, current_date) - 90), false) baru
                           from pemeriksaan q where q.idpel = d.idpel) x on true
        left join skor_dasar s on s.idpel = d.idpel),
  -- semua pemeriksaan pada periode yang lokasinya di sel ini: koordinat pemeriksaan, atau koordinat DIL bila kosong
  pm as (select p.id_p2tl, p.idpel, p.nama, p.gol, p.tgl, p.lat, p.lon, p.regu, trim(p.petugas) petugas, p.kwh_ts, p.tarif, p.daya, p.pemutusan
         from pemeriksaan p
         where p.tgl between p_from and p_to and p.lat is not null
           and p.lon between (p_i * p_k - 1) * 0.0005 and (p_i * p_k + p_k + 1) * 0.0005
           and p.lat between (p_j * p_k - 1) * 0.0005 and (p_j * p_k + p_k + 1) * 0.0005
           and fdiv(floor(p.lon / 0.0005)::int, p_k) = p_i and fdiv(floor(p.lat / 0.0005)::int, p_k) = p_j
         union all
         select p.id_p2tl, p.idpel, coalesce(p.nama, d.nama), p.gol, p.tgl, d.lat, d.lon, p.regu, trim(p.petugas), p.kwh_ts, p.tarif, p.daya, p.pemutusan
         from d0 d join pemeriksaan p on p.idpel = d.idpel
         where p.tgl between p_from and p_to and p.lat is null)
  select json_build_object(
    'k', p_k,
    'gardu', (select coalesce(json_agg(x order by x.n desc), '[]') from (select gardu k, count(*) n from a group by 1 order by 2 desc limit 5) x),
    'tarif', (select coalesce(json_agg(x order by x.n desc), '[]') from (select tarif k, count(*) n from a group by 1 order by 2 desc limit 5) x),
    'risk', (select json_build_object('t', count(*) filter (where skor >= 60), 's', count(*) filter (where skor >= 35 and skor < 60)) from a),
    'full', v_full,
    'n_pop', (select count(*) from a),
    'n_belum12', (select count(*) from a where last_periksa is null),
    'pts', (select coalesce(json_agg(json_build_array(idpel, nama, tarif, daya, layanan, gardu, round(lat::numeric, 6), round(lon::numeric, 6), gol, last_periksa, skor, alamat)), '[]')
            from a where v_full or skor >= 35 or last_periksa is not null or gol is not null),
    'periksa', (select coalesce(json_agg(json_build_array(id_p2tl, idpel, nama, gol, tgl, round(lat::numeric, 6), round(lon::numeric, 6), regu, petugas, kwh_ts, tarif, daya, pemutusan)
                order by (gol = 'Sesuai'), tgl desc), '[]') from (select * from pm order by (gol = 'Sesuai'), tgl desc limit 3000) x),
    'n_periksa', (select count(*) from pm)
  ) into r;
  return r;
end $$;

select f_refresh_dil_sel_internal();

-- Hak eksekusi
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('f_meta','f_ringkasan','f_datasets','f_hapus_data','f_cakupan','f_titik_sesuai','f_grid','f_risiko_titik','f_calon','f_cell2')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
revoke execute on function f_refresh_dil_sel_internal() from public, anon, authenticated;
notify pgrst, 'reload schema';

commit;
