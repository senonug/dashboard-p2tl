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

-- DPM & OLAP disimpan per tahun (v1.8a): 1 baris per pelanggan per tahun, 12 bulan dalam array
-- ---------- 1. Fungsi bantu array bulan --------------------------------
-- Nilai bulan k (1..12) dari array tahunan; null bila bulan itu tidak ada datanya
create or replace function bln(a anyarray, ada int, k int) returns anyelement
language sql immutable parallel safe as $$
  select case when k between 1 and 12 and coalesce(ada, 0) & (1 << (k - 1)) <> 0 then a[k] end
$$;
-- Sama, tetapi k <= 0 berarti bulan di tahun sebelumnya (0 = Desember tahun lalu)
create or replace function bln2(c anyarray, ca int, p anyarray, pa int, k int) returns anyelement
language sql immutable parallel safe as $$
  select case when k >= 1 then bln(c, ca, k) else bln(p, pa, k + 12) end
$$;
-- Rata-rata dari 3 nilai, mengabaikan yang kosong
create or replace function avg3(a real, b real, c real) returns double precision
language sql immutable parallel safe as $$
  select (coalesce(a, 0)::float8 + coalesce(b, 0) + coalesce(c, 0))
         / nullif((a is not null)::int + (b is not null)::int + (c is not null)::int, 0)
$$;
-- Array 12 bulan berisi v di posisi k, sisanya null
create or replace function arr12(v anyelement, k int) returns anyarray
language sql immutable parallel safe as $$
  select array_fill(nullif(v, v), array[k - 1]) || v || array_fill(nullif(v, v), array[12 - k])
$$;

-- ---------- 2. Tabel per tahun -----------------------------------------
create table if not exists kode_baca (
  id   smallserial primary key,
  kode text not null unique
);

create table if not exists pakai_paska_th (
  idpel text not null,
  tahun smallint not null,
  tarif text,                -- tarif bulan terakhir yang ada
  daya  integer[],           -- 12 bulan
  kwh   real[],
  jn    real[],              -- jam nyala
  kd    smallint[],          -- kode baca (kode_baca.id)
  ada   integer not null default 0,   -- bit bulan yang ada datanya (bit 0 = Januari)
  primary key (idpel, tahun)
);
create index if not exists pakai_paska_th_tahun_idx on pakai_paska_th (tahun);

create table if not exists pakai_pra_th (
  idpel text not null,
  tahun smallint not null,
  daya  integer[],
  kwh   real[],              -- kWh token dibeli per bulan
  ada   integer not null default 0,
  primary key (idpel, tahun)
);
create index if not exists pakai_pra_th_tahun_idx on pakai_pra_th (tahun);

-- Daftar bulan yang sudah diunggah (sumber kalender di Kelola Data)
create table if not exists bulan_data (
  dataset  text not null,       -- paska | pra
  blth     integer not null,
  n        integer not null default 0,
  status   text not null default 'ok',   -- ok | proses (unggah terputus)
  file     text,
  oleh     text,
  waktu    timestamptz default now(),
  n_baru   integer,             -- pelanggan yang tidak ada di bulan sebelumnya
  n_hilang integer,             -- pelanggan bulan sebelumnya yang tidak ada lagi
  primary key (dataset, blth)
);

-- Tabel penampung sementara saat unggah (dikosongkan setelah digabung)
create unlogged table if not exists stg_paska (
  job text not null, idpel text, blth integer, tarif text, daya integer, kwh real, jn real, kd text,
  t timestamptz default now()
);
create index if not exists stg_paska_job_idx on stg_paska (job, blth, idpel);
create unlogged table if not exists stg_pra (
  job text not null, idpel text, blth integer, daya integer, kwh real,
  t timestamptz default now()
);
create index if not exists stg_pra_job_idx on stg_pra (job, blth, idpel);

create table if not exists skor_pop (kecamatan text, layanan text, n integer);

-- Hak akses
alter table pakai_paska_th enable row level security;
alter table pakai_pra_th enable row level security;
alter table kode_baca enable row level security;
alter table bulan_data enable row level security;
alter table stg_paska enable row level security;
alter table stg_pra enable row level security;
alter table skor_pop enable row level security;
do $$
declare t text;
begin
  foreach t in array array['pakai_paska_th','pakai_pra_th','kode_baca','bulan_data'] loop
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('create policy %I on %I for select to authenticated using (is_member())', t || '_read', t);
    execute format('grant select on %I to authenticated', t);
  end loop;
  foreach t in array array['stg_paska','stg_pra'] loop
    execute format('drop policy if exists %I on %I', t || '_ins', t);
    execute format('create policy %I on %I for insert to authenticated with check (can_upload())', t || '_ins', t);
    execute format('grant insert on %I to authenticated', t);
  end loop;
