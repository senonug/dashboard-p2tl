// Konfigurasi koneksi Supabase. Publishable key memang aman berada di halaman web:
// akses data tetap dikunci oleh login + Row Level Security di database.
export const CONFIG = {
  url: 'https://mxrjpvppliskfcnjkvto.supabase.co',
  key: 'sb_publishable_iOleI1CDWft14SfYVOMPZg_ZVgwPW1j',
  unit: 'UP3 Lenteng Agung',
  // Akun bersama untuk login cukup dengan sandi (v1.8d). Hak akses diatur di tabel app_user (peran viewer).
  sharedEmail: 'tim-p2tl@up3-lentengagung.id',
};
