const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const QRCode = require('qrcode');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { buildQcPrompt } = require('./qcPrompt');
const { parseWorkbook, rowsToContacts } = require('./contactImport');
const localAi = require('./localAi');
const { enforceQcGuardrails } = require('./replySafety');
const { buildSafeFallbackReply } = require('./replyFallback');

let mainWindow;
let waClient;
let waInitializing = false;
let campaignTimer;
let campaignRunning = false;
let contacts = [];
let incomingCounter = 0;
let clientGeneration = 0;
let reconnectTimer;
let reconnectAttempts = 0;
let metadataWrite = Promise.resolve();
let processedIncomingIds = [];
const activeIncomingIds = new Set();
const pendingIncomingIds = new Set();
let replyQueue = [];
let replyProcessing = false;

const metadataDir = () => path.join(app.getPath('userData'), 'metadata');
const metadataPath = () => path.join(metadataDir(), 'state.json');
const sessionPath = () => path.join(app.getPath('userData'), 'whatsapp-session');

const state = {
  connection: 'offline',
  connectionDetail: 'Aplikasi belum terhubung',
  lastQr: null,
  settings: {
    defaultCountryCode: '62'
  },
  campaign: {
    name: '',
    audience: '',
    stage: 'Opening',
    delaySeconds: 30,
    dailyLimit: 50,
    dailySentDate: null,
    dailySentCount: 0,
    templateType: 'text',
    templateText: '',
    imagePath: '',
    imageCaption: '',
    nextIndex: 0,
    lastRunAt: null,
    status: 'idle'
  }
};

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function publishState() {
  sendToRenderer('app:state', getPublicState());
}