end $$;
revoke all on pakai_paska_th, pakai_pra_th, kode_baca, bulan_data, stg_paska, stg_pra, skor_pop from anon;


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
  foreach t in array array['pemeriksaan','dil','ts_bayar','upload_log'] loop
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
    'paska_blth', (select coalesce(json_agg(blth order by blth), '[]') from bulan_data where dataset = 'paska' and status = 'ok'),
    'pra_blth', (select coalesce(json_agg(blth order by blth), '[]') from bulan_data where dataset = 'pra' and status = 'ok'),
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
alter table skor_dasar add column if not exists alamat text;
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
set search_path = public set work_mem = '64MB' set max_parallel_workers_per_gather = 0
as $$
declare v_pas int; v_pra int; v_yp int; v_mp int; v_bp int; v_yr int; v_mr int; v_nup int; n int;
begin
  v_pas := (select max(blth) from bulan_data where dataset = 'paska' and status = 'ok');
  v_pra := (select max(blth) from bulan_data where dataset = 'pra' and status = 'ok');
  truncate skor_dasar;
  truncate skor_pop;
  if v_pas is null and v_pra is null then return 0; end if;

  create temp table if not exists tmp_skor (
    idpel text, blth int, layanan text, tarif text, daya int, jn numeric, kwh numeric, kd text, beli boolean, beli3 boolean, prev_k numeric
  ) on commit drop;
  truncate tmp_skor;

  -- Paskabayar
  if v_pas is not null then
    v_yp := v_pas / 100; v_mp := v_pas % 100; v_bp := 1 << (v_mp - 1);
    insert into tmp_skor (idpel, blth, layanan, tarif, daya, jn, kwh, kd, beli, beli3, prev_k)
    select t.idpel, v_pas, 'PASKABAYAR', t.tarif, t.daya[v_mp], t.jn[v_mp], t.kwh[v_mp], k.kode, null, null,
           avg3(bln2(t.kwh, t.ada, p.kwh, p.ada, v_mp - 1), bln2(t.kwh, t.ada, p.kwh, p.ada, v_mp - 2), bln2(t.kwh, t.ada, p.kwh, p.ada, v_mp - 3))
    from pakai_paska_th t
    left join pakai_paska_th p on v_mp <= 3 and p.idpel = t.idpel and p.tahun = v_yp - 1
    left join kode_baca k on k.id = t.kd[v_mp]
    where t.tahun = v_yp and t.ada & v_bp <> 0;
  end if;

  -- Prabayar
  if v_pra is not null then
    v_yr := v_pra / 100; v_mr := v_pra % 100;
    select count(*) into v_nup from bulan_data
    where dataset = 'pra' and status = 'ok' and blth in (v_pra, blth_add(v_pra, -1), blth_add(v_pra, -2));
    insert into tmp_skor (idpel, blth, layanan, tarif, daya, jn, kwh, kd, beli, beli3, prev_k)
    with o as materialized (
      select coalesce(t.idpel, p.idpel) idpel,
             bln2(t.kwh, t.ada, p.kwh, p.ada, v_mr) k0, bln2(t.kwh, t.ada, p.kwh, p.ada, v_mr - 1) k1,
             bln2(t.kwh, t.ada, p.kwh, p.ada, v_mr - 2) k2, bln2(t.kwh, t.ada, p.kwh, p.ada, v_mr - 3) k3,
             coalesce(bln2(t.daya, t.ada, p.daya, p.ada, v_mr), bln2(t.daya, t.ada, p.daya, p.ada, v_mr - 1),
                      bln2(t.daya, t.ada, p.daya, p.ada, v_mr - 2), bln2(t.daya, t.ada, p.daya, p.ada, v_mr - 3)) dy
      from (select * from pakai_pra_th where tahun = v_yr) t
      full join (select * from pakai_pra_th where tahun = v_yr - 1 and v_mr <= 3) p on p.idpel = t.idpel),
    ids as (select idpel from o where k0 is not null or k1 is not null or k2 is not null
            union select idpel from dil where status = 'AKTIF' and layanan = 'PRABAYAR'),
    m as (select i.idpel, o.k0, o.k1, o.k2, o.k3, coalesce(o.dy, d.daya) dy, d.tarif
          from ids i left join o on o.idpel = i.idpel left join dil d on d.idpel = i.idpel
          where v_pas is null or not exists (select 1 from pakai_paska_th q where q.idpel = i.idpel and q.tahun = v_yp and q.ada & v_bp <> 0))
    select idpel, v_pra, 'PRABAYAR', tarif, dy,
           (coalesce(k0, 0) + coalesce(k1, 0) + coalesce(k2, 0)) / greatest(v_nup, 1) / nullif(dy / 1000.0, 0),
           coalesce(k0, 0), null, k0 is not null, (k0 is not null or k1 is not null or k2 is not null),
           avg3(k1, k2, k3)
    from m;
  end if;

  analyze tmp_skor;
  -- Skor (+ jumlah populasi per kecamatan & layanan dalam satu langkah)
  with j as materialized (
    select s.*, d.nama, d.alamat, d.gardu, d.kelurahan, d.kecamatan, d.merk, d.tahun_tera, d.lat, d.lon,
           coalesce(s.tarif, d.tarif) tr, coalesce(s.daya, d.daya) dy
    from tmp_skor s left join dil d on d.idpel = s.idpel),
  pop as (insert into skor_pop (kecamatan, layanan, n) select kecamatan, layanan, count(*) from j group by 1, 2),
  sc as (
    select j.*,
        (case when jn is not null and jn < 40 and (layanan <> 'PRABAYAR' or beli3) then 35 else 0 end)
      + (case when layanan = 'PRABAYAR' and not beli then 20 else 0 end)
      + (case when kd in ('KWH METER MACET','MCB PERLU DIPERIKSA','KWH METER TIDAK ADA','KWH METER TINGGI','KWH METER DIDALAM BANGUNAN') then 15 else 0 end)
      + (case when tahun_tera is not null and tahun_tera <= 2012 then 10 else 0 end)
      + (case when prev_k > 0 and kwh is not null and kwh < 0.5 * prev_k and (layanan <> 'PRABAYAR' or beli) then 15 else 0 end)
      + (case when dy >= 2200 and jn is not null and jn < 40 and (layanan <> 'PRABAYAR' or beli3) then 10 else 0 end) skor0
    from j)
  insert into skor_dasar (idpel, blth, nama, alamat, tarif, daya, layanan, gardu, kelurahan, kecamatan, merk, tahun_tera, lat, lon,
                          jn, kwh, kd, beli, prev_k, skor0)
  select idpel, blth, nama, alamat, tr, dy, layanan, gardu, kelurahan, kecamatan, merk, tahun_tera, lat, lon,
         round(jn, 1), round(kwh, 1), kd, beli, round(prev_k::numeric, 1), skor0
  from sc where skor0 >= 15;   -- skor < 15 (mis. hanya meter tera lama) tidak disimpan: selalu kategori Rendah
  get diagnostics n = row_count;

  analyze skor_dasar;
  return n;
