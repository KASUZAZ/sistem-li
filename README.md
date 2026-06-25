# Sistem LI

Sistem LI ialah portal ringkas untuk pengurusan Latihan Industri. Sistem ini membolehkan pelajar menghantar log mingguan, memuat naik gambar passport dan gambar aktiviti, melihat laporan mingguan/bulanan, serta membolehkan admin atau penyelia menyemak dan mengesahkan laporan.

## Fungsi Utama

- Login mengikut peranan: Pelajar, Penyelia Universiti dan Admin.
- Dashboard pelajar dengan maklumat penempatan, syarikat dan penyelia.
- Log mingguan dengan upload gambar aktiviti.
- Report pelajar secara mingguan dan bulanan.
- Pengesahan log dan tandatangan penyelia.
- Dashboard admin dengan tools pengurusan pelajar, syarikat, penyelia, report, import CSV dan analitik.
- Data disimpan menggunakan Supabase.

## Akaun Demo

Admin:

```text
Login: admin
Password: falysa123
```

Penyelia:

```text
Login: Izah@micost.edu.my
Password: penyelia123
```

Pelajar:

```text
Login: DKM03020001
Password: dkm2
```

## Supabase

Database Supabase digunakan untuk menyimpan:

- maklumat pelajar
- log mingguan
- pengesahan penyelia
- gambar passport pelajar
- gambar aktiviti harian/mingguan

Fail `supabase-schema.sql` boleh digunakan untuk setup semula table dan data awal dalam Supabase SQL Editor.

## Deploy Netlify

Untuk deploy:

1. Connect repository ini ke Netlify.
2. Build command: kosongkan.
3. Publish directory: root folder.
4. Deploy site.

Sistem ini ialah static frontend dan akan terus berhubung dengan Supabase melalui konfigurasi dalam `app.js`.

## Nota

Setup Supabase sekarang sesuai untuk demo/FYP. Untuk production sebenar, password perlu disimpan secara lebih selamat dan Row Level Security policy perlu diketatkan.
