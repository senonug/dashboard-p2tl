-- =====================================================================
--  Dashboard P2TL — pembaruan v1.8b (Peta Kerja)
--
--  Isi:
--   1. dil_sel_h: ringkasan DIL per kotak ±55 m (dasar sel 500 / 250 / 100 m)
--   2. f_grid      : sel peta per ukuran (500/250/100 m) + jumlah "belum pernah diperiksa" + calon TO per sel
--   3. f_cell2     : isi satu sel (pelanggan DIL + SEMUA pemeriksaan pada periode, termasuk Sesuai)
--   4. f_risiko_titik : titik calon TO dalam batas layar peta (dipakai saat diperbesar)
--   5. f_cakupan   : tanpa data sel (pindah ke f_grid); titik Sesuai ditampilkan semua bila periode ≤ 3 bulan
--   6. Perbaikan kecil: label snapshot DIL, angka "baru / tidak ada lagi" di kalender bila bulan diunggah mundur
--
--  Cara pakai: Supabase › SQL Editor › New query › tempel SELURUH isi file › Run.
--  Prasyarat: v1.8a sudah terpasang. Seluruh isi berjalan dalam satu transaksi.
-- =====================================================================
begin;

-- Pembagian bulat ke bawah (benar juga untuk angka negatif, mis. lintang)
create or replace function fdiv(a int, k int) returns int
language sql immutable parallel safe as $$ select floor(a::numeric / k)::int $$;

-- ---------- 1. Ringkasan DIL per kotak 0,0005° (±55 m) ----------
create table if not exists dil_sel_h (
  fx integer, fy integer, kecamatan text, layanan text, n integer, slat double precision, slon double precision
);
create index if not exists dil_sel_h_idx on dil_sel_h (fx, fy);
alter table dil_sel_h enable row level security;  -- tanpa policy: hanya lewat fungsi security definer
revoke all on dil_sel_h from anon;

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
  analyze dil_sel; analyze dil_sel_h;
  return n;
end $$;
select f_refresh_dil_sel_internal();

-- ---------- 2. Sel peta per ukuran ----------
-- p_k = 10 (±500 m), 5 (±250 m), 2 (±100 m); sel (i, j) = kotak 0,0005° dibagi p_k
create or replace function f_grid(p_from date, p_to date, p_regu int default null, p_kec text default null, p_layanan text default null, p_k int default 10)
returns json
language plpgsql stable security definer set search_path = public as $$
declare r json; v_min int;
begin
  perform guard();
  if p_k not in (2, 5, 10) then raise exception 'Ukuran sel tidak dikenal'; end if;
  v_min := case p_k when 10 then 30 when 5 then 10 else 3 end;
  with b as (select * from f_base(p_from, p_to, p_regu, p_kec, p_layanan)),
  bi as (select idpel, bool_or(gol <> 'Sesuai') tm from b group by idpel),
  s as materialized (select fdiv(fx, p_k) i, fdiv(fy, p_k) j, layanan, n, slat, slon from dil_sel_h
                     where (p_kec is null or kecamatan = p_kec) and (p_layanan is null or layanan = p_layanan)),
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
    'k', p_k,
    'data_min', (select min(tgl) from pemeriksaan),
    'cells', (select coalesce(json_agg(json_build_array(i, j, pop, ins, tm, pra, round(lat::numeric, 6), round(lon::numeric, 6), kel, kec, last, gardu, ever, rt, rs)), '[]') from cells),
    'risk', (select coalesce(json_agg(json_build_array(i, j, t, s, round(lat::numeric, 6), round(lon::numeric, 6))), '[]') from crk),
    'zero', (select json_build_object('cells', count(*) filter (where ins = 0), 'pop', coalesce(sum(pop) filter (where ins = 0), 0),
                                      'never_cells', count(*) filter (where ever = 0), 'never_pop', coalesce(sum(pop) filter (where ever = 0), 0),
                                      'never_plg', coalesce(sum(greatest(pop - ever, 0)), 0)) from cells)
  ) into r;
  return r;
end $$;

