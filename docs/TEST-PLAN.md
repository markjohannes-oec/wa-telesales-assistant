# Checklist Uji Operasional

Jalankan dengan nomor uji dan kontak yang sudah memberi izin menerima pesan. Jangan langsung memakai daftar besar.

## Persiapan

- Pastikan WhatsApp di ponsel aktif dan laptop terhubung internet.
- Pastikan ruang kosong sekitar 2 GB tersedia untuk executable portable dan data sesi.
- Siapkan `sample-contacts.csv` atau file XLSX dengan header `Nama,Nomor`.

## Uji koneksi

1. Buka aplikasi secara manual.
2. Pastikan QR muncul pada penggunaan pertama.
3. Scan QR dan tunggu status `Ready`.
4. Tutup lalu buka kembali aplikasi. Pastikan sesi reconnect tanpa scan ulang.
5. Tekan `Ganti nomor`. Pastikan sesi lama dihapus dan QR baru muncul.

## Uji import

- Import CSV dengan nomor `0812...`, `+628...`, dan nomor duplikat.
- Pastikan nomor lokal menjadi `628...`, duplikat hanya muncul sekali, dan nomor invalid dilewati.
- Import XLSX dengan header `Nama,Nomor`.
- Publikasikan Google Sheet sebagai CSV lalu import link-nya.
- Pastikan file `.xls` lama ditolak dengan pesan yang jelas dan dapat disimpan ulang sebagai `.xlsx`.

## Uji campaign

1. Masukkan satu template teks dengan `{Nama}`.
2. Isi jeda yang cukup untuk uji kecil.
3. Isi batas penerima harian lebih kecil daripada jumlah kontak, lalu pastikan campaign berhenti saat batas tercapai dan angka tetap setelah aplikasi dibuka ulang.
4. Tekan `Mulai campaign` dan periksa pesan pada kontak uji.
5. Tekan `Pause / Stop` lalu pastikan pesan berikutnya tidak dikirim.
6. Lanjutkan campaign dengan menekan `Mulai campaign`.
7. Uji template gambar tanpa caption dan dengan caption `{Nama}`.
8. Pindahkan/ubah path gambar lalu tekan `Mulai campaign`; pastikan aplikasi menolak dengan pesan untuk memilih ulang gambar.
9. Matikan koneksi atau tutup aplikasi saat status `sending`. Buka kembali dan pastikan kontak menjadi `needs_review`; pilih `Tandai sudah terkirim` atau `Kirim ulang` setelah memeriksa chat.
10. Uji `Reset antrean` hanya setelah memang ingin mengirim ulang seluruh daftar.
11. Masukkan jeda sangat kecil atau volume tinggi dan pastikan panel menampilkan peringatan risiko; peringatan tidak boleh dianggap sebagai jaminan aman.

## Uji balasan AI

- Kirim beberapa balasan dari kontak uji saat aplikasi aktif.
- Pastikan setiap balasan tampil sebagai item terpisah.
- Pastikan draft tidak terkirim otomatis.
- Edit draft lalu tekan `Kirim jawaban`.
- Tutup runtime AI bawaan atau uji saat model belum selesai dimuat, kirim balasan, pastikan error menampilkan tombol `Coba lagi`.
- Uji pertanyaan harga/promo dan pastikan draft meminta operator melakukan pengecekan manual.

## Kriteria siap operasional terbatas

- Semua uji di atas lulus pada satu laptop.
- Operator memahami status `needs_review` dan tidak mengirim ulang tanpa memeriksa chat.
- Kontak yang dipakai sudah memberikan persetujuan menerima pesan.
- Operator memulai dengan volume kecil dan memantau kualitas akun WhatsApp.
