# Dashboard P2TL · UP3 Lenteng Agung

Dashboard web untuk menganalisis hasil pemeriksaan P2TL, digabung dengan data pemakaian (DPM paskabayar, OLAP prabayar), Data Induk Langganan, dan Laporan TS terbayar.

- **Tampilan web:** GitHub Pages (gratis), bisa dibuka dari mana saja.
- **Database & login:** Supabase (paket gratis: database 500 MB).
- **Unggah data:** file dibaca dan diringkas di browser, lalu hanya kolom yang dipakai yang dikirim ke database. NIK dan nomor HP pelanggan dibuang.

---

## A. Pasang database Supabase (sekali saja, ±5 menit)

> Untuk project `mxrjpvppliskfcnjkvto`, langkah 1–2 dan 6 **sudah dikerjakan** (skema terpasang, admin `nugrohoseno07@gmail.com` terdaftar). Tinggal langkah 3–5.

1. Buka project Supabase Anda, lalu pilih **SQL Editor** › **New query**.
2. Salin **seluruh isi** file `supabase/schema.sql`, tempel, lalu klik **Run**. Pastikan hasilnya *Success*.
3. **Authentication** › **Sign In / Providers** › **Email**: matikan **Allow new users to sign up**, supaya hanya akun yang diundang yang bisa masuk.
4. **Authentication** › **URL Configuration**:
   - *Site URL*: `https://senonug.github.io/dashboard-p2tl/`
   - *Redirect URLs*: tambahkan `https://senonug.github.io/dashboard-p2tl/**`
5. **Authentication** › **Users** › **Add user** › **Create new user**: isi email dan kata sandi Anda, lalu centang *Auto Confirm User*.
6. Kembali ke **SQL Editor**, ganti email di bawah ini, lalu jalankan:
   ```sql
   insert into app_user (email, nama, role) values ('email.anda@contoh.com', 'Seno Nugroho', 'admin')
   on conflict (email) do update set role = 'admin';
   ```

## B. Terbitkan web di GitHub Pages (±5 menit)

1. Di GitHub, buat repository baru bernama **`dashboard-p2tl`** dengan visibilitas **Public**. GitHub Pages gratis mensyaratkan repo publik. Yang publik hanya kode tampilannya; data tetap terkunci di Supabase dengan login.
2. Di repo tersebut pilih **Add file** › **Upload files**. Tarik **isi** folder ini (`index.html`, folder `assets`, folder `supabase`, `README.md`) lalu klik **Commit changes**.
3. **Settings** › **Pages** › *Source*: **Deploy from a branch**, *Branch*: `main` / `(root)`, lalu **Save**.
4. Tunggu 1–2 menit, kemudian buka **https://senonug.github.io/dashboard-p2tl/**.

## C. Isi data pertama kali

1. Masuk dengan akun admin dari langkah A.5.
2. Buka **Kelola & Unggah Data**, lalu tarik kelima file sekaligus. Jenisnya dikenali otomatis.
3. Periksa layar validasi tiap file, lalu klik **Terapkan data**.
   - DIL (±110 MB) butuh sekitar 20–40 detik untuk dibaca dan sekitar 1 menit untuk dikirim.
   - OLAP prabayar butuh sekitar 15 detik.

## D. Pembaruan rutin

| Data | Kapan | Cara simpan |
|---|---|---|
| Pemeriksaan P2TL | Bulanan, atau kapan saja | Ditambahkan; baris dengan `ID_P2TL` sama diperbarui |
| DPM Baca Paskabayar | Bulanan | Bulan (BLTH) yang sama diganti seluruhnya |
| OLAP Prabayar | Bulanan | Bulan yang sama diganti seluruhnya (diringkas per pelanggan) |
| DIL | Berkala | Diperbarui per IDPEL |
| Laporan TS Terbayar | Bulanan | Ditambahkan; `NO AGENDA` sama diperbarui |

Skor risiko Calon TO dihitung ulang otomatis setiap kali DPM, OLAP, atau DIL diunggah.

## E. Menambah pengguna

1. Supabase › **Authentication** › **Users** › **Invite user** (masukkan email). Pengguna menerima email untuk mengatur kata sandi.
2. Di dashboard, buka **Kelola Data** › **Pengguna dashboard**, lalu daftarkan email yang sama dengan salah satu peran:
   - `viewer`: hanya melihat.
   - `uploader`: melihat dan mengunggah.
   - `admin`: semuanya, termasuk mengatur pengguna dan menghapus bulan lama.

## Catatan penting

- **Supabase gratis dijeda otomatis setelah 7 hari tanpa aktivitas.** Bila dashboard tidak bisa memuat data setelah lama tidak dibuka, masuk ke supabase.com dan klik **Restore project**. Data tidak hilang.
- **Kapasitas:** satu bulan data (DPM + OLAP + pemeriksaan) sekitar 35–40 MB, sedangkan DIL sekitar 90 MB. Kuota 500 MB cukup untuk kira-kira 8–9 bulan. Pemakaian terlihat di halaman Kelola Data, dan admin bisa menghapus bulan pemakaian lama.
- **Format file:** `.xlsx` atau `.csv`. File `.xls` lama perlu disimpan ulang sebagai `.xlsx`.
- **Kerahasiaan:** data pelanggan (nama, alamat, koordinat) tersimpan di server Supabase (Singapura). Pastikan penggunaannya sesuai kebijakan data PLN.

## Struktur

```
index.html              halaman utama
assets/config.js        alamat & publishable key Supabase
assets/app.js           login, menu, filter tanggal, router
assets/pages.js         8 halaman analisis
assets/data.js          halaman Kelola & Unggah Data
assets/worker.js        pembaca file di latar belakang
assets/ingest.js        validasi & pengiriman data
assets/datasets.js      pemetaan kolom 5 jenis file
assets/xlsxstream.js    pembaca .xlsx streaming (hemat memori)
assets/ui.js            komponen grafik & tabel
assets/vendor/          supabase-js, Leaflet, SheetJS, fflate
supabase/schema.sql     tabel, keamanan (RLS), dan fungsi analisis
```
