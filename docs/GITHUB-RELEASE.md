# GitHub Release

Source code disimpan di repository. File Windows portable disimpan sebagai asset pada GitHub Release karena ukurannya sekitar 1,3 GB dan tidak seharusnya masuk ke riwayat Git.

## Release pertama

1. Buat tag versi, misalnya `v0.1.0`.
2. Push tag tersebut ke GitHub.
3. GitHub Actions menjalankan `npm ci`, menyiapkan Chromium dan AI lokal, membangun executable portable, menghitung SHA256, lalu membuat Release.
4. Unduh executable dari halaman Release.

Workflow membutuhkan waktu cukup lama karena model AI lokal berukuran sekitar 1,1 GB.

## Verifikasi file di Windows

```powershell
Get-FileHash ".\WA Telesales Assistant 0.1.0.exe" -Algorithm SHA256
```

Bandingkan hasilnya dengan `SHA256SUMS.txt` pada release yang sama.