end $$;

-- Hitung ulang skor sebagai panggilan tersendiri (dipanggil aplikasi setelah unggah/hapus DIL, DPM, OLAP)
create or replace function f_hitung_skor() returns integer
language plpgsql volatile security definer set search_path = public set statement_timeout = '120s' as $$
begin
  if not can_upload() then raise exception 'Akses ditolak: hanya pengunggah'; end if;
  return f_refresh_skor_internal();
end $$;

create or replace function f_risiko(p_from date, p_to date, p_regu int default null, p_kec text default null, p_layanan text default null,
                                   p_kategori text default null, p_limit int default 200)
returns json
language plpgsql stable security definer set search_path = public as $$
declare r json; v_pas int; v_pra int;
begin
  perform guard();
  if not exists (select 1 from skor_dasar) and not exists (select 1 from skor_pop) then
    return json_build_object('blth', null);
  end if;
  v_pas := (select max(blth) from skor_dasar where layanan = 'PASKABAYAR');
  v_pra := (select max(blth) from skor_dasar where layanan = 'PRABAYAR');
  v_pas := coalesce(v_pas, (select max(blth) from bulan_data where dataset = 'paska' and status = 'ok'));
  v_pra := coalesce(v_pra, (select max(blth) from bulan_data where dataset = 'pra' and status = 'ok'));
  with b as (select * from f_base(p_from, p_to, p_regu, p_kec, p_layanan)),
  bj as (select b.*,
                case when b.jenislayanan = 'PRABAYAR' then coalesce(bln(pr.kwh, pr.ada, z.mm), 0) / nullif(b.daya / 1000.0, 0)
                     else bln(ps.jn, ps.ada, z.mm) end jn,
                (coalesce(ps.ada, 0) & (1 << (z.mm - 1)) <> 0 or coalesce(pr.ada, 0) & (1 << (z.mm - 1)) <> 0) has_u
         from b
         cross join lateral (select extract(year from b.tgl)::int yy, extract(month from b.tgl)::int mm) z
         left join pakai_paska_th ps on ps.idpel = b.idpel and ps.tahun = z.yy
         left join pakai_pra_th pr on pr.idpel = b.idpel and pr.tahun = z.yy),
  hist as (select distinct idpel from pemeriksaan where tgl > greatest(p_to, current_date) - 90 and idpel is not null),
  gtem as (select distinct d.gardu from pemeriksaan p join dil d on d.idpel = p.idpel where p.gol <> 'Sesuai' and p.tgl > p_to - 180 and d.gardu is not null),
  uc0 as (select s.idpel, s.jn, s.kwh, s.kd, s.beli, s.prev_k, s.nama, s.tarif, s.daya, s.layanan, s.gardu, s.kelurahan, s.kecamatan, s.merk, s.tahun_tera, s.lat, s.lon,
                 s.skor0 + case when g.gardu is not null then 5 else 0 end skor
          from skor_dasar s left join gtem g on g.gardu = s.gardu
          where (p_kec is null or s.kecamatan = p_kec) and (p_layanan is null or s.layanan = p_layanan)
            and not exists (select 1 from hist h where h.idpel = s.idpel)),
  uc as (select *, case when skor >= 60 then 'Tinggi' when skor >= 35 then 'Sedang' else 'Rendah' end kat from uc0),
  -- populasi (perkiraan): jumlah pelanggan yang diskor dikurangi pelanggan yang diperiksa 90 hari terakhir
  pop as (select greatest(0, coalesce((select sum(n) from skor_pop where (p_kec is null or kecamatan = p_kec) and (p_layanan is null or layanan = p_layanan)), 0)
                 - (select count(*) from hist h join dil d on d.idpel = h.idpel where d.status = 'AKTIF'
                      and (p_kec is null or d.kecamatan = p_kec) and (p_layanan is null or d.layanan = p_layanan))) n)
  select json_build_object(
    'blth', greatest(v_pas, v_pra), 'blth_pas', v_pas, 'blth_pra', v_pra,
    'has_pra', v_pra is not null, 'has_pas', v_pas is not null,
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
        'nobuy', (select count(*) from uc where layanan = 'PRABAYAR' and not beli),
        'prajn', (select count(*) from uc where layanan = 'PRABAYAR' and jn > 0 and jn < 40),
        'pasjn', (select count(*) from uc where layanan <> 'PRABAYAR' and jn < 40 and coalesce(kd, 'NORMAL') = 'NORMAL'),
        'kd', (select count(*) from uc where kd in ('KWH METER MACET','MCB PERLU DIPERIKSA','KWH METER TIDAK ADA','KWH METER TINGGI','KWH METER DIDALAM BANGUNAN'))),
    'kat', (select json_build_array(
        json_build_object('k', 'Tinggi', 'n', (select count(*) from uc where kat = 'Tinggi')),
        json_build_object('k', 'Sedang', 'n', (select count(*) from uc where kat = 'Sedang')),
        json_build_object('k', 'Rendah', 'n', greatest(0, (select n from pop) - (select count(*) from uc where kat <> 'Rendah'))))),
    'list', (select coalesce(json_agg(x), '[]') from (
        select idpel, nama, tarif, daya, layanan, gardu, kelurahan, kecamatan, merk, tahun_tera, jn, kwh, kd, beli, prev_k, skor, kat,
               round(lat::numeric, 6) lat, round(lon::numeric, 6) lon
        from uc where (p_kategori is null or kat = p_kategori) order by skor desc, daya desc nulls last, idpel limit p_limit) x)
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
  uc as (select s.idpel, s.nama, s.alamat, s.tarif, s.daya, s.layanan, s.gardu, s.lat, s.lon,
                floor(s.lon / 0.005)::int gx, floor(s.lat / 0.005)::int gy,
                s.skor0 + case when g.gardu is not null then 5 else 0 end skor
         from skor_dasar s left join gtem g on g.gardu = s.gardu
         where s.skor0 >= 30 and s.lat is not null and s.lon is not null
           and (p_kec is null or s.kecamatan = p_kec) and (p_layanan is null or s.layanan = p_layanan)
           and not exists (select 1 from hist h where h.idpel = s.idpel)),
  rk as (select *, case when skor >= 60 then 'Tinggi' else 'Sedang' end kat from uc where skor >= 35)
  select json_build_object(
    'blth', v_blth,
    'blth_pas', (select max(blth) from skor_dasar where layanan = 'PASKABAYAR'),
    'blth_pra', (select max(blth) from skor_dasar where layanan = 'PRABAYAR'),
    'cells', (select coalesce(json_agg(json_build_array(gx, gy, t, s)), '[]') from (
        select gx, gy, count(*) filter (where kat = 'Tinggi') t, count(*) filter (where kat = 'Sedang') s from rk group by 1, 2) x),
    'pts', (select coalesce(json_agg(json_build_array(round(lat::numeric, 6), round(lon::numeric, 6), idpel, nama, skor, kat, tarif, daya, layanan, gardu, alamat)), '[]') from (
        select * from rk order by skor desc, daya desc nulls last limit 3000) x)
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
  u as (select t.idpel, t.tahun * 100 + g blth, t.kwh[g] kwh
        from pakai_paska_th t cross join generate_series(1, 12) g
        where t.idpel in (select idpel from b) and t.ada & (1 << (g - 1)) <> 0
        union all
        select t.idpel, t.tahun * 100 + g, t.kwh[g]
        from pakai_pra_th t cross join generate_series(1, 12) g
        where t.idpel in (select idpel from b) and t.ada & (1 << (g - 1)) <> 0),
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
    'months', (select coalesce(json_agg(distinct blth order by blth), '[]') from bulan_data where status = 'ok'),
    'index', (select coalesce(json_agg(x order by x.tm, x.k), '[]') from idx x),
    'kpi', (select json_build_object('kenaikan', avg((ak - bk) / bk * 100), 'tambah_kwh', sum(ak - bk))
            from base join aft using (idpel) join b using (idpel) where gol <> 'Sesuai'),
    'gol', (select coalesce(json_agg(x), '[]') from (select gol k, count(*) n, avg((ak - bk) / bk * 100) chg
            from base join aft using (idpel) join b using (idpel) where gol <> 'Sesuai' group by 1) x),
    'low', (select coalesce(json_agg(x), '[]') from (select b.idpel, b.gol, b.tarif, b.daya, b.nama, round(bk::numeric, 1) bk, round(ak::numeric, 1) ak,
                   round(((ak - bk) / bk * 100)::numeric, 1) chg
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
    select t.tahun * 100 + g blth, t.kwh[g] kwh, t.jn[g] jam_nyala, 'paska' src
    from pakai_paska_th t cross join generate_series(1, 12) g where t.idpel = p_idpel and t.ada & (1 << (g - 1)) <> 0
    union all
    select t.tahun * 100 + g, t.kwh[g], null, 'pra'
    from pakai_pra_th t cross join generate_series(1, 12) g where t.idpel = p_idpel and t.ada & (1 << (g - 1)) <> 0) x;
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
    'paska', (select coalesce(json_agg(x order by x.blth), '[]') from (select blth, n, status, file, oleh, waktu, n_baru, n_hilang from bulan_data where dataset = 'paska') x),
    'pra', (select coalesce(json_agg(x order by x.blth), '[]') from (select blth, n, status, file, oleh, waktu, n_baru, n_hilang from bulan_data where dataset = 'pra') x),
    'dil', json_build_object('n', (select count(*) from dil), 'aktif', (select count(*) from dil where status = 'AKTIF'), 'snapshot', (select max(snapshot) from dil),
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

-- Hapus data satu periode bulanan sebelum unggah ulang
create or replace function f_clear_month(p_dataset text, p_blth int) returns integer
language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  if not can_upload() then raise exception 'Akses ditolak: hanya pengunggah'; end if;
  if p_dataset in ('paska', 'pra') then
    raise exception 'Aplikasi di browser Anda versi lama. Muat ulang halaman dengan Ctrl+Shift+R lalu unggah lagi.';
  elsif p_dataset = 'ts' then delete from ts_bayar where blth_of(tgl_register) = p_blth; get diagnostics n = row_count;
  else raise exception 'dataset tidak dikenal'; end if;
  return n;
end $$;


-- Hapus data (khusus admin): per bulan, atau seluruh DIL
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
  elsif p_dataset = 'dil' then delete from dil where true; get diagnostics n = row_count; delete from dil_sel where true;
  else raise exception 'dataset tidak dikenal'; end if;
  insert into upload_log (dataset, filename, periode, n_rows, info, uploaded_by)
  values (p_dataset, '(dihapus)', coalesce(p_blth::text, 'semua'), -n, '{"hapus": true}', me_email());
  return n;
end $$;

-- ---------- Unggah DPM/OLAP per bulan ke tabel per tahun (v1.8a) ----------
-- ---------- 4. View dengan nama lama (untuk kueri manual / kompatibilitas) ----------
create or replace view pakai_paska with (security_invoker = true) as
  select t.idpel, t.tahun * 100 + g blth, t.tarif, t.daya[g] daya, t.kwh[g]::numeric kwh, t.jn[g]::numeric jam_nyala, k.kode kdbaca
  from pakai_paska_th t cross join generate_series(1, 12) g left join kode_baca k on k.id = t.kd[g]
  where t.ada & (1 << (g - 1)) <> 0;
create or replace view pakai_pra with (security_invoker = true) as
  select t.idpel, t.tahun * 100 + g blth, t.daya[g] daya, t.kwh[g]::numeric kwh
  from pakai_pra_th t cross join generate_series(1, 12) g
  where t.ada & (1 << (g - 1)) <> 0;
grant select on pakai_paska, pakai_pra to authenticated;
revoke all on pakai_paska, pakai_pra from anon;

-- ---------- 5. Unggah: gabungkan satu bulan dari tabel penampung -----------
-- Dipanggil per bagian (p_part = 0..p_parts-1) agar tiap panggilan jauh di bawah batas 30 detik.
-- Tiap bagian aman diulang: bulan itu dikosongkan dulu untuk pelanggan di bagian tsb, lalu diisi.
create or replace function f_simpan_bulan(p_dataset text, p_job text, p_blth int, p_part int default 0, p_parts int default 1)
returns integer
language plpgsql volatile security definer set search_path = public set statement_timeout = '120s' as $$
declare v_y smallint; v_m int; v_bit int; n int := 0;
begin
  if not can_upload() then raise exception 'Akses ditolak: hanya pengunggah'; end if;
  v_y := p_blth / 100; v_m := p_blth % 100;
  if v_m not between 1 and 12 or v_y < 2000 then raise exception 'BLTH tidak valid: %', p_blth; end if;
  if p_parts < 1 or p_part < 0 or p_part >= p_parts then raise exception 'Bagian tidak valid'; end if;
  if p_dataset not in ('paska', 'pra') then raise exception 'dataset tidak dikenal'; end if;
  v_bit := 1 << (v_m - 1);
  if p_part = 0 then
    insert into bulan_data (dataset, blth, n, status, oleh, waktu) values (p_dataset, p_blth, 0, 'proses', me_email(), now())
    on conflict (dataset, blth) do update set status = 'proses', oleh = me_email(), waktu = now();
  end if;

  if p_dataset = 'paska' then
    insert into kode_baca (kode) select distinct s.kd from stg_paska s
    where s.job = p_job and s.blth = p_blth and s.kd is not null and not exists (select 1 from kode_baca k where k.kode = s.kd);

    -- kosongkan bulan ini hanya untuk pelanggan yang TIDAK ada di file baru (yang ada langsung ditimpa di bawah)
    update pakai_paska_th t set daya[v_m] = null, kwh[v_m] = null, jn[v_m] = null, kd[v_m] = null, ada = ada & ~v_bit
    where t.tahun = v_y and t.ada & v_bit <> 0 and (hashtext(t.idpel) & 2147483647) % p_parts = p_part
      and not exists (select 1 from stg_paska s where s.job = p_job and s.blth = p_blth and s.idpel = t.idpel);

    insert into pakai_paska_th as t (idpel, tahun, tarif, daya, kwh, jn, kd, ada)
    select distinct on (s.idpel) s.idpel, v_y, s.tarif, arr12(s.daya, v_m), arr12(s.kwh, v_m), arr12(s.jn, v_m), arr12(k.id, v_m), v_bit
    from stg_paska s left join kode_baca k on k.kode = s.kd
    where s.job = p_job and s.blth = p_blth and s.idpel is not null and (hashtext(s.idpel) & 2147483647) % p_parts = p_part
    order by s.idpel
    on conflict (idpel, tahun) do update set
      daya[v_m] = excluded.daya[v_m], kwh[v_m] = excluded.kwh[v_m], jn[v_m] = excluded.jn[v_m], kd[v_m] = excluded.kd[v_m],
      tarif = case when (t.ada >> v_m) = 0 then coalesce(excluded.tarif, t.tarif) else t.tarif end,
      ada = t.ada | v_bit;
    get diagnostics n = row_count;

    delete from pakai_paska_th where tahun = v_y and ada = 0 and (hashtext(idpel) & 2147483647) % p_parts = p_part;

  elsif p_dataset = 'pra' then
    update pakai_pra_th t set daya[v_m] = null, kwh[v_m] = null, ada = ada & ~v_bit
    where t.tahun = v_y and t.ada & v_bit <> 0 and (hashtext(t.idpel) & 2147483647) % p_parts = p_part
      and not exists (select 1 from stg_pra s where s.job = p_job and s.blth = p_blth and s.idpel = t.idpel);

    insert into pakai_pra_th as t (idpel, tahun, daya, kwh, ada)
    select distinct on (s.idpel) s.idpel, v_y, arr12(s.daya, v_m), arr12(s.kwh, v_m), v_bit
    from stg_pra s
    where s.job = p_job and s.blth = p_blth and s.idpel is not null and (hashtext(s.idpel) & 2147483647) % p_parts = p_part
    order by s.idpel
    on conflict (idpel, tahun) do update set
      daya[v_m] = excluded.daya[v_m], kwh[v_m] = excluded.kwh[v_m], ada = t.ada | v_bit;
    get diagnostics n = row_count;

    delete from pakai_pra_th where tahun = v_y and ada = 0 and (hashtext(idpel) & 2147483647) % p_parts = p_part;
  else
    raise exception 'dataset tidak dikenal';
  end if;
  return n;
end $$;

-- Tutup satu bulan: hitung jumlah & perubahan vs bulan sebelumnya, tandai selesai, kosongkan penampung
create or replace function f_selesai_bulan(p_dataset text, p_job text, p_blth int, p_file text default null)
returns json
language plpgsql volatile security definer set search_path = public set statement_timeout = '120s' as $$
declare v_tbl text; v_y int; v_bit int; v_pb int; v_py int; v_pbit int; n int; nb int; nh int; v_has_prev boolean;
begin
  if not can_upload() then raise exception 'Akses ditolak: hanya pengunggah'; end if;
  if p_dataset = 'paska' then v_tbl := 'pakai_paska_th'; elsif p_dataset = 'pra' then v_tbl := 'pakai_pra_th'; else raise exception 'dataset tidak dikenal'; end if;
  v_y := p_blth / 100; v_bit := 1 << (p_blth % 100 - 1);
  v_pb := blth_add(p_blth, -1); v_py := v_pb / 100; v_pbit := 1 << (v_pb % 100 - 1);
  execute format('select count(*) from %I where tahun = $1 and ada & $2 <> 0', v_tbl) into n using v_y, v_bit;
  v_has_prev := exists (select 1 from bulan_data where dataset = p_dataset and blth = v_pb and status = 'ok');
  if v_has_prev then
    execute format('select count(*) filter (where p.idpel is null), count(*) filter (where c.idpel is null)
                    from (select idpel from %1$I where tahun = $1 and ada & $2 <> 0) c
                    full join (select idpel from %1$I where tahun = $3 and ada & $4 <> 0) p on p.idpel = c.idpel', v_tbl)
      into nb, nh using v_y, v_bit, v_py, v_pbit;
  end if;
  insert into bulan_data (dataset, blth, n, status, file, oleh, waktu, n_baru, n_hilang)
  values (p_dataset, p_blth, n, 'ok', p_file, me_email(), now(), nb, nh)
  on conflict (dataset, blth) do update set n = excluded.n, status = 'ok', file = excluded.file, oleh = excluded.oleh,
    waktu = excluded.waktu, n_baru = excluded.n_baru, n_hilang = excluded.n_hilang;
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
  return json_build_object('n', n, 'n_baru', nb, 'n_hilang', nh,
    'n_prev', (select b.n from bulan_data b where b.dataset = p_dataset and b.blth = v_pb and b.status = 'ok'));
end $$;

-- Buang isi penampung bila unggah dibatalkan / gagal sebelum digabung
create or replace function f_buang_stg(p_job text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not can_upload() then raise exception 'Akses ditolak: hanya pengunggah'; end if;
  delete from stg_paska where job = p_job or t < now() - interval '1 day';
  delete from stg_pra where job = p_job or t < now() - interval '1 day';
end $$;

-- ---------- 9. DIL: jangan timpa nama/alamat dengan nilai bermasking ----------
create or replace function dil_jaga_masking() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.nama is not null and position('*' in new.nama) > 0 and old.nama is not null and position('*' in old.nama) = 0 then
    new.nama := old.nama;
  end if;
  if new.alamat is not null and position('*' in new.alamat) > 0 and old.alamat is not null and position('*' in old.alamat) = 0 then
    new.alamat := old.alamat;
  end if;
  return new;
end $$;
drop trigger if exists dil_jaga_masking on dil;
create trigger dil_jaga_masking before update on dil for each row execute function dil_jaga_masking();


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
  elsif p_dataset = 'paska' then analyze pakai_paska_th;
  elsif p_dataset = 'pra' then analyze pakai_pra_th;
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
  with t as (select extract(month from tgl_register)::int b, kwh,
                    row_number() over (partition by extract(month from tgl_register) order by kwh desc nulls last) rk
             from ts_bayar where gol_ts is not null and tgl_register between v_awal and p_to),
  rk as (select b, count(*) filter (where kwh >= 50000) big, coalesce(sum(kwh) filter (where rk <= 5), 0) top5 from t group by b),
  bt as (select p.tgl, p.kwh_ts_ok,
                exists (select 1 from ts_bayar x where x.gol_ts is not null and (x.no_agenda = p.no_agenda
                        or (p.idpel ~ '^[0-9]+$' and x.idpel = p.idpel and x.tgl_register >= p.tgl))) paid
         from pemeriksaan p where p.gol <> 'Sesuai' and p.tgl between v_awal and p_to),
  un as (select extract(month from tgl)::int b, coalesce(sum(kwh_ts_ok) filter (where not paid), 0) kwh,
                count(*) filter (where not paid) n from bt group by 1)
  select json_build_object(
    'tahun', v_th,
    'target', (select kwh from target_p2tl where tahun = v_th),
    'data_max', (select max(tgl_register) from ts_bayar where gol_ts is not null and tgl_register between v_awal and p_to),
    'kwh', (select coalesce(sum(kwh), 0) from ts_bayar where gol_ts is not null and tgl_register between v_awal and p_to),
    'rp', (select coalesce(sum(total_p2tl), 0) from ts_bayar where gol_ts is not null and tgl_register between v_awal and p_to),
    'n', (select count(*) from ts_bayar where gol_ts is not null and tgl_register between v_awal and p_to),
    'bulan', (select coalesce(json_agg(x order by x.b, x.gol), '[]') from (
        select extract(month from tgl_register)::int b, gol_ts gol, count(*) n, coalesce(sum(kwh), 0) kwh, coalesce(sum(total_p2tl), 0) rp
        from ts_bayar where gol_ts is not null and tgl_register between v_awal and p_to group by 1, 2) x),
    'risk', (select coalesce(json_agg(rk order by rk.b), '[]') from rk),
    'belum', (select coalesce(json_agg(un order by un.b), '[]') from un)
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
             'f_recovery','f_detail','f_usage_hist','f_datasets','f_clear_month','f_after_upload','f_log_delete','f_hapus_data','f_cari','f_sekitar','f_hitung_skor','f_capaian','f_target_list','f_set_target','f_simpan_bulan','f_selesai_bulan','f_buang_stg','my_role','is_member','can_upload','is_admin')
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
revoke execute on function dil_jaga_masking() from public, anon, authenticated;
select f_refresh_dil_sel_internal();

-- Pengamanan akhir: tidak ada akses tanpa login ke tabel mana pun
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on pakai_paska, pakai_pra from anon;

-- Batas waktu query untuk pengguna login (bawaan Supabase 8 detik)
alter role authenticated set statement_timeout = '30s';
notify pgrst, 'reload config';

-- ---------- 14. Daftarkan admin pertama --------------------------------
-- GANTI email di bawah dengan email akun Supabase Auth Anda, lalu jalankan:
-- insert into app_user (email, nama, role) values ('email.anda@pln.co.id', 'Seno Nugroho', 'admin')
--   on conflict (email) do update set role = 'admin';
