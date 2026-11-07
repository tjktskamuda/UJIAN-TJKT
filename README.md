# UJIAN TJKT — Sistem Ujian Online

Frontend statis (GitHub Pages) untuk **Sistem Ujian Online** SMKN 1 Murung Pudak.

```
GitHub Pages (file di repo ini)  →  Google Apps Script (API JSON)  →  Supabase (database)
```

| Halaman | Alamat |
|---|---|
| Siswa | `https://<akun>.github.io/<repo>/` |
| Admin / guru | `https://<akun>.github.io/<repo>/admin.html` |

## Pengaturan

Hanya satu file yang perlu diubah: **`config.js`**

```js
window.APP_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/ID_DEPLOYMENT/exec'
};
```

`API_URL` = URL Web App Apps Script (Terapkan → Kelola deployment). URL ini boleh publik.
Kunci Supabase **tidak pernah** ditaruh di repo ini — kunci hanya ada di Script Properties Apps Script.

Aktifkan GitHub Pages: **Settings → Pages → Deploy from a branch → `main` / root**.

## Isi repo

| File | Fungsi |
|---|---|
| `index.html` | Halaman siswa (pilih mapel → kelas → nama → ujian → hasil) |
| `admin.html` | Dashboard admin |
| `config.js` | Alamat API |
| `styles.css` | Tampilan Liquid Glass |
| `app.js` | Pemanggil API (fetch), modal, toast, utilitas |
| `exam.js` | Timer server, autosave, anti-cheating, **jeda otomatis saat koneksi putus** |
| `admin.js` | Dashboard admin |

## Koneksi siswa terputus?

Ujian otomatis **dijeda**: soal disembunyikan dan timer berhenti. Saat internet kembali, siswa melanjutkan **soal yang sama dengan sisa waktu yang sama**. Ini juga berlaku setelah memuat ulang halaman. Setiap jeda tercatat untuk pengawas (menu Pelanggaran, tingkat INFO). Batas total jeda diatur di menu Pengaturan.

Panduan lengkap (instalasi Supabase, Apps Script, deployment): lihat `PANDUAN.md` di paket backend.
