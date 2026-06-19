// ============================================================
// KONFIGURASI
// ============================================================
const SPREADSHEET_ID = '1DceIE5g3ukwye4jBzm4_EPgscCN8xyJD06ISEg1-PaI';
const SHEET_NAME = 'Pemasukan';
const DRIVE_FOLDER_ID = '1zOLU96iA64aHmrr3723iggqGn66Z5wwj';

const KATEGORI_MAP = {
  'vest_kkn':        { statusCol: 2,  tanggalCol: 3  },
  'makan_minggu_1':  { statusCol: 5,  tanggalCol: 6  },
  'makan_minggu_2':  { statusCol: 8,  tanggalCol: 9  },
  'makan_minggu_3':  { statusCol: 11, tanggalCol: 12 },
  'makan_minggu_4':  { statusCol: 14, tanggalCol: 15 },
};

const NOMINAL_MAP = {
  'vest_kkn':        125000,
  'makan_minggu_1':  200000,
  'makan_minggu_2':  200000,
  'makan_minggu_3':  200000,
  'makan_minggu_4':  200000,
};

// ============================================================
// CORS Helper
// ============================================================
function buildResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// Helper: Cari startRow (baris setelah header "Nama")
// ============================================================
function findStartRow(data) {
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] && data[i][0].toString().trim() === 'Nama') {
      return i + 1;
    }
  }
  return -1;
}

// ============================================================
// OCR Helper - Ekstrak teks dari gambar/PDF via Google Drive
// ============================================================
function extractTextWithOCR(base64Data, mimeType, fileName) {
  let tempDocId = null;

  try {
    const decoded  = Utilities.base64Decode(base64Data);
    const blob     = Utilities.newBlob(decoded, mimeType, fileName || 'ocr_temp');

    const resource = {
      title:    'ocr_temp_' + Date.now(),
      mimeType: 'application/vnd.google-apps.document',
    };
    const options = { ocr: true, ocrLanguage: 'id' };

    const tempFile = Drive.Files.insert(resource, blob, options);
    tempDocId = tempFile.id;

    const doc  = DocumentApp.openById(tempDocId);
    const text = doc.getBody().getText();

    return text.trim();

  } catch (err) {
    Logger.log('OCR error: ' + err.message);
    return '';

  } finally {
    if (tempDocId) {
      try { DriveApp.getFileById(tempDocId).setTrashed(true); } catch (_) {}
    }
  }
}

// ============================================================
// LLM Vision - Baca nominal dari bukti transfer
// ============================================================
function verifyNominalDenganLLM(base64Image, mimeType, ocrText) {
  const props   = PropertiesService.getScriptProperties();
  const apiKey  = props.getProperty('SUMOPOD_API_KEY');
  const baseUrl = props.getProperty('SUMOPOD_BASE_URL') || 'https://ai.sumopod.com/v1';
  const model   = props.getProperty('SUMOPOD_MODEL')    || 'gpt-4o';

  const ocrContext = ocrText
    ? `\n\nTeks yang berhasil diekstrak otomatis dari gambar (gunakan sebagai referensi):\n---\n${ocrText}\n---`
    : '';

  const prompt = `Lihat gambar bukti transfer ini.
Temukan angka nominal transfer utama — biasanya angka paling besar dan mencolok di halaman.

Untuk BCA/Blu: cari tulisan "IDR xxx,xxx.xx" yang besar di tengah, atau field "Amount".
Untuk GoPay/OVO/Dana: cari nominal di bagian tengah struk.
Abaikan biaya admin/fee — hanya ambil nominal transfer utama.
Kembalikan nominal dalam angka bulat tanpa titik/koma/desimal (contoh: 125000 bukan 125.000).${ocrContext}

Balas HANYA JSON ini, tanpa teks lain, tanpa markdown:
{"nominal": 125000}

Jika tidak ada nominal sama sekali, balas:
{"nominal": null}`;

  const contentBlocks = [{ type: 'text', text: prompt }];

  // Gambar/screenshot dikirim sebagai image_url, PDF tidak bisa → andalkan OCR text saja
  if (mimeType.startsWith('image/')) {
    contentBlocks.push({
      type:      'image_url',
      image_url: { url: `data:${mimeType};base64,${base64Image}` },
    });
  }

  const payload = {
    model,
    temperature: 0,
    max_tokens:  100,
    messages:    [{ role: 'user', content: contentBlocks }],
  };

  const fetchOptions = {
    method:             'post',
    contentType:        'application/json',
    headers:            { Authorization: 'Bearer ' + apiKey },
    payload:            JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  const res  = UrlFetchApp.fetch(`${baseUrl}/chat/completions`, fetchOptions);
  const code = res.getResponseCode();
  const body = res.getContentText();

  if (code !== 200) throw new Error(`Sumopod API error (${code}): ${body}`);

  const json    = JSON.parse(body);
  const rawText = json.choices?.[0]?.message?.content || '';
  const cleaned = rawText.replace(/```json|```/g, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error('Respons LLM tidak bisa diparse: ' + rawText);
  }

  return parsed.nominal;
}

// ============================================================
// GET - Ambil daftar nama anggota
// ============================================================
function doGet(e) {
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    const data  = sheet.getDataRange().getValues();

    const startRow = findStartRow(data);
    if (startRow === -1) {
      return buildResponse({ success: false, error: 'Header "Nama" tidak ditemukan di sheet.' });
    }

    const anggota = [];
    for (let i = startRow; i < data.length; i++) {
      const row  = data[i];
      const nama = row[0];
      if (!nama || nama.toString().startsWith('Notes')) break;

      anggota.push({
        nama:           nama,
        vest_kkn:       row[2]  || 'Belum',
        makan_minggu_1: row[5]  || 'Belum',
        makan_minggu_2: row[8]  || 'Belum',
        makan_minggu_3: row[11] || 'Belum',
        makan_minggu_4: row[14] || 'Belum',
      });
    }

    return buildResponse({ success: true, anggota, debug: { totalRows: data.length, startRow } });
  } catch (err) {
    return buildResponse({ success: false, error: err.message });
  }
}

