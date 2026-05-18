// =============================================================
// TELEGRAM MAIL GATEWAY CORE ENGINE v18.0 - FEMININE SPECIAL
// =============================================================
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const Groq = require('groq-sdk');

// CONFIG SECURE (.env file integration)
require('dotenv').config();
const TOKEN = process.env.TOKEN || '8829940673:AAHqA6_LjlON9DXqMfUTkZ68__MC1O8ZR2I';
const OWNER_ID = process.env.OWNER_ID || '8430290683';
const QRIS_URL = process.env.QRIS_URL || 'https://qu.ax/g1eRh';
const SAWERIA_URL = process.env.SAWERIA_URL || 'https://saweria.co/emyber';
const CS_EMAIL = 'emy.system@yahoo.com';

const bot = new TelegramBot(TOKEN, { polling: true });
const dbPath = path.join(__dirname, 'database.json');

// STORAGE OPTIMIZED WITH MAPS
const customNameStorage = new Map();
const rateLimitStorage = new Map();
const adminSessionStorage = new Map(); // Untuk mencatat alur input menu rahasia Admin
const csSessionStorage = new Map(); // userId -> { startedAt, lastActivity, name, username, chatId, timeoutId }
const banStorage = new Set(); // userId yang dibanned
const tictacStorage = new Map(); // userId -> { board, messageId }
const TTT_WIN_REWARD = 15;
const aiChatHistory = new Map(); // userId -> [{ role, content }]
const AI_MAX_HISTORY = 20; // maks pesan disimpan per user

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const AI_SYSTEM_PROMPT = `Kamu adalah EMA (Electronic Mail Assistant), asisten cerdas milik bot layanan email temporary ini. Kamu punya kepribadian yang ramah, ceria, sedikit bercanda tapi tetap informatif dan membantu.

Tentang dirimu:
- Nama: EMA (Electronic Mail Assistant)
- Dibuat oleh developer bot ini untuk membantu pengguna
- Kamu tahu dan mengerti SEMUA menu bot ini
- Kamu bisa menjelaskan fungsi command, alur penggunaan, batasan tier, biaya poin, limit harian, dan tips memakai bot
- Kamu berbicara dalam Bahasa Indonesia yang santai, natural, dan jelas
- Kamu punya rasa humor ringan tapi tidak berlebihan
- Kamu tidak bisa melakukan aksi bot secara langsung (misal buat email), tapi bisa menjelaskan caranya

Daftar fitur/menu bot yang wajib kamu pahami:
- /start → dashboard utama bot
- /profile → lihat profil, poin, tier, status email
- /createmailr → buat email random
- /createmailc → buat email custom
- /checkinbox → cek inbox email / OTP
- /emailactive → cek sisa waktu email aktif
- /deletemail → hapus sesi email aktif
- /topuppoint → topup poin & upgrade tier
- /claimdaily → klaim bonus harian
- /help → bantuan lengkap dan penjelasan menu
- /sendmessage → kirim pesan anonim ke user ID atau username
- /msglogs → riwayat pesan anonim (Owner)
- /sendsubscribe → beli langganan anon chat sendmessage
- /setmessagequota → atur kuota sendmessage (Owner)
- /broadcast → kirim pengumuman ke semua user (Owner)
- /ban dan /unban → blokir / buka blokir user (Owner)
- /setpoint → set poin user (Owner)
- /settier → set tier user (Owner)
- /cs → mulai sesi CS live chat
- /endcs → akhiri sesi CS sendiri
- /cslist → daftar sesi CS aktif (Owner)
- /csend → tutup sesi CS user (Owner)
- /reply → balas user pada sesi CS (Owner)
- /tictac → main TicTacToe (user menang = +15 poin gratis, max 3 kemenangan/hari)
- /aboutdev → info developer & dukungan
- /ai → chat dengan EMA
- /clearai → hapus riwayat percakapan AI

Konteks penting:
- B-Tier = free
- A-Tier = premium dengan limit harian tertentu
- S-Tier = premium penuh
- Owner/Admin = akses admin penuh
- Jika user tanya fitur, jelaskan langkah pakainya dengan jelas
- Jika user tanya masalah bot, bantu diagnosis dengan langkah singkat dan praktis
- Jika user tanya tentang menu yang tidak ada, bilang dengan jujur bahwa menu itu tidak tersedia

Batasan:
- Jangan berpura-pura jadi manusia jika ditanya langsung apakah kamu AI
- Jangan berikan informasi yang bisa membahayakan privasi pengguna lain
- Tetap fokus pada topik bot dan hal-hal umum yang berguna`;

