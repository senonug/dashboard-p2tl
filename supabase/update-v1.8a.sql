-- =====================================================================
--  Dashboard P2TL — pembaruan v1.8a
--  DPM & OLAP disimpan PER TAHUN (1 baris per pelanggan per tahun, 12 bulan dalam array)
--
--  Isi:
--   1. Tabel baru: pakai_paska_th, pakai_pra_th, kode_baca, bulan_data, stg_paska, stg_pra, skor_pop
--   2. Pindahkan OLAP lama (Jan–Feb 2026) ke tabel per tahun + periksa jumlahnya
--   3. Tabel lama pakai_paska / pakai_pra diganti VIEW dengan nama yang sama
--   4. Fungsi unggah baru: f_simpan_bulan, f_selesai_bulan, f_buang_stg
--   5. Fungsi lama disesuaikan: f_meta, f_datasets, f_clear_month, f_hapus_data, f_after_upload,
--      f_refresh_skor_internal, f_risiko, f_peta_risiko, f_recovery, f_usage_hist
--   6. DIL: nama/alamat lama tidak ditimpa nilai bermasking (tanda *)
--
--  Cara pakai: Supabase › SQL Editor › New query › tempel SELURUH isi file › Run.
--  Seluruh isi berjalan dalam satu transaksi: bila ada yang gagal, tidak ada yang berubah.
-- =====================================================================
begin;

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

-- Jumlah populasi skor per kecamatan & layanan (untuk angka "Rendah")
create table if not exists skor_pop (kecamatan text, layanan text, n integer);
alter table skor_dasar add column if not exists alamat text;

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

-- ---------- 3. Pindahkan OLAP lama ke tabel per tahun ------------------
do $$
declare n_old bigint; n_new bigint; k_old numeric; k_new numeric; has_old boolean;
begin
  has_old := exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace
                     where s.nspname = 'public' and c.relname = 'pakai_pra' and c.relkind = 'r');
  if not has_old then return; end if;   -- sudah pernah dijalankan

  insert into pakai_pra_th (idpel, tahun, daya, kwh, ada)
  select idpel, (blth / 100)::smallint,
         array[max(daya) filter (where blth % 100 = 1), max(daya) filter (where blth % 100 = 2), max(daya) filter (where blth % 100 = 3),
               max(daya) filter (where blth % 100 = 4), max(daya) filter (where blth % 100 = 5), max(daya) filter (where blth % 100 = 6),
               max(daya) filter (where blth % 100 = 7), max(daya) filter (where blth % 100 = 8), max(daya) filter (where blth % 100 = 9),
               max(daya) filter (where blth % 100 = 10), max(daya) filter (where blth % 100 = 11), max(daya) filter (where blth % 100 = 12)],
         array[max(kwh) filter (where blth % 100 = 1), max(kwh) filter (where blth % 100 = 2), max(kwh) filter (where blth % 100 = 3),
               max(kwh) filter (where blth % 100 = 4), max(kwh) filter (where blth % 100 = 5), max(kwh) filter (where blth % 100 = 6),
               max(kwh) filter (where blth % 100 = 7), max(kwh) filter (where blth % 100 = 8), max(kwh) filter (where blth % 100 = 9),
               max(kwh) filter (where blth % 100 = 10), max(kwh) filter (where blth % 100 = 11), max(kwh) filter (where blth % 100 = 12)]::real[],
         bit_or(1 << (blth % 100 - 1))
  from pakai_pra group by idpel, blth / 100
  on conflict (idpel, tahun) do nothing;

  insert into bulan_data (dataset, blth, n, status, file, oleh, waktu)
  select 'pra', blth, count(*), 'ok', '(dipindah dari tabel lama)', 'v1.8a', now() from pakai_pra group by blth
  on conflict (dataset, blth) do nothing;

  -- periksa: jumlah baris & total kWh per bulan harus sama
  select count(*), coalesce(sum(kwh), 0) into n_old, k_old from pakai_pra;
  select count(*), coalesce(sum(t.kwh[g]::float8), 0) into n_new, k_new
  from pakai_pra_th t cross join generate_series(1, 12) g where t.ada & (1 << (g - 1)) <> 0;
  if n_old <> n_new or abs(k_old - k_new) > greatest(1, k_old * 0.000001) then
    raise exception 'Pemindahan OLAP tidak cocok: lama % baris / % kWh, baru % baris / % kWh. Tidak ada yang diubah.', n_old, k_old, n_new, k_new;
  end if;
  raise notice 'OLAP dipindah: % baris bulanan, % kWh', n_new, round(k_new);

  -- DPM lama (bila masih ada isinya) juga dipindah
  if exists (select 1 from pakai_paska) then
    insert into kode_baca (kode) select distinct kdbaca from pakai_paska p
    where kdbaca is not null and not exists (select 1 from kode_baca k where k.kode = p.kdbaca);
    insert into pakai_paska_th (idpel, tahun, tarif, daya, kwh, jn, kd, ada)
    select p.idpel, (p.blth / 100)::smallint, (array_agg(p.tarif order by p.blth desc))[1],
           array[max(p.daya) filter (where p.blth % 100 = 1), max(p.daya) filter (where p.blth % 100 = 2), max(p.daya) filter (where p.blth % 100 = 3), max(p.daya) filter (where p.blth % 100 = 4), max(p.daya) filter (where p.blth % 100 = 5), max(p.daya) filter (where p.blth % 100 = 6), max(p.daya) filter (where p.blth % 100 = 7), max(p.daya) filter (where p.blth % 100 = 8), max(p.daya) filter (where p.blth % 100 = 9), max(p.daya) filter (where p.blth % 100 = 10), max(p.daya) filter (where p.blth % 100 = 11), max(p.daya) filter (where p.blth % 100 = 12)],
           array[max(p.kwh) filter (where p.blth % 100 = 1), max(p.kwh) filter (where p.blth % 100 = 2), max(p.kwh) filter (where p.blth % 100 = 3), max(p.kwh) filter (where p.blth % 100 = 4), max(p.kwh) filter (where p.blth % 100 = 5), max(p.kwh) filter (where p.blth % 100 = 6), max(p.kwh) filter (where p.blth % 100 = 7), max(p.kwh) filter (where p.blth % 100 = 8), max(p.kwh) filter (where p.blth % 100 = 9), max(p.kwh) filter (where p.blth % 100 = 10), max(p.kwh) filter (where p.blth % 100 = 11), max(p.kwh) filter (where p.blth % 100 = 12)]::real[],
           array[max(p.jam_nyala) filter (where p.blth % 100 = 1), max(p.jam_nyala) filter (where p.blth % 100 = 2), max(p.jam_nyala) filter (where p.blth % 100 = 3), max(p.jam_nyala) filter (where p.blth % 100 = 4), max(p.jam_nyala) filter (where p.blth % 100 = 5), max(p.jam_nyala) filter (where p.blth % 100 = 6), max(p.jam_nyala) filter (where p.blth % 100 = 7), max(p.jam_nyala) filter (where p.blth % 100 = 8), max(p.jam_nyala) filter (where p.blth % 100 = 9), max(p.jam_nyala) filter (where p.blth % 100 = 10), max(p.jam_nyala) filter (where p.blth % 100 = 11), max(p.jam_nyala) filter (where p.blth % 100 = 12)]::real[],
           array[max(k.id) filter (where p.blth % 100 = 1), max(k.id) filter (where p.blth % 100 = 2), max(k.id) filter (where p.blth % 100 = 3), max(k.id) filter (where p.blth % 100 = 4), max(k.id) filter (where p.blth % 100 = 5), max(k.id) filter (where p.blth % 100 = 6), max(k.id) filter (where p.blth % 100 = 7), max(k.id) filter (where p.blth % 100 = 8), max(k.id) filter (where p.blth % 100 = 9), max(k.id) filter (where p.blth % 100 = 10), max(k.id) filter (where p.blth % 100 = 11), max(k.id) filter (where p.blth % 100 = 12)]::smallint[],
           bit_or(1 << (p.blth % 100 - 1))
    from pakai_paska p left join kode_baca k on k.kode = p.kdbaca
    group by p.idpel, p.blth / 100
    on conflict (idpel, tahun) do nothing;
    insert into bulan_data (dataset, blth, n, status, file, oleh, waktu)
    select 'paska', blth, count(*), 'ok', '(dipindah dari tabel lama)', 'v1.8a', now() from pakai_paska group by blth
    on conflict (dataset, blth) do nothing;
    select count(*), coalesce(sum(kwh), 0) into n_old, k_old from pakai_paska;
    select count(*), coalesce(sum(t.kwh[g]::float8), 0) into n_new, k_new
    from pakai_paska_th t cross join generate_series(1, 12) g where t.ada & (1 << (g - 1)) <> 0;
    if n_old <> n_new or abs(k_old - k_new) > greatest(1, k_old * 0.000001) then
      raise exception 'Pemindahan DPM tidak cocok: lama % baris / % kWh, baru % baris / % kWh. Tidak ada yang diubah.', n_old, k_old, n_new, k_new;
    end if;
    raise notice 'DPM dipindah: % baris bulanan, % kWh', n_new, round(k_new);
  end if;

  drop table pakai_paska;
  drop table pakai_pra;
