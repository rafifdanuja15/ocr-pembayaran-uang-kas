# Kas KKN — Panduan Setup

Web app pengumpulan bukti pembayaran kas KKN yang terhubung langsung ke Google Sheets dan Google Drive, dilengkapi OCR otomatis untuk membaca nominal dari bukti transfer.

---

## Arsitektur

```
Anggota buka web → Pilih nama & kategori → Upload foto/PDF bukti
         ↓
   Google Apps Script (backend)
         ↓
   Google Drive OCR (ekstrak teks dari gambar/PDF)
         ↓
   LLM Vision (verifikasi nominal transfer)
         ↓                    ↓
  Google Sheets          Google Drive
  (status → Lunas,       (bukti foto
   isi tanggal)           tersimpan)
```

---

## Setup (ikuti urutan ini)

### Langkah 1 — Upload Excel ke Google Sheets

1. Buka [Google Sheets](https://sheets.google.com)
2. Klik **File → Import → Upload** → pilih `Uang_KAS.xlsx`
3. Pilih "Replace spreadsheet" → **Import data**
4. Salin **Spreadsheet ID** dari URL:
```
   https://docs.google.com/spreadsheets/d/[SPREADSHEET_ID]/edit
```

### Langkah 2 — Buat folder Google Drive

1. Buka [Google Drive](https://drive.google.com)
2. Buat folder baru, misal: **"Bukti Kas KKN"**
3. Buka folder → salin **Folder ID** dari URL:
```
   https://drive.google.com/drive/folders/[FOLDER_ID]
```

### Langkah 3 — Deploy Google Apps Script

1. Di Google Sheets, klik **Extensions → Apps Script**
2. Hapus kode default, paste semua isi file `apps-script/Code.gs`
3. Isi konstanta di bagian atas:
```javascript
   const SPREADSHEET_ID = 'paste Spreadsheet ID kamu di sini';
   const DRIVE_FOLDER_ID = 'paste Folder ID Drive kamu di sini';
```
4. Klik **Save** (Ctrl+S)

### Langkah 4 — Aktifkan Drive API v2

> Wajib untuk fitur OCR — tanpa ini pembacaan nominal dari gambar/PDF tidak akan berjalan.

1. Di editor Apps Script, klik **"+ Services"** di sidebar kiri
2. Cari **Drive API** → pilih **Version: v2** → klik **Add**

### Langkah 5 — Set OAuth Scope di `appsscript.json`

1. Klik ikon ⚙️ **Project Settings** → centang **"Show appsscript.json manifest file in editor"**
2. Buka file `appsscript.json`, pastikan isinya seperti ini:
```json
   {
     "timeZone": "Asia/Jakarta",
     "dependencies": {
       "enabledAdvancedServices": [
         {
           "userSymbol": "Drive",
           "version": "v2",
           "serviceId": "drive"
         }
       ]
     },
     "exceptionLogging": "STACKDRIVER",
     "runtimeVersion": "V8",
     "oauthScopes": [
       "https://www.googleapis.com/auth/script.external_request",
       "https://www.googleapis.com/auth/spreadsheets",
       "https://www.googleapis.com/auth/drive",
       "https://www.googleapis.com/auth/documents"
     ],
     "webapp": {
       "executeAs": "USER_DEPLOYING",
       "access": "ANYONE_ANONYMOUS"
     }
   }
```

### Langkah 6 — Isi API Key LLM

1. Di Apps Script, klik **Project Settings → Script Properties**
2. Tambah properti berikut:

   | Property | Value |
   |----------|-------|
   | `SUMOPOD_API_KEY` | API key kamu |
   | `SUMOPOD_BASE_URL` | `https://ai.sumopod.com/v1` |
   | `SUMOPOD_MODEL` | `gpt-4o` |

### Langkah 7 — Deploy Web App

1. Klik **Deploy → New deployment**
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
2. Klik **Deploy** → izinkan semua akses yang diminta → salin **Web App URL**

> **Setiap ada perubahan kode:** Deploy → Manage deployments → Edit (ikon pensil) → Version: **New version** → Deploy. URL tidak berubah.

### Langkah 8 — Isi URL di frontend

Buka `frontend/index.html`, cari baris ini:

```javascript
const APPS_SCRIPT_URL = 'ISI_URL_APPS_SCRIPT_KAMU_DI_SINI';
```

Ganti dengan URL yang disalin tadi.

### Langkah 9 — Deploy ke Netlify (gratis)

**Cara termudah (drag & drop):**
1. Buka [netlify.com](https://netlify.com) → Sign up / Login
2. Drag & drop **folder `frontend/`** ke halaman Netlify
3. Dapat link otomatis, contoh: `https://nama-random.netlify.app`
4. Bagikan link ini ke semua anggota KKN!

**Atau via GitHub (untuk update lebih mudah):**
1. Push folder `frontend/` ke GitHub repo
2. Connect repo ke Netlify → auto-deploy setiap ada perubahan

---

## Cek hasil di Google Sheets

Setelah anggota submit:
- Sheet **"Pemasukan"** → kolom status berubah jadi **Lunas**, kolom tanggal terisi otomatis
- Sheet **"Log Pembayaran"** → tercatat semua history submission dengan link bukti

---

## ⚠️ Troubleshooting

| Masalah | Solusi |
|---------|--------|
| Daftar nama tidak muncul | Pastikan Apps Script URL sudah diisi di `index.html` |
| Error "Nama tidak ditemukan" | Pastikan nama di spreadsheet sama persis (huruf kapital, spasi) |
| Upload gagal | Cek ukuran file < 5 MB, format JPG/PNG/PDF |
| CORS error | Pastikan deployment Apps Script diset "Anyone can access" |
| Status tidak update | Cek `SPREADSHEET_ID` dan nama sheet = `"Pemasukan"` |
| Error permission Drive | Pastikan scope `drive` & `documents` sudah ada di `appsscript.json`, lalu re-deploy |
| OCR tidak berjalan | Pastikan Drive API **v2** (bukan v3) sudah ditambah di Services |
| Nominal tidak terbaca | Foto terlalu blur — minta anggota upload ulang dengan foto lebih jelas |
| LLM error | Cek Script Properties: `SUMOPOD_API_KEY`, `SUMOPOD_BASE_URL`, `SUMOPOD_MODEL` |

---

## 📁 Struktur File

```
kas-kkn/
├── frontend/
│   └── index.html          ← Web app (deploy ke Netlify)
└── apps-script/
    └── Code.gs             ← Backend (paste ke Apps Script)
```
