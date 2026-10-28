-- =====================================================================
--  Dashboard P2TL UP3 Lenteng Agung — skema database Supabase
--  Jalankan SELURUH file ini sekali di Supabase › SQL Editor › New query.
--  Aman dijalankan ulang (idempotent) untuk memperbarui fungsi.
-- =====================================================================

-- ---------- 1. Pengguna & hak akses ----------------------------------
create table if not exists app_user (
  email      text primary key,
  nama       text,
  role       text not null default 'viewer' check (role in ('viewer','uploader','admin')),
  created_at timestamptz default now()
);

create or replace function me_email() returns text
language sql stable set search_path = public as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_user where lower(email) = me_email())
$$;

create or replace function can_upload() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_user where lower(email) = me_email() and role in ('uploader','admin'))
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_user where lower(email) = me_email() and role = 'admin')
$$;

create or replace function my_role() returns json
language sql stable security definer set search_path = public as $$
  select coalesce((select json_build_object('email', email, 'nama', nama, 'role', role)
                   from app_user where lower(email) = me_email()), json_build_object('email', me_email(), 'role', null))
$$;

-- ---------- 2. Tabel data --------------------------------------------
create table if not exists pemeriksaan (
  id_p2tl        text primary key,
  idpel          text,
  nama           text,
  tarif          text,
  daya           integer,
  gardu          text,
  lat            double precision,
  lon            double precision,
  sesuai_merk    text,
  merk_meter     text,
  update_status  text,
  gol            text,          -- 'Sesuai' | P1..P4 | K1..K2
  peruntukan     text,
  catatan        text,
  pemutusan      text,
  kwh_ts         numeric default 0,
  rupiah_ts      numeric default 0,
  rupiah_kwh     numeric default 0,
  waktu_periksa  timestamp,
  tgl            date,
  regu           integer,
  petugas        text,
  sumber         text,
  dlpd           text,
  jenislayanan   text,
  status_kwh     text,
  ganti_material text,
  durasi         integer,
  ts_ap2t        text,
  no_agenda      text,
  tgl_sph        date,
  tindaklanjut   text,
  nomor_meter    text,
  tahun_meter    integer,
  uploaded_at    timestamptz default now()
);
-- Nilai TS tidak wajar: kWh > 20.000 jam x kVA, atau Rp > Rp60.000 per VA (indikasi salah input/format di sumber)
alter table pemeriksaan drop column if exists ts_wajar, drop column if exists kwh_ts_ok, drop column if exists rp_ts_ok;
alter table pemeriksaan add column ts_wajar boolean generated always as (
  coalesce(kwh_ts, 0) <= 20000 * greatest(coalesce(daya, 450), 450)::numeric / 1000
  and coalesce(rupiah_ts, 0) <= 60000 * greatest(coalesce(daya, 450), 450)::numeric) stored;
alter table pemeriksaan add column kwh_ts_ok numeric generated always as (case when
  coalesce(kwh_ts, 0) <= 20000 * greatest(coalesce(daya, 450), 450)::numeric / 1000
  and coalesce(rupiah_ts, 0) <= 60000 * greatest(coalesce(daya, 450), 450)::numeric then kwh_ts else 0 end) stored;
alter table pemeriksaan add column rp_ts_ok numeric generated always as (case when
  coalesce(kwh_ts, 0) <= 20000 * greatest(coalesce(daya, 450), 450)::numeric / 1000
  and coalesce(rupiah_ts, 0) <= 60000 * greatest(coalesce(daya, 450), 450)::numeric then rupiah_ts else 0 end) stored;
create index if not exists pemeriksaan_tgl_idx on pemeriksaan (tgl);
create index if not exists pemeriksaan_idpel_idx on pemeriksaan (idpel);
create index if not exists pemeriksaan_agenda_idx on pemeriksaan (no_agenda);

create table if not exists dil (
  idpel       text primary key,
  nama        text,
  alamat      text,
  tarif       text,
  daya        integer,
  layanan     text,        -- PRABAYAR | PASKABAYAR
  pembmeter   text,        -- PRABAYAR | MEKANIK/MANUAL | AMR | ...
  status      text,        -- AKTIF | BONGKAR | HAPUS
  gardu       text,
  kecamatan   text,
  kelurahan   text,
  merk        text,
  tahun_tera  integer,
  lat         double precision,
  lon         double precision,
  keperluan   text,
  tgl_nyala   date,
  snapshot    text,
  gx          integer generated always as (floor(lon / 0.005)::int) stored,
  gy          integer generated always as (floor(lat / 0.005)::int) stored,
  uploaded_at timestamptz default now()
);
create index if not exists dil_cell_idx on dil (gx, gy);
create index if not exists dil_kec_idx on dil (kecamatan);

create table if not exists pakai_paska (
  idpel     text not null,
  blth      integer not null,   -- yyyymm (BLTH rekening)
  tarif     text,
  daya      integer,
  kwh       numeric,
  jam_nyala numeric,
  kdbaca    text,
  tgl_baca  date,
  primary key (idpel, blth)
);
create index if not exists pakai_paska_blth_idx on pakai_paska (blth);

create table if not exists pakai_pra (
  idpel  text not null,
  blth   integer not null,      -- yyyymm bulan pembelian token
  daya   integer,
  kwh    numeric,
  n_beli integer,
  rp     numeric,
  primary key (idpel, blth)
);
create index if not exists pakai_pra_blth_idx on pakai_pra (blth);