function getPublicState() {
  normalizeDailyUsage();
  return {
    connection: state.connection,
    connectionDetail: state.connectionDetail,
    lastQr: state.lastQr,
    settings: state.settings,
    ai: localAi.getStatus(),
    campaign: state.campaign,
    contacts,
    contactCount: contacts.length,
    nextIndex: state.campaign.nextIndex,
    campaignRunning,
    campaignRisk: getCampaignRisk()
  };
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeDailyUsage() {
  const today = localDateKey();
  if (state.campaign.dailySentDate !== today) {
    state.campaign.dailySentDate = today;
    state.campaign.dailySentCount = 0;
  }
  state.campaign.dailyLimit = Math.max(1, Math.floor(Number(state.campaign.dailyLimit) || 1));
  state.campaign.dailySentCount = Math.max(0, Math.floor(Number(state.campaign.dailySentCount) || 0));
}

function getCampaignRisk() {
  normalizeDailyUsage();
  const delay = Math.max(1, Number(state.campaign.delaySeconds) || 1);
  const limit = state.campaign.dailyLimit;
  if (delay < 10 || limit > 500) {
    return { level: 'danger', message: 'Pengaturan sangat agresif. Kurangi volume/jeda dan gunakan hanya untuk kontak yang memberi izin; tidak ada angka yang menjamin bebas pembatasan WhatsApp.' };
  }
  if (delay < 30 || limit > 200) {
    return { level: 'warning', message: 'Pengaturan mulai berisiko. Pertimbangkan jeda minimal 30 detik dan volume harian lebih kecil; pantau respons dan pembatasan akun.' };
  }
  return { level: 'low', message: 'Risiko lebih rendah menurut pengaturan lokal, tetapi WhatsApp tetap dapat membatasi akun tanpa pemberitahuan.' };
}

async function saveMetadata() {
  const payload = {
    settings: state.settings,
    campaign: state.campaign,
    contacts,
    processedIncomingIds,
    savedAt: new Date().toISOString()
  };
  metadataWrite = metadataWrite.then(async () => {
    await fsp.mkdir(metadataDir(), { recursive: true });
    const temporaryPath = `${metadataPath()}.tmp`;
    const backupPath = `${metadataPath()}.bak`;
    await fsp.writeFile(temporaryPath, JSON.stringify(payload, null, 2), 'utf8');
    try {
      await fsp.copyFile(metadataPath(), backupPath);
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('Metadata backup failed:', error.message);
    }
    await fsp.rm(metadataPath(), { force: true });
    await fsp.rename(temporaryPath, metadataPath());
  }).catch((error) => {
    console.error('Metadata save failed:', error.message);
  });
  return metadataWrite;
}

async function loadMetadata() {
  const candidates = [metadataPath(), `${metadataPath()}.bak`];
  for (const candidate of candidates) {
    try {
      const raw = await fsp.readFile(candidate, 'utf8');
      const saved = JSON.parse(raw);
      if (saved.settings) state.settings = { ...state.settings, ...saved.settings };
      if (saved.campaign) state.campaign = { ...state.campaign, ...saved.campaign, status: 'idle' };
      normalizeDailyUsage();
      if (Array.isArray(saved.contacts)) contacts = saved.contacts;
      if (Array.isArray(saved.processedIncomingIds)) processedIncomingIds = saved.processedIncomingIds.slice(-2000);
      const pendingIndex = contacts.findIndex((contact) => ['sending', 'needs_review'].includes(contact.status));
      if (pendingIndex >= 0) {
        contacts[pendingIndex].status = 'needs_review';
        state.campaign.nextIndex = pendingIndex;
        state.campaign.status = 'needs_review';
      }
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') console.error(`Metadata load failed (${candidate}):`, error.message);
    }
  }
}

function setConnection(connection, detail) {
  state.connection = connection;
  state.connectionDetail = detail;
  publishState();
}

async function importFile() {
  if (campaignRunning) throw new Error('Pause campaign sebelum mengganti daftar kontak.');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Pilih daftar kontak',
    properties: ['openFile'],
    filters: [{ name: 'Kontak', extensions: ['csv', 'xlsx'] }]
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const imported = rowsToContacts(await parseWorkbook(result.filePaths[0]), state.settings.defaultCountryCode);
  contacts = imported;
  state.campaign.nextIndex = 0;
  await saveMetadata();
  publishState();
  return { count: contacts.length, source: result.filePaths[0] };
}

async function importGoogleCsv(url) {
  if (campaignRunning) throw new Error('Pause campaign sebelum mengganti daftar kontak.');
  let parsedUrl;
  try { parsedUrl = new URL(url); } catch { throw new Error('Link Google Sheets tidak valid.'); }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('Link harus menggunakan HTTP atau HTTPS.');
  const response = await fetch(parsedUrl);
  if (!response.ok) throw new Error(`Google Sheets gagal diambil (${response.status}).`);
  const text = await response.text();
  contacts = rowsToContacts(await parseWorkbook(text, { type: 'string' }), state.settings.defaultCountryCode);
  state.campaign.nextIndex = 0;
  await saveMetadata();
  publishState();
  return { count: contacts.length };
}

function createClient() {
  const bundledChromium = app.isPackaged ? path.join(process.resourcesPath, 'chromium', 'chrome.exe') : '';
  let executablePath = bundledChromium && fs.existsSync(bundledChromium) ? bundledChromium : undefined;
  if (!executablePath) {
    try { executablePath = require('puppeteer').executablePath(); } catch { /* show the normal Puppeteer error if unavailable */ }
  }
  return new Client({
    authStrategy: new LocalAuth({ dataPath: sessionPath() }),
    puppeteer: {
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
  });
}

function clearReconnectTimer() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectAttempts += 1;
  const delay = Math.min(60000, Math.max(5000, reconnectAttempts * 5000));
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    initializeWhatsApp().catch((error) => console.error('Reconnect failed:', error.message));
  }, delay);
}

