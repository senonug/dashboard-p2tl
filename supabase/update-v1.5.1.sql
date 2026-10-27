-- =====================================================================
-- Dashboard P2TL · update v1.5.1 (Peta Kerja lebih cepat)
-- Jalankan SEKALI di Supabase → SQL Editor (aman dijalankan ulang).
-- Isi:
--  1. Tabel ringkasan dil_sel (DIL per sel/kecamatan/kelurahan/layanan/gardu) + pengisinya
--  2. Indeks pemeriksaan (idpel, tgl) untuk tanggal pemeriksaan terakhir per sel
--  3. f_cakupan baru: memakai dil_sel (±6,4 detik → perkiraan <0,5 detik), menambah
--     tanggal disisir terakhir & gardu dominan per sel, dan titik temuan tanpa
--     koordinat (data Agu–Sep 2026) memakai koordinat DIL pelanggan
--  4. f_meta: daftar kecamatan dari dil_sel
--  5. f_after_upload('dil') mengisi ulang dil_sel; f_hapus_data('dil') mengosongkannya
-- Hasil KPI & sel sudah dicek identik dengan versi lama (Sep 2026, dan Jan–Sep Jagakarsa prabayar).
-- =====================================================================
-- ---------- v1.5.1: ringkasan DIL per sel (mempercepat f_cakupan & f_meta) ----------
create table if not exists dil_sel (
  gx integer, gy integer, inbox boolean, kecamatan text, kelurahan text, layanan text, gardu text,
  n integer, slat double precision, slon double precision
);
create index if not exists dil_sel_cell_idx on dil_sel (gx, gy);
-- tanggal pemeriksaan terakhir per pelanggan (index-only scan)
create index if not exists pemeriksaan_idpel_tgl_idx on pemeriksaan (idpel, tgl);
alter table dil_sel enable row level security;  -- tanpa policy: hanya dibaca lewat fungsi security definer

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
  analyze dil_sel;
  return n;
end $$;
revoke execute on function f_refresh_dil_sel_internal() from public, anon, authenticated;