create table if not exists ts_bayar (
  no_agenda    text primary key,
  idpel        text,
  nama         text,
  golongan     text,
  alamat       text,
  tarif        text,
  daya         integer,
  kwh          numeric,
  rp_kwh       numeric,
  rp_beban     numeric,
  rp_ts        numeric,
  rp_materai   numeric,
  rp_material  numeric,
  total_p2tl   numeric,
  tunai        numeric,
  angsur       numeric,
  rp_ppj       numeric,
  rp_ppn       numeric,
  rp_ujl       numeric,
  tgl_register date,
  no_sph       text,
  tgl_sph      date
);
-- Satu No. Agenda bisa punya beberapa baris pembayaran (mis. P4: uang muka NONPELANGGAN + angsuran IDPEL baru),
-- jadi kunci tabel adalah id baris, bukan No. Agenda.
alter table ts_bayar add column if not exists id bigserial;
do $$ begin
  if exists (select 1 from pg_constraint where conrelid = 'ts_bayar'::regclass and contype = 'p'
             and pg_get_constraintdef(oid) like '%no_agenda%') then
    alter table ts_bayar drop constraint ts_bayar_pkey;
    alter table ts_bayar add primary key (id);
  end if;
end $$;
alter table ts_bayar alter column no_agenda drop not null;
create index if not exists ts_bayar_agenda_idx on ts_bayar (no_agenda);
-- Golongan untuk dashboard: P1–P4/K1–K2 apa adanya; golongan lain (mis. "KWH") digabung ke K2;
-- DKRP dan UPDATEANGSURAN tidak ditampilkan (null)
alter table ts_bayar add column if not exists gol_ts text generated always as (
  case when golongan in ('P1','P2','P3','P4','K1','K2') then golongan
       when golongan in ('DKRP','UPDATEANGSURAN') then null
       else 'K2' end) stored;
create index if not exists ts_bayar_tgl_idx on ts_bayar (tgl_register);
create index if not exists ts_bayar_idpel_idx on ts_bayar (idpel);

create table if not exists upload_log (
  id          bigserial primary key,
  dataset     text not null,
  filename    text,
  periode     text,
  n_rows      integer,
  info        jsonb,
  uploaded_by text default me_email(),
  created_at  timestamptz default now()
);