-- ---------- 3. Isi satu sel ----------
create or replace function f_cell2(p_i int, p_j int, p_k int, p_from date, p_to date) returns json
language plpgsql stable security definer set search_path = public as $$
declare r json; g0 int; g1 int; h0 int; h1 int;
begin
  perform guard();
  if p_k not in (2, 5, 10) then raise exception 'Ukuran sel tidak dikenal'; end if;
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
    'pts', (select coalesce(json_agg(json_build_array(idpel, nama, tarif, daya, layanan, gardu, round(lat::numeric, 6), round(lon::numeric, 6), gol, last_periksa, skor, alamat)), '[]') from a),
    'periksa', (select coalesce(json_agg(json_build_array(id_p2tl, idpel, nama, gol, tgl, round(lat::numeric, 6), round(lon::numeric, 6), regu, petugas, kwh_ts, tarif, daya, pemutusan)
                order by (gol = 'Sesuai'), tgl desc), '[]') from (select * from pm order by (gol = 'Sesuai'), tgl desc limit 3000) x),
    'n_periksa', (select count(*) from pm)
  ) into r;
  return r;
end $$;

-- ---------- 4. Titik calon TO dalam batas layar ----------
create or replace function f_risiko_titik(p_from date, p_to date, p_kec text, p_layanan text,
                                          p_s double precision, p_w double precision, p_n double precision, p_e double precision, p_limit int default 4000)
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
    'pts', (select coalesce(json_agg(json_build_array(round(lat::numeric, 6), round(lon::numeric, 6), idpel, nama, skor, kat, tarif, daya, layanan, gardu, alamat)), '[]') from (
        select * from rk order by skor desc, daya desc nulls last limit greatest(1, least(p_limit, 6000))) x)
  ) into r;
  return r;
end $$;

-- ---------- 5. f_cakupan: KPI, tabel kecamatan/kelurahan, titik pemeriksaan ----------
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
    'points', (select coalesce(json_agg(json_build_array(round(lat::numeric, 6), round(lon::numeric, 6), gol, idpel, nama, rupiah_ts, tgl)), '[]') from (
       select * from bl where gol <> 'Sesuai' and lat is not null
       union all
       (select * from bl where gol = 'Sesuai' and lat is not null order by md5(id_p2tl) limit case when v_all then null else 4000 end)) x)
  ) into r;
  return r;
end $$;

-- ---------- 6a. Label snapshot DIL = snapshot terbanyak (bukan urutan abjad) ----------
create or replace function f_datasets() returns json
language plpgsql stable security definer set search_path = public as $$
declare r json;
begin
  perform guard();
  select json_build_object(
    'pemeriksaan', json_build_object('n', (select count(*) from pemeriksaan), 'min', (select min(tgl) from pemeriksaan), 'max', (select max(tgl) from pemeriksaan)),
    'paska', (select coalesce(json_agg(x order by x.blth), '[]') from (select blth, n, status, file, oleh, waktu, n_baru, n_hilang from bulan_data where dataset = 'paska') x),
    'pra', (select coalesce(json_agg(x order by x.blth), '[]') from (select blth, n, status, file, oleh, waktu, n_baru, n_hilang from bulan_data where dataset = 'pra') x),
    'dil', json_build_object('n', (select count(*) from dil), 'aktif', (select count(*) from dil where status = 'AKTIF'),
                             'snapshot', (select snapshot from dil where snapshot is not null group by 1 order by count(*) desc limit 1),
                             'masking', (select count(*) from dil where position('*' in coalesce(nama, '')) > 0)),
    'ts', json_build_object('n', (select count(*) from ts_bayar), 'min', (select min(tgl_register) from ts_bayar), 'max', (select max(tgl_register) from ts_bayar)),
    'months', json_build_object(
       'pemeriksaan', (select coalesce(json_agg(x order by x.blth), '[]') from (select blth_of(tgl) blth, count(*) n from pemeriksaan where tgl is not null group by 1) x),
       'ts', (select coalesce(json_agg(x order by x.blth), '[]') from (select blth_of(tgl_register) blth, count(*) n from ts_bayar where tgl_register is not null group by 1) x)),
    'log', (select coalesce(json_agg(x order by x.created_at desc), '[]') from (select * from upload_log order by created_at desc limit 30) x),
    'db_size', pg_database_size(current_database())
  ) into r;
  return r;
end $$;