create or replace function f_after_upload(p_dataset text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not can_upload() then raise exception 'Akses ditolak: hanya pengunggah'; end if;
  if p_dataset = 'pemeriksaan' then analyze pemeriksaan;
  elsif p_dataset = 'dil' then analyze dil; perform f_refresh_dil_sel_internal();
  elsif p_dataset = 'paska' then analyze pakai_paska;
  elsif p_dataset = 'pra' then analyze pakai_pra;
  elsif p_dataset = 'ts' then analyze ts_bayar; end if;
end $$;

create or replace function f_hapus_data(p_dataset text, p_blth int default null) returns integer
language plpgsql volatile security definer set search_path = public as $$
declare n int := 0;
begin
  if not is_admin() then raise exception 'Akses ditolak: hanya admin'; end if;
  if p_dataset = 'pemeriksaan' then delete from pemeriksaan where blth_of(tgl) = p_blth; get diagnostics n = row_count;
  elsif p_dataset = 'paska' then delete from pakai_paska where blth = p_blth; get diagnostics n = row_count;
  elsif p_dataset = 'pra' then delete from pakai_pra where blth = p_blth; get diagnostics n = row_count;
  elsif p_dataset = 'ts' then delete from ts_bayar where blth_of(tgl_register) = p_blth; get diagnostics n = row_count;
  elsif p_dataset = 'dil' then delete from dil where true; get diagnostics n = row_count; delete from skor_dasar where true; delete from dil_sel where true;
  else raise exception 'dataset tidak dikenal'; end if;
  insert into upload_log (dataset, filename, periode, n_rows, info, uploaded_by)
  values (p_dataset, '(dihapus)', coalesce(p_blth::text, 'semua'), -n, '{"hapus": true}', me_email());
  return n;
end $$;

-- Cakupan & peta: populasi dari dil_sel (ringkasan), pemeriksaan digabung per pelanggan.
-- cells: [gx, gy, pop, ins, tm, pra, lat, lon, kel, kec, terakhir_diperiksa (s.d. p_to, kapan pun), gardu_dominan]
create or replace function f_cakupan(p_from date, p_to date, p_regu int default null, p_kec text default null, p_layanan text default null)
returns json
language plpgsql stable security definer set search_path = public as $$
declare r json;
begin
  perform guard();
  with b as (select * from f_base(p_from, p_to, p_regu, p_kec, p_layanan)),
  bi as (select idpel, bool_or(gol <> 'Sesuai') tm from b group by idpel),
  bl as (select b.id_p2tl, b.gol, b.idpel, b.nama, b.rupiah_ts, coalesce(b.lat, d.lat) lat, coalesce(b.lon, d.lon) lon
         from b left join dil d on d.idpel = b.idpel and b.lat is null),
  ia as materialized (select d.gx, d.gy, d.gardu, d.kecamatan, d.kelurahan, bi.tm from bi join dil d on d.idpel = bi.idpel
         where d.status = 'AKTIF' and (p_kec is null or d.kecamatan = p_kec) and (p_layanan is null or d.layanan = p_layanan)
           and d.lat between -6.6 and -6.1 and d.lon between 106.6 and 107.0),
  s as materialized (select * from dil_sel where inbox and (p_kec is null or kecamatan = p_kec) and (p_layanan is null or layanan = p_layanan)),
  cp as (select gx, gy, sum(n) pop, coalesce(sum(n) filter (where layanan = 'PRABAYAR'), 0) pra, sum(slat) / sum(n) lat, sum(slon) / sum(n) lon
         from s group by gx, gy having sum(n) >= 30),
  ckel as (select distinct on (gx, gy) gx, gy, kelurahan kel, kecamatan kec from (
           select gx, gy, kelurahan, kecamatan, sum(n) n from s where kelurahan is not null group by 1, 2, 3, 4) z order by gx, gy, n desc, kelurahan),
  cgar as (select distinct on (gx, gy) gx, gy, gardu from (
           select gx, gy, gardu, sum(n) n from s where gardu is not null group by 1, 2, 3) z order by gx, gy, n desc, gardu),
  cins as (select gx, gy, count(*) ins, count(*) filter (where tm) tm from ia group by 1, 2),
  clast as (select d.gx, d.gy, max(p.tgl) last from (select idpel, max(tgl) tgl from pemeriksaan where tgl <= p_to group by idpel) p join dil d on d.idpel = p.idpel
            where d.status = 'AKTIF' and (p_kec is null or d.kecamatan = p_kec) and (p_layanan is null or d.layanan = p_layanan) group by 1, 2),
  cells as materialized (select cp.gx, cp.gy, cp.pop, coalesce(ci.ins, 0) ins, coalesce(ci.tm, 0) tm, cp.pra, cp.lat, cp.lon, ck.kel, ck.kec, cl.last, cg.gardu
            from cp left join cins ci using (gx, gy) left join ckel ck using (gx, gy) left join cgar cg using (gx, gy) left join clast cl using (gx, gy))
  select json_build_object(
    'kpi', json_build_object(
       'aktif', (select coalesce(sum(n), 0) from s), 'pra', (select coalesce(sum(n), 0) from s where layanan = 'PRABAYAR'),
       'uniq', (select count(*) from bi), 'uniq_dil', (select count(*) from ia),
       'gardu_total', (select count(distinct gardu) from s), 'gardu_ins', (select count(distinct gardu) from ia),
       'cells', (select count(*) from cells), 'cells_zero', (select count(*) from cells where ins = 0),
       'pop_zero', (select coalesce(sum(pop), 0) from cells where ins = 0)),
    'cells', (select coalesce(json_agg(json_build_array(gx, gy, pop, ins, tm, pra, round(lat::numeric, 6), round(lon::numeric, 6), kel, kec, last, gardu)), '[]') from cells),
    'kec', (select coalesce(json_agg(x order by x.pop desc), '[]') from (
       select p.k, p.pop, coalesce(i.ins, 0) ins, coalesce(i.tm, 0) tm
       from (select kecamatan k, sum(n) pop from s group by 1 having sum(n) > 500) p
       left join (select kecamatan k, count(*) ins, count(*) filter (where tm) tm from ia group by 1) i on i.k is not distinct from p.k) x),
    'kel', (select coalesce(json_agg(x order by x.tm desc, x.ins desc), '[]') from (
       select p.k, p.kec, p.pop, coalesce(i.ins, 0) ins, coalesce(i.tm, 0) tm
       from (select kelurahan k, kecamatan kec, sum(n) pop from s group by 1, 2 having sum(n) > 300) p
       left join (select kelurahan k, kecamatan kec, count(*) ins, count(*) filter (where tm) tm from ia group by 1, 2) i
         on i.k is not distinct from p.k and i.kec is not distinct from p.kec) x),
    -- koordinat pemeriksaan; bila kosong (mis. data Agu–Sep 2026) memakai koordinat DIL pelanggan
    'points', (select coalesce(json_agg(json_build_array(round(lat::numeric, 6), round(lon::numeric, 6), gol, idpel, nama, rupiah_ts)), '[]') from (
       select * from bl where gol <> 'Sesuai' and lat is not null
       union all
       (select * from bl where gol = 'Sesuai' and lat is not null order by md5(id_p2tl) limit 2500)) x)
  ) into r;
  return r;
end $$;

-- f_meta: daftar kecamatan dari ringkasan
create or replace function f_meta() returns json
language plpgsql stable security definer set search_path = public as $$
declare r json;
begin
  perform guard();
  select json_build_object(
    'me', my_role(),
    'periksa_min', (select min(tgl) from pemeriksaan),
    'periksa_max', (select max(tgl) from pemeriksaan),
    'n_periksa', (select count(*) from pemeriksaan),
    'regu', (select coalesce(json_agg(rg order by rg), '[]') from (select distinct regu rg from pemeriksaan where regu is not null) x),
    'kecamatan', (select coalesce(json_agg(k order by n desc), '[]') from (select kecamatan k, sum(n) n from dil_sel where kecamatan is not null group by 1 having sum(n) > 500) x),
    'dil_n', (select count(*) from dil),
    'dil_snapshot', (select max(snapshot) from dil),
    'paska_blth', (select coalesce(json_agg(b order by b), '[]') from (select distinct blth b from pakai_paska) x),
    'pra_blth', (select coalesce(json_agg(b order by b), '[]') from (select distinct blth b from pakai_pra) x),
    'ts_min', (select min(tgl_register) from ts_bayar),
    'ts_max', (select max(tgl_register) from ts_bayar),
    'ts_n', (select count(*) from ts_bayar),
    'last_upload', (select max(created_at) from upload_log)
  ) into r;
  return r;
end $$;

select f_refresh_dil_sel_internal();
notify pgrst, 'reload schema';