async function initializeWhatsApp() {
  if (waInitializing || (waClient && state.connection === 'ready')) return;
  clearReconnectTimer();
  if (waClient) await disconnectWhatsApp(false);
  waInitializing = true;
  const generation = ++clientGeneration;
  state.lastQr = null;
  setConnection('connecting', 'Menghubungkan ke sesi WhatsApp…');
  const client = createClient();
  waClient = client;
  const isCurrentClient = () => waClient === client && clientGeneration === generation;

  client.on('qr', async (qr) => {
    const qrImage = await QRCode.toDataURL(qr, { margin: 1, width: 280 });
    if (!isCurrentClient()) return;
    state.lastQr = qrImage;
    setConnection('qr', 'Scan QR dengan WhatsApp di ponsel untuk menghubungkan nomor.');
  });
  client.on('authenticated', () => { if (isCurrentClient()) setConnection('authenticated', 'Sesi WhatsApp terautentikasi.'); });
  client.on('ready', () => {
    if (!isCurrentClient()) return;
    waInitializing = false;
    reconnectAttempts = 0;
    state.lastQr = null;
    setConnection('ready', 'WhatsApp siap digunakan.');
  });
  client.on('auth_failure', (message) => {
    if (!isCurrentClient()) return;
    waInitializing = false;
    setConnection('error', `Autentikasi gagal: ${message}`);
  });
  client.on('disconnected', (reason) => {
    if (!isCurrentClient()) return;
    waInitializing = false;
    campaignRunning = false;
    if (campaignTimer) clearTimeout(campaignTimer);
    setConnection('offline', `WhatsApp terputus: ${reason || 'unknown'}`);
    if (state.campaign.status === 'running') state.campaign.status = 'paused';
    publishState();
    scheduleReconnect();
  });
  const handleIncomingMessage = (message) => {
    if (!isCurrentClient()) return;
    processIncomingMessage(message).catch((error) => {
      sendToRenderer('reply:error', { message: error.message });
    });
  };
  client.on('message', handleIncomingMessage);
  client.on('message_create', handleIncomingMessage);

  try {
    await client.initialize();
  } catch (error) {
    if (!isCurrentClient()) return;
    waInitializing = false;
    setConnection('error', `Gagal menginisialisasi WhatsApp: ${error.message}`);
    scheduleReconnect();
  }
}

async function disconnectWhatsApp(clearSession = false) {
  clearReconnectTimer();
  clientGeneration += 1;
  campaignRunning = false;
  if (campaignTimer) clearTimeout(campaignTimer);
  const client = waClient;
  waClient = null;
  if (client) {
    try { await client.destroy(); } catch (error) { console.warn('WA destroy:', error.message); }
  }
  waInitializing = false;
  if (state.campaign.status === 'running') state.campaign.status = 'paused';
  await saveMetadata();
  if (clearSession) {
    await fsp.rm(sessionPath(), { recursive: true, force: true });
    state.lastQr = null;
    setConnection('offline', 'Sesi dihapus. Hubungkan nomor baru dengan scan QR.');
  } else {
    setConnection('offline', 'WhatsApp terputus.');
  }
}

function ensureReady() {
  if (!waClient || state.connection !== 'ready') {
    const error = new Error('WhatsApp belum siap. Hubungkan nomor terlebih dahulu.');
    error.retryable = true;
    throw error;
  }
}

function renderTemplate(contact) {
  return String(state.campaign.templateText || '').replaceAll('{Nama}', contact.name || 'Kak');
}

async function sendToContact(contact) {
  ensureReady();
  let target;
  try {
    target = await waClient.getNumberId(contact.number);
  } catch (error) {
    error.retryable = true;
    throw error;
  }
  if (!target) {
    const error = new Error(`Nomor ${contact.rawNumber || contact.number} tidak terdaftar di WhatsApp.`);
    error.permanent = true;
    throw error;
  }
  if (state.campaign.templateType === 'image') {
    if (!state.campaign.imagePath) throw new Error('File gambar belum dipilih.');
    const media = MessageMedia.fromFilePath(state.campaign.imagePath);
    const caption = String(state.campaign.imageCaption || state.campaign.templateText || '').trim().replaceAll('{Nama}', contact.name || 'Kak');
    return waClient.sendMessage(target._serialized, media, {
      ...(caption ? { caption } : {})
    });
  } else {
    const text = renderTemplate(contact).trim();
    if (!text) throw new Error('Template teks masih kosong.');
    return waClient.sendMessage(target._serialized, text);
  }
}

function scheduleNextSend() {
  if (!campaignRunning) return;
  const delay = Math.max(1, Number(state.campaign.delaySeconds) || 1) * 1000;
  campaignTimer = setTimeout(() => sendNextContact().catch((error) => stopCampaign(error.message)), delay);
}

