const PRICE_PROMO_PATTERN = /\b(harga|harganya|biaya|tarif|promo|promonya|diskon|cashback|voucher|kupon|potongan|cicilan|gratis)\b/i;
const PRICE_QUESTION_PATTERN = /\bberapa\s+(harga|harganya|biaya|tarif|rupiah|bayarnya|cicilan)\b/i;
const CURRENCY_PATTERN = /(?:rp\.?\s*\d|\d[\d.\s]*(?:rupiah|rb|ribu|juta)\b)/i;
const CREDENTIAL_PATTERN = /\b(otp|one[- ]time password|password|kata sandi|pin)\b/i;

const MANUAL_PRICE_PROMO_REPLY = 'Untuk info harga atau promo yang berlaku, saya cek manual dulu supaya informasinya tepat ya. Boleh saya tahu kebutuhan belajar yang sedang dicari?';
const CREDENTIAL_REPLY = 'Demi keamanan, mohon jangan kirim OTP, PIN, atau password lewat chat. Saya bantu arahkan melalui proses resmi ya.';

function isPriceOrPromoQuestion(message) {
  const text = String(message || '');
  return PRICE_PROMO_PATTERN.test(text) || PRICE_QUESTION_PATTERN.test(text) || CURRENCY_PATTERN.test(text);
}

function normalizeDraft(draft) {
  return String(draft || '')
    .replace(/^```(?:text|plaintext)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .replace(/^\s*(jawaban|draft|saran(?: jawaban)?)\s*:\s*/i, '')
    .trim();
}

function enforceQcGuardrails({ incomingMessage, draft }) {
  const incoming = String(incomingMessage || '');
  const normalized = normalizeDraft(draft);
  if (CREDENTIAL_PATTERN.test(incoming)) return CREDENTIAL_REPLY;
  if (isPriceOrPromoQuestion(incoming) || PRICE_PROMO_PATTERN.test(normalized) || CURRENCY_PATTERN.test(normalized)) {
    return MANUAL_PRICE_PROMO_REPLY;
  }
  return normalized || 'Terima kasih sudah menghubungi kami. Boleh saya tahu kebutuhan yang sedang dicari?';
}

module.exports = {
  CREDENTIAL_REPLY,
  MANUAL_PRICE_PROMO_REPLY,
  enforceQcGuardrails,
  isPriceOrPromoQuestion,
  normalizeDraft
};