// ============================================================
// POST - Terima submission form pembayaran
// ============================================================
function doPost(e) {
  try {
    const params = JSON.parse(e.postData.contents);
    const { nama, kategori, buktiBase64, buktiMimeType, buktiFileName } = params;

    if (!nama || !kategori || !buktiBase64) {
      return buildResponse({ success: false, error: 'Data tidak lengkap.' });
    }

    const mapping           = KATEGORI_MAP[kategori];
    const nominalSeharusnya = NOMINAL_MAP[kategori];
    if (!mapping || !nominalSeharusnya) {
      return buildResponse({ success: false, error: 'Kategori tidak valid.' });
    }

    // ── OCR dulu sebelum kirim ke LLM ───────────────────────
    let ocrText = '';
    try {
      ocrText = extractTextWithOCR(buktiBase64, buktiMimeType, buktiFileName);
      Logger.log('OCR result (300 char): ' + ocrText.substring(0, 300));
    } catch (ocrErr) {
      Logger.log('OCR skipped: ' + ocrErr.message);
    }

    // ── Verifikasi nominal via LLM ──────────────────────────
    let nominalTerdeteksi;
    try {
      nominalTerdeteksi = verifyNominalDenganLLM(buktiBase64, buktiMimeType, ocrText);
    } catch (err) {
      return buildResponse({ success: false, error: 'Gagal verifikasi bukti: ' + err.message });
    }

    if (nominalTerdeteksi === null || nominalTerdeteksi === undefined) {
      return buildResponse({
        success: false,
        error:   'Nominal tidak terbaca jelas di gambar. Coba upload ulang dengan foto yang lebih jelas.',
      });
    }

    if (Number(nominalTerdeteksi) !== Number(nominalSeharusnya)) {
      return buildResponse({
        success:           false,
        error:             `Nominal tidak sesuai. Kategori ini butuh Rp${Number(nominalSeharusnya).toLocaleString('id-ID')}, tapi di bukti terbaca Rp${Number(nominalTerdeteksi).toLocaleString('id-ID')}.`,
        nominalTerdeteksi,
        nominalSeharusnya,
      });
    }

    // ── Simpan bukti ke Drive ────────────────────────────────
    const folder       = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    const timestamp    = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyyMMdd_HHmmss');
    const safeNama     = nama.replace(/\s+/g, '_');
    const extension    = buktiFileName ? buktiFileName.split('.').pop() : 'jpg';
    const fullFileName = `${safeNama}_${kategori}_${timestamp}.${extension}`;

    const decoded = Utilities.base64Decode(buktiBase64);
    const blob    = Utilities.newBlob(decoded, buktiMimeType || 'image/jpeg', fullFileName);
    const file    = folder.createFile(blob);
    const fileUrl = file.getUrl();

    // ── Update sheet ─────────────────────────────────────────
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    const data  = sheet.getDataRange().getValues();

    const startRow = findStartRow(data);
    if (startRow === -1) {
      return buildResponse({ success: false, error: 'Header "Nama" tidak ditemukan di spreadsheet.' });
    }

    let rowFound = -1;
    for (let i = startRow; i < data.length; i++) {
      if (data[i][0] && data[i][0].toString().trim() === nama.trim()) {
        rowFound = i + 1;
        break;
      }
    }

    if (rowFound === -1) {
      return buildResponse({ success: false, error: `Nama "${nama}" tidak ditemukan di spreadsheet.` });
    }

    const today = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'dd/MM/yyyy');
    sheet.getRange(rowFound, mapping.statusCol  + 1).setValue('Lunas');
    sheet.getRange(rowFound, mapping.tanggalCol + 1).setValue(today);

    logSubmission(ss, nama, kategori, today, fileUrl);

    return buildResponse({
      success:           true,
      message:           `Pembayaran ${nama} untuk ${kategori} berhasil dicatat!`,
      fileUrl,
      nominalTerdeteksi,
      ocrPreview:        ocrText.substring(0, 100) || null,
    });

  } catch (err) {
    return buildResponse({ success: false, error: err.message });
  }
}

// ============================================================
// Helper: Catat log di sheet "Log Pembayaran"
// ============================================================
function logSubmission(ss, nama, kategori, tanggal, fileUrl) {
  let logSheet = ss.getSheetByName('Log Pembayaran');
  if (!logSheet) {
    logSheet = ss.insertSheet('Log Pembayaran');
    logSheet.appendRow(['Timestamp', 'Nama', 'Kategori', 'Tanggal Bayar', 'Link Bukti']);
  }
  logSheet.appendRow([new Date(), nama, kategori, tanggal, fileUrl]);
}