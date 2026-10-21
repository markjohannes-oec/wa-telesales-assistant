const {
  CREDENTIAL_REPLY,
  MANUAL_PRICE_PROMO_REPLY,
  enforceQcGuardrails,
  isPriceOrPromoQuestion
} = require('./replySafety');

function buildFallbackReply({ contactName, incomingMessage }) {
  const name = contactName || 'Kak';
  const message = String(incomingMessage || '').trim();
  const lower = message.toLowerCase();

  if (/\b(otp|one[- ]time password|password|kata sandi|pin)\b/i.test(message)) return CREDENTIAL_REPLY;
  if (isPriceOrPromoQuestion(message)) return MANUAL_PRICE_PROMO_REPLY;
  if (/\b(refund|komplain|keluhan|kecewa|tidak puas|dirugikan|uang kembali|penipuan|tertipu)\b/i.test(lower)) {
    return `Mohon maaf atas pengalaman yang kurang nyaman, ${name}. Saya bantu cek dulu ya. Boleh ceritakan kendala yang terjadi?`;
  }
  if (/^(halo|hai|hi|pagi|siang|sore|malam|assalamualaikum)\b/i.test(lower)) {
    return `Halo ${name}, terima kasih sudah menghubungi kami. Boleh saya tahu kebutuhan belajar yang sedang dicari?`;
  }
  if (message.includes('?')) {
    return `Terima kasih sudah bertanya, ${name}. Saya bantu cek sesuai kebutuhan ya. Boleh ceritakan target atau kebutuhan belajar yang sedang dicari?`;
  }
  return `Terima kasih sudah membalas, ${name}. Boleh saya tahu kebutuhan belajar atau target yang ingin dicapai?`;
}

function buildSafeFallbackReply(input) {
  return enforceQcGuardrails({
    incomingMessage: input?.incomingMessage,
    draft: buildFallbackReply(input || {})
  });
}

module.exports = { buildFallbackReply, buildSafeFallbackReply };
