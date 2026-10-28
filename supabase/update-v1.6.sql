-- =====================================================================
-- Dashboard P2TL · update v1.6 (Ringkasan Eksekutif: capaian target)
-- Jalankan SEKALI di Supabase → SQL Editor (aman dijalankan ulang).
-- Isi:
--  1. Tabel target_p2tl (target kWh TS terbayar per tahun), terisi 2026 = 11.500.820 kWh
--  2. f_capaian(p_to): realisasi kWh TS terbayar per bulan tahun berjalan + target
--  3. f_target_list() untuk dibaca semua pengguna, f_set_target() khusus admin
-- =====================================================================

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

do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('f_capaian', 'f_target_list', 'f_set_target')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
notify pgrst, 'reload schema';
