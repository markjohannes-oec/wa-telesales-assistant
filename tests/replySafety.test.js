const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CREDENTIAL_REPLY,
  MANUAL_PRICE_PROMO_REPLY,
  enforceQcGuardrails,
  isPriceOrPromoQuestion
} = require('../src/replySafety');

test('detects price and promo questions without treating every question as pricing', () => {
  assert.equal(isPriceOrPromoQuestion('Kak, ada promo bulan ini?'), true);
  assert.equal(isPriceOrPromoQuestion('Kelas berapa yang cocok untuk anak saya?'), false);
  assert.equal(isPriceOrPromoQuestion('Berapa harganya?'), true);
});

test('forces manual validation for price or promo', () => {
  assert.equal(enforceQcGuardrails({ incomingMessage: 'Berapa harga paketnya?', draft: 'Paketnya Rp 1.000.000.' }), MANUAL_PRICE_PROMO_REPLY);
  assert.equal(enforceQcGuardrails({ incomingMessage: 'Ada diskon?', draft: 'Silakan cek ya.' }), MANUAL_PRICE_PROMO_REPLY);
});

test('blocks credential handling in the suggested reply', () => {
  assert.equal(enforceQcGuardrails({ incomingMessage: 'Saya kirim OTP ya?', draft: 'Boleh, kirim OTP-nya.' }), CREDENTIAL_REPLY);
});

test('removes accidental draft labels and code fences', () => {
  assert.equal(enforceQcGuardrails({ incomingMessage: 'Saya ingin konsultasi', draft: '```text\nDraft: Halo Kak, boleh saya tahu kebutuhannya?\n```' }), 'Halo Kak, boleh saya tahu kebutuhannya?');
});