async function sendNextContact() {
  if (!campaignRunning) return;
  if (state.campaign.nextIndex >= contacts.length) {
    campaignRunning = false;
    state.campaign.status = 'completed';
    await saveMetadata();
    publishState();
    sendToRenderer('campaign:notice', { type: 'success', message: 'Campaign selesai.' });
    return;
  }
  normalizeDailyUsage();
  if (state.campaign.dailySentCount >= state.campaign.dailyLimit) {
    campaignRunning = false;
    state.campaign.status = 'paused';
    await saveMetadata();
    publishState();
    sendToRenderer('campaign:notice', { type: 'info', message: `Batas harian ${state.campaign.dailyLimit} penerima tercapai. Campaign dijeda sampai hari berikutnya atau sampai operator mengubah batas.` });
    return;
  }
  const index = state.campaign.nextIndex;
  const contact = contacts[index];
  if (contact.status === 'sent') {
    state.campaign.nextIndex += 1;
    await saveMetadata();
    scheduleNextSend();
    return;
  }
  contact.status = 'sending';
  contact.sendingAt = new Date().toISOString();
  contact.lastError = '';
  await saveMetadata();
  try {
    const sentMessage = await sendToContact(contact);
    contacts[index].status = 'sent';
    contacts[index].sentAt = new Date().toISOString();
    contacts[index].messageId = sentMessage?.id?.id || null;
    normalizeDailyUsage();
    state.campaign.dailySentCount += 1;
    state.campaign.nextIndex = index + 1;
    sendToRenderer('campaign:progress', { index, total: contacts.length, contact, status: 'sent' });
  } catch (error) {
    if (error.retryable || !error.permanent) {
      contacts[index].status = 'needs_review';
      contacts[index].lastError = error.message;
      campaignRunning = false;
      state.campaign.status = 'needs_review';
      await saveMetadata();
      publishState();
      sendToRenderer('campaign:notice', { type: 'error', message: `Pengiriman berhenti karena status pesan tidak pasti: ${error.message}` });
      return;
    }
    contacts[index].status = 'failed';
    contacts[index].lastError = error.message;
    state.campaign.nextIndex = index + 1;
    sendToRenderer('campaign:progress', { index, total: contacts.length, contact, status: 'failed', error: error.message });
  }
  state.campaign.lastRunAt = new Date().toISOString();
  await saveMetadata();
  publishState();
  scheduleNextSend();
}

function startCampaign() {
  ensureReady();
  normalizeDailyUsage();
  if (!contacts.length) throw new Error('Impor kontak terlebih dahulu.');
  const pendingIndex = contacts.findIndex((contact) => contact.status === 'needs_review' || contact.status === 'sending');
  if (pendingIndex >= 0) throw new Error(`Kontak ${contacts[pendingIndex].name || contacts[pendingIndex].rawNumber} perlu diselesaikan sebelum campaign dilanjutkan.`);
  if (state.campaign.nextIndex >= contacts.length) throw new Error('Campaign sudah selesai. Tekan Reset antrean untuk mengirim ulang.');
  if (state.campaign.templateType === 'text' && !state.campaign.templateText.trim()) throw new Error('Template teks masih kosong.');
  if (state.campaign.templateType === 'image' && !state.campaign.imagePath) throw new Error('Pilih gambar terlebih dahulu.');
  if (state.campaign.templateType === 'image' && !fs.existsSync(state.campaign.imagePath)) throw new Error('File gambar tidak ditemukan di laptop ini. Pilih ulang gambar sebelum memulai.');
  if (state.campaign.dailySentCount >= state.campaign.dailyLimit) throw new Error(`Batas harian ${state.campaign.dailyLimit} penerima sudah tercapai.`);
  const risk = getCampaignRisk();
  if (risk.level !== 'low') sendToRenderer('campaign:notice', { type: risk.level === 'danger' ? 'error' : 'info', message: risk.message });
  if (state.campaign.nextIndex >= contacts.length) state.campaign.nextIndex = 0;
  campaignRunning = true;
  state.campaign.status = 'running';
  saveMetadata();
  publishState();
  sendNextContact().catch((error) => stopCampaign(error.message));
}

async function resetCampaign() {
  if (campaignRunning) throw new Error('Pause campaign sebelum mereset antrean.');
  contacts = contacts.map((contact) => ({
    ...contact,
    status: 'queued',
    sendingAt: null,
    sentAt: null,
    messageId: null,
    lastError: ''
  }));
  state.campaign.nextIndex = 0;
  state.campaign.status = 'idle';
  await saveMetadata();
  publishState();
}

