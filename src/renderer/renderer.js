const $ = (id) => document.getElementById(id);
let appState;
let replyItems = [];
let selectedTemplateType = 'text';

function toast(message, type = 'info') {
  const element = $('toast');
  element.textContent = message;
  element.className = `toast ${type}`;
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => element.classList.add('hidden'), 4500);
}

function call(action, successMessage) {
  return action().then((result) => { if (successMessage) toast(successMessage); return result; }).catch((error) => { toast(error.message || String(error), 'error'); throw error; });
}

function setConnection(status, detail) {
  const badge = $('connectionBadge');
  badge.textContent = status === 'ready' ? 'Ready' : status === 'qr' ? 'Scan QR' : status;
  badge.className = `badge ${status}`;
  $('connectionText').textContent = detail || '';
  $('connectBtn').disabled = status === 'ready' || status === 'connecting' || status === 'authenticated';
  $('switchBtn').disabled = status === 'connecting';
  if (appState?.lastQr) { $('qrPanel').classList.remove('hidden'); $('qrImage').src = appState.lastQr; } else if (status === 'ready') $('qrPanel').classList.add('hidden');
}

function renderContacts() {
  $('contactCount').textContent = `${appState.contactCount} kontak`;
  const body = $('contactsBody');
  if (!appState.contactCount) { body.innerHTML = '<tr><td colspan="3" class="empty">Belum ada kontak.</td></tr>'; return; }
  body.innerHTML = (appState.contacts || []).map((contact) => `<tr><td>${escapeHtml(contact.name || '-')}</td><td>${escapeHtml(contact.rawNumber || contact.number)}</td><td>${escapeHtml(contact.status || 'queued')}</td></tr>`).join('');
}

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }

function renderCampaign() {
  const campaign = appState.campaign;
  $('campaignName').value = campaign.name || '';
  $('campaignAudience').value = campaign.audience || '';
  $('campaignStage').value = campaign.stage || 'Opening';
  $('delaySeconds').value = campaign.delaySeconds ?? 30;
  $('dailyLimit').value = campaign.dailyLimit ?? 50;
  $('dailyUsage').textContent = `${campaign.dailySentCount || 0} / ${campaign.dailyLimit || 50} penerima hari ini`;
  $('templateText').value = campaign.templateText || '';
  $('imageCaption').value = campaign.imageCaption || '';
  $('imagePath').textContent = campaign.imagePath || 'Gambar akan dikirim tanpa caption jika caption kosong.';
  $('campaignStatus').textContent = campaignRunningLabel(appState);
  $('startBtn').disabled = appState.campaignRunning;
  const pending = (appState.contacts || []).find((contact) => contact.status === 'needs_review' || contact.status === 'sending');
  $('pendingNotice').classList.toggle('hidden', !pending);
  if (pending) $('pendingDetail').textContent = `${pending.name || pending.rawNumber || pending.number}: ${pending.lastError || 'status pesan tidak diketahui'}`;
  if (campaign.imagePath) setImagePreview(campaign.imagePath);
  setTemplateType(campaign.templateType || 'text', false);
  const total = appState.contactCount || 0;
  const current = Math.min(appState.nextIndex || 0, total);
  $('progressBar').style.width = total ? `${Math.round((current / total) * 100)}%` : '0%';
  $('progressText').textContent = total ? `${current} dari ${total} kontak diproses.` : 'Belum ada kontak.';
  const risk = appState.campaignRisk || { level: 'low', message: '' };
  $('riskNotice').textContent = risk.message;
  $('riskNotice').className = `risk-notice ${risk.level}`;
}

function campaignRunningLabel(state) { return state.campaignRunning ? 'Berjalan' : ({ completed: 'Selesai', paused: 'Pause', needs_review: 'Perlu ditinjau', idle: 'Idle' }[state.campaign.status] || 'Idle'); }

function renderState(next) { appState = next; setConnection(next.connection, next.connectionDetail); renderContacts(); renderCampaign(); if (next.ai) renderAi(next.ai); }

function renderAi(next) { $('aiStatus').textContent = next.state === 'ready' ? 'Siap' : next.state === 'starting' ? 'Memuat' : next.state === 'error' ? 'Error' : 'Offline'; $('aiDetail').textContent = next.detail || ''; }

function readCampaignForm() {
  return { name: $('campaignName').value.trim(), audience: $('campaignAudience').value.trim(), stage: $('campaignStage').value, delaySeconds: Math.max(1, Number($('delaySeconds').value) || 1), dailyLimit: Math.max(1, Number($('dailyLimit').value) || 1), templateType: selectedTemplateType, templateText: selectedTemplateType === 'text' ? $('templateText').value : $('imageCaption').value, imagePath: selectedTemplateType === 'image' ? (appState?.campaign.imagePath || '') : '', imageCaption: $('imageCaption').value };
}

function setTemplateType(type, persist = true) { selectedTemplateType = type; $('textModeBtn').classList.toggle('active', type === 'text'); $('imageModeBtn').classList.toggle('active', type === 'image'); $('textTemplatePanel').classList.toggle('hidden', type !== 'text'); $('imageTemplatePanel').classList.toggle('hidden', type !== 'image'); if (persist) call(() => window.waApp.updateCampaign(readCampaignForm())); }

function setImagePreview(filePath) { $('imagePreview').innerHTML = `<img src="file://${encodeURI(filePath.replaceAll('\\', '/'))}" alt="Preview gambar" />`; }

function showReply(payload) {
  const existing = replyItems.findIndex((item) => item.id === payload.id);
  if (existing >= 0) replyItems[existing] = { ...replyItems[existing], ...payload };
  else replyItems.unshift(payload);
  renderReplies();
}

