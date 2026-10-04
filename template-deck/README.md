# Template Deck

Cetakan slide presentasi kosong dengan desain yang sama seperti deck PGRI 13 Okt 2026.

## Cara pakai untuk kegiatan baru

1. Duplikat folder ini dengan nama `YYYY-MM-DD-nama-acara`, mis. `2026-11-20-seminar-guru-hebat/`
2. Edit `index.html`: ganti teks yang bertanda `<!-- GANTI: ... -->`
3. Kalau perlu gambar sendiri, buat folder `assets/` di dalam folder deck dan arahkan `src` ke sana
4. Tambahkan satu kartu di landing page (`index.html` di root repo)
5. Commit + push — GitHub Pages otomatis menayangkan

## Komponen siap pakai

- `.slide.cover` — sampul (ganti `cover-default.jpg` bila perlu)
- `.kicker`, `h2`, `.lead`, `.bullets` — teks
- `.cards.c2/.c3/.c4` — kartu kolom
- `.steps` + `.step` — alur langkah
- `.quote` — kutipan
- `.watermark` — hiasan emoji sisi kanan (contoh: `<span class="watermark">🎯</span>`)
- `.vs` — perbandingan buruk vs baik

Navigasi: panah ← → / spasi / klik • `F` fullscreen.