-- ---------- 3. Row Level Security ------------------------------------
do $$
declare t text;
begin
  foreach t in array array['pemeriksaan','dil','pakai_paska','pakai_pra','ts_bayar','upload_log'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format('create policy %I on %I for select to authenticated using (is_member())', t || '_read', t);
    execute format('create policy %I on %I for all to authenticated using (can_upload()) with check (can_upload())', t || '_write', t);
  end loop;
end $$;
alter table app_user enable row level security;
drop policy if exists app_user_read on app_user;
drop policy if exists app_user_admin on app_user;
create policy app_user_read on app_user for select to authenticated using (is_member());
create policy app_user_admin on app_user for all to authenticated using (is_admin()) with check (is_admin());

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on all tables in schema public from anon;

-- ---------- 4. Fungsi bantu ------------------------------------------
create or replace function blth_of(d date) returns integer
language sql immutable set search_path = public as $$ select (extract(year from d) * 100 + extract(month from d))::int $$;

create or replace function blth_add(b integer, n integer) returns integer
language sql immutable set search_path = public as $$
  select blth_of((make_date(b / 100, b % 100, 1) + make_interval(months => n))::date)
$$;

create or replace function guard() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_member() then raise exception 'Akses ditolak: akun belum terdaftar di dashboard'; end if;
end $$;

-- Pemeriksaan pada rentang + filter umum (dipakai semua halaman)
create or replace function f_base(p_from date, p_to date, p_regu int, p_kec text, p_layanan text)
returns setof pemeriksaan
language sql stable security definer set search_path = public as $$
  select p.* from pemeriksaan p
  left join dil d on d.idpel = p.idpel
  where p.tgl between p_from and p_to
    and (p_regu is null or p.regu = p_regu)
    and (p_kec is null or d.kecamatan = p_kec)
    and (p_layanan is null or p.jenislayanan = p_layanan)
$$;

-- ---------- 5. Meta ---------------------------------------------------
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

-- ---------- 6. Ringkasan & Temuan ------------------------------------
create or replace function f_ringkasan(p_from date, p_to date, p_regu int default null, p_kec text default null, p_layanan text default null,
                                      p_cmp_from date default null, p_cmp_to date default null)
returns json
language plpgsql stable security definer set search_path = public as $$
declare r json;
begin
  perform guard();
  with b as (select * from f_base(p_from, p_to, p_regu, p_kec, p_layanan)),
  c as (select * from f_base(coalesce(p_cmp_from, '1900-01-01'), coalesce(p_cmp_to, '1900-01-01'), p_regu, p_kec, p_layanan)),
  aktif as (select count(*) n from dil where status = 'AKTIF' and (p_kec is null or kecamatan = p_kec)
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

-- ---------- 7. Kinerja -----------------------------------------------
create or replace function f_kinerja(p_from date, p_to date, p_regu int default null, p_kec text default null, p_layanan text default null)
returns json
language plpgsql stable security definer set search_path = public as $$
declare r json;
begin
  perform guard();
  with b as (select * from f_base(p_from, p_to, p_regu, p_kec, p_layanan))
  select json_build_object(
    'petugas', (select coalesce(json_agg(x order by x.rp desc), '[]') from (
       select trim(petugas) nama, mode() within group (order by regu) regu, count(*) n,
              count(*) filter (where gol <> 'Sesuai') t, coalesce(sum(rp_ts_ok), 0) rp, coalesce(sum(kwh_ts_ok), 0) kwh,
              percentile_cont(0.5) within group (order by greatest(durasi, 0)) dur, count(distinct tgl) hari
       from b group by trim(petugas)) x),
    'regu', (select coalesce(json_agg(x order by x.rp desc), '[]') from (
       select regu, count(*) n, count(*) filter (where gol <> 'Sesuai') t, coalesce(sum(rp_ts_ok), 0) rp,
              count(distinct trim(petugas)) p, count(distinct tgl) hari
       from b group by regu) x),
    'regu_gol', (select coalesce(json_agg(x), '[]') from (
       select regu, gol, count(*) n from b where gol <> 'Sesuai' group by 1, 2) x)
  ) into r;
  return r;
end $$;

-- Ringkasan DIL per sel (v1.5.1): diisi ulang oleh f_after_upload('dil')
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

-- ---------- 8. Cakupan & peta ----------------------------------------
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

-- Detail satu sel grid: + skor risiko per pelanggan (null bila tidak berisiko / sudah diperiksa 90 hari)
create or replace function f_cell(p_gx int, p_gy int, p_from date, p_to date) returns json
language plpgsql stable security definer set search_path = public as $$
declare r json;
begin
  perform guard();
  with ins as (select idpel, max(tgl) tgl, string_agg(distinct gol, ',') gol from pemeriksaan where tgl between p_from and p_to group by idpel),
  last3 as (select idpel, max(tgl) tgl from pemeriksaan where tgl >= p_to - 365 group by idpel),
  gtem as (select distinct d.gardu from pemeriksaan p join dil d on d.idpel = p.idpel where p.gol <> 'Sesuai' and p.tgl > p_to - 180 and d.gardu is not null),
  a as (select d.idpel, d.nama, d.tarif, d.daya, d.layanan, d.gardu, d.kelurahan, d.kecamatan, d.merk, d.tahun_tera, d.lat, d.lon, d.alamat,
               ins.gol, l.tgl last_periksa,
               case when s.idpel is null or exists (select 1 from pemeriksaan h where h.idpel = d.idpel and h.tgl > greatest(p_to, current_date) - 90) then null
                    else s.skor0 + case when exists (select 1 from gtem g where g.gardu = d.gardu) then 5 else 0 end end skor
        from dil d left join ins on ins.idpel = d.idpel left join last3 l on l.idpel = d.idpel left join skor_dasar s on s.idpel = d.idpel
        where d.gx = p_gx and d.gy = p_gy and d.status = 'AKTIF')
  select json_build_object(
    'gardu', (select coalesce(json_agg(x order by x.n desc), '[]') from (select gardu k, count(*) n from a group by 1 order by 2 desc limit 5) x),
    'tarif', (select coalesce(json_agg(x order by x.n desc), '[]') from (select tarif k, count(*) n from a group by 1 order by 2 desc limit 5) x),
    'risk', (select json_build_object('t', count(*) filter (where skor >= 60), 's', count(*) filter (where skor >= 35 and skor < 60)) from a),
    'blth', (select max(blth) from skor_dasar),
    'pts', (select coalesce(json_agg(json_build_array(idpel, nama, tarif, daya, layanan, gardu, round(lat::numeric, 6), round(lon::numeric, 6), gol, last_periksa, skor, alamat)), '[]') from a)
  ) into r;
  return r;
end $$;

-- ---------- 9. Risiko & calon TO -------------------------------------
-- Skor dasar disimpan per bulan pemakaian terbaru (dihitung ulang saat unggah DPM/OLAP/DIL)
create table if not exists skor_dasar (
  idpel text primary key, blth integer, nama text, tarif text, daya integer, layanan text, gardu text, kelurahan text, kecamatan text,
  merk text, tahun_tera integer, lat double precision, lon double precision, jn numeric, kwh numeric, kd text, beli boolean, prev_k numeric, skor0 integer
);
alter table skor_dasar enable row level security;
drop policy if exists skor_dasar_read on skor_dasar;
create policy skor_dasar_read on skor_dasar for select to authenticated using (is_member());

create or replace function f_refresh_skor() returns integer
language plpgsql volatile security definer set search_path = public as $$
begin
  if not can_upload() then raise exception 'Akses ditolak: hanya pengunggah'; end if;
  return f_refresh_skor_internal();
end $$;

create or replace function f_refresh_skor_internal() returns integer
language plpgsql volatile security definer
set search_path = public set work_mem = '32MB' set enable_mergejoin = off set max_parallel_workers_per_gather = 0
as $$
declare v_blth int; v_has_pra boolean; n int; b1 int; b2 int; b3 int;
begin
  v_blth := greatest((select max(blth) from pakai_paska), (select max(blth) from pakai_pra));
  truncate skor_dasar;
  if v_blth is null then return 0; end if;
  b1 := blth_add(v_blth, -1); b2 := blth_add(v_blth, -2); b3 := blth_add(v_blth, -3);
  v_has_pra := exists (select 1 from pakai_pra where blth = v_blth);
  insert into skor_dasar (idpel, blth, layanan, jn, kwh, kd, beli, prev_k, skor0)
  with pv_pas as materialized (select idpel, avg(kwh) k from pakai_paska where blth in (b1, b2, b3) group by idpel),
  pv_pra as materialized (select idpel, avg(kwh) k from pakai_pra where blth in (b1, b2, b3) group by idpel),
  m as (select d.idpel, d.daya, d.layanan, d.tahun_tera,
               case when d.layanan = 'PRABAYAR' then coalesce(pr.kwh, 0) / nullif(d.daya / 1000.0, 0) else ps.jam_nyala end jn,
               case when d.layanan = 'PRABAYAR' then coalesce(pr.kwh, 0) else ps.kwh end kwh,
               ps.kdbaca kd, pr.idpel is not null beli,
               case when d.layanan = 'PRABAYAR' then vr.k else vp.k end prev_k
        from dil d
        left join pakai_paska ps on d.layanan <> 'PRABAYAR' and ps.idpel = d.idpel and ps.blth = v_blth
        left join pakai_pra pr on d.layanan = 'PRABAYAR' and pr.idpel = d.idpel and pr.blth = v_blth
        left join pv_pas vp on d.layanan <> 'PRABAYAR' and vp.idpel = d.idpel
        left join pv_pra vr on d.layanan = 'PRABAYAR' and vr.idpel = d.idpel
        where d.status = 'AKTIF'),
  sc as (select m.*,
               (case when jn is not null and jn < 40 and (layanan <> 'PRABAYAR' or beli) then 35 else 0 end)
             + (case when layanan = 'PRABAYAR' and v_has_pra and not beli then 20 else 0 end)
             + (case when kd in ('KWH METER MACET','MCB PERLU DIPERIKSA','KWH METER TIDAK ADA','KWH METER TINGGI','KWH METER DIDALAM BANGUNAN') then 15 else 0 end)
             + (case when tahun_tera is not null and tahun_tera <= 2012 then 10 else 0 end)
             + (case when prev_k > 0 and kwh is not null and kwh < 0.5 * prev_k then 15 else 0 end)
             + (case when daya >= 2200 and jn is not null and jn < 40 then 10 else 0 end) skor0
        from m)
  select idpel, v_blth, layanan, round(jn, 1), round(kwh, 1), kd, beli, round(prev_k, 1), skor0
  from sc where skor0 > 0;
  get diagnostics n = row_count;
  analyze skor_dasar;
  return n;
end $$;

-- Hitung ulang skor sebagai panggilan tersendiri (dipanggil aplikasi setelah unggah/hapus DIL, DPM, OLAP)
create or replace function f_hitung_skor() returns integer
language plpgsql volatile security definer set search_path = public as $$
begin
  if not can_upload() then raise exception 'Akses ditolak: hanya pengunggah'; end if;
  return f_refresh_skor_internal();
end $$;

create or replace function f_risiko(p_from date, p_to date, p_regu int default null, p_kec text default null, p_layanan text default null,
                                   p_kategori text default null, p_limit int default 200)
returns json
language plpgsql stable security definer set search_path = public as $$
declare r json; v_blth int; v_has_pra boolean; v_has_pas boolean; v_n_aktif int;
begin
  perform guard();
  v_blth := (select max(blth) from skor_dasar);
  if v_blth is null then
    return json_build_object('blth', null);
  end if;
  v_has_pra := exists (select 1 from pakai_pra where blth = v_blth);
  v_has_pas := exists (select 1 from pakai_paska where blth = v_blth);
  with b as (select * from f_base(p_from, p_to, p_regu, p_kec, p_layanan)),
  bj as (select b.*, case when b.jenislayanan = 'PRABAYAR' then coalesce(pr.kwh, 0) / nullif(b.daya / 1000.0, 0) else ps.jam_nyala end jn,
                (ps.idpel is not null or pr.idpel is not null) has_u
         from b left join pakai_paska ps on ps.idpel = b.idpel and ps.blth = blth_of(b.tgl)
                left join pakai_pra pr on pr.idpel = b.idpel and pr.blth = blth_of(b.tgl)),
  hist as (select distinct idpel from pemeriksaan where tgl > greatest(p_to, current_date) - 90 and idpel is not null),
  gtem as (select distinct d.gardu from pemeriksaan p join dil d on d.idpel = p.idpel where p.gol <> 'Sesuai' and p.tgl > p_to - 180 and d.gardu is not null),
  uc0 as (select s.idpel, s.jn, s.kwh, s.kd, s.beli, s.prev_k, d.nama, d.tarif, d.daya, d.layanan, d.gardu, d.kelurahan, d.kecamatan, d.merk, d.tahun_tera, d.lat, d.lon,
                 s.skor0 + case when g.gardu is not null then 5 else 0 end skor
          from skor_dasar s join dil d on d.idpel = s.idpel left join gtem g on g.gardu = d.gardu
          where (p_kec is null or d.kecamatan = p_kec) and (p_layanan is null or d.layanan = p_layanan)
            and not exists (select 1 from hist h where h.idpel = s.idpel)),
  uc as (select *, case when skor >= 60 then 'Tinggi' when skor >= 35 then 'Sedang' else 'Rendah' end kat from uc0),
  pop as (select count(*) n from dil d where d.status = 'AKTIF' and (p_kec is null or d.kecamatan = p_kec) and (p_layanan is null or d.layanan = p_layanan)
            and not exists (select 1 from hist h where h.idpel = d.idpel))
  select json_build_object(
    'blth', v_blth, 'has_pra', v_has_pra, 'has_pas', v_has_pas,
    'jn_hit', (select coalesce(json_agg(x order by x.o), '[]') from (
        select case when jn < 40 then 1 when jn < 80 then 2 when jn < 120 then 3 when jn < 200 then 4 else 5 end o,
               count(*) n, count(*) filter (where gol <> 'Sesuai') t from bj where has_u and jn is not null group by 1) x),
    'merk_hit', (select coalesce(json_agg(x order by x.t::numeric / x.n desc), '[]') from (
        select coalesce(d.merk, b.merk_meter) k, count(*) n, count(*) filter (where b.gol <> 'Sesuai') t
        from b left join dil d on d.idpel = b.idpel group by 1 having count(*) >= 30) x),
    'tera_hit', (select coalesce(json_agg(x order by x.o), '[]') from (
        select case when t <= 2012 then 1 when t <= 2016 then 2 when t <= 2020 then 3 when t <= 2023 then 4 else 5 end o,
               count(*) n, count(*) filter (where gol <> 'Sesuai') tm
        from (select coalesce(d.tahun_tera, b.tahun_meter) t, b.gol from b left join dil d on d.idpel = b.idpel) z where t > 1990 group by 1) x),
    'pool', json_build_object(
        'nobuy', (select count(*) from uc where layanan = 'PRABAYAR' and v_has_pra and not beli),
        'prajn', (select count(*) from uc where layanan = 'PRABAYAR' and beli and jn < 40),
        'pasjn', (select count(*) from uc where layanan <> 'PRABAYAR' and jn < 40 and coalesce(kd, 'NORMAL') = 'NORMAL'),
        'kd', (select count(*) from uc where kd in ('KWH METER MACET','MCB PERLU DIPERIKSA','KWH METER TIDAK ADA','KWH METER TINGGI','KWH METER DIDALAM BANGUNAN'))),
    'kat', (select json_build_array(
        json_build_object('k', 'Tinggi', 'n', (select count(*) from uc where kat = 'Tinggi')),
        json_build_object('k', 'Sedang', 'n', (select count(*) from uc where kat = 'Sedang')),
        json_build_object('k', 'Rendah', 'n', (select n from pop) - (select count(*) from uc where kat <> 'Rendah')))),
    'list', (select coalesce(json_agg(x), '[]') from (
        select idpel, nama, tarif, daya, layanan, gardu, kelurahan, kecamatan, merk, tahun_tera, jn, kwh, kd, beli, prev_k, skor, kat,
               round(lat::numeric, 6) lat, round(lon::numeric, 6) lon
        from uc where (p_kategori is null or kat = p_kategori) order by skor desc, daya desc, idpel limit p_limit) x)
  ) into r;
  return r;
end $$;

-- Peta Kerja (v1.5): calon TO berisiko per sel + titiknya
create or replace function f_peta_risiko(p_from date, p_to date, p_regu int default null, p_kec text default null, p_layanan text default null)
returns json
language plpgsql stable security definer set search_path = public as $$
declare r json; v_blth int;
begin
  perform guard();
  v_blth := (select max(blth) from skor_dasar);
  if v_blth is null then return json_build_object('blth', null, 'cells', '[]'::json, 'pts', '[]'::json); end if;
  with hist as (select distinct idpel from pemeriksaan where tgl > greatest(p_to, current_date) - 90 and idpel is not null),
  gtem as (select distinct d.gardu from pemeriksaan p join dil d on d.idpel = p.idpel where p.gol <> 'Sesuai' and p.tgl > p_to - 180 and d.gardu is not null),
  uc as (select d.idpel, d.nama, d.alamat, d.tarif, d.daya, d.layanan, d.gardu, d.lat, d.lon, d.gx, d.gy,
                s.skor0 + case when g.gardu is not null then 5 else 0 end skor
         from skor_dasar s join dil d on d.idpel = s.idpel left join gtem g on g.gardu = d.gardu
         where s.skor0 >= 30 and d.lat is not null
           and (p_kec is null or d.kecamatan = p_kec) and (p_layanan is null or d.layanan = p_layanan)
           and not exists (select 1 from hist h where h.idpel = s.idpel)),
  rk as (select *, case when skor >= 60 then 'Tinggi' else 'Sedang' end kat from uc where skor >= 35)
  select json_build_object(
    'blth', v_blth,
    'cells', (select coalesce(json_agg(json_build_array(gx, gy, t, s)), '[]') from (
        select gx, gy, count(*) filter (where kat = 'Tinggi') t, count(*) filter (where kat = 'Sedang') s from rk group by 1, 2) x),
    'pts', (select coalesce(json_agg(json_build_array(round(lat::numeric, 6), round(lon::numeric, 6), idpel, nama, skor, kat, tarif, daya, layanan, gardu, alamat)), '[]') from (
        select * from rk order by skor desc, daya desc limit 3000) x)
  ) into r;
  return r;
end $$;

-- ---------- 10. Pembayaran TS ----------------------------------------
create or replace function f_pembayaran(p_from date, p_to date, p_regu int default null, p_kec text default null, p_layanan text default null)
returns json
language plpgsql stable security definer set search_path = public as $$
declare r json;
begin
  perform guard();
  with t as (select * from ts_bayar where tgl_register between p_from and p_to and gol_ts is not null),
  b as (select * from f_base(p_from, p_to, p_regu, p_kec, p_layanan) where gol <> 'Sesuai'),
  bm as (select b.*, tb.no_agenda paid_agenda, tb.total_p2tl paid, tb.tunai, tb.angsur, tb.tgl_register
         from b left join lateral (
           select * from ts_bayar t
           where t.gol_ts is not null and (t.no_agenda = b.no_agenda
              or (b.idpel ~ '^[0-9]+$' and t.idpel = b.idpel and t.tgl_register >= b.tgl))
           order by (t.no_agenda = b.no_agenda) desc, t.tgl_register limit 1) tb on true)
  select json_build_object(
    'kpi', (select json_build_object('n', count(*), 'total', coalesce(sum(total_p2tl), 0), 'rp_ts', coalesce(sum(rp_ts), 0),
        'kwh', coalesce(sum(kwh), 0), 'tunai', coalesce(sum(tunai), 0), 'angsur', coalesce(sum(angsur), 0),
        'n_tunai', count(*) filter (where coalesce(angsur, 0) = 0), 'n_angsur', count(*) filter (where angsur > 0)) from t),
    'gol', (select coalesce(json_agg(x order by x.rp desc), '[]') from (select gol_ts k, count(*) n, coalesce(sum(total_p2tl), 0) rp, coalesce(sum(kwh), 0) kwh from t group by 1) x),
    'daily', (select coalesce(json_agg(x order by x.tgl), '[]') from (select tgl_register tgl, count(*) n, coalesce(sum(total_p2tl), 0) rp from t group by 1) x),
    'top', (select coalesce(json_agg(x), '[]') from (select no_agenda, nama, gol_ts golongan, tarif, daya, kwh, total_p2tl, tunai, angsur, tgl_register from t order by total_p2tl desc limit 10) x),
    'funnel', (select json_build_object(
        'temuan', count(*), 'rp_temuan', coalesce(sum(rp_ts_ok), 0), 'agenda_kosong', count(*) filter (where coalesce(no_agenda, '-') = '-'),
        'ap2t', count(*) filter (where ts_ap2t = 'Ya'),
        'sph', count(*) filter (where tgl_sph is not null or (no_agenda like 'P2TL/%')),
        'lunas', count(*) filter (where paid_agenda is not null), 'rp_lunas', coalesce(sum(paid), 0),
        'p4_tanpa_agenda', count(*) filter (where coalesce(no_agenda, '-') = '-')) from bm),
    'aging', (select coalesce(json_agg(x order by x.o), '[]') from (
        select case when m < 3 then 1 when m < 6 then 2 when m < 12 then 3 else 4 end o, count(*) n, coalesce(sum(angsur), 0) rp
        from (select angsur, (extract(year from age(current_date, tgl_register)) * 12 + extract(month from age(current_date, tgl_register))) m
              from ts_bayar where angsur > 0 and gol_ts is not null) z group by 1) x),
    'ts_range', json_build_object('min', (select min(tgl_register) from ts_bayar where gol_ts is not null), 'max', (select max(tgl_register) from ts_bayar where gol_ts is not null))
  ) into r;
  return r;
end $$;

-- ---------- 11. Recovery ---------------------------------------------
create or replace function f_recovery(p_from date, p_to date, p_regu int default null, p_kec text default null, p_layanan text default null)
returns json
language plpgsql stable security definer set search_path = public as $$
declare r json;
begin
  perform guard();
  with b as (select distinct on (idpel) idpel, gol, tgl, blth_of(tgl) m0, nama, tarif, daya
             from f_base(p_from, p_to, p_regu, p_kec, p_layanan) where idpel ~ '^[0-9]+$' order by idpel, tgl),
  u as (select idpel, blth, kwh from pakai_paska union all select idpel, blth, kwh from pakai_pra),
  rel as (select b.idpel, b.gol, (u.blth / 100 - b.m0 / 100) * 12 + (u.blth % 100 - b.m0 % 100) k, u.kwh
          from b join u on u.idpel = b.idpel),
  base as (select idpel, avg(kwh) bk from rel where k between -3 and -1 group by idpel having avg(kwh) > 0),
  aft as (select idpel, avg(kwh) ak, count(*) na from rel where k between 1 and 3 group by idpel),
  idx as (select rel.gol <> 'Sesuai' tm, k, percentile_cont(0.5) within group (order by rel.kwh / base.bk * 100) med, count(*) n
          from rel join base using (idpel) where k between -6 and 6 group by 1, 2)
  select json_build_object(
    'n_tm', (select count(*) from b where gol <> 'Sesuai'), 'n_tm_idpel', (select count(*) from b where gol <> 'Sesuai'),
    'n_with_base', (select count(*) from base join b using (idpel) where gol <> 'Sesuai'),
    'n_with_after', (select count(*) from aft join base using (idpel) join b using (idpel) where gol <> 'Sesuai'),
    'months', (select coalesce(json_agg(distinct blth order by blth), '[]') from (select blth from pakai_paska union select blth from pakai_pra) z),
    'index', (select coalesce(json_agg(x order by x.tm, x.k), '[]') from idx x),
    'kpi', (select json_build_object('kenaikan', avg((ak - bk) / bk * 100), 'tambah_kwh', sum(ak - bk))
            from base join aft using (idpel) join b using (idpel) where gol <> 'Sesuai'),
    'gol', (select coalesce(json_agg(x), '[]') from (select gol k, count(*) n, avg((ak - bk) / bk * 100) chg
            from base join aft using (idpel) join b using (idpel) where gol <> 'Sesuai' group by 1) x),
    'low', (select coalesce(json_agg(x), '[]') from (select b.idpel, b.gol, b.tarif, b.daya, b.nama, round(bk, 1) bk, round(ak, 1) ak, round((ak - bk) / bk * 100, 1) chg
            from base join aft using (idpel) join b using (idpel) where gol <> 'Sesuai' order by (ak - bk) / bk limit 50) x)
  ) into r;
  return r;
end $$;

-- ---------- 12. Detail temuan ----------------------------------------
create or replace function f_detail(p_from date, p_to date, p_regu int default null, p_kec text default null, p_layanan text default null,
                                   p_q text default null, p_gol text default null, p_ap2t text default null, p_tindakan text default null,
                                   p_bayar text default null, p_limit int default 50, p_offset int default 0)
returns json
language plpgsql stable security definer set search_path = public as $$
declare r json;
begin
  perform guard();
  with b as (select f.*, tb.total_p2tl paid, tb.tunai, tb.angsur, tb.tgl_register, tb.gol_ts ts_gol, tb.kwh ts_kwh, tb.rp_ts ts_rp,
                    d.merk dil_merk, d.tahun_tera, d.kelurahan, d.kecamatan, d.gardu dil_gardu, d.status dil_status, d.tgl_nyala
             from f_base(p_from, p_to, p_regu, p_kec, p_layanan) f
             left join lateral (
               select * from ts_bayar t
               where t.gol_ts is not null and (t.no_agenda = f.no_agenda
                  or (f.idpel ~ '^[0-9]+$' and t.idpel = f.idpel and t.tgl_register >= f.tgl))
               order by (t.no_agenda = f.no_agenda) desc, t.tgl_register limit 1) tb on true
             left join dil d on d.idpel = f.idpel
             where f.gol <> 'Sesuai'
               and (p_gol is null or f.gol = p_gol)
               and (p_ap2t is null or p_ap2t = 'ANOMALI' or coalesce(f.ts_ap2t, '-') = p_ap2t)
               and (p_tindakan is null or f.pemutusan = p_tindakan)
               and (p_ap2t is distinct from 'ANOMALI' or not f.ts_wajar)
               and (p_bayar is null or (p_bayar = 'Sudah' and tb.no_agenda is not null) or (p_bayar = 'Belum' and tb.no_agenda is null))
               and (p_q is null or f.idpel ilike '%' || p_q || '%' or f.nama ilike '%' || p_q || '%' or f.no_agenda ilike '%' || p_q || '%'
                    or f.catatan ilike '%' || p_q || '%' or f.petugas ilike '%' || p_q || '%'))
  select json_build_object(
    'total', (select count(*) from b),
    'rows', (select coalesce(json_agg(x), '[]') from (
       select id_p2tl, waktu_periksa, idpel, nama, tarif, daya, gol, trim(petugas) petugas, regu, kwh_ts, rupiah_ts, pemutusan, ts_ap2t, no_agenda,
              catatan, lat, lon, gardu, coalesce(dil_merk, merk_meter) merk, coalesce(tahun_tera, tahun_meter) tahun, kelurahan, kecamatan,
              dil_status, tgl_nyala, jenislayanan, paid, tunai, angsur, tgl_register, ts_wajar, ts_gol, ts_kwh, ts_rp
       from b order by ts_wajar, rupiah_ts desc, waktu_periksa desc limit p_limit offset p_offset) x)
  ) into r;
  return r;
end $$;

-- Riwayat pemakaian 1 pelanggan (sparkline di panel detail)
create or replace function f_usage_hist(p_idpel text) returns json
language plpgsql stable security definer set search_path = public as $$
declare r json;
begin
  perform guard();
  select coalesce(json_agg(x order by x.blth), '[]') into r from (
    select blth, kwh, jam_nyala, 'paska' src from pakai_paska where idpel = p_idpel
    union all select blth, kwh, null, 'pra' from pakai_pra where idpel = p_idpel) x;
  return r;
end $$;

-- ---------- 13. Kelola data ------------------------------------------
create or replace function f_datasets() returns json
language plpgsql stable security definer set search_path = public as $$
declare r json;
begin
  perform guard();
  select json_build_object(
    'pemeriksaan', json_build_object('n', (select count(*) from pemeriksaan), 'min', (select min(tgl) from pemeriksaan), 'max', (select max(tgl) from pemeriksaan)),
    'paska', (select coalesce(json_agg(x order by x.blth), '[]') from (select blth, count(*) n from pakai_paska group by 1) x),
    'pra', (select coalesce(json_agg(x order by x.blth), '[]') from (select blth, count(*) n from pakai_pra group by 1) x),
    'dil', json_build_object('n', (select count(*) from dil), 'aktif', (select count(*) from dil where status = 'AKTIF'), 'snapshot', (select max(snapshot) from dil)),
    'ts', json_build_object('n', (select count(*) from ts_bayar), 'min', (select min(tgl_register) from ts_bayar), 'max', (select max(tgl_register) from ts_bayar)),
    'months', json_build_object(
       'pemeriksaan', (select coalesce(json_agg(x order by x.blth), '[]') from (select blth_of(tgl) blth, count(*) n from pemeriksaan where tgl is not null group by 1) x),
       'ts', (select coalesce(json_agg(x order by x.blth), '[]') from (select blth_of(tgl_register) blth, count(*) n from ts_bayar where tgl_register is not null group by 1) x)),
    'log', (select coalesce(json_agg(x order by x.created_at desc), '[]') from (select * from upload_log order by created_at desc limit 30) x),
    'db_size', pg_database_size(current_database())
  ) into r;
  return r;
end $$;

-- Hapus data satu periode bulanan sebelum unggah ulang
create or replace function f_clear_month(p_dataset text, p_blth int) returns integer
language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  if not can_upload() then raise exception 'Akses ditolak: hanya pengunggah'; end if;
  if p_dataset = 'paska' then delete from pakai_paska where blth = p_blth; get diagnostics n = row_count;
  elsif p_dataset = 'pra' then delete from pakai_pra where blth = p_blth; get diagnostics n = row_count;
  elsif p_dataset = 'ts' then delete from ts_bayar where blth_of(tgl_register) = p_blth; get diagnostics n = row_count;
  else raise exception 'dataset tidak dikenal'; end if;
  return n;
end $$;


-- Hapus data (khusus admin): per bulan, atau seluruh DIL
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

-- Cari pelanggan di DIL: IDPEL (awal angka) atau kata pada nama/alamat
create or replace function f_cari(p_q text) returns json
language plpgsql stable security definer set search_path = public as $$
declare r json; q text := trim(coalesce(p_q, ''));
begin
  perform guard();
  if length(q) < 3 then return '[]'::json; end if;
  select coalesce(json_agg(x), '[]') into r from (
    select d.idpel, d.nama, d.alamat, d.tarif, d.daya, d.layanan, d.gardu, d.kelurahan, d.status,
           round(d.lat::numeric, 6) lat, round(d.lon::numeric, 6) lon
    from dil d
    where d.lat is not null and (
      (q ~ '^[0-9]+$' and d.idpel like q || '%')
      or (q !~ '^[0-9]+$' and not exists (
            select 1 from unnest(string_to_array(upper(q), ' ')) w
            where w <> '' and upper(coalesce(d.nama, '') || ' ' || coalesce(d.alamat, '')) not like '%' || w || '%')))
    order by (d.status = 'AKTIF') desc, d.idpel limit 25) x;
  return r;
end $$;

-- Pelanggan & temuan di sekitar satu titik (radius maks. 100 m)
create or replace function f_sekitar(p_lat double precision, p_lon double precision, p_radius int default 100) returns json
language plpgsql stable security definer set search_path = public as $$
declare r json; rad numeric := least(greatest(coalesce(p_radius, 100), 10), 100);
        dlat double precision; dlon double precision;
begin
  perform guard();
  dlat := rad / 111320.0; dlon := rad / (111320.0 * cos(radians(p_lat)));
  with pel0 as (select d.idpel, d.nama, d.alamat, d.tarif, d.daya, d.layanan, d.gardu, d.status, d.lat, d.lon,
                 111320.0 * sqrt(power(d.lat - p_lat, 2) + power((d.lon - p_lon) * cos(radians(p_lat)), 2)) jarak
          from dil d
          where d.gx between floor((p_lon - dlon) / 0.005)::int and floor((p_lon + dlon) / 0.005)::int
            and d.gy between floor((p_lat - dlat) / 0.005)::int and floor((p_lat + dlat) / 0.005)::int
            and d.lat between p_lat - dlat and p_lat + dlat and d.lon between p_lon - dlon and p_lon + dlon),
  pel as (select p0.*, l.tgl last_tgl, l.gol last_gol, s.skor0 skor
          from pel0 p0
          left join lateral (select tgl, gol from pemeriksaan pm where pm.idpel = p0.idpel order by tgl desc limit 1) l on true
          left join skor_dasar s on s.idpel = p0.idpel
          where p0.jarak <= rad),
  non as (select p.idpel, p.nama, null::text alamat, p.tarif, p.daya, p.jenislayanan layanan, p.gardu, 'NON-DIL'::text status, p.lat, p.lon,
                 111320.0 * sqrt(power(p.lat - p_lat, 2) + power((p.lon - p_lon) * cos(radians(p_lat)), 2)) jarak,
                 p.tgl last_tgl, p.gol last_gol, null::int skor
          from pemeriksaan p
          where p.lat between p_lat - dlat and p_lat + dlat and p.lon between p_lon - dlon and p_lon + dlon
            and not exists (select 1 from dil d where d.idpel = p.idpel))
  select coalesce(json_agg(x order by x.jarak), '[]') into r from (
    select idpel, nama, alamat, tarif, daya, layanan, gardu, status, round(lat::numeric, 6) lat, round(lon::numeric, 6) lon,
           round(jarak::numeric, 0) jarak, last_tgl, last_gol, skor
    from (select * from pel union all select * from non) u where jarak <= rad order by jarak limit 300) x;
  return r;
end $$;

-- Catat penghapusan bulan di riwayat
create or replace function f_log_delete(p_dataset text, p_blth int, p_n int) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not can_upload() then raise exception 'Akses ditolak'; end if;
  insert into upload_log (dataset, filename, periode, n_rows, info, uploaded_by) values (p_dataset, '(dihapus)', p_blth::text, -p_n, '{"hapus": true}', me_email());
end $$;

-- Perbarui statistik tabel setelah unggah besar (agar query tetap cepat)
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

-- ---------- Target tahunan & capaian (v1.6) ----------
create table if not exists target_p2tl (
  tahun      integer primary key,
  kwh        numeric not null check (kwh > 0),
  updated_at timestamptz default now(),
  updated_by text
);
alter table target_p2tl enable row level security;  -- hanya lewat fungsi
insert into target_p2tl (tahun, kwh, updated_by) values (2026, 11500820, 'awal (v1.6)')
  on conflict (tahun) do nothing;

-- Realisasi kWh TS terbayar (Laporan TS, tanggal register) tahun dari p_to, s.d. p_to
create or replace function f_capaian(p_to date) returns json
language plpgsql stable security definer set search_path = public as $$
declare r json; v_th int := extract(year from p_to)::int; v_awal date;
begin
  perform guard();
  v_awal := make_date(v_th, 1, 1);
  select json_build_object(
    'tahun', v_th,
    'target', (select kwh from target_p2tl where tahun = v_th),
    'data_max', (select max(tgl_register) from ts_bayar where gol_ts is not null and tgl_register between v_awal and p_to),
    'kwh', (select coalesce(sum(kwh), 0) from ts_bayar where gol_ts is not null and tgl_register between v_awal and p_to),
    'rp', (select coalesce(sum(total_p2tl), 0) from ts_bayar where gol_ts is not null and tgl_register between v_awal and p_to),
    'n', (select count(*) from ts_bayar where gol_ts is not null and tgl_register between v_awal and p_to),
    'bulan', (select coalesce(json_agg(x order by x.b, x.gol), '[]') from (
        select extract(month from tgl_register)::int b, gol_ts gol, count(*) n, coalesce(sum(kwh), 0) kwh, coalesce(sum(total_p2tl), 0) rp
        from ts_bayar where gol_ts is not null and tgl_register between v_awal and p_to group by 1, 2) x)
  ) into r;
  return r;
end $$;

create or replace function f_target_list() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform guard();
  return (select coalesce(json_agg(x order by x.tahun desc), '[]') from (select tahun, kwh, updated_at, updated_by from target_p2tl) x);
end $$;

create or replace function f_set_target(p_tahun int, p_kwh numeric) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Akses ditolak: hanya admin'; end if;
  if p_tahun < 2020 or p_tahun > 2100 then raise exception 'Tahun tidak valid'; end if;
  if p_kwh is null then delete from target_p2tl where tahun = p_tahun; return; end if;
  if p_kwh <= 0 then raise exception 'Target harus lebih dari 0'; end if;
  insert into target_p2tl (tahun, kwh, updated_at, updated_by) values (p_tahun, p_kwh, now(), me_email())
    on conflict (tahun) do update set kwh = excluded.kwh, updated_at = now(), updated_by = excluded.updated_by;
end $$;

-- Hak eksekusi fungsi hanya untuk pengguna login
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('f_meta','f_ringkasan','f_kinerja','f_cakupan','f_cell','f_peta_risiko','f_risiko','f_pembayaran',
             'f_recovery','f_detail','f_usage_hist','f_datasets','f_clear_month','f_after_upload','f_log_delete','f_hapus_data','f_cari','f_sekitar','f_hitung_skor','f_capaian','f_target_list','f_set_target','my_role','is_member','can_upload','is_admin')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- Fungsi internal: hanya dipanggil dari fungsi lain, tidak boleh lewat API
drop function if exists f_usage_month(int);
revoke execute on function f_base(date, date, int, text, text) from public, anon, authenticated;
revoke execute on function guard() from public, anon, authenticated;
revoke execute on function f_refresh_skor() from public, anon, authenticated;
revoke execute on function f_refresh_skor_internal() from public, anon, authenticated;
revoke execute on function f_refresh_dil_sel_internal() from public, anon, authenticated;
select f_refresh_dil_sel_internal();

-- Pengamanan akhir: tidak ada akses tanpa login ke tabel mana pun
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Batas waktu query untuk pengguna login (bawaan Supabase 8 detik)
alter role authenticated set statement_timeout = '30s';
notify pgrst, 'reload config';

-- ---------- 14. Daftarkan admin pertama --------------------------------
-- GANTI email di bawah dengan email akun Supabase Auth Anda, lalu jalankan:
-- insert into app_user (email, nama, role) values ('email.anda@pln.co.id', 'Seno Nugroho', 'admin')
--   on conflict (email) do update set role = 'admin';