function stopCampaign(reason = 'Campaign dihentikan operator.') {
  campaignRunning = false;
  if (campaignTimer) clearTimeout(campaignTimer);
  state.campaign.status = 'paused';
  saveMetadata();
  publishState();
  sendToRenderer('campaign:notice', { type: 'info', message: reason });
}

async function resolvePending(action) {
  const index = contacts.findIndex((contact) => contact.status === 'needs_review' || contact.status === 'sending');
  if (index < 0) throw new Error('Tidak ada pengiriman yang perlu diselesaikan.');
  if (action === 'sent') {
    contacts[index].status = 'sent';
    contacts[index].sentAt = contacts[index].sentAt || new Date().toISOString();
    normalizeDailyUsage();
    state.campaign.dailySentCount = Math.min(state.campaign.dailyLimit, state.campaign.dailySentCount + 1);
    state.campaign.nextIndex = index + 1;
  } else if (action === 'retry') {
    contacts[index].status = 'queued';
    contacts[index].lastError = '';
    contacts[index].sendingAt = null;
    state.campaign.nextIndex = index;
  } else {
    throw new Error('Aksi pending tidak dikenal.');
  }
  state.campaign.status = 'paused';
  await saveMetadata();
  publishState();
}

async function suggestReply({ chatId, contactName, incomingMessage }) {
  const prompt = buildQcPrompt({
    campaign: state.campaign.name,
    audience: state.campaign.audience,
    stage: state.campaign.stage,
    contactName,
    incomingMessage
  });
  try {
    const rawSuggestion = await localAi.chat([{ role: 'user', content: prompt }]);
    const suggestion = enforceQcGuardrails({ incomingMessage, draft: rawSuggestion });
    return { chatId, contactName, incomingMessage, suggestion, fallback: false };
  } catch (error) {
    const suggestion = buildSafeFallbackReply({ contactName, incomingMessage });
    return { chatId, contactName, incomingMessage, suggestion, fallback: true, fallbackReason: error.message };
  }
}

async function processReplyQueue() {
  if (replyProcessing || !replyQueue.length) return;
  replyProcessing = true;
  const payload = replyQueue.shift();
  try {
    const result = await suggestReply(payload);
    if (payload.incomingId) { activeIncomingIds.delete(payload.incomingId); pendingIncomingIds.add(payload.incomingId); }
    sendToRenderer('reply:ready', { ...payload, ...result, status: 'ready' });
  } catch (error) {
    if (payload.incomingId) activeIncomingIds.delete(payload.incomingId);
    sendToRenderer('reply:ready', { ...payload, status: 'error', error: error.message });
  } finally {
    replyProcessing = false;
    processReplyQueue();
  }
}

async function processIncomingMessage(message) {
  if (!message || message.fromMe) return;
  const incomingId = message.id?.id;
  if (incomingId && (processedIncomingIds.includes(incomingId) || activeIncomingIds.has(incomingId) || pendingIncomingIds.has(incomingId))) return;
  if (incomingId) {
    activeIncomingIds.add(incomingId);
    while (activeIncomingIds.size > 2000) activeIncomingIds.delete(activeIncomingIds.values().next().value);
  }
  let chat;
  let contact;
  try {
    chat = await message.getChat();
    contact = await message.getContact();
  } catch (error) {
    sendToRenderer('reply:error', { message: `Pesan masuk diterima, tetapi identitas kontak gagal dibaca: ${error.message}` });
  }
  const payload = {
    id: `reply-${++incomingCounter}`,
    incomingId,
    chatId: message.from,
    contactName: contact?.pushname || contact?.name || chat?.name || message.from,
    incomingMessage: String(message.body || '[Pesan non-teks diterima. Tinjau pesan asli di WhatsApp.]').trim(),
    suggestion: '',
    status: 'generating'
  };
  sendToRenderer('reply:new', payload);
  replyQueue.push(payload);
  processReplyQueue();
}

async function retryReply(payload) {
  if (!payload?.chatId || !payload?.incomingMessage) throw new Error('Data balasan tidak lengkap.');
  if (payload.incomingId && (processedIncomingIds.includes(payload.incomingId) || activeIncomingIds.has(payload.incomingId))) return;
  if (payload.incomingId) activeIncomingIds.add(payload.incomingId);
  const retryPayload = { ...payload, status: 'generating', suggestion: '', error: '' };
  sendToRenderer('reply:new', retryPayload);
  replyQueue.push(retryPayload);
  processReplyQueue();
}