function renderReplies() {
  $('replyEmpty').classList.toggle('hidden', replyItems.length > 0);
  $('replyList').innerHTML = replyItems.map((payload) => {
    const statusText = payload.status === 'ready' ? 'Siap ditinjau' : payload.status === 'error' ? 'Gagal' : 'Memproses';
    const statusClass = payload.status === 'ready' ? 'ready' : payload.status === 'error' ? 'error' : 'generating';
    const retryButton = payload.status === 'error' ? '<button class="button secondary full retry-reply">Coba lagi</button>' : '';
    const fallbackNote = payload.fallback ? `<div class="fallback-note">AI lokal belum siap, jadi draft ini dibuat dengan aturan dasar QC. Tetap periksa dan edit sebelum mengirim.${payload.fallbackReason ? ` Detail teknis: ${escapeHtml(payload.fallbackReason)}` : ''}</div>` : '';
    return `<div class="reply-item" data-reply-id="${escapeHtml(payload.id)}"><div class="reply-meta"><strong>${escapeHtml(payload.contactName || 'Kontak')}</strong><span class="badge ${statusClass}">${statusText}</span></div><div class="incoming-box"><div class="small-label">Pesan user</div><div>${escapeHtml(payload.incomingMessage || '')}</div></div>${fallbackNote}<label>Saran jawaban<textarea class="textarea reply-textarea reply-draft" rows="6">${escapeHtml(payload.suggestion || '')}</textarea></label>${payload.error ? `<div class="error-text">${escapeHtml(payload.error)}</div>` : ''}${retryButton}<button class="button primary full send-reply" ${payload.status !== 'ready' ? 'disabled' : ''}>Kirim jawaban</button><p class="hint">Periksa draft sebelum dikirim. Harga dan promo harus dicek manual.</p></div>`;
  }).join('');
}

$('connectBtn').addEventListener('click', () => call(() => window.waApp.connect()));
$('switchBtn').addEventListener('click', () => call(() => window.waApp.switchNumber(), 'Sesi lama dihapus. Scan QR untuk nomor baru.'));
$('importFileBtn').addEventListener('click', () => call(() => window.waApp.importFile(), 'Kontak berhasil diimpor.'));
$('importSheetBtn').addEventListener('click', () => call(() => window.waApp.importGoogle($('sheetUrl').value.trim()), 'Google Sheets berhasil diimpor.'));
$('clearContactsBtn').addEventListener('click', () => call(() => window.waApp.clearContacts(), 'Daftar kontak dihapus.'));
$('textModeBtn').addEventListener('click', () => setTemplateType('text'));
$('imageModeBtn').addEventListener('click', () => setTemplateType('image'));
$('chooseImageBtn').addEventListener('click', () => call(() => window.waApp.chooseImage()).then((result) => { if (!result?.path) return; appState.campaign.imagePath = result.path; $('imagePath').textContent = result.path; setImagePreview(result.path); return call(() => window.waApp.updateCampaign(readCampaignForm())); }));
$('startBtn').addEventListener('click', () => call(() => window.waApp.updateCampaign(readCampaignForm()).then(() => window.waApp.startCampaign()), 'Campaign dimulai.'));
$('stopBtn').addEventListener('click', () => call(() => window.waApp.stopCampaign(), 'Campaign dihentikan sementara.'));
$('resetBtn').addEventListener('click', () => call(() => window.waApp.resetCampaign(), 'Antrean direset.'));
$('pendingSentBtn').addEventListener('click', () => call(() => window.waApp.resolvePending('sent'), 'Kontak ditandai sudah terkirim.'));
$('pendingRetryBtn').addEventListener('click', () => call(() => window.waApp.resolvePending('retry'), 'Kontak dikembalikan ke antrean.'));
$('restartAiBtn').addEventListener('click', () => call(() => window.waApp.startAi(), 'AI bawaan dimulai.'));
 $('replyList').addEventListener('click', (event) => { const itemElement = event.target.closest('[data-reply-id]'); if (!itemElement) return; const item = replyItems.find((reply) => reply.id === itemElement.dataset.replyId); if (!item) return; if (event.target.closest('.retry-reply')) { call(() => window.waApp.retryReply(item)); return; } if (!event.target.closest('.send-reply')) return; const button = event.target.closest('.send-reply'); if (button.disabled) return; button.disabled = true; const text = itemElement.querySelector('.reply-draft').value.trim(); call(() => window.waApp.sendReply({ chatId: item.chatId, incomingId: item.incomingId, text }), 'Jawaban dikirim.').then(() => { replyItems = replyItems.filter((reply) => reply.id !== item.id); renderReplies(); }).catch(() => { button.disabled = false; }); });

window.waApp.onState(renderState);
window.waApp.onAiState(renderAi);
window.waApp.onAiError((payload) => toast(payload.message, 'error'));
window.waApp.onReplyNew(showReply);
window.waApp.onReplyReady(showReply);
window.waApp.onReplyError((payload) => toast(payload.message, 'error'));
window.waApp.onCampaignProgress((payload) => { const percent = Math.round(((payload.index + 1) / payload.total) * 100); $('progressBar').style.width = `${percent}%`; $('progressText').textContent = `${payload.index + 1} dari ${payload.total}: ${payload.contact.name || payload.contact.number} (${payload.status})${payload.error ? ` — ${payload.error}` : ''}`; });
window.waApp.onCampaignNotice((payload) => toast(payload.message, payload.type === 'error' ? 'error' : 'info'));
window.waApp.getState().then(renderState).catch((error) => toast(error.message, 'error'));
