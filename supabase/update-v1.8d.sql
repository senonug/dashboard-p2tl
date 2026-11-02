-- =====================================================================
--  Dashboard P2TL — pembaruan v1.8d (login cukup dengan sandi tim)
--
--  LANGKAH 1 (sekali, di Supabase, bukan SQL):
--    Authentication › Users › Add user › Create new user
--      Email    : tim-p2tl@up3-lentengagung.id
--      Password : (sandi tim yang disepakati)
--      Centang  : Auto Confirm User
--
--  LANGKAH 2: jalankan file ini di SQL Editor (mendaftarkan akun bersama sebagai viewer = lihat saja).
--  Akun email admin yang lama tetap berlaku lewat tautan "Masuk dengan email".
-- =====================================================================
insert into app_user (email, nama, role)
values ('tim-p2tl@up3-lentengagung.id', 'Tim P2TL', 'viewer')
on conflict (email) do update set nama = excluded.nama, role = 'viewer';