const CS_TIMEOUT_MS = 30 * 60 * 1000; // 30 menit inaktivitas

function resetCsTimeout(userId) {
  const session = csSessionStorage.get(userId);
  if (!session) return;
  if (session.timeoutId) clearTimeout(session.timeoutId);
  session.lastActivity = Date.now();
  session.timeoutId = setTimeout(async () => {
    const s = csSessionStorage.get(userId);
    if (!s) return;
    csSessionStorage.delete(userId);
    try {
      await bot.sendMessage(Number(s.chatId),
        `*Sesi CS Otomatis Ditutup*\n\nSesi live chat kamu ditutup karena tidak ada aktivitas selama 30 menit.\n\nKetik /cs untuk membuka sesi baru kapan saja.`,
        { parse_mode: 'Markdown' }
      );
    } catch {}
    try {
      await bot.sendMessage(OWNER_ID,
        `⏰ *Sesi CS Timeout*\n\n👤 *${s.name}* (${s.username})\n🆔 \`${userId}\`\n\nSesi otomatis ditutup karena tidak aktif 30 menit.`,
        { parse_mode: 'Markdown' }
      );
    } catch {}
  }, CS_TIMEOUT_MS);
  csSessionStorage.set(userId, session);
}

async function askCsAssistant(chatId, userMessage) {
  let history = aiChatHistory.get(`cs_${chatId}`) || [];
  history.push({ role: 'user', content: userMessage });

  if (history.length > AI_MAX_HISTORY) {
    history = history.slice(history.length - AI_MAX_HISTORY);
  }

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: `Kamu adalah EMA, AI pendamping CS live chat untuk bot ini. Tugasmu menjawab user dengan cepat, sopan, singkat bila perlu, dan membantu sambil menunggu admin/developer membalas.

Kamu harus:
- membantu user memahami masalahnya
- memberi langkah singkat yang relevan
- minta informasi tambahan bila perlu
- jangan menutup sesi CS
- jangan bilang kamu adalah admin/developer
- jangan mengklaim tindakan yang tidak bisa kamu lakukan
- pahami semua menu bot dan jelaskan sesuai konteks

Fitur bot yang harus kamu pahami:
- /start, /profile, /createmailr, /createmailc, /checkinbox, /emailactive, /deletemail
- /topuppoint, /claimdaily, /help, /sendmessage, /msglogs, /sendsubscribe
- /setmessagequota, /broadcast, /ban, /unban, /setpoint, /settier
- /cs, /endcs, /cslist, /csend, /reply
- /tictac, /ai, /clearai, /aboutdev

Jawab dalam Bahasa Indonesia yang ramah, natural, dan jelas.`
      },
      ...history
    ],
    max_tokens: 512,
    temperature: 0.7
  });

  const reply = completion.choices[0]?.message?.content || 'Maaf, saya belum bisa membantu saat ini.';
  history.push({ role: 'assistant', content: reply });
  aiChatHistory.set(`cs_${chatId}`, history);
  return reply;
}

