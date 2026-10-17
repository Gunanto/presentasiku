# Presentasiku

Arsip slide presentasi **Gunanto** (Guru Matematika — SMPN 1 Punggur) sebagai narasumber/pemateri.

🌐 **Live:** https://gunanto.github.io/presentasiku/

## Struktur

| Path | Isi |
|---|---|
| `index.html` | Landing page — daftar semua presentasi |
| `assets-bersama/` | Logo, sampul default, dan aset yang dipakai bersama |
| `template-deck/` | Cetakan slide kosong untuk kegiatan baru |
| `2026-10-13-pgri-ai-digital/` | Deck: AI dan Literasi Digital dalam Pendidikan (PGRI Lampung Tengah, Hotel BBC Bandarjaya) |

## Menambah presentasi baru

1. Duplikat `template-deck/` → `YYYY-MM-DD-nama-acara/`
2. Isi konten, tambah kartu di landing page
3. Push ke `main` — GitHub Pages menayangkan otomatis

## Proteksi token

Landing page dan halaman login tetap publik. Semua path lain di VPS dilindungi oleh Nginx dan service token, termasuk folder slide baru. Thumbnail yang dipakai landing page dikecualikan secara eksplisit agar kartu tetap tampil.

Source service auth, unit systemd, konfigurasi Nginx, dan script deploy ada di `.auth/` dan `deploy.sh`. Nilai token tetap berada di `tokenslide.md` lokal dan `/etc/gezyslide-auth.env` di VPS; keduanya tidak dikirim ke GitHub.

Admin VPS tersedia di `https://slide.gezytech.web.id/admin.html`. Dari halaman itu admin dapat mengganti token, mengurutkan atau menonaktifkan card, dan menambah card baru. Konfigurasi aktif disimpan di `/var/lib/gezyslide/config.json`, di luar folder deploy, sehingga tidak tertimpa saat pull atau deploy.

Deploy dari checkout lokal dengan:

```bash
./deploy.sh
```
