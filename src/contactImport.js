const path = require('node:path');
const fsp = require('node:fs/promises');
const ExcelJS = require('exceljs');

function normalizeHeader(key) {
  return String(key).replace(/^\uFEFF/, '').trim().toLowerCase();
}

function normalizeNumber(raw, defaultCountryCode = '62') {
  let value = String(raw ?? '').trim();
  const hadPlus = value.startsWith('+');
  value = value.replace(/\D/g, '');
  if (value.startsWith('00')) value = value.slice(2);
  if (value.startsWith('0')) value = `${defaultCountryCode}${value.slice(1)}`;
  if (!hadPlus && value.startsWith('8') && value.length >= 9 && value.length <= 12) value = `${defaultCountryCode}${value}`;
  return /^\d{8,15}$/.test(value) ? value : '';
}

function parseCsvText(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') { field += '"'; index += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === ',' && !quoted) { row.push(field); field = ''; continue; }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(field); field = '';
      if (row.some((value) => String(value).trim() !== '')) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift().map((value) => String(value).replace(/^\uFEFF/, '').trim());
  return rows.map((values) => headers.reduce((record, header, index) => {
    if (header) record[header] = values[index] ?? '';
    return record;
  }, {}));
}

async function parseWorkbook(filePathOrText, options = {}) {
  if (options.type === 'string') return parseCsvText(filePathOrText);
  const extension = path.extname(String(filePathOrText)).toLowerCase();
  if (extension === '.csv') return parseCsvText(await fsp.readFile(filePathOrText, 'utf8'));
  if (extension === '.xls') throw new Error('Format .xls lama belum didukung. Simpan file sebagai .xlsx atau .csv terlebih dahulu.');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePathOrText);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];
  const values = worksheet.getSheetValues().filter(Boolean).map((row) => row.slice(1));
  if (!values.length) return [];
  const headers = values.shift().map((value) => String(value ?? '').trim());
  return values.map((row) => headers.reduce((record, header, index) => {
    if (header) record[header] = row[index] ?? '';
    return record;
  }, {}));
}

function rowsToContacts(rows, defaultCountryCode = '62') {
  if (!rows.length) throw new Error('File atau sheet tidak memiliki data.');
  const first = rows[0];
  const keys = Object.keys(first);
  const findKey = (wanted) => keys.find((key) => normalizeHeader(key) === wanted);
  const nameKey = findKey('nama') || findKey('name');
  const numberKey = findKey('nomor') || findKey('nomor hp') || findKey('phone') || findKey('number');
  if (!nameKey || !numberKey) throw new Error('Kolom wajib adalah Nama dan Nomor.');
  const result = [];
  const seen = new Set();
  for (const row of rows) {
    const name = String(row[nameKey] ?? '').trim();
    const rawNumber = String(row[numberKey] ?? '').trim();
    const number = normalizeNumber(rawNumber, defaultCountryCode);
    if (!number || seen.has(number)) continue;
    seen.add(number);
    result.push({ id: `${number}-${result.length}`, name, rawNumber, number, status: 'queued' });
  }
  if (!result.length) throw new Error('Tidak ada nomor valid yang dapat diimpor.');
  return result;
}

module.exports = { normalizeNumber, parseCsvText, parseWorkbook, rowsToContacts };
