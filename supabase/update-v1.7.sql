-- =====================================================================
-- Dashboard P2TL · update v1.7 (Rapor bulanan di Ringkasan Eksekutif)
-- Jalankan SEKALI di Supabase → SQL Editor (aman dijalankan ulang).
-- Mengganti f_capaian: ditambah per bulan
--   risk : jumlah kasus ≥ 50.000 kWh dan kWh dari 5 kasus terbesar (Laporan TS, tgl register)
--   belum: potensi kWh temuan (per bulan pemeriksaan) yang belum cocok dengan Laporan TS
-- Butuh update v1.6 (tabel target_p2tl) sudah dijalankan.
-- =====================================================================
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

revoke all on function f_capaian(date) from public, anon;
grant execute on function f_capaian(date) to authenticated;
notify pgrst, 'reload schema';
