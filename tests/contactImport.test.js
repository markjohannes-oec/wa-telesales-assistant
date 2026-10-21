const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ExcelJS = require('exceljs');
const { normalizeNumber, parseCsvText, parseWorkbook, rowsToContacts } = require('../src/contactImport');

test('normalizes Indonesian numbers and rejects malformed values', () => {
  assert.equal(normalizeNumber('08123456789'), '628123456789');
  assert.equal(normalizeNumber('+628123456789'), '628123456789');
  assert.equal(normalizeNumber('8123456789'), '628123456789');
  assert.equal(normalizeNumber('123'), '');
});

test('parses quoted CSV and deduplicates contacts', () => {
  const rows = parseCsvText('\uFEFFNama,Nomor\n"Sari, A",08123456789\nBudi,08123456789\nCici,invalid\n');
  const contacts = rowsToContacts(rows);
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].name, 'Sari, A');
  assert.equal(contacts[0].number, '628123456789');
});

test('imports local CSV files', async () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wa-assistant-')), 'contacts.csv');
  fs.writeFileSync(filePath, 'Nama,Nomor\nRina,08122222222\n', 'utf8');
  const contacts = rowsToContacts(await parseWorkbook(filePath));
  assert.equal(contacts[0].name, 'Rina');
  assert.equal(contacts[0].number, '628122222222');
});

test('imports XLSX with the required headers', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Contacts');
  sheet.addRow(['Nama', 'Nomor']);
  sheet.addRow(['Dewi', '08123456789']);
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wa-assistant-')), 'contacts.xlsx');
  await workbook.xlsx.writeFile(filePath);
  const contacts = rowsToContacts(await parseWorkbook(filePath));
  assert.equal(contacts[0].name, 'Dewi');
  assert.equal(contacts[0].number, '628123456789');
});