// REGISTER MENU BLUE COMMANDS INTERFACE
bot.setMyCommands([
  { command: 'start', description: 'Buka dashboard utama' },
  { command: 'profile', description: 'Cek saldo poin, tier & status email' },
  { command: 'createmailr', description: 'Buat email acak' },
  { command: 'createmailc', description: 'Buat email kustom' },
  { command: 'checkinbox', description: 'Periksa kotak masuk / kode OTP' },
  { command: 'emailactive', description: 'Cek sisa waktu sesi email' },
  { command: 'topuppoint', description: 'Topup poin & upgrade tier' },
  { command: 'claimdaily', description: 'Klaim bonus harian' },
  { command: 'sendsubscribe', description: 'Beli langganan anon chat sendmessage' },
  { command: 'setmessagequota', description: '(Owner) Atur kuota sendmessage pengguna' },
  { command: 'aboutdev', description: 'Info developer & dukungan' },
  { command: 'help', description: 'Pusat bantuan' },
  { command: 'setpoint', description: '(Owner) Atur poin user' },
  { command: 'settier', description: '(Owner) Atur tier user' },
  { command: 'msglogs', description: '(Owner) Riwayat pengiriman pesan anon' },
  { command: 'sendmessage', description: 'Kirim pesan anon ke user ID/username' },
  { command: 'cs', description: 'Hubungi CS / live chat dengan admin' },
  { command: 'endcs', description: 'Akhiri sesi live chat CS' },
  { command: 'cslist', description: '(Owner) Daftar sesi CS aktif' },
  { command: 'csend', description: '(Owner) Tutup sesi CS user' },
  { command: 'reply', description: '(Owner) Balas pesan user di CS' },
  { command: 'deletemail', description: 'Hapus sesi email aktif' },
  { command: 'broadcast', description: '(Owner) Kirim pengumuman ke semua user' },
  { command: 'ban', description: '(Owner) Blokir user dari bot' },
  { command: 'unban', description: '(Owner) Buka blokir user' },
  { command: 'tictac', description: 'Main Tic-Tac-Toe & menangkan poin gratis' },
  { command: 'ai', description: 'Chat dengan EMA — asisten AI bot ini' },
  { command: 'clearai', description: 'Hapus riwayat percakapan AI kamu' }
]).catch((err) => console.error("Gagal melakukan set perintah menu:", err.message));

// ANTI-SPAM RATE LIMITER
function checkRateLimit(chatId, action = 'default') {
  const now = Date.now();
  const key = `${chatId}_${action}`;
  const userLimit = rateLimitStorage.get(key) || { count: 0, reset: now + 5000 }; 
  
  if (now > userLimit.reset) {
    userLimit.count = 0;
    userLimit.reset = now + 5000;
  }
  
  if (userLimit.count >= 3) return false;
  userLimit.count++;
  rateLimitStorage.set(key, userLimit);
  return true;
}

// HELPER: GET CURRENT DATE STRING IN ASIA/JAKARTA
function getJakartaDateString() {
  const options = { timeZone: 'Asia/Jakarta', year: 'numeric', month: 'short', day: 'numeric' };
  return new Date().toLocaleDateString('en-US', options);
}

// DATABASE ASYNC & ATOMIC OPERATORS
async function readDB() {
  try {
    await fs.access(dbPath);
    const data = await fs.readFile(dbPath, 'utf8');
    return JSON.parse(data);
  } catch {
    const initData = { users: {}, sendMessageLogs: [] };
    await writeDB(initData);
    return initData;
  }
}

