# WA Telesales Assistant

Aplikasi desktop Windows portable untuk mengelola satu sesi WhatsApp Web, mengirim satu template campaign ke daftar kontak, dan membuat draft saran balasan memakai AI lokal bawaan. Operator tetap meninjau dan menekan **Kirim** untuk setiap balasan masuk.

## Status

Ini adalah MVP fondasi. Aplikasi menyimpan sesi WhatsApp dan metadata campaign secara lokal supaya dapat reconnect setelah laptop restart. Campaign tidak berjalan otomatis setelah restart; operator harus membuka aplikasi dan menekan **Mulai**.

## Prasyarat versi portable

- Windows 10/11 64-bit.
- WhatsApp aktif di ponsel.
- Ruang kosong sekitar 2 GB untuk executable dan data awal model.
- Internet untuk koneksi WhatsApp Web. AI berjalan offline setelah aplikasi dibuka.

Tidak perlu Node.js, npm, Ollama, API key, akun provider, atau download model tambahan.

## Menjalankan

```powershell
npm install
npm start
```

Pada pembukaan pertama, aplikasi akan menampilkan QR. Scan QR dari WhatsApp ponsel. Sesi disimpan oleh `whatsapp-web.js` di folder data aplikasi. Tombol **Ganti nomor** menghapus sesi tersebut dan meminta scan QR baru.

## Membagikan ke laptop lain

Gunakan satu file [WA Telesales Assistant 0.1.0.exe](../dist/WA%20Telesales%20Assistant%200.1.0.exe) dari folder `dist/`. Salin file tersebut ke laptop Windows 10/11 64-bit lalu jalankan dengan double-click. Tidak perlu menginstal Node.js, npm, Python, Ollama, runtime AI, Chromium, atau library tambahan. Ukuran file sekitar 1,3 GB karena Chromium, runtime AI, dan model sudah dibundel. Laptop tujuan tetap membutuhkan internet untuk WhatsApp Web dan harus scan QR untuk nomor yang digunakan di laptop itu.

Jika template gambar sudah tersimpan di metadata lalu aplikasi dipindahkan ke laptop lain, pilih ulang file gambarnya karena path file lokal tidak ikut dipindahkan.

Versi portable membundel Chromium, runtime `llama.cpp`, dan model Qwen2.5 1.5B Instruct quantized untuk WhatsApp Web dan saran balasan AI. Semua proses AI berjalan di laptop; isi chat tidak dikirim ke provider cloud.

## Format kontak

CSV/XLSX/Google Sheets published CSV harus memiliki header:

```csv
Nama,Nomor
Ani,08123456789
Budi,628123456789
```

Angka yang diawali `08` otomatis dinormalisasi menjadi kode negara Indonesia `62`. Nomor negara lain sebaiknya sudah ditulis dalam format internasional.

Untuk XLSX, formatkan kolom `Nomor` sebagai **Text** agar angka `08...` tidak dipotong oleh Excel. Angka lokal yang sudah kehilangan angka `0` dan dimulai dengan `8` juga akan dibaca sebagai nomor Indonesia. File `.xls` lama perlu disimpan ulang sebagai `.xlsx` atau `.csv`.

## Alur penggunaan

1. Buka aplikasi secara manual.
2. Tunggu status WhatsApp menjadi `Ready` atau scan QR.
3. Import kontak dari file atau link Google Sheets yang sudah dipublikasikan sebagai CSV.
4. Isi nama campaign, target audiens, tahap, jeda detik, dan batas penerima per hari.
5. Pilih template teks atau gambar. Teks mendukung `{Nama}`; gambar dapat dikirim tanpa caption.
6. Tekan **Mulai campaign**.
7. Saat user membalas, draft muncul di panel kanan. Periksa, edit bila perlu, lalu tekan **Kirim jawaban**.

## AI dan aturan QC

AI bawaan menggunakan `llama.cpp` dan model Qwen2.5 1.5B Instruct Q4. Panel AI menampilkan status loading/ready/error. Runtime dimulai otomatis ketika aplikasi dibuka dan dihentikan ketika aplikasi ditutup.

Instruksi prompt di `src/qcPrompt.js` diringkas dari skill `telesales-quality-check`: pahami campaign/tahap/audiens, jawab pertanyaan langsung, gunakan probing yang singkat, kaitkan manfaat dengan kebutuhan, dan jangan membuat klaim harga/promo. Jika user menanyakan harga atau promo, draft meminta operator mengecek manual.

Isi percakapan tidak ditulis ke metadata. Metadata lokal hanya berisi konfigurasi, daftar kontak, status antrean, dan posisi campaign agar operator dapat melanjutkan secara manual setelah restart. Draft dan pesan masuk berada di memori aplikasi selama aplikasi berjalan.

Batas penerima harian disimpan bersama metadata dan dihitung ulang setiap pergantian tanggal lokal laptop. Panel campaign menampilkan indikator risiko berdasarkan jeda dan volume. Indikator itu hanya peringatan operasional: tidak ada angka jeda atau volume yang dapat menjamin akun WhatsApp bebas pembatasan. Hentikan campaign jika muncul peringatan WhatsApp, kegagalan berulang, atau respons negatif; gunakan hanya kontak yang memiliki dasar izin/relasi komunikasi yang sah.

## Build portable Windows

```powershell
npm run dist
```

Perintah build mengambil Chromium dari cache Puppeteer pada laptop pembuat lalu memasukkannya ke executable portable. Jalankan build pada laptop yang memiliki koneksi internet agar cache Chromium tersedia.

Hasil portable akan dibuat di folder `dist/`.

Checklist pengujian manual tersedia di [docs/TEST-PLAN.md](docs/TEST-PLAN.md).

## Catatan dependency

`npm audit --omit=dev` perlu dijalankan sebelum aplikasi dibagikan luas. Integrasi WhatsApp Web membawa dependency browser automation; file Excel/CSV juga sebaiknya hanya dibuka dari sumber yang dipercaya. Runtime AI dan model portable berasal dari llama.cpp dan Qwen yang didistribusikan dengan lisensi masing-masing.

## Batasan MVP

- WhatsApp Web dapat berubah sehingga integrasi perlu dirawat jika library atau halaman berubah.
- Aplikasi harus dibuka manual oleh operator dan koneksi internet harus tersedia.
- Jeda hanya mengatur waktu antar pengiriman; tidak ada angka yang menjamin akun bebas pembatasan.
- Indikator risiko dan batas harian membantu mengendalikan volume, tetapi bukan mekanisme anti-ban. Jika muncul peringatan WhatsApp, pengiriman gagal berulang, akun dibatasi, atau penerima mengeluh, segera tekan `Pause / Stop` dan lakukan review manual.
- Tidak ada login multi-user, laporan historis, notifikasi, atau penyimpanan riwayat chat.
- Jika status kontak menjadi `needs_review` setelah koneksi bermasalah, operator harus memilih **Tandai sudah terkirim** atau **Kirim ulang** setelah memeriksa chat WhatsApp. Tombol **Reset antrean** mengirim ulang semua kontak setelah operator menekannya.