-- ---------- 6b. "Baru / tidak ada lagi" dihitung juga untuk bulan sesudahnya ----------
-- (agar tetap terisi bila bulan diunggah dari yang terbaru ke yang lama)
create or replace function f_banding_bulan(p_dataset text, p_blth int) returns void
language plpgsql volatile security definer set search_path = public as $$
declare v_tbl text; v_y int; v_bit int; v_pb int; v_py int; v_pbit int; nb int; nh int;
begin
  if p_dataset = 'paska' then v_tbl := 'pakai_paska_th'; elsif p_dataset = 'pra' then v_tbl := 'pakai_pra_th'; else return; end if;
  if not exists (select 1 from bulan_data where dataset = p_dataset and blth = p_blth and status = 'ok') then return; end if;
  v_pb := blth_add(p_blth, -1);
  if not exists (select 1 from bulan_data where dataset = p_dataset and blth = v_pb and status = 'ok') then return; end if;
  v_y := p_blth / 100; v_bit := 1 << (p_blth % 100 - 1);
  v_py := v_pb / 100; v_pbit := 1 << (v_pb % 100 - 1);
  execute format('select count(*) filter (where p.idpel is null), count(*) filter (where c.idpel is null)
                  from (select idpel from %1$I where tahun = $1 and ada & $2 <> 0) c
                  full join (select idpel from %1$I where tahun = $3 and ada & $4 <> 0) p on p.idpel = c.idpel', v_tbl)
    into nb, nh using v_y, v_bit, v_py, v_pbit;
  update bulan_data set n_baru = nb, n_hilang = nh where dataset = p_dataset and blth = p_blth;
end $$;

create or replace function f_selesai_bulan(p_dataset text, p_job text, p_blth int, p_file text default null)
returns json
language plpgsql volatile security definer set search_path = public set statement_timeout = '120s' as $$
declare v_tbl text; v_y int; v_bit int; v_pb int; n int; r bulan_data;
begin
  if not can_upload() then raise exception 'Akses ditolak: hanya pengunggah'; end if;
  if p_dataset = 'paska' then v_tbl := 'pakai_paska_th'; elsif p_dataset = 'pra' then v_tbl := 'pakai_pra_th'; else raise exception 'dataset tidak dikenal'; end if;
  v_y := p_blth / 100; v_bit := 1 << (p_blth % 100 - 1);
  v_pb := blth_add(p_blth, -1);
  execute format('select count(*) from %I where tahun = $1 and ada & $2 <> 0', v_tbl) into n using v_y, v_bit;
  insert into bulan_data (dataset, blth, n, status, file, oleh, waktu, n_baru, n_hilang)
  values (p_dataset, p_blth, n, 'ok', p_file, me_email(), now(), null, null)
  on conflict (dataset, blth) do update set n = excluded.n, status = 'ok', file = excluded.file, oleh = excluded.oleh,
    waktu = excluded.waktu, n_baru = null, n_hilang = null;
  perform f_banding_bulan(p_dataset, p_blth);
  perform f_banding_bulan(p_dataset, blth_add(p_blth, 1));
  if p_dataset = 'paska' then
    delete from stg_paska where (job = p_job and blth = p_blth) or t < now() - interval '1 day';
  else
    delete from stg_pra where (job = p_job and blth = p_blth) or t < now() - interval '1 day';
  end if;
  -- penampung kosong: kembalikan ruangnya (hanya bila tidak ada unggahan lain yang sedang berjalan)
  begin
    if p_dataset = 'paska' then
      lock table stg_paska in access exclusive mode nowait;
      if not exists (select 1 from stg_paska) then truncate stg_paska; end if;
    else
      lock table stg_pra in access exclusive mode nowait;
      if not exists (select 1 from stg_pra) then truncate stg_pra; end if;
    end if;
  exception when lock_not_available then null;
  end;
  select * into r from bulan_data where dataset = p_dataset and blth = p_blth;
  return json_build_object('n', n, 'n_baru', r.n_baru, 'n_hilang', r.n_hilang,
    'n_prev', (select b.n from bulan_data b where b.dataset = p_dataset and b.blth = v_pb and b.status = 'ok'));
end $$;

-- isi ulang angka pembanding untuk semua bulan yang sudah ada
do $$
declare x record;
begin
  for x in select dataset, blth from bulan_data where status = 'ok' loop
    perform f_banding_bulan(x.dataset, x.blth);
  end loop;
end $$;

-- ---------- Hak eksekusi ----------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('f_grid','f_cell2','f_risiko_titik','f_cakupan','f_datasets','f_selesai_bulan')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
revoke execute on function f_banding_bulan(text, int) from public, anon, authenticated;
revoke execute on function f_refresh_dil_sel_internal() from public, anon, authenticated;
notify pgrst, 'reload schema';

commit;