end $$;

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

-- Versi aplikasi lama tidak boleh lagi mengosongkan DPM/OLAP lewat fungsi ini
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

-- Perbarui statistik tabel setelah unggah besar
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

-- ---------- 6. Meta & Kelola Data -------------------------------------
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

-- ---------- 7. Skor risiko: berpangkal dari pelanggan di DPM / OLAP terbaru ----------
--  Paskabayar : semua pelanggan di DPM bulan terbaru (DIL hanya untuk nama, alamat, koordinat, gardu, tera)
--  Prabayar   : pelanggan yang membeli token dalam 3 bulan terakhir + pelanggan prabayar AKTIF di DIL,
--               kecuali yang muncul di DPM bulan terbaru (sudah paskabayar)
--  Jam nyala prabayar = rata-rata kWh token 3 bulan terakhir ÷ kVA
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

-- ---------- 8. Recovery & riwayat pemakaian ----------------------------
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

-- Hitung ulang skor (dipanggil aplikasi). Batas waktu dinaikkan ke 120 detik khusus fungsi ini.
create or replace function f_hitung_skor() returns integer
language plpgsql volatile security definer set search_path = public set statement_timeout = '120s' as $$
begin
  if not can_upload() then raise exception 'Akses ditolak: hanya pengunggah'; end if;
  return f_refresh_skor_internal();
end $$;

-- Hak eksekusi: fungsi API hanya untuk pengguna login; fungsi internal tidak lewat API
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('f_simpan_bulan','f_selesai_bulan','f_buang_stg','f_hitung_skor','f_hapus_data','f_clear_month',
             'f_after_upload','f_meta','f_datasets','f_risiko','f_peta_risiko','f_recovery','f_usage_hist')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
revoke execute on function f_refresh_skor_internal() from public, anon, authenticated;
revoke execute on function dil_jaga_masking() from public, anon, authenticated;
notify pgrst, 'reload schema';

-- ---------- 10. Hitung ulang skor dengan rumus baru ----------
select f_refresh_skor_internal() as skor_baru;

commit;

-- Selesai. Hasil yang diharapkan: "skor_baru" berisi jumlah pelanggan berskor.