async function markIncomingProcessed(incomingId) {
  if (!incomingId) return;
  pendingIncomingIds.delete(incomingId);
  if (!processedIncomingIds.includes(incomingId)) processedIncomingIds = [...processedIncomingIds.slice(-1999), incomingId];
  await saveMetadata();
}

function registerIpc() {
  ipcMain.handle('app:get-state', () => getPublicState());
  ipcMain.handle('wa:connect', () => initializeWhatsApp());
  ipcMain.handle('wa:switch-number', () => disconnectWhatsApp(true).then(() => initializeWhatsApp()));
  ipcMain.handle('wa:disconnect', () => disconnectWhatsApp(false));
  ipcMain.handle('contacts:import-file', () => importFile());
  ipcMain.handle('contacts:import-google', (_event, url) => importGoogleCsv(url));
  ipcMain.handle('contacts:clear', async () => {
    if (campaignRunning) throw new Error('Hentikan campaign sebelum menghapus kontak.');
    contacts = [];
    state.campaign.nextIndex = 0;
    await saveMetadata();
    publishState();
  });
  ipcMain.handle('campaign:update', async (_event, campaign) => {
    if (campaignRunning) throw new Error('Pause campaign sebelum mengubah template.');
    const allowed = ['name', 'audience', 'stage', 'delaySeconds', 'dailyLimit', 'templateType', 'templateText', 'imagePath', 'imageCaption'];
    const patch = Object.fromEntries(allowed.filter((key) => Object.prototype.hasOwnProperty.call(campaign || {}, key)).map((key) => [key, campaign[key]]));
    state.campaign = { ...state.campaign, ...patch, status: state.campaign.status === 'completed' ? 'idle' : state.campaign.status };
    state.campaign.delaySeconds = Math.max(1, Math.floor(Number(state.campaign.delaySeconds) || 1));
    state.campaign.dailyLimit = Math.max(1, Math.floor(Number(state.campaign.dailyLimit) || 1));
    normalizeDailyUsage();
    if (!['text', 'image'].includes(state.campaign.templateType)) state.campaign.templateType = 'text';
    await saveMetadata();
    publishState();
  });
  ipcMain.handle('campaign:start', () => startCampaign());
  ipcMain.handle('campaign:stop', () => stopCampaign());
  ipcMain.handle('campaign:reset', () => resetCampaign());
  ipcMain.handle('campaign:resolve-pending', (_event, action) => resolvePending(action));
  ipcMain.handle('campaign:choose-image', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Pilih gambar campaign',
      properties: ['openFile'],
      filters: [{ name: 'Gambar', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return { path: result.filePaths[0] };
  });
  ipcMain.handle('ai:start', () => startLocalAi());
  ipcMain.handle('ai:stop', () => localAi.stop());
  ipcMain.handle('reply:send', async (_event, { chatId, text, incomingId }) => {
    ensureReady();
    if (!chatId || !String(text || '').trim()) throw new Error('Chat atau pesan kosong.');
    await waClient.sendMessage(chatId, String(text).trim());
    await markIncomingProcessed(incomingId);
  });
  ipcMain.handle('reply:retry', (_event, payload) => retryReply(payload));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0c111b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

async function startLocalAi() {
  try {
    await localAi.start({ packaged: app.isPackaged, projectRoot: path.join(__dirname, '..'), resourcesPath: process.resourcesPath });
    publishState();
  } catch (error) {
    sendToRenderer('ai:error', { message: error.message });
  }
}

app.whenReady().then(async () => {
  await loadMetadata();
  localAi.configure((aiStatus) => sendToRenderer('ai:state', aiStatus));
  registerIpc();
  createWindow();
  mainWindow.webContents.once('did-finish-load', () => {
    publishState();
    initializeWhatsApp();
    startLocalAi();
  });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', async () => {
  if (waClient) {
    try { await waClient.destroy(); } catch { /* app is closing */ }
  }
  await localAi.stop();
  if (process.platform !== 'darwin') app.quit();
});