async function writeDB(data) {
  try {
    await fs.writeFile(dbPath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Database Write Exception:', err.message);
  }
}

// Audit logging for admin actions
async function appendAuditLog(operatorId, action, targetId, before, after) {
  const logPath = path.join(__dirname, 'audit.log');
  const entry = {
    timestamp: new Date().toISOString(),
    operatorId: String(operatorId),
    action: String(action),
    targetId: String(targetId),
    before: before === undefined ? null : before,
    after: after === undefined ? null : after
  };
  try {
    await fs.appendFile(logPath, JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error('Audit Log Error:', err.message);
  }
}

async function verifyUser(chatId, firstName, username) {
  const db = await readDB();
  const today = getJakartaDateString();
  chatId = String(chatId).trim();

  const normalizedUsername = username ? String(username).toLowerCase() : null;

  if (!db.users[chatId]) {
    db.users[chatId] = {
      name: firstName || 'Pengguna',
      username: normalizedUsername,
      points: 10,
      activeEmail: null,
      activeEmailToken: null,
      emailExpiry: null,
      tier: 'B-Tier (Standard Free)',
      tierExpiry: null,
      dailyUsageCustom: 0,
      dailyUsageRandom: 0,
      lastUsedDate: today,
      lastDailyClaim: null,
      sendMessageQuota: 0,
      dailyTTTWins: 0,
      banned: false
    };
    await writeDB(db);
  }

  // Sync ban status ke memory
  if (db.users[chatId].banned) {
    banStorage.add(chatId);
    return null;
  } else {
    banStorage.delete(chatId);
  }

  if (normalizedUsername && db.users[chatId].username !== normalizedUsername) {
    db.users[chatId].username = normalizedUsername;
    await writeDB(db);
  }

  if (typeof db.users[chatId].sendMessageQuota === 'undefined') {
    db.users[chatId].sendMessageQuota = 0;
    await writeDB(db);
  }

  if (typeof db.users[chatId].dailyTTTWins === 'undefined') {
    db.users[chatId].dailyTTTWins = 0;
    await writeDB(db);
  }

  if (db.users[chatId].lastUsedDate !== today) {
    db.users[chatId].dailyUsageCustom = 0;
    db.users[chatId].dailyUsageRandom = 0;
    db.users[chatId].dailyTTTWins = 0;
    db.users[chatId].lastUsedDate = today;
    await writeDB(db);
  }

  // Timezone safe checking for tier expiry
  if (db.users[chatId].tierExpiry && Date.now() > new Date(db.users[chatId].tierExpiry).getTime()) {
    db.users[chatId].tier = 'B-Tier (Standard Free)';
    db.users[chatId].tierExpiry = null;
    await writeDB(db);
    try {
      await bot.sendMessage(chatId, `*Masa Langganan Telah Berakhir*\n\nHalo, masa paket premium kamu telah berakhir. Status akun kamu otomatis kembali ke B-Tier (Free). Untuk memperpanjang, silakan cek /topuppoint.`, { parse_mode: 'Markdown' });
    } catch {}
  }

  // Timezone safe checking for active email expiry
  if (db.users[chatId].activeEmail && db.users[chatId].emailExpiry) {
    const expiryTime = new Date(db.users[chatId].emailExpiry).getTime();
    if (Date.now() > expiryTime) {
      db.users[chatId].activeEmail = null;
      db.users[chatId].activeEmailToken = null;
      db.users[chatId].emailExpiry = null;
      await writeDB(db);
      try {
        await bot.sendMessage(chatId, `*Email Otomatis Dihapus*\n\nMasa aktif email temporary kamu telah berakhir dan email telah dihapus demi keamanan. Jika kamu membutuhkan sesi baru, silakan buat yang baru.`, { parse_mode: 'Markdown' });
      } catch {}
    }
  }

  return db.users[chatId];
}

function makeRandomString(length) {
  const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

function sanitizeMailName(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9.]/g, '');
}

async function getMailTmDomain() {
  const res = await apiCall('https://api.mail.tm/domains');
  const domains = res.data && res.data['hydra:member'];
  if (!Array.isArray(domains) || domains.length === 0) {
    throw new Error('Tidak ada domain mail.tm yang tersedia saat ini.');
  }
  return domains[0].domain;
}

async function createMailTmAccount(emailAddress) {
  const password = makeRandomString(16);
  await apiCall('https://api.mail.tm/accounts', {
    method: 'post',
    headers: { 'Content-Type': 'application/json' },
    data: { address: emailAddress, password }
  });

  const tokenRes = await apiCall('https://api.mail.tm/token', {
    method: 'post',
    headers: { 'Content-Type': 'application/json' },
    data: { address: emailAddress, password }
  });

  return { address: emailAddress, token: tokenRes.data.token };
}

async function createTemporaryEmailSession(chatId, type) {
  const db = await readDB();
  const user = db.users[chatId];

  if (!user) throw new Error('User not registered.');

  const isAdmin = chatId === String(OWNER_ID);
  const isSTier = user.tier.includes('S-Tier');
  const isATier = user.tier.includes('A-Tier');
  // B-Tier = bukan Admin, bukan S-Tier, bukan A-Tier
  const isFree = !isAdmin && !isSTier && !isATier;

  const now = Date.now();

  // =========================================================
  // CEK EMAIL AKTIF — HANYA BERLAKU UNTUK B-TIER (FREE)
  // A-Tier, S-Tier, dan Owner/Admin bebas timpa sesi lama
  // =========================================================
  if (
    isFree &&
    user.activeEmail &&
    user.emailExpiry &&
    now < new Date(user.emailExpiry).getTime()
  ) {
    throw new Error(
      'Kamu masih memiliki sesi email aktif. Tunggu hingga sesi berakhir sebelum membuat email baru.'
    );
  }

  // Timpa sesi lama untuk pengguna Premium (A-Tier, S-Tier, Owner)
  if (!isFree) {
    user.activeEmail = null;
    user.activeEmailToken = null;
    user.emailExpiry = null;
  }

  // =========================================================
  // PENEGAKAN LIMIT HARIAN
  // - A-Tier  : total (custom + random) maks 10/hari
  // - B-Tier  : custom maks 1/hari, random bebas (kena biaya poin)
  // - S-Tier & Owner : tidak ada batasan harian
  // =========================================================
  if (isATier) {
    const totalUsage =
      (user.dailyUsageCustom || 0) +
      (user.dailyUsageRandom || 0);
    if (totalUsage >= 10) {
      throw new Error(
        'Limit harian A-Tier telah tercapai (10 sesi per hari).'
      );
    }
  }

  if (isFree && type === 'custom' && (user.dailyUsageCustom || 0) >= 1) {
    throw new Error(
      'Limit email custom gratis telah habis untuk hari ini (maks 1x per hari).'
    );
  }

  let cost;
  let requestedName = null;

  if (type === 'random') {
    cost = isATier ? 2 : (isFree ? 5 : 0);
  } else {
    requestedName = customNameStorage.get(chatId);

    if (!requestedName) {
      throw new Error(
        'Nama custom tidak ditemukan. Jalankan kembali /createmailc.'
      );
    }

    cost = isATier ? 5 : (isFree ? 10 : 0);
  }

  if (!isAdmin && user.points < cost) {
    throw new Error(
      'Saldo poin tidak cukup untuk membuat email ini. Silakan isi Point di menu TopupPoint.'
    );
  }

  const domain = await getMailTmDomain();

  let attempt = 0;
  let emailAddress;
  let success = false;

  while (!success && attempt < 5) {
    attempt += 1;

    if (type === 'random') {
      emailAddress = `${makeRandomString(10)}@${domain}`;
    } else {
      emailAddress = `${sanitizeMailName(requestedName)}@${domain}`;
    }

    try {
      const { address, token } =
        await createMailTmAccount(emailAddress);

      user.activeEmail = address;
      user.activeEmailToken = token;

      user.emailExpiry = new Date(
        now + 60 * 60 * 1000
      ).toISOString();

      if (!isAdmin) {
        user.points -= cost;

        if (type === 'random') {
          user.dailyUsageRandom =
            (user.dailyUsageRandom || 0) + 1;
        } else {
          user.dailyUsageCustom =
            (user.dailyUsageCustom || 0) + 1;
        }
      }

      await writeDB(db);

      success = true;

      return {
        address,
        cost,
        expiryText: new Date(user.emailExpiry)
          .toLocaleString('id-ID', {
            timeZone: 'Asia/Jakarta'
          })
      };

    } catch (err) {

      if (
        err.response &&
        err.response.status === 422 &&
        type === 'random'
      ) {
        continue;
      }

      if (
        err.response &&
        err.response.status === 422 &&
        type === 'custom'
      ) {
        throw new Error(
          'Nama email custom sudah dipakai.'
        );
      }

      throw err;
    }
  }

  throw new Error(
    'Gagal membuat email otomatis.'
  );
}

async function apiCall(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await axios({
        url,
        ...options,
        timeout: 12000,
        headers: { 'User-Agent': 'MailGatewayBot/2.0', ...options.headers }
      });
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
    }
  }
}

// -------------------------------------------------------------
// CORE BOT COMMAND HANDLERS (SUPER FEMININE STYLE)
// -------------------------------------------------------------
bot.onText(/\/(start|menu)/i, async (msg) => {
  const chatId = String(msg.chat.id).trim();
  if (!checkRateLimit(chatId)) return bot.sendMessage(chatId, "Sistem sedang sibuk, silakan tunggu beberapa detik lalu coba lagi.");

  await verifyUser(chatId, msg.from.first_name, msg.from.username);
  const userName = msg.from.username ? `@${msg.from.username}` : (msg.from.first_name || 'Pengguna');

  const text = `Halo ${userName}, selamat datang di dashboard utama.

Bot ini siap membantu kamu menyiapkan email sementara yang aman, cepat, dan terpercaya. Berikut fitur yang tersedia:

Fitur pembuatan email sementara:
- /CreateMailR : Buat sesi email acak
- /CreateMailC : Buat sesi email kustom
- /CheckInbox : Periksa kotak masuk / kode OTP
- /EmailActive : Lihat sisa waktu sesi email aktif

Menu akun & layanan premium:
- /P
