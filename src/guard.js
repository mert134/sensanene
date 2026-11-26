/**
 * LORES GUARD — gerçek zamanlı sunucu koruması.
 *
 * Bu modül TAMAMEN yeniden yazıldı. Artık "kayıt + uyarı" değil; tespit edilen
 * ihlallerde gerçekten müdahale eder (mesaj silme, timeout, atma, yasaklama,
 * rol soyma, kanal/rol geri yükleme). Discord tarafına sızmaması gereken
 * operatör katmanı (whitelist / sessiz mod) korunarak muhafaza edildi.
 *
 * Yetenekler:
 *  - Anti-Nuke: denetim kaydındaki toplu silme/oluşturma/yetki değişiklikleri
 *    hem sabit limit hem sunucu büyüklüğüne göre ORAN ile izlenir. Eşik
 *    aşılınca yürütücünün rolleri soyulur, gerekiyorsa atılır/yasaklanır.
 *  - Anti-Raid: katılım patlaması, tekrar eden avatarlar, yeni hesaplar.
 *  - Kanal/Rol/Webhook/Bot/Emoji/Entegrasyon/Davet korumaları; guard kanalı
 *    veya honeypot kanalı silinirse otomatik onarım + fail-safe.
 *  - Honeypot: tuzak kanal, tuzak rol ve tuzak mesaj. Tıklayan/mention'layan
 *    kişi anında cezalandırılır (varsayılan: 1 saat timeout, yapılandırılabilir
 *    kick/ban).
 *  - Reklam motoru: davet linkleri, link kısaltıcılar, Discord "nitro" scam,
 *    gizlenmiş linkler (discord[.]gg, d1scord, harf karıştırma), kripto/bahis/
 *    satış/sunucu tanıtımı sinyalleri, emoji-büyük harf kümeleri ile puanlama.
 *    Yüksek skorda mesaj silinir ve ceza uygulanır.
 *  - Spam: hızlı mesaj, tekrar eden içerik, çoklu kanal bombardımanı.
 *  - Mention: @everyone/@here ve toplu mention; aşırı mention'da timeout.
 *  - Yedek & geri yükleme: rol/kanal anlık görüntüsü; nuke sonrası otomatik
 *    (sınırlı) veya elle tam geri yükleme.
 *  - Güvenlik denetimi: doğrulama seviyesi, 2FA, guard kanalı varlığı.
 *  - Panik modu: tüm yetkili rollerin soyulması, davetlerin silinmesi.
 *
 * Operatör katmanı (değişmedi):
 *  - Koruma YALNIZCA operatörün whitelist'ine alınmış sunucularda gerçekten
 *    çalışır. Yeni sunucular otomatik pasif başlar.
 *  - Sessiz moddaki (blacklist) sunucularda hiçbir izleme/ceza yapılmaz; sunucu
 *    bunu anlayamaz (/guard durum normal görünür).
 */
const { SlashCommandBuilder, EmbedBuilder, AuditLogEvent, GatewayIntentBits, PermissionsBitField, ChannelType, OverwriteType } = require('discord.js');
const { db, save } = require('./store');
const settings = require('./settings');

const COLOR = { main: 0x5865f2, ok: 0x2ecc71, err: 0xed4245, warn: 0xfaa61a, gold: 0xf1c40f };

/* ================================================================== MODÜLLER */
const MODULES = [
  { key: 'antiNuke', label: 'Anti-Nuke', icon: 'shield', desc: 'Toplu kanal/rol silme, yetki değişikliği ve yıkım hareketleri: roller soyulur, gerekirse yasaklanır.' },
  { key: 'antiRaid', label: 'Anti-Raid', icon: 'users', desc: 'Katılım patlaması, tekrar eden avatar/isim ve yeni hesap akınlarını yakalar; sunucuyu kilitler.' },
  { key: 'channelGuard', label: 'Kanal Koruması', icon: 'hash', desc: 'Kanal silme/oluşturma/yeniden adlandırma limitleri; guard kanalı silinirse anında onarır.' },
  { key: 'roleGuard', label: 'Rol Koruması', icon: 'tag', desc: 'Rol silme/oluşturma ve tehlikeli yetki değişikliklerini izler; silinen rolleri yedekten geri kurar.' },
  { key: 'webhookGuard', label: 'Webhook Koruması', icon: 'link', desc: 'Yetkisiz webhook oluşturma/silme; yeni webhook’ları anında temizler.' },
  { key: 'botGuard', label: 'Bot Koruması', icon: 'bot', desc: 'Güvenli listede olmayan bot eklendiğinde botu anında atar, davet edeni cezalandırır.' },
  { key: 'spamGuard', label: 'Spam Koruması', icon: 'message', desc: 'Mesaj bombardımanı, birebir tekrar ve çoklu kanal spam’i: mesaj sil + timeout.' },
  { key: 'adGuard', label: 'Reklam Koruması', icon: 'megaphone', desc: 'Davet, kısaltıcı, nitro scam, bahis/satış/tanıtım sinyalleri ve gizlenmiş linkler: mesaj sil + ceza.' },
  { key: 'mentionGuard', label: 'Mention Koruması', icon: 'alert', desc: '@everyone/@here kötüye kullanımı ve toplu mention; aşırıda mesaj silinir, timeout verilir.' },
  { key: 'honeypot', label: 'Honeypot (Tuzak)', icon: 'lock', desc: 'Tuzak kanal/rol/mesaj; kimseye söylenmez. Dokunan anında cezalandırılır.' },
  { key: 'accountGuard', label: 'Hesap Koruması', icon: 'userX', desc: 'Yeni açılmış hesapların riskli katılımını işaretler ve yapılandırılırsa atar.' }
];

/* ============================================================ İZLENEN İŞLEMLER */
/** module: hangi modüle bağlı · ratio: sunucu büyüklüğüne göre otomatik eşik. */
const LIMIT_ACTIONS = [
  { key: 'ban', label: 'Yasaklama', def: 3, module: 'antiNuke', ratio: 3 },
  { key: 'kick', label: 'Atma', def: 3, module: 'antiNuke', ratio: 3 },
  { key: 'memberPrune', label: 'Toplu üye atma', def: 1, module: 'antiRaid', ratio: 0 },
  { key: 'channelDelete', label: 'Kanal silme', def: 2, module: 'channelGuard', ratio: 4 },
  { key: 'channelCreate', label: 'Kanal oluşturma', def: 3, module: 'channelGuard', ratio: 4 },
  { key: 'channelRename', label: 'Kanal adı değiştirme', def: 3, module: 'channelGuard', ratio: 0 },
  { key: 'roleDelete', label: 'Rol silme', def: 2, module: 'roleGuard', ratio: 5 },
  { key: 'roleCreate', label: 'Rol oluşturma', def: 3, module: 'roleGuard', ratio: 0 },
  { key: 'roleUpdate', label: 'Rol yetkisi değiştirme', def: 3, module: 'roleGuard', ratio: 4 },
  { key: 'webhook', label: 'Webhook oluşturma', def: 2, module: 'webhookGuard', ratio: 0 },
  { key: 'webhookDelete', label: 'Webhook silme', def: 2, module: 'webhookGuard', ratio: 0 },
  { key: 'botAdd', label: 'Bot ekleme', def: 1, module: 'botGuard', ratio: 0 },
  { key: 'emojiDelete', label: 'Emoji silme', def: 3, module: 'antiNuke', ratio: 0 },
  { key: 'integration', label: 'Entegrasyon ekleme/silme', def: 1, module: 'antiNuke', ratio: 0 },
  { key: 'inviteCreate', label: 'Davet oluşturma', def: 4, module: 'adGuard', ratio: 0 }
];

const ACTION_BY_KEY = Object.fromEntries(LIMIT_ACTIONS.map((a) => [a.key, a]));
const MODULE_BY_KEY = Object.fromEntries(MODULES.map((m) => [m.key, m]));

const PUNISHMENTS = [
  { key: 'ban', label: 'Yasakla' },
  { key: 'kick', label: 'Sunucudan at' },
  { key: 'roles', label: 'Tüm yetkili rollerini al' },
  { key: 'timeout', label: 'Zaman aşımı (timeout)' }
];

const HONEYPOT_ACTIONS = [
  { key: 'timeout', label: 'Timeout (saatlik)' },
  { key: 'kick', label: 'Sunucudan at' },
  { key: 'ban', label: 'Yasakla' },
  { key: 'roles', label: 'Tüm yetkili rollerini al' }
];

const AD_ACTIONS = [
  { key: 'delete', label: 'Mesajı sil + uyar' },
  { key: 'timeout', label: 'Mesajı sil + timeout' },
  { key: 'kick', label: 'Sil + sunucudan at' },
  { key: 'ban', label: 'Sil + yasakla' }
];

const BOT_ACTIONS = [
  { key: 'notify', label: 'Sadece bildir' },
  { key: 'kick', label: 'Botu at' },
  { key: 'ban-inviter', label: 'Botu at + davet edeni yasakla' }
];

const RAID_ACTIONS = [
  { key: 'notify', label: 'Bildir + izlemeyi sıkılaştır' },
  { key: 'kick-new', label: 'Raid süresince yeni hesapları at' },
  { key: 'lockdown', label: 'Sunucuyu kilitle (doğrulama yükselt)' }
];

const NEW_ACCOUNT_ACTIONS = [
  { key: 'notify', label: 'Sadece işaretle' },
  { key: 'kick', label: 'Sunucudan at' }
];

const DANGEROUS_PERMS = ['Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'ManageWebhooks', 'BanMembers', 'KickMembers', 'ModerateMembers', 'ManageMessages'];

const DEFAULT_GUARD = {
  enabled: false,
  simulation: false,
  logChannelId: null,
  punishment: 'ban',
  timeoutMinutes: 10,
  windowSeconds: 60,
  whitelist: [],
  jailRoleId: null,
  mutedRoleId: null,
  modules: Object.fromEntries(MODULES.map((m) => [m.key, true])),
  limits: Object.fromEntries(LIMIT_ACTIONS.map((a) => [a.key, a.def])),
  ratios: Object.fromEntries(LIMIT_ACTIONS.map((a) => [a.key, a.ratio])),
  thresholds: {
    massDestructive: 5,   // tek kişide pencere içinde toplam yıkıcı işlem
    maxMentions: 6,       // tek mesajda mention sayısı
    massMention: 12       // tek mesajda toplu mention eşiği
  },
  ad: {
    action: 'delete',
    timeoutMinutes: 10,
    allowInvites: false,
    trustedDomains: [],
    detected: 0
  },
  caps: { enabled: true, minLength: 12, percent: 70 },
  emoji: { enabled: true, max: 8 },
  newAccount: { enabled: true, days: 7, minMembers: 15, action: 'notify' },
  raidAction: 'notify',
  botAction: 'kick',
  safety: {
    verifyLevel: true,
    twoFactor: true,
    watchIntegrations: true,
    autoRestore: true,
    restoreMaxPerWindow: 6
  },
  honeypot: {
    enabled: true,
    channelId: null,
    roleId: null,
    messageId: null,
    action: 'timeout',
    hours: 1,
    autoReply: true,
    hits: 0,
    lastAt: null,
    setupAt: null
  },
  stats: { blocked: 0, deleted: 0, timeouts: 0, bans: 0, kicks: 0, stripped: 0, restored: 0, honeypot: 0, ads: 0, lastAt: null, byDay: {} },
  backup: null,
  enabledAt: null,
  installedAt: null,
  /* Operatör katmanı — Discord tarafında HİÇ gösterilmez. */
  silent: false,
  silentAt: null,
  silentReason: null,
  addedAt: null,
  approvedAt: null,
  approvedBy: null
};

const MAX_EVENTS = 120;

/* ================================================================ YAPILANDIRMA */
function deepMerge(base, extra) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base?.[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

function get(guildId) {
  const key = String(guildId);
  if (!db.guard[key]) {
    db.guard[key] = JSON.parse(JSON.stringify(DEFAULT_GUARD));
    save();
  }
  const stored = db.guard[key];
  const cfg = deepMerge(DEFAULT_GUARD, stored);
  cfg.modules = { ...DEFAULT_GUARD.modules, ...(stored.modules || {}) };
  cfg.limits = { ...DEFAULT_GUARD.limits, ...(stored.limits || {}) };
  cfg.ratios = { ...DEFAULT_GUARD.ratios, ...(stored.ratios || {}) };
  cfg.whitelist = Array.isArray(stored.whitelist) ? stored.whitelist.map(String) : [];
  return cfg;
}

function write(guildId, cfg) {
  db.guard[String(guildId)] = cfg;
  save();
  return cfg;
}

function update(guildId, patch) {
  const cfg = get(guildId);
  const next = { ...cfg, ...patch };
  if (patch.modules) next.modules = { ...cfg.modules, ...patch.modules };
  if (patch.limits) next.limits = { ...cfg.limits, ...patch.limits };
  if (patch.ratios) next.ratios = { ...cfg.ratios, ...patch.ratios };
  if (patch.thresholds) next.thresholds = { ...cfg.thresholds, ...patch.thresholds };
  if (patch.ad) next.ad = { ...cfg.ad, ...patch.ad };
  if (patch.caps) next.caps = { ...cfg.caps, ...patch.caps };
  if (patch.emoji) next.emoji = { ...cfg.emoji, ...patch.emoji };
  if (patch.newAccount) next.newAccount = { ...cfg.newAccount, ...patch.newAccount };
  if (patch.safety) next.safety = { ...cfg.safety, ...patch.safety };
  if (patch.honeypot) next.honeypot = { ...cfg.honeypot, ...patch.honeypot };
  if (patch.whitelist) next.whitelist = [...new Set(patch.whitelist.map(String))];
  if (patch.stats) next.stats = { ...cfg.stats, ...patch.stats };
  return write(guildId, next);
}

function setEnabled(guildId, enabled, actorName = null) {
  const cfg = update(guildId, { enabled: Boolean(enabled), enabledAt: enabled ? Date.now() : null, installedAt: get(guildId).installedAt || Date.now() });
  pushEvent(guildId, {
    type: 'action',
    severity: enabled ? 'low' : 'medium',
    title: enabled ? 'Koruma açıldı' : 'Koruma kapatıldı',
    detail: actorName ? `İşlemi yapan: ${actorName}` : 'Panel üzerinden değiştirildi',
    module: null
  });
  void cfg;
  return get(guildId);
}

function setModule(guildId, key, enabled) {
  const mod = MODULE_BY_KEY[key];
  if (!mod) return { ok: false, error: 'Bilinmeyen modül.' };
  const cfg = get(guildId);
  update(guildId, { modules: { ...cfg.modules, [key]: Boolean(enabled) } });
  return { ok: true, module: key, label: mod.label, enabled: Boolean(enabled) };
}

function setLimit(guildId, key, value) {
  const action = ACTION_BY_KEY[key];
  if (!action) return { ok: false, error: 'Bilinmeyen işlem.' };
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1 || n > 100) return { ok: false, error: 'Limit 1 ile 100 arasında olmalı.' };
  const cfg = get(guildId);
  update(guildId, { limits: { ...cfg.limits, [key]: n } });
  return { ok: true, action: key, label: action.label, limit: n, ratio: get(guildId).ratios[key] || 0 };
}

function setRatio(guildId, key, value) {
  const action = ACTION_BY_KEY[key];
  if (!action) return { ok: false, error: 'Bilinmeyen işlem.' };
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false, error: 'Oran 0 (kapalı) ile 100 arasında olmalı.' };
  const cfg = get(guildId);
  update(guildId, { ratios: { ...cfg.ratios, [key]: n } });
  return { ok: true, action: key, label: action.label, ratio: n };
}

function isWhitelisted(cfg, userId) {
  return (cfg.whitelist || []).map(String).includes(String(userId));
}

function addWhitelist(guildId, userId) {
  const cfg = get(guildId);
  if (isWhitelisted(cfg, userId)) return { ok: false, error: 'Bu kullanıcı zaten güvenli listede.' };
  update(guildId, { whitelist: [...cfg.whitelist, String(userId)] });
  return { ok: true, whitelist: get(guildId).whitelist };
}

function removeWhitelist(guildId, userId) {
  const cfg = get(guildId);
  if (!isWhitelisted(cfg, userId)) return { ok: false, error: 'Kullanıcı güvenli listede değil.' };
  update(guildId, { whitelist: cfg.whitelist.filter((id) => String(id) !== String(userId)) });
  return { ok: true, whitelist: get(guildId).whitelist };
}

/* =================================================================== OLAY AKIŞI */
function pushEvent(guildId, event) {
  const key = String(guildId);
  if (!db.guardEvents[key]) db.guardEvents[key] = [];
  const record = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    type: event.type || 'info',
    severity: event.severity || 'low',
    title: event.title || 'Guard kaydı',
    detail: event.detail || '',
    module: event.module || null,
    action: event.action || null,
    actor: event.actor || null,
    count: event.count ?? null,
    limit: event.limit ?? null,
    channel: event.channel || null,
    target: event.target || null,
    evidence: event.evidence || null,
    score: event.score ?? null,
    punishment: event.punishment || null,
    restored: event.restored || null
  };
  db.guardEvents[key].unshift(record);
  db.guardEvents[key] = db.guardEvents[key].slice(0, MAX_EVENTS);
  save();
  return record;
}

function events(guildId, limit = 30) {
  return (db.guardEvents[String(guildId)] || []).slice(0, limit);
}

function clearEvents(guildId) {
  db.guardEvents[String(guildId)] = [];
  save();
  return { ok: true };
}

/* ================================================================== SAYAÇLAR */
/* guildId:actorId:action -> [zaman damgaları] */
const counters = new Map();
/* guildId:actorId:* -> [zaman damgaları] (toplam yıkıcı hareket) */
const destructive = new Map();
const lastNotified = new Map();
const logFixAt = new Map(); // guildId -> son guard kanalı onarımı
/* RAID: guildId -> [{at, userId, avatar, name, newAccount}] */
const joinStamps = new Map();
/* SPAM: guildId:userId -> [{at, hash, channelId, content}] */
const messageTrail = new Map();
/* KANAL: guildId:channelId -> [zaman] (webhook temizliği için) */
const raidMode = new Map(); // guildId -> { until, action }

function counterKey(guildId, actorId, action) {
  return `${guildId}:${actorId}:${action}`;
}

function prune(list, now, windowMs) {
  return (list || []).filter((t) => typeof t === 'number' && now - t <= windowMs);
}

/** Nesne biçimindeki zaman damgalarını (ör. {at, hash}) pencereye göre süzer. */
function pruneStamps(list, now, windowMs) {
  return (list || []).filter((item) => item && typeof item.at === 'number' && now - item.at <= windowMs);
}

/**
 * Bir işlemi sayar ve sınır aşımını bildirir.
 * Dönen: { count, limit, ratioLimit, totalMembers, violated, reason }
 */
function registerAction(guildId, { actorId, action, now = Date.now(), memberCount = null }) {
  const cfg = get(guildId);
  const limit = cfg.limits[action] ?? ACTION_BY_KEY[action]?.def ?? 3;
  const ratio = cfg.ratios[action] ?? ACTION_BY_KEY[action]?.ratio ?? 0;
  const windowMs = Math.max(5, Number(cfg.windowSeconds) || 60) * 1000;
  const key = counterKey(guildId, actorId, action);
  const stamps = prune(counters.get(key), now, windowMs);
  stamps.push(now);
  counters.set(key, stamps);

  const total = Number(memberCount) || 0;
  const ratioLimit = ratio > 0 && total >= 25 ? Math.max(1, Math.ceil(total / ratio)) : 0;
  const violated = stamps.length > limit || (ratioLimit > 0 && stamps.length >= ratioLimit);
  const reason = stamps.length > limit ? 'limit' : ratioLimit > 0 && stamps.length >= ratioLimit ? 'oran' : null;
  return { count: stamps.length, limit, ratioLimit, totalMembers: total || null, violated, reason };
}

/** Tek kişide pencere içinde toplam kaç yıkıcı işlem yapıldı? */
function registerDestructive(guildId, { actorId, now = Date.now() }) {
  const cfg = get(guildId);
  const windowMs = Math.max(5, Number(cfg.windowSeconds) || 60) * 1000;
  const key = `${guildId}:${actorId}:all`;
  const stamps = prune(destructive.get(key), now, windowMs);
  stamps.push(now);
  destructive.set(key, stamps);
  return { count: stamps.length, limit: Number(cfg.thresholds.massDestructive) || 6 };
}

function shouldNotify(guildId, actorId, kind, cooldownMs = 30000) {
  const key = `${guildId}:${actorId}:${kind}`;
  const last = lastNotified.get(key) || 0;
  if (Date.now() - last < cooldownMs) return false;
  lastNotified.set(key, Date.now());
  return true;
}

function bumpStat(guildId, key, amount = 1) {
  const cfg = get(guildId);
  const stats = { ...cfg.stats };
  stats[key] = (stats[key] || 0) + amount;
  stats.lastAt = Date.now();
  const day = new Date().toISOString().slice(0, 10);
  const byDay = { ...(stats.byDay || {}) };
  byDay[day] = { ...(byDay[day] || {}) };
  byDay[day][key] = (byDay[day][key] || 0) + amount;
  const days = Object.keys(byDay).sort().slice(-14);
  stats.byDay = Object.fromEntries(days.map((d) => [d, byDay[d]]));
  update(guildId, { stats });
  return stats;
}

/* ============================================================== REKLAM MOTORU */
const INVITE_RE = /(?:discord[\s._-]*(?:gg|io|me|li|gift|com\/invite|com\/+invite|app\.com\/invite)|discordapp\.com\/invite|dsc\.gg|dis\.gd)\s*\/\s*[a-z0-9-]{2,}/i;
const SHORTENERS = ['bit.ly', 'tinyurl.com', 'goo.gl', 't.co', 'ow.ly', 'is.gd', 'cutt.ly', 'shorturl.at', 'rebrand.ly', 's.id', 'rb.gy', 'adf.ly', 'shrtco.de', 'bit.do', 'clck.ru', 'v.gd', 'tiny.cc', 'chilp.it', 't.ly', 'spoo.me', '1link.in', 'linktr.ee'];
const AD_TLDS = ['com', 'net', 'org', 'gg', 'io', 'me', 'li', 'tv', 'xyz', 'shop', 'store', 'site', 'online', 'link', 'click', 'app', 'dev', 'co', 'tr', 'ru', 'info', 'biz', 'vip', 'ltd', 'pro', 'top', 'fun', 'club', 'live', 'space', 'tech', 'cloud', 'one', 'win', 'bet', 'casino', 'party', 'gdn', 'icu', 'cyou', 'buzz', 'rest', 'de', 'uk', 'fr', 'az', 'kz'];
const AD_WORDS = [
  'reklam', 'promosyon', 'promo', 'indirim', 'kupon', 'referans', 'ref link', 'davetiyesi', 'katılın', 'bedava', 'ücretsiz', 'beleş',
  'nitro', 'hediye', 'çekiliş', 'giveaway', 'satılık', 'satılıyor', 'ucuz', 'fırsat', 'kampanya', 'işe alım', 'mod alım', 'yetkili alım', 'admin alım',
  'takipçi', 'abone', 'boost basma', 'para kazan', 'kazanç', 'kazandıran', 'proxy', 'scam', 'dolandırıcı', 'güvenilir site', 'tıkla',
  'sunucumuz', 'sunucuma', 'sunucumuzda', 'sunucu tanıtım', 'tanıtım', 'reklamımızı', 'bize katıl', 'gel abi', 'abone ol', 'başvuru', 'iş başvurusu',
  'cüzdan', 'bahis', 'iddaa', 'kripto', 'btc', 'usdt', 'airdrop', 'hack', 'cheat', 'crack', 'apk', 'mod menu', 'valorant point', 'robux',
  'minecraft hesap', 'hesap satış', 'member boost', 'bot basma', 'takas', 'ininal', 'papara', 'iban', 'havale', 'eft', 'ödeme', 'taban fiyat',
  'yatırım', 'forex', 'sinyal', 'premium satış', 'hesap aç', 'özelden yaz', 'fiyat', 'satın al', 'sipariş', 'kargo', 'stok', 'whatsapp', 'telegram'
];
const AD_MILD = ['youtube', 'twitch', 'tiktok', 'instagram', 'kanalım', 'yayın', 'dm gel', 'free', 'vip', 'çekilişe katıl'];
const AD_STRONG = [
  { re: /(?:free|bedava|beleş)[\s\S]{0,24}(?:nitro|robux|v-?bucks|steam|cs2|csgo|valorant)/i, weight: 4, label: 'bedava nitro/oyun tuzağı' },
  { re: /(?:nitro)[\s\S]{0,20}(?:free|bedava|beleş|gift|hediye|alttaki|linke|tıkla)/i, weight: 4, label: 'nitro scam' },
  { re: /(?:steamcommunity|steamcommunlty|stesmcommunity|steamcomunity|steamcommunitly|stesmcommunlty)[.\s]/i, weight: 4, label: 'sahte Steam' },
  { re: /(?:airdrop|free\s*crypto|kripto\s*(?:fırsat|kazan)|usdt\s*kazan|cüzdan\s*bağla|(?:usdt|btc|eth)[\s\S]{0,16}cüzdan|(?:usdt|btc)[\s\S]{0,16}kazan)/i, weight: 3, label: 'kripto tuzağı' },
  { re: /(?:bahis|iddaa|casino|bet\s*sitesi|kupon\s*kodu)[\s\S]{0,20}(?:link|site|tıkla|kazan)/i, weight: 3, label: 'bahis reklamı' },
  { re: /(?:satılık|satış|satıyorum|satın al)[\s\S]{0,20}(?:hesap|sunucu|kanal|takipçi|üye|bot|boost)/i, weight: 3, label: 'satış ilanı' },
  { re: /(?:takipçi|üye|boost|bot)\s*(?:basma|satışı|kazan)/i, weight: 3, label: 'üye/takipçi satışı' },
  { re: /(?:discord\.com\/users?\/\d{5,}|discord\.com\/channels\/\d+\/\d+\/\d+)/i, weight: 2, label: 'harici Discord bağlantısı' },
  { re: /(?:kaç\s*k(?:i)?\s*(?:ayrıcalık|yetki)?\s*kazan|100\s*(?:üye|kişi|davet)[\s\S]{0,24}(?:kazan|ödül|nitro))/i, weight: 2, label: 'davet ödülü tuzağı' }
];
const CRYPTO_RE = /\b(?:bc1[a-z0-9]{25,}|0x[a-f0-9]{40}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|T[A-Za-z1-9]{33})\b/;
const PRICE_RE = /(?:\d{1,6})\s*(?:tl|try|₺|\$|usd|eur|€|usdt|btc)\b|\b(?:tl|try|₺|\$|usd|eur|€|usdt|btc)\s*\d{1,6}\b/i;
const EVERYONE_RE = /@everyone|@here/i;
const MENTION_USER_RE = /<@!?(\d{15,25})>/g;
const MENTION_ROLE_RE = /<@&(\d{15,25})>/g;
const CUSTOM_EMOJI_RE = /<a?:[a-zA-Z0-9_~]{2,32}:\d{15,25}>/g;
const UNICODE_EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/gu;

/** Gizlenmiş metni normalize eder: d1scord[.]gg → discord.gg, sıfır genişlik temizliği, leet. */
function normalizeText(input) {
  let s = String(input || '');
  s = s.normalize('NFKC');
  s = s.replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '');
  s = s.replace(/[\s]*[[(]\s*[.\u3002]\s*[\])][\s]*/g, '.');
  s = s.replace(/[\s]*\(?\s*dot\s*\)?[\s]*/gi, '.');
  s = s.replace(/\s*\.\s*/g, '.');
  s = s.replace(/\s*\/\s*/g, '/');
  s = s.toLowerCase();
  // leet / görsel benzerlik
  s = s.replace(/0/g, 'o').replace(/[1|!]/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5|\$/g, 's').replace(/7/g, 't').replace(/@/g, 'a');
  s = s.replace(/[ıİ]/g, 'i').replace(/[şŞ]/g, 's').replace(/[ğĞ]/g, 'g').replace(/[üÜ]/g, 'u').replace(/[öÖ]/g, 'o').replace(/[çÇ]/g, 'c');
  return s;
}

/** Metindeki tüm URL/alan adlarını çıkarır (gizlenmiş olanlar dahil). */
function extractLinks(raw) {
  const text = normalizeText(raw);
  const found = new Set();
  const urlRe = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/gi;
  let m;
  while ((m = urlRe.exec(text))) {
    const value = m[0].replace(/[),.;!?]+$/, '');
    if (value.length > 3) found.add(value);
  }
  // davet linkleri ayrıca yakalanır (discord.gg/abc gibi)
  const invite = text.match(INVITE_RE);
  if (invite) found.add(invite[0]);
  return [...found];
}

function linkHost(link) {
  return String(link).replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
}

function hasAdWord(text) {
  const hits = [];
  for (const word of AD_WORDS) {
    const re = new RegExp(`(?:^|[^a-z0-9çğıöşü])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    if (re.test(text)) hits.push(word);
  }
  return hits;
}

/**
 * Reklam analizi: { score, confident, reasons, links, action }
 * Skor 3+ ise güçlü reklam kabul edilir. Ham metin ve normalize metin birlikte
 * taranır; böylece hem Türkçe yazım hem leet/kaçamak yazım yakalanır.
 */
function analyzeAd(raw, cfg = null, extra = {}) {
  const moduleOn = cfg ? cfg.modules?.adGuard !== false : true;
  const adCfg = cfg?.ad || {};
  const text = String(raw || '');
  const rawLower = text.toLocaleLowerCase('tr');
  const norm = normalizeText(text);
  const hay = `${rawLower}\n${norm}`;
  const reasons = [];
  let score = 0;
  let strong = false;

  const links = extractLinks(text);
  const invited = INVITE_RE.test(norm) || INVITE_RE.test(rawLower);
  const trusted = (adCfg.trustedDomains || []).map((d) => String(d).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, ''));
  const isTrustedLink = (link) => trusted.some((d) => linkHost(link) === d || linkHost(link).endsWith(`.${d}`));

  if (invited) {
    if (adCfg.allowInvites) {
      reasons.push('davet linki (izinli)');
    } else {
      score += 4;
      strong = true;
      reasons.push('Discord davet linki');
    }
  }

  for (const link of links) {
    if (isTrustedLink(link)) continue;
    const host = linkHost(link);
    if (invited && /discord/.test(host)) continue;
    if (SHORTENERS.some((sh) => host === sh || host.endsWith(`.${sh}`))) {
      score += 3;
      strong = true;
      reasons.push(`link kısaltıcı (${host})`);
      continue;
    }
    if (host.includes('discord') && host !== 'discord.com' && host !== 'discord.gg' && host !== 'discordapp.com') {
      score += 3;
      strong = true;
      reasons.push(`sahte Discord alan adı (${host})`);
      continue;
    }
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
      score += 2;
      reasons.push(`IP adresi (${host})`);
      continue;
    }
    score += 1;
    reasons.push(`bağlantı (${host})`);
  }
  if (links.length >= 3) { score += 2; reasons.push(`${links.length} bağlantı`); }

  for (const rule of AD_STRONG) {
    if (rule.re.test(hay)) {
      score += rule.weight;
      strong = strong || rule.weight >= 3;
      reasons.push(rule.label);
    }
  }

  const words = hasAdWord(rawLower).concat(hasAdWord(norm).filter((w) => !hasAdWord(rawLower).includes(w)));
  if (words.length) {
    score += Math.min(3, words.length);
    reasons.push(`reklam sözcükleri: ${words.slice(0, 5).join(', ')}`);
    if (links.length && words.length >= 2) { score += 1; strong = true; }
  }
  const mild = hasAdWordIn(hay, AD_MILD);
  if (mild.length >= 2) score += 1;

  if (CRYPTO_RE.test(text)) { score += 2; reasons.push('kripto cüzdan adresi'); }
  if (PRICE_RE.test(text)) { score += 1; reasons.push('fiyat/ödeme ifadesi'); }

  const letters = (text.match(/\p{L}/gu) || []).length;
  const uppers = (text.match(/\p{Lu}/gu) || []).length;
  if (letters >= 16 && uppers / letters >= 0.6) { score += 1; reasons.push('aşırı büyük harf'); }
  const emojis = (text.match(UNICODE_EMOJI_RE) || []).length + (text.match(CUSTOM_EMOJI_RE) || []).length;
  if (emojis >= 6) { score += 1; reasons.push('emoji bombardımanı'); }

  const noLinks = norm.replace(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?/g, '').trim();
  if (links.length && noLinks.length <= 24 && (invited || SHORTENERS.some((sh) => links.some((l) => linkHost(l).includes(sh))))) {
    score += 1;
    strong = true;
    reasons.push('kısa link mesajı');
  }

  // Duyuru biçimi: @everyone/@here + link + reklam sözcüğü → reklam duyurusu
  if (EVERYONE_RE.test(text) && links.some((l) => !isTrustedLink(l)) && words.length >= 1) {
    score += 2;
    reasons.push('@everyone/@here reklam duyurusu');
  }

  const extraText = String(extra.text || '');
  if (extraText) {
    const extraWords = hasAdWord(normalizeText(extraText));
    if (extraWords.length && links.length) { score += 1; reasons.push('embed/ek içeriği'); }
  }

  const threshold = 3;
  const confident = Boolean(moduleOn) && (score >= threshold || (strong && score >= 2));
  return {
    score,
    confident,
    strong,
    reasons: [...new Set(reasons)],
    links,
    action: confident ? (adCfg.action || 'delete') : 'none',
    moduleOn
  };
}

/** Verilen metinde listedeki sözcüklerden hangileri var? */
function hasAdWordIn(hay, list) {
  const hits = [];
  for (const word of list) {
    const re = new RegExp(`(?:^|[^a-z0-9çğıöşü])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    if (re.test(hay)) hits.push(word);
  }
  return hits;
}

/* =========================================================== HONEYPOT YARDIMCI */
const honeypotHits = new Map(); // guildId:userId -> son zaman

function honeypotOffense(guild, cfg, userId, { name, kind, channelId = null, messageId = null }) {
  if (!cfg.honeypot?.enabled) return;
  if (isWhitelisted(cfg, userId)) return;
  if (userId === guild.ownerId) return;
  const key = `${guild.id}:${userId}`;
  const last = honeypotHits.get(key) || 0;
  if (Date.now() - last < 8000) return; // aynı kişide tekrar tetikleme koruması
  honeypotHits.set(key, Date.now());

  const action = cfg.honeypot.action || 'timeout';
  const hours = Math.max(1, Math.min(24, Number(cfg.honeypot.hours) || 1));
  const settings2 = get(guild.id);
  update(guild.id, { honeypot: { ...settings2.honeypot, hits: (settings2.honeypot.hits || 0) + 1, lastAt: Date.now() } });
  bumpStat(guild.id, 'honeypot');
  const ev = pushEvent(guild.id, {
    type: 'violation',
    severity: 'high',
    title: '🍯 Honeypot tetiklendi',
    detail: `${name || userId} tuzak ${kind} ile etkileşime girdi. Uygulanan: ${HONEYPOT_ACTIONS.find((a) => a.key === action)?.label || action}`,
    module: 'honeypot',
    actor: { id: userId, name: name || userId },
    channel: channelId,
    evidence: messageId ? `Mesaj: ${messageId}` : `Tuzak: ${kind}`,
    punishment: action
  });
  notify(guild, settings2, ev);
  enforce(guild, settings2, {
    offenderId: userId,
    action,
    hours,
    reason: `Honeypot tuzağı (${kind})`,
    module: 'honeypot'
  }).catch(() => {});
  return ev;
}

/* ================================================================== CEZA VERME */
function canActOn(guild, member) {
  if (!guild || !member) return false;
  if (member.id === guild.ownerId) return false;
  const me = guild.members?.me;
  if (!me) return false;
  try {
    const botTop = me.roles?.highest?.position ?? 0;
    const targetTop = member.roles?.highest?.position ?? 0;
    return targetTop < botTop;
  } catch {
    return false;
  }
}

function punishLabel(action) {
  return PUNISHMENTS.find((p) => p.key === action)?.label || action;
}

async function stripDangerousRoles(guild, member, reason) {
  const toRemove = [];
  try {
    for (const role of member.roles.cache.values()) {
      if (role.id === guild.id) continue;
      if (role.managed) continue;
      const perms = role.permissions;
      if (!perms) continue;
      if (DANGEROUS_PERMS.some((p) => perms.has?.(PermissionsBitField.Flags[p]))) toRemove.push(role);
    }
    if (toRemove.length) await member.roles.remove(toRemove, reason);
    return toRemove.length;
  } catch {
    return 0;
  }
}

function timeoutMsOf(cfg, { minutes = null, hours = null } = {}) {
  let value = null;
  if (hours != null) value = Number(hours) * 60;
  else if (minutes != null) value = Number(minutes);
  else value = Number(cfg.timeoutMinutes) || 10;
  if (!Number.isFinite(value) || value <= 0) value = 10;
  return Math.min(28 * 24 * 60 * 60 * 1000, Math.max(60 * 1000, Math.round(value * 60 * 1000)));
}

/**
 * Gerçek ceza uygulaması. Adım adım yetki kontrolü yapar; uygulanamıyorsa
 * nedeniyle birlikte olay akışına yazar. Demo modunda sahte nesneler yüzünden
 * sessizce başarısız olur (try/catch).
 */
async function enforce(guild, cfg, { offenderId, action = null, minutes = null, hours = null, reason = 'Guard', module = null, alert = true, evidence = null }) {
  if (!guild || !offenderId) return { ok: false, error: 'Eksik bilgi' };
  if (isWhitelisted(cfg, offenderId)) return { ok: false, error: 'Güvenli listede' };
  if (String(offenderId) === String(guild.ownerId)) return { ok: false, error: 'Sunucu sahibi' };
  const member = guild.members?.cache?.get(String(offenderId)) || null;
  const chosen = action || cfg.punishment || 'ban';
  const notes = [];
  let did = null;

  if (member && !canActOn(guild, member)) {
    return failEnforce(guild, cfg, { member, offenderId, chosen, module, reason, alert, evidence, why: 'Botun rolü bu üyenin altında (rol sırası)' });
  }

  try {
    if (chosen === 'ban') {
      const me = guild.members?.me;
      if (!me?.permissions?.has?.(PermissionsBitField.Flags.BanMembers)) {
        notes.push('botun "Üyeleri Yasakla" yetkisi yok');
      } else if (member && member.bannable === false) {
        notes.push('üye yasaklanabilir değil');
      } else {
        await guild.bans.create(String(offenderId), { reason: `LORES Guard · ${reason}` });
        did = 'ban';
        bumpStat(guild.id, 'bans');
      }
    } else if (chosen === 'kick') {
      const me = guild.members?.me;
      if (!me?.permissions?.has?.(PermissionsBitField.Flags.KickMembers)) {
        notes.push('botun "Üyeleri At" yetkisi yok');
      } else if (!member) {
        notes.push('üye sunucuda bulunamadı');
      } else if (member.kickable === false) {
        notes.push('üye atılabilir değil');
      } else {
        await member.kick(`LORES Guard · ${reason}`);
        did = 'kick';
        bumpStat(guild.id, 'kicks');
      }
    } else if (chosen === 'timeout') {
      if (!member) notes.push('üye sunucuda bulunamadı');
      else if (member.moderatable === false) notes.push('üye susturulabilir değil');
      else {
        const ms = timeoutMsOf(cfg, { minutes, hours });
        await member.timeout(ms, `LORES Guard · ${reason}`);
        did = 'timeout';
        bumpStat(guild.id, 'timeouts');
        notes.push(`${Math.round(ms / 60000)} dk timeout`);
      }
    } else if (chosen === 'roles') {
      if (!member) notes.push('üye sunucuda bulunamadı');
      else {
        const removed = await stripDangerousRoles(guild, member, `LORES Guard · ${reason}`);
        if (removed > 0) {
          did = 'roles';
          bumpStat(guild.id, 'stripped');
          notes.push(`${removed} yetkili rol alındı`);
        } else {
          notes.push('alınacak yetkili rol bulunamadı');
        }
      }
    }
  } catch (err) {
    notes.push(`hata: ${err.message}`);
  }

  const titles = { ban: 'yasaklandı', kick: 'atıldı', timeout: 'timeout verildi', roles: 'yetkili rolleri alındı' };
  const ev = pushEvent(guild.id, {
    type: did ? 'punishment' : 'punishment',
    severity: did ? 'high' : 'medium',
    title: did ? `🛡️ Müdahale: ${titles[did]}` : 'Ceza uygulanamadı',
    detail: notes.join(' · ') || 'İşlem yapılamadı.',
    module,
    actor: { id: String(offenderId), name: member?.user?.tag || String(offenderId) },
    punishment: chosen,
    evidence: evidence || null
  });
  if (alert) notify(guild, cfg, ev);
  if (did) bumpStat(guild.id, 'blocked');
  return { ok: Boolean(did), applied: did, event: ev };
}

function failEnforce(guild, cfg, { member, offenderId, chosen, module, reason, alert, evidence, why }) {
  const ev = pushEvent(guild.id, {
    type: 'punishment',
    severity: 'medium',
    title: 'Ceza uygulanamadı — yetki yetersiz',
    detail: `${member?.user?.tag || offenderId} için ${punishLabel(chosen)} denendi (${reason}). Neden: ${why}.`,
    module,
    actor: { id: String(offenderId), name: member?.user?.tag || String(offenderId) },
    punishment: chosen,
    evidence: evidence || null
  });
  if (alert) notify(guild, cfg, ev);
  return { ok: false, error: why, event: ev };
}

/* =============================================================== ÖZET / YEDEK */
function summary(guildId, guild = null) {
  const cfg = get(guildId);
  const list = events(guildId, 60);
  const activeModules = MODULES.filter((m) => cfg.modules[m.key]);
  return {
    enabled: cfg.enabled,
    simulation: false,
    punishment: cfg.punishment,
    punishmentLabel: punishLabel(cfg.punishment),
    timeoutMinutes: cfg.timeoutMinutes,
    windowSeconds: cfg.windowSeconds,
    logChannelId: cfg.logChannelId,
    logChannelName: cfg.logChannelId ? (guild?.channels?.cache?.get(cfg.logChannelId)?.name || null) : null,
    jailRoleId: cfg.jailRoleId,
    jailRoleName: cfg.jailRoleId ? (guild?.roles?.cache?.get(cfg.jailRoleId)?.name || null) : null,
    whitelistCount: cfg.whitelist.length,
    modulesTotal: MODULES.length,
    modulesActive: activeModules.length,
    modules: activeModules.map((m) => m.label),
    enabledAt: cfg.enabledAt,
    eventCount: list.length,
    lastEvent: list[0] || null,
    violations24h: list.filter((e) => (e.type === 'violation' || e.type === 'punishment') && Date.now() - e.at < 86400000).length,
    honeypot: {
      enabled: Boolean(cfg.honeypot?.enabled),
      channelId: cfg.honeypot?.channelId || null,
      roleId: cfg.honeypot?.roleId || null,
      hits: cfg.honeypot?.hits || 0,
      lastAt: cfg.honeypot?.lastAt || null,
      action: cfg.honeypot?.action || 'timeout',
      channelName: cfg.honeypot?.channelId ? (guild?.channels?.cache?.get(cfg.honeypot.channelId)?.name || null) : null
    },
    stats: cfg.stats,
    ad: { action: cfg.ad.action, allowInvites: cfg.ad.allowInvites, trusted: (cfg.ad.trustedDomains || []).length, detected: cfg.ad.detected || 0 },
    backup: cfg.backup ? { at: cfg.backup.at, roles: cfg.backup.roles.length, channels: cfg.backup.channels.length } : null
  };
}

/** Rol + kanal listesinin anlık görüntüsü (gerçek veri, geri yükleme yapmaz). */
function takeBackup(guild) {
  const roles = [...guild.roles.cache.values()]
    .filter((r) => !r.managed && r.id !== guild.id)
    .slice(0, 200)
    .map((r) => ({ id: r.id, name: r.name, color: String(r.color || 0), position: r.position, hoist: Boolean(r.hoist), mentionable: Boolean(r.mentionable), permissions: String(r.permissions?.bitfield ?? '0') }));
  const channels = [...guild.channels.cache.values()]
    .slice(0, 300)
    .map((c) => ({ id: c.id, name: c.name, type: c.type, parentId: c.parentId || null, position: c.position, topic: c.topic || null, nsfw: Boolean(c.nsfw) }));
  const backup = { at: Date.now(), takenBy: null, roles, channels };
  update(guild.id, { backup });
  pushEvent(guild.id, {
    type: 'action',
    severity: 'low',
    title: 'Yedek alındı',
    detail: `${roles.length} rol, ${channels.length} kanal kaydedildi.`,
    module: null
  });
  return { ok: true, roles: roles.length, channels: channels.length, at: backup.at };
}

/**
 * Yedekten geri yükleme: eksik roller ve kanallar yeniden kurulur.
 * var olanlar (isim eşleşmesi) korunur. Kategori eşleşmesi isimle yapılır.
 */
async function restoreBackup(guild, { limiter = 80, reason = 'Guard yedeği' } = {}) {
  const cfg = get(guild.id);
  const backup = cfg.backup;
  if (!backup) return { ok: false, error: 'Yedek bulunamadı. Önce /guard yedek çalıştır.' };
  if (!guild.members?.me?.permissions?.has?.(PermissionsBitField.Flags.ManageChannels)) {
    return { ok: false, error: 'Botun "Kanalları Yönet" yetkisi yok.' };
  }
  const created = { roles: 0, channels: 0 };
  const failed = [];

  // 1) Roller
  const existingRoles = new Set([...guild.roles.cache.values()].map((r) => r.name));
  for (const role of backup.roles.slice(0, limiter)) {
    if (existingRoles.has(role.name)) continue;
    try {
      await guild.roles.create({
        name: role.name,
        color: Number(role.color) || 0,
        hoist: Boolean(role.hoist),
        mentionable: Boolean(role.mentionable),
        permissions: role.permissions ? BigInt(role.permissions) : undefined,
        reason
      });
      created.roles += 1;
    } catch (err) {
      failed.push(`rol:${role.name} — ${err.message}`);
    }
  }

  // 2) Kanallar (önce kategoriler)
  const allChannels = [...guild.channels.cache.values()];
  const existingChannels = new Set(allChannels.map((c) => `${c.name}|${c.type}`));
  const categoryMap = new Map();
  for (const ch of allChannels.filter((c) => c.type === ChannelType.GuildCategory)) categoryMap.set(ch.name, ch.id);

  const ordered = [...backup.channels].sort((a, b) => (a.type === ChannelType.GuildCategory ? -1 : 0) - (b.type === ChannelType.GuildCategory ? -1 : 0));
  for (const channel of ordered.slice(0, limiter)) {
    if (channel.type === ChannelType.GuildCategory && categoryMap.has(channel.name)) continue;
    if (existingChannels.has(`${channel.name}|${channel.type}`)) continue;
    try {
      const parent = channel.parentId
        ? backup.channels.find((c) => c.id === channel.parentId)
        : null;
      const parentId = parent ? categoryMap.get(parent.name) : undefined;
      const newChannel = await guild.channels.create({
        name: channel.name,
        type: channel.type ?? 0,
        parent: parentId,
        topic: channel.topic || undefined,
        nsfw: Boolean(channel.nsfw),
        reason
      });
      if (channel.type === ChannelType.GuildCategory) categoryMap.set(channel.name, newChannel.id);
      created.channels += 1;
    } catch (err) {
      failed.push(`kanal:${channel.name} — ${err.message}`);
    }
  }

  update(guild.id, { stats: { ...cfg.stats, restored: (cfg.stats.restored || 0) + created.roles + created.channels } });
  const ev = pushEvent(guild.id, {
    type: 'action',
    severity: created.roles + created.channels ? 'medium' : 'low',
    title: 'Yedekten geri yükleme',
    detail: `${created.roles} rol, ${created.channels} kanal yeniden oluşturuldu${failed.length ? ` · ${failed.length} hata` : ''}.`,
    module: 'antiNuke'
  });
  if (created.roles + created.channels) bumpStat(guild.id, 'restored', created.roles + created.channels);
  void ev;
  return { ok: true, ...created, failed };
}

/** Örnek bir ihlal kaydı üretir (gerçek işlem yapmaz). */
function runTest(guild, actorName = null) {
  const cfg = get(guild.id);
  const ev = pushEvent(guild.id, {
    type: 'violation',
    severity: 'high',
    title: 'Guard testi — örnek ihlal',
    detail: `${actorName ? `${actorName} tetikledi · ` : ''}örnek sayaç 3 işlem / sınır 2 · gerçek bir işlem yapılmadı`,
    module: 'antiNuke',
    action: 'channelDelete',
    actor: actorName ? { id: null, name: actorName } : null,
    count: 3,
    limit: 2
  });
  notify(guild, cfg, ev);
  return ev;
}

/* ============================================================ OPERATÖR KATMANI
   Bu bölüm YALNIZCA panelde (sitede) görünür ve düzenlenir; Discord tarafına
   sızmaz. Kurallar:

   1) Guard yalnızca operatörün whitelist'e aldığı sunucularda ÇALIŞIR.
   2) Bota eklenen her yeni sunucu otomatik olarak pasif (onay bekliyor) başlar.
   3) Operatörün blacklist'e aldığı (sessize aldığı) sunucularda izleme hiç
      çalışmaz; buna rağmen komutlar ve durum çıktısı değişmez.
   4) Sessiz modda hiçbir otomatik işlem yapılmaz ve HİÇBİR webhook oluşturulmaz.
   ============================================================================ */
const DEFAULT_POLICY = {
  autoBlockNewGuilds: true,
  allowed: [],
  blocked: [],
  notes: {},
  roster: {},
  updatedAt: null
};

const MAX_OPS = 200;

function policy() {
  const raw = db.guardPolicy && typeof db.guardPolicy === 'object' ? db.guardPolicy : {};
  return {
    autoBlockNewGuilds: raw.autoBlockNewGuilds !== false,
    allowed: Array.isArray(raw.allowed) ? raw.allowed.map(String) : [],
    blocked: Array.isArray(raw.blocked) ? raw.blocked.map(String) : [],
    notes: raw.notes && typeof raw.notes === 'object' ? raw.notes : {},
    roster: raw.roster && typeof raw.roster === 'object' ? raw.roster : {},
    updatedAt: raw.updatedAt || null
  };
}

function savePolicy(patch) {
  const next = { ...policy(), ...(patch || {}) };
  next.allowed = [...new Set((next.allowed || []).map(String))];
  next.blocked = [...new Set((next.blocked || []).map(String))];
  next.notes = next.notes && typeof next.notes === 'object' ? next.notes : {};
  next.roster = next.roster && typeof next.roster === 'object' ? next.roster : {};
  next.updatedAt = Date.now();
  db.guardPolicy = next;
  save();
  return next;
}

function isAllowed(guildId) {
  return policy().allowed.includes(String(guildId));
}

function isBlocked(guildId) {
  return policy().blocked.includes(String(guildId));
}

/** Koruma bu sunucuda GERÇEKTEN çalışıyor mu? (Discord'a asla gösterilmez) */
function isOperational(guildId) {
  const cfg = get(guildId);
  if (cfg.silent) return false;
  if (isBlocked(guildId)) return false;
  if (!isAllowed(guildId)) return false;
  return Boolean(cfg.enabled);
}

function guildStatus(guildId) {
  const id = String(guildId);
  const cfg = get(id);
  const p = policy();
  if (p.blocked.includes(id)) return 'silent';
  if (cfg.silent && !p.allowed.includes(id)) return 'pending';
  if (cfg.silent) return 'silent';
  if (!p.allowed.includes(id)) return 'pending';
  return cfg.enabled ? 'active' : 'idle';
}

/* ------------------------------------------------------------- OPERATÖR KAYDI */
function pushOps(entry) {
  if (!Array.isArray(db.guardOps)) db.guardOps = [];
  const record = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    guildId: String(entry.guildId || ''),
    guildName: entry.guildName || null,
    action: entry.action || 'note',
    detail: entry.detail || '',
    actor: entry.actor || 'panel'
  };
  db.guardOps.unshift(record);
  db.guardOps = db.guardOps.slice(0, MAX_OPS);
  save();
  return record;
}

function ops(limit = 60) {
  return (Array.isArray(db.guardOps) ? db.guardOps : []).slice(0, limit);
}

function clearOps() {
  db.guardOps = [];
  save();
  return { ok: true };
}

function setNote(guildId, text, actor = 'panel') {
  const id = String(guildId);
  const p = policy();
  const notes = { ...p.notes };
  const clean = String(text || '').trim().slice(0, 300);
  if (clean) notes[id] = { text: clean, at: Date.now() };
  else delete notes[id];
  savePolicy({ notes });
  pushOps({ guildId: id, guildName: p.roster[id]?.name || null, action: 'note', detail: clean || 'Not silindi', actor });
  return { ok: true, note: notes[id] || null };
}

/* --------------------------------------------------------- WHITELIST/BLACKLIST */
function setSilent(guildId, silent, options = {}) {
  const id = String(guildId);
  const reason = options.reason ? String(options.reason).slice(0, 200) : null;
  const actor = options.actor || 'panel';
  const p = policy();
  if (silent) {
    savePolicy({ blocked: [...p.blocked, id] });
    update(id, { silent: true, silentAt: Date.now(), silentReason: reason || 'Operatör tarafından sessize alındı' });
  } else {
    savePolicy({ blocked: p.blocked.filter((x) => x !== id) });
    update(id, { silent: false, silentAt: null, silentReason: null });
  }
  pushOps({
    guildId: id,
    guildName: p.roster[id]?.name || null,
    action: silent ? 'silent-on' : 'silent-off',
    detail: silent ? (reason || 'Koruma sessize alındı — sunucuya normal görünüyor') : 'Sessiz mod kaldırıldı (whitelist onayı ayrıca gerekir)',
    actor
  });
  return { ok: true, status: guildStatus(id), admin: adminSummary(id) };
}

function approveGuild(guildId, options = {}) {
  const id = String(guildId);
  const actor = options.actor || 'panel';
  const note = options.note ? String(options.note).slice(0, 300) : null;
  const p = policy();
  const patch = { allowed: [...p.allowed, id], blocked: p.blocked.filter((x) => x !== id) };
  if (note) patch.notes = { ...p.notes, [id]: { text: note, at: Date.now() } };
  savePolicy(patch);
  update(id, { silent: false, silentAt: null, silentReason: null, approvedAt: Date.now(), approvedBy: actor });
  if (!get(id).enabled) setEnabled(id, true, actor);
  pushOps({ guildId: id, guildName: p.roster[id]?.name || null, action: 'approve', detail: note || 'Whitelist’e alındı — koruma çalışıyor', actor });
  return { ok: true, status: guildStatus(id), admin: adminSummary(id) };
}

function revokeGuild(guildId, options = {}) {
  const id = String(guildId);
  const actor = options.actor || 'panel';
  const reason = options.reason ? String(options.reason).slice(0, 200) : 'Operatör tarafından pasife alındı';
  const p = policy();
  savePolicy({ allowed: p.allowed.filter((x) => x !== id), blocked: [...p.blocked, id] });
  update(id, { silent: true, silentAt: Date.now(), silentReason: reason });
  pushOps({ guildId: id, guildName: p.roster[id]?.name || null, action: 'revoke', detail: reason, actor });
  return { ok: true, status: guildStatus(id), admin: adminSummary(id) };
}

function setAutoBlock(enabled, actor = 'panel') {
  const p = savePolicy({ autoBlockNewGuilds: Boolean(enabled) });
  pushOps({ guildId: '', action: 'policy', detail: `Yeni sunucuları otomatik pasifleştirme ${p.autoBlockNewGuilds ? 'açıldı' : 'kapatıldı'}`, actor });
  return { ok: true, policy: p };
}

/* ------------------------------------------------------------------ SENKRON */
function syncGuild(guild) {
  if (!guild || !guild.id) return null;
  const id = String(guild.id);
  const cfg = get(id);
  const p = policy();
  const name = guild.name || p.roster[id]?.name || id;
  const memberCount = typeof guild.memberCount === 'number' ? guild.memberCount : (p.roster[id]?.memberCount ?? null);
  const isNew = !cfg.addedAt;
  const patch = {};
  if (isNew) patch.addedAt = Date.now();
  if (!cfg.installedAt) patch.installedAt = Date.now();
  const willBlock = p.autoBlockNewGuilds && !p.allowed.includes(id) && !p.blocked.includes(id);
  if (isNew && willBlock) {
    patch.silent = true;
    patch.silentAt = Date.now();
    patch.silentReason = 'Yeni sunucu: operatör onayı bekleniyor';
  }
  if (Object.keys(patch).length) update(id, patch);
  savePolicy({ roster: { ...p.roster, [id]: { name, memberCount, addedAt: cfg.addedAt || Date.now(), lastSeen: Date.now() } } });
  if (isNew) {
    pushOps({
      guildId: id,
      guildName: name,
      action: willBlock ? 'auto-pending' : 'joined',
      detail: willBlock ? 'Yeni sunucu eklendi — koruma otomatik pasif başladı (whitelist onayı bekliyor)' : 'Yeni sunucu eklendi — zaten whitelist içinde',
      actor: 'bot'
    });
  }
  return { id, name, status: guildStatus(id), isNew, operational: isOperational(id) };
}

function syncAll(client) {
  const guilds = client?.guilds?.cache ? [...client.guilds.cache.values()] : [];
  return guilds.map((g) => syncGuild(g)).filter(Boolean);
}

/* ------------------------------------------------------------------- LİSTELE */
function adminSummary(guildId, guild = null) {
  const id = String(guildId);
  const cfg = get(id);
  const p = policy();
  const list = events(id, 60);
  return {
    ...summary(id, guild),
    status: guildStatus(id),
    operational: isOperational(id),
    silent: Boolean(cfg.silent),
    silentAt: cfg.silentAt || null,
    silentReason: cfg.silentReason || null,
    allowed: p.allowed.includes(id),
    blocked: p.blocked.includes(id),
    note: p.notes[id]?.text || null,
    noteAt: p.notes[id]?.at || null,
    addedAt: cfg.addedAt || p.roster[id]?.addedAt || null,
    approvedAt: cfg.approvedAt || null,
    approvedBy: cfg.approvedBy || null,
    installedAt: cfg.installedAt || null,
    eventCount: list.length,
    violations24h: list.filter((e) => (e.type === 'violation' || e.type === 'punishment') && Date.now() - e.at < 86400000).length,
    stats: cfg.stats,
    honeypot: { ...cfg.honeypot, channelName: cfg.honeypot?.channelId ? (guild?.channels?.cache?.get(cfg.honeypot.channelId)?.name || null) : null },
    ad: cfg.ad,
    safety: cfg.safety
  };
}

function guildStates(client) {
  const p = policy();
  const map = new Map();
  const ensure = (id) => {
    if (!map.has(id)) {
      const known = p.roster[id] || {};
      map.set(id, {
        id,
        name: known.name || get(id).guildName || id,
        memberCount: known.memberCount ?? null,
        online: false,
        icon: null
      });
    }
    return map.get(id);
  };
  Object.keys(p.roster || {}).forEach(ensure);
  Object.keys(db.guard || {}).forEach(ensure);

  const live = client?.guilds?.cache ? [...client.guilds.cache.values()] : [];
  for (const g of live) {
    const id = String(g.id);
    const row = ensure(id);
    row.name = g.name || row.name;
    row.memberCount = typeof g.memberCount === 'number' ? g.memberCount : row.memberCount;
    row.online = true;
    row.icon = typeof g.iconURL === 'function' ? (g.iconURL({ size: 64 }) || null) : null;
  }

  const rows = [...map.values()].map((row) => {
    const adm = adminSummary(row.id);
    return {
      ...row,
      status: adm.status,
      statusLabel: STATUS_LABEL[adm.status] || adm.status,
      operational: adm.operational,
      enabled: Boolean(adm.enabled),
      silent: Boolean(adm.silent),
      silentReason: adm.silentReason,
      allowed: adm.allowed,
      blocked: adm.blocked,
      note: adm.note,
      addedAt: adm.addedAt,
      approvedAt: adm.approvedAt,
      approvedBy: adm.approvedBy,
      modulesActive: adm.modulesActive,
      modulesTotal: adm.modulesTotal,
      punishmentLabel: adm.punishmentLabel,
      windowSeconds: adm.windowSeconds,
      logChannelName: adm.logChannelName,
      whitelistCount: adm.whitelistCount,
      eventCount: adm.eventCount,
      violations24h: adm.violations24h,
      stats: adm.stats,
      honeypot: adm.honeypot,
      lastEvent: adm.lastEvent ? { title: adm.lastEvent.title, at: adm.lastEvent.at, severity: adm.lastEvent.severity } : null,
      backup: adm.backup
    };
  });
  const order = { pending: 0, silent: 1, active: 2, idle: 3 };
  rows.sort((a, b) => (order[a.status] - order[b.status]) || String(a.name).localeCompare(String(b.name), 'tr'));
  return rows;
}

const STATUS_LABEL = {
  active: 'Koruma çalışıyor',
  idle: 'Sunucu kapatmış',
  silent: 'Sessizde (blacklist)',
  pending: 'Onay bekliyor'
};

function policyStats(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const p = policy();
  return {
    total: list.length,
    active: list.filter((r) => r.status === 'active').length,
    idle: list.filter((r) => r.status === 'idle').length,
    silent: list.filter((r) => r.status === 'silent').length,
    pending: list.filter((r) => r.status === 'pending').length,
    allowed: p.allowed.length,
    blocked: p.blocked.length,
    autoBlockNewGuilds: p.autoBlockNewGuilds,
    opsCount: Array.isArray(db.guardOps) ? db.guardOps.length : 0,
    updatedAt: p.updatedAt,
    totalBlocked: list.reduce((sum, r) => sum + (r.stats?.blocked || 0), 0),
    totalHoneypot: list.reduce((sum, r) => sum + (r.stats?.honeypot || 0), 0)
  };
}

/* ------------------------------------------------------------------ BİLDİRİM */
function guardEmbed(cfg, ev) {
  const color = ev.severity === 'high' ? COLOR.err : ev.severity === 'medium' ? COLOR.warn : COLOR.main;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: 'LORES Guard · gerçek zamanlı koruma' })
    .setTitle(ev.title)
    .setDescription(ev.detail || null)
    .setTimestamp();
  if (ev.actor?.name) embed.addFields({ name: 'Sorumlu', value: `${ev.actor.name}${ev.actor.id ? `\n\`${ev.actor.id}\`` : ''}`, inline: true });
  if (ev.module && MODULE_BY_KEY[ev.module]) embed.addFields({ name: 'Modül', value: MODULE_BY_KEY[ev.module].label, inline: true });
  if (ev.punishment) embed.addFields({ name: 'Ceza', value: ev.punishment, inline: true });
  if (ev.count != null && ev.limit != null) embed.addFields({ name: 'Sayaç', value: `${ev.count} işlem / ${cfg.windowSeconds} sn\nSınır: ${ev.limit}`, inline: true });
  if (ev.evidence) embed.addFields({ name: 'Kanıt', value: String(ev.evidence).slice(0, 300) });
  if (ev.channel) embed.addFields({ name: 'Kanal', value: `<#${ev.channel}>`, inline: true });
  embed.setFooter({ text: 'LORES Guard · otomatik müdahale aktif' });
  return embed;
}

async function notify(guild, cfg, ev) {
  try {
    settings.log(guild.id, 'guard', `${ev.title}${ev.actor?.name ? ` — ${ev.actor.name}` : ''}${ev.detail ? ` (${ev.detail})` : ''}`);
  } catch { /* yoksay */ }
  if (!cfg?.logChannelId || !guild?.channels?.cache) return;
  const channel = guild.channels.cache.get(cfg.logChannelId);
  if (!channel || typeof channel.send !== 'function') return;
  try {
    await channel.send({ embeds: [guardEmbed(cfg, ev)] });
  } catch { /* kanal silinmiş/yetki yok */ }
}

async function recordViolation(guild, { action, actor, detail, count, limit, severity = 'medium', target = null, label = null, module = null, evidence = null }) {
  const cfg = get(guild.id);
  const meta = ACTION_BY_KEY[action];
  const ev = pushEvent(guild.id, {
    type: 'violation',
    severity,
    title: `${label || (meta ? meta.label : 'Guard')} sınırı aşıldı`,
    detail: [detail, target].filter(Boolean).join(' · '),
    module: module || (meta ? meta.module : null),
    action: action || null,
    actor: actor ? { id: actor.id || null, name: actor.name || actor.tag || String(actor.id || 'bilinmiyor') } : null,
    count,
    limit,
    evidence
  });
  notify(guild, cfg, ev);
  return ev;
}

async function recordInfo(guild, { title, detail, severity = 'low', module = null, actor = null, evidence = null }) {
  const cfg = get(guild.id);
  const ev = pushEvent(guild.id, { type: 'info', severity, title, detail, module, actor: actor ? { id: actor.id || null, name: actor.name || actor.tag } : null, evidence });
  if (cfg.logChannelId) notify(guild, cfg, ev);
  return ev;
}

/* ================================================================== İZLEME */
const AUDIT_MAP = new Map([
  [AuditLogEvent.ChannelDelete, 'channelDelete'],
  [AuditLogEvent.ChannelCreate, 'channelCreate'],
  [AuditLogEvent.ChannelUpdate, 'channelRename'],
  [AuditLogEvent.RoleDelete, 'roleDelete'],
  [AuditLogEvent.RoleCreate, 'roleCreate'],
  [AuditLogEvent.RoleUpdate, 'roleUpdate'],
  [AuditLogEvent.WebhookCreate, 'webhook'],
  [AuditLogEvent.WebhookDelete, 'webhookDelete'],
  [AuditLogEvent.BotAdd, 'botAdd'],
  [AuditLogEvent.MemberBanAdd, 'ban'],
  [AuditLogEvent.MemberKick, 'kick'],
  [AuditLogEvent.MemberPrune, 'memberPrune'],
  [AuditLogEvent.EmojiDelete, 'emojiDelete'],
  [AuditLogEvent.IntegrationCreate, 'integration'],
  [AuditLogEvent.IntegrationDelete, 'integration'],
  [AuditLogEvent.InviteCreate, 'inviteCreate']
]);

function guardActive(guild) {
  if (!guild || !guild.id) return false;
  if (!isOperational(guild.id)) return false;
  return get(guild.id);
}

/**
 * İşlemi yapan botun kendisi mi? Panelin toplu işlemleri botun tokeniyle
 * yapılır; denetim kaydında bot görünür ve guard bunları tehlike SAYMAZ.
 */
function isSelfActor(guild, actorId) {
  if (!actorId) return false;
  const id = String(actorId);
  const client = guild?.client;
  const own = [client?.user?.id, client?.application?.id].filter(Boolean).map(String);
  return own.includes(id);
}

function isSelfMessage(message) {
  if (!message) return true;
  if (message.webhookId) return true;
  if (message.author?.bot) return true;
  return isSelfActor(message.guild, message.author?.id);
}

/** Guard kanalı silinmişse sessizce yeniden oluşturur (yalnızca operasyonelken). */
async function ensureLogChannel(guild, cfg, { force = false } = {}) {
  if (!cfg.logChannelId) return null;
  const existing = guild.channels?.cache?.get(cfg.logChannelId);
  if (existing && !force) return existing;
  if (Date.now() - (logFixAt.get(guild.id) || 0) < 60000) return null;
  logFixAt.set(guild.id, Date.now());
  try {
    if (!guild.members?.me?.permissions?.has?.(PermissionsBitField.Flags.ManageChannels)) return null;
    const created = await guild.channels.create({
      name: 'guard-log',
      type: ChannelType.GuildText,
      topic: 'LORES Guard kayıt kanalı (otomatik onarıldı)',
      reason: 'Guard: kayıt kanalı silinmişti, yeniden oluşturuldu'
    });
    update(guild.id, { logChannelId: created.id });
    pushEvent(guild.id, {
      type: 'action',
      severity: 'medium',
      title: 'Guard kanalı onarıldı',
      detail: 'Kayıt kanalı silinmişti; #guard-log yeniden oluşturuldu.',
      module: 'channelGuard'
    });
    return created;
  } catch {
    return null;
  }
}

/** Bir webhook setinden son N saniyede oluşturulanları siler. */
async function purgeRecentWebhooks(guild, executorId = null) {
  try {
    if (!guild.members?.me?.permissions?.has?.(PermissionsBitField.Flags.ManageWebhooks)) return 0;
    const hooks = await guild.fetchWebhooks();
    let removed = 0;
    const now = Date.now();
    for (const hook of hooks.values()) {
      const owner = hook.owner?.id || null;
      const fresh = hook.createdTimestamp && now - hook.createdTimestamp < 5 * 60 * 1000;
      if (!fresh) continue;
      if (executorId && owner && String(owner) !== String(executorId)) continue;
      try {
        await hook.delete('LORES Guard · yetkisiz webhook temizliği');
        removed += 1;
      } catch { /* yoksay */ }
    }
    return removed;
  } catch {
    return 0;
  }
}

/** Yakın zamanda eklenen botları atar. */
async function purgeRecentBot(guild, botId) {
  try {
    const member = guild.members?.cache?.get(String(botId)) || await guild.members?.fetch?.(String(botId)).catch(() => null);
    if (member?.kick) {
      await member.kick('LORES Guard · güvenli listede olmayan bot');
      return true;
    }
  } catch { /* yoksay */ }
  return false;
}

/* ------------------------------------------------------- ROL / KANAL YETKİ ANALİZİ */
function hasDangerousPermission(permissions, keys = DANGEROUS_PERMS) {
  try {
    return keys.some((p) => permissions?.has?.(PermissionsBitField.Flags[p]));
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------- DENETİM OLAYI */
async function onAuditEntry(entry, guild) {
  const cfg = guardActive(guild);
  if (!cfg) return;
  if (!entry || !entry.actionType) return;

  const executorId = entry.executorId || entry.executor?.id || null;
  if (!executorId || isSelfActor(guild, executorId)) return;
  if (isWhitelisted(cfg, executorId)) return;

  const action = AUDIT_MAP.get(entry.actionType);
  if (!action) return;
  const meta = ACTION_BY_KEY[action];
  if (meta && cfg.modules[meta.module] === false) return;

  const executorName = entry.executor?.tag || entry.executor?.username || executorId;
  const isDestructive = ['channelDelete', 'roleDelete', 'ban', 'kick', 'webhookDelete', 'memberPrune'].includes(action);

  // Özel durumlar ------------------------------------------------------------
  if (action === 'channelDelete') {
    const targetId = entry.targetId;
    if (cfg.logChannelId && targetId === cfg.logChannelId) {
      const ev = pushEvent(guild.id, {
        type: 'violation', severity: 'high', title: 'Guard kanalı silindi',
        detail: `${executorName} guard kayıt kanalını sildi — kanal otomatik onarılacak.`,
        module: 'channelGuard', action, actor: { id: executorId, name: executorName }, punishment: cfg.punishment
      });
      notify(guild, cfg, ev);
      await ensureLogChannel(guild, get(guild.id), { force: true });
      enforce(guild, cfg, { offenderId: executorId, reason: 'Guard kanalını sildi', module: 'channelGuard', evidence: 'Guard kanalı silme' }).catch(() => {});
      return;
    }
    if (cfg.honeypot?.channelId && targetId === cfg.honeypot.channelId) {
      const ev = pushEvent(guild.id, {
        type: 'violation', severity: 'high', title: '🍯 Honeypot kanalı silindi',
        detail: `${executorName} tuzak kanalı sildi. Kanal yeniden kuruluyor ve ceza uygulanıyor.`,
        module: 'honeypot', action, actor: { id: executorId, name: executorName }, punishment: cfg.punishment
      });
      notify(guild, cfg, ev);
      update(guild.id, { honeypot: { ...get(guild.id).honeypot, channelId: null, messageId: null, hits: (get(guild.id).honeypot.hits || 0) + 1, lastAt: Date.now() } });
      enforce(guild, cfg, { offenderId: executorId, reason: 'Honeypot kanalını sildi', module: 'honeypot', evidence: 'Tuzak kanalı silme' }).catch(() => {});
      bumpStat(guild.id, 'honeypot');
      createHoneypotChannel(guild, { silent: true }).catch(() => {});
      return;
    }
  }

  if (action === 'botAdd') {
    const botId = entry.targetId;
    const botUser = entry.target;
    if (cfg.modules.botGuard !== false) {
      const ev = pushEvent(guild.id, {
        type: 'violation', severity: 'high', title: 'Güvenli listede olmayan bot eklendi',
        detail: `${executorName} tarafından ${botUser?.tag || botId} eklendi.`,
        module: 'botGuard', action, actor: { id: executorId, name: executorName }, target: botUser?.tag || botId,
        punishment: cfg.botAction
      });
      notify(guild, cfg, ev);
      if (cfg.botAction === 'kick' || cfg.botAction === 'ban-inviter') {
        await purgeRecentBot(guild, botId);
      }
      if (cfg.botAction === 'ban-inviter') {
        await enforce(guild, cfg, { offenderId: executorId, action: 'ban', reason: 'Güvenli listede olmayan bot ekledi', module: 'botGuard', evidence: botUser?.tag || botId });
      }
      bumpStat(guild.id, 'blocked');
      return;
    }
  }

  if (action === 'webhook') {
    const ev = pushEvent(guild.id, {
      type: 'violation', severity: 'medium', title: 'Yetkisiz webhook oluşturuldu',
      detail: `${executorName} webhook oluşturdu — temizleniyor.`,
      module: 'webhookGuard', action, actor: { id: executorId, name: executorName }, target: entry.target?.name || null
    });
    notify(guild, cfg, ev);
    const removed = await purgeRecentWebhooks(guild, executorId);
    if (removed) bumpStat(guild.id, 'blocked');
    // limit kontrolü de çalışsın
  }

  if (action === 'integration' && cfg.safety?.watchIntegrations !== false) {
    const ev = pushEvent(guild.id, {
      type: 'violation', severity: 'high', title: 'Entegrasyon değişikliği',
      detail: `${executorName} entegrasyon ${entry.actionType === AuditLogEvent.IntegrationDelete ? 'sildi' : 'ekledi'} (${entry.target?.name || entry.targetId || '?'}).`,
      module: 'antiNuke', action, actor: { id: executorId, name: executorName }
    });
    notify(guild, cfg, ev);
  }

  if (action === 'inviteCreate') {
    if (!cfg.ad.allowInvites) {
      const ev = pushEvent(guild.id, {
        type: 'violation', severity: 'medium', title: 'Davet oluşturuldu (izleniyor)',
        detail: `${executorName} yeni davet üretti${entry.target?.code ? `: discord.gg/${entry.target.code}` : ''}.`,
        module: 'adGuard', action, actor: { id: executorId, name: executorName }
      });
      notify(guild, cfg, ev);
    }
  }

  if (action === 'roleUpdate') {
    const changes = Array.isArray(entry.changes) ? entry.changes.map((c) => c.key) : [];
    const permsChanged = changes.includes('permissions') || changes.includes('$add') || changes.includes('$remove');
    const targetRole = entry.target;
    if (targetRole && hasDangerousPermission(targetRole.permissions) && (permsChanged || changes.includes('position'))) {
      const ev = pushEvent(guild.id, {
        type: 'violation', severity: 'high', title: 'Tehlikeli rol yetkisi değişti',
        detail: `${executorName} "${targetRole.name}" rolünün yetkilerini/pozisyonunu değiştirdi.`,
        module: 'roleGuard', action, actor: { id: executorId, name: executorName }, target: targetRole.name
      });
      notify(guild, cfg, ev);
      if (cfg.punishment) {
        enforce(guild, cfg, { offenderId: executorId, reason: 'Tehlikeli rol yetkisi değiştirdi', module: 'roleGuard', evidence: `Rol: ${targetRole.name}` }).catch(() => {});
      }
      return;
    }
  }

  // Sayım + eşik ---------------------------------------------------------------
  const memberCount = guild.memberCount || (guild.members?.cache?.size ?? null);
  const res = registerAction(guild.id, { actorId: executorId, action, memberCount });
  const targetName = entry.target?.name || entry.target?.username || entry.target?.tag || null;
  const extraDetail = targetName ? `Hedef: ${targetName}` : null;

  let destructiveVerdict = null;
  if (isDestructive) destructiveVerdict = registerDestructive(guild.id, { actorId: executorId });

  const massViolation = destructiveVerdict && destructiveVerdict.count >= destructiveVerdict.limit;
  const violated = res.violated || massViolation;

  if (violated) {
    if (!shouldNotify(guild.id, executorId, `audit:${action}`, 15000)) return;
    const limitLabel = res.violated
      ? (res.reason === 'oran' ? `${res.count} işlem · oran sınırı ~${res.ratioLimit} (${res.totalMembers} üye)` : `${res.count} işlem / ${cfg.windowSeconds} sn · sınır ${res.limit}`)
      : `${destructiveVerdict.count} yıkıcı işlem / ${cfg.windowSeconds} sn · toplu yıkım sınırı ${destructiveVerdict.limit}`;
    const ev = pushEvent(guild.id, {
      type: 'violation',
      severity: massViolation || res.count >= res.limit * 2 ? 'high' : 'medium',
      title: massViolation ? 'Toplu yıkım girişimi (anti-nuke)' : `${meta ? meta.label : action} sınırı aşıldı`,
      detail: `${executorName} · ${limitLabel}${extraDetail ? ` · ${extraDetail}` : ''}`,
      module: meta ? meta.module : 'antiNuke',
      action,
      actor: { id: executorId, name: executorName },
      count: res.count,
      limit: res.limit,
      evidence: extraDetail
    });
    notify(guild, cfg, ev);
    const result = await enforce(guild, cfg, {
      offenderId: executorId,
      reason: massViolation ? 'Toplu yıkım girişimi' : `${meta ? meta.label : action} sınırı aşıldı`,
      module: meta ? meta.module : 'antiNuke',
      evidence: extraDetail || limitLabel
    });
    // Nuke sonrası otomatik yedekten onarım (yalnızca channel/role silmede).
    if ((action === 'channelDelete' || action === 'roleDelete') && cfg.safety?.autoRestore && cfg.backup) {
      const recentKey = `restore:${guild.id}`;
      const stamps = prune(restoreStamps.get(recentKey), Date.now(), 10 * 60 * 1000);
      restoreStamps.set(recentKey, stamps);
      if (stamps.length < Math.max(1, Number(cfg.safety.restoreMaxPerWindow) || 6)) {
        stamps.push(Date.now());
        const restored = await restoreBackup(guild, { limiter: 40, reason: 'Guard · nuke sonrası otomatik onarım' });
        if (restored.ok) {
          if (restored.roles + restored.channels > 0) {
            const ev2 = pushEvent(guild.id, {
              type: 'action', severity: 'medium', title: 'Yedekten otomatik onarım',
              detail: `${restored.roles} rol, ${restored.channels} kanal geri kuruldu.`,
              module: 'antiNuke', restored: { roles: restored.roles, channels: restored.channels }
            });
            notify(guild, get(guild.id), ev2);
          }
        }
      }
    }
    void result;
    return;
  }

  // Sınır aşılmayan işlemler: yalnızca kritik olanlarda bilgi kaydı.
  if (['webhookDelete', 'integration', 'inviteCreate', 'botAdd', 'emojiDelete'].includes(action)) {
    if (!shouldNotify(guild.id, executorId, `info:${action}`, 120000)) return;
    pushEvent(guild.id, {
      type: 'info',
      severity: 'low',
      title: `${meta ? meta.label : action} kaydedildi`,
      detail: [executorName, targetName].filter(Boolean).join(' · '),
      module: meta ? meta.module : null,
      action,
      actor: { id: executorId, name: executorName },
      count: res.count,
      limit: res.limit
    });
  }
}

const restoreStamps = new Map();

/* --------------------------------------------------------------- ÜYE KATILIMI */
function onMemberAdd(member) {
  const guild = member.guild;
  const cfg = guardActive(guild);
  if (!cfg) return;
  const now = Date.now();
  const user = member.user || {};
  try {
    if (user.bot && cfg.modules.botGuard !== false) {
      recordInfo(guild, {
        title: 'Sunucuya bot eklendi',
        detail: `${user.tag || member.id} · güvenli listede değilse bot koruması kaydına düşer`,
        severity: 'medium',
        module: 'botGuard',
        actor: { id: member.id, name: user.tag || member.id }
      });
      return;
    }

    // Hesap yaşı
    const ageDays = user.createdTimestamp ? (now - user.createdTimestamp) / 86400000 : null;
    if (cfg.modules.accountGuard !== false && cfg.newAccount?.enabled && ageDays != null && ageDays < Number(cfg.newAccount.days)) {
      if ((guild.memberCount || 0) >= Number(cfg.newAccount.minMembers)) {
        if (cfg.newAccount.action === 'kick') {
          enforce(guild, cfg, { offenderId: member.id, action: 'kick', reason: `Çok yeni hesap (${Math.max(1, Math.floor(ageDays))} gün)`, module: 'accountGuard', evidence: user.tag || member.id }).catch(() => {});
        } else {
          pushEvent(guild.id, {
            type: 'info', severity: 'medium', title: 'Yeni hesap katıldı',
            detail: `${user.tag || member.id} · hesap yaşı ${Math.max(1, Math.floor(ageDays))} gün`,
            module: 'accountGuard', actor: { id: member.id, name: user.tag || member.id }
          });
        }
      }
    }

    if (cfg.modules.antiRaid === false) return;

    // Aktif raid modu: yeni gelen hesaplar 10 dakika boyunca anında atılır.
    const activeRaid = raidMode.get(guild.id);
    if (activeRaid) {
      if (now >= activeRaid.until) {
        raidMode.delete(guild.id);
      } else if (activeRaid.action === 'kick-new' && ageDays != null && ageDays < 2
        && String(member.id) !== String(guild.ownerId) && !isWhitelisted(cfg, member.id)) {
        enforce(guild, cfg, {
          offenderId: member.id,
          action: 'kick',
          reason: 'Raid modu — yeni hesap katılımı',
          module: 'antiRaid',
          evidence: `${Math.max(1, Math.floor(ageDays))} günlük hesap, raid modu aktif`
        }).catch(() => {});
        return;
      }
    }

    const stamps = pruneStamps(joinStamps.get(guild.id), now, 12000);
    stamps.push({ at: now, userId: member.id, avatar: user.avatar || null, name: (user.username || '').toLowerCase(), newAccount: ageDays != null && ageDays < 2 });
    joinStamps.set(guild.id, stamps.slice(-60));

    const windowStamps = stamps.filter((s) => now - s.at <= 12000);
    const avatarCounts = {};
    windowStamps.forEach((s) => { if (s.avatar) avatarCounts[s.avatar] = (avatarCounts[s.avatar] || 0) + 1; });
    const dupAvatar = Object.values(avatarCounts).some((n) => n >= 3);
    const manyNew = windowStamps.filter((s) => s.newAccount).length;
    const count = windowStamps.length;
    const threshold = Math.max(5, Math.ceil((guild.memberCount || 100) * 0.01));
    const raidDetected = count >= threshold || dupAvatar || manyNew >= 4;

    if (raidDetected && shouldNotify(guild.id, 'raid', 'join', 45000)) {
      const ev = pushEvent(guild.id, {
        type: 'violation', severity: 'high', title: '🚨 Olası raid tespit edildi',
        detail: `12 saniyede ${count} katılım${dupAvatar ? ' · tekrar eden avatarlar' : ''}${manyNew >= 4 ? ` · ${manyNew} yeni hesap` : ''}`,
        module: 'antiRaid', count, limit: threshold
      });
      notify(guild, cfg, ev);
      bumpStat(guild.id, 'blocked');

      // Raid modu: yeni hesapları at / kilitle
      const action = cfg.raidAction || 'notify';
      if (action === 'kick-new') {
        raidMode.set(guild.id, { until: now + 10 * 60 * 1000, action });
        for (const s of windowStamps) {
          if (s.newAccount && String(s.userId) !== String(guild.ownerId) && !isWhitelisted(cfg, s.userId)) {
            enforce(guild, cfg, { offenderId: s.userId, action: 'kick', reason: 'Raid sırasında yeni hesap', module: 'antiRaid' }).catch(() => {});
          }
        }
      } else if (action === 'lockdown') {
        applyLockdown(guild, cfg).catch(() => {});
      }
    }
  } catch { /* yoksay */ }
}

async function applyLockdown(guild, cfg) {
  try {
    const level = guild.verificationLevel;
    if (typeof level === 'number' && level < 3 && guild.members?.me?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) {
      await guild.setVerificationLevel(3, 'LORES Guard · raid kilidi');
      raidMode.set(guild.id, { until: Date.now() + 10 * 60 * 1000, action: 'lockdown', previousLevel: level });
      pushEvent(guild.id, {
        type: 'action', severity: 'high', title: 'Sunucu kilidi (raid)',
        detail: 'Doğrulama seviyesi "Yüksek" yapıldı. 10 dakika sonra guard eski seviyeye döndürebilir.',
        module: 'antiRaid'
      });
    }
  } catch { /* yoksay */ }
}

/* ----------------------------------------------------------------- MESAJ AKIŞI */
function messageText(message) {
  const parts = [message.content || ''];
  try {
    if (Array.isArray(message.embeds)) {
      for (const e of message.embeds) {
        if (!e) continue;
        parts.push(e.title || '', e.description || '', e.url || '', e.footer?.text || '', e.author?.name || '');
        if (Array.isArray(e.fields)) parts.push(...e.fields.map((f) => `${f.name || ''} ${f.value || ''}`));
      }
    }
    if (message.attachments?.size) parts.push([...message.attachments.values()].map((a) => a.name || '').join(' '));
  } catch { /* yoksay */ }
  return parts.filter(Boolean).join(' \n ');
}

function isHoneypotChannel(message, cfg) {
  if (!cfg.honeypot?.enabled || !cfg.honeypot.channelId) return false;
  if (String(message.channelId || message.channel?.id) === String(cfg.honeypot.channelId)) return true;
  const parent = message.channel?.parentId || message.channel?.parent?.id;
  return Boolean(parent && String(parent) === String(cfg.honeypot.channelId));
}

function contentHash(content) {
  return normalizeText(content)
    .replace(/<a?:[a-zA-Z0-9_~]+:\d+>/g, '')
    .replace(/[^a-z0-9ğüşiöç\s]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function countEmojis(content) {
  const custom = (String(content).match(CUSTOM_EMOJI_RE) || []).length;
  const unicode = (String(content).match(UNICODE_EMOJI_RE) || []).length;
  return custom + unicode;
}

function mentionCounts(message) {
  const content = String(message.content || '');
  let users = 0;
  let roles = 0;
  try {
    users = message.mentions?.users?.size || (content.match(MENTION_USER_RE) || []).length;
    roles = message.mentions?.roles?.size || (content.match(MENTION_ROLE_RE) || []).length;
  } catch {
    users = (content.match(MENTION_USER_RE) || []).length;
    roles = (content.match(MENTION_ROLE_RE) || []).length;
  }
  const everyone = EVERYONE_RE.test(content) ? 1 : 0;
  return { users, roles, everyone, total: users + roles + everyone };
}

async function deleteMessageSafe(message, reason = 'Guard') {
  try {
    if (message.deletable !== false && typeof message.delete === 'function') {
      await message.delete(reason.slice(0, 500));
      return true;
    }
  } catch { /* yoksay */ }
  return false;
}

async function purgeRecentByUser(channel, userId, limit = 15) {
  try {
    if (!channel?.messages?.fetch) return 0;
    const messages = await channel.messages.fetch({ limit });
    const mine = [...messages.values()].filter((m) => String(m.author?.id) === String(userId));
    if (!mine.length) return 0;
    if (typeof channel.bulkDelete === 'function' && mine.length > 1) {
      const deleted = await channel.bulkDelete(mine.filter((m) => Date.now() - m.createdTimestamp < 14 * 86400000), true);
      return deleted.size || 0;
    }
    let count = 0;
    for (const m of mine.slice(0, 5)) {
      if (await deleteMessageSafe(m, 'Guard · spam temizliği')) count += 1;
    }
    return count;
  } catch {
    return 0;
  }
}

async function warnChannel(guild, channelId, text) {
  try {
    const channel = guild.channels?.cache?.get(channelId);
    if (channel?.send) {
      const msg = await channel.send(text);
      if (msg?.delete) setTimeout(() => msg.delete().catch(() => {}), 6000);
      return msg;
    }
  } catch { /* yoksay */ }
  return null;
}

async function onMessage(message) {
  if (!message?.guild || isSelfMessage(message)) return;
  const guild = message.guild;
  const cfg = guardActive(guild);
  if (!cfg) return;
  const authorId = String(message.author?.id || '');
  if (!authorId) return;
  if (isWhitelisted(cfg, authorId)) return;
  if (authorId === String(guild.ownerId)) return;

  const content = message.content || '';
  const fullText = messageText(message);

  try {
    // 1) HONEYPOT: tuzak kanal / tuzak rol mention
    if (cfg.modules.honeypot !== false) {
      const inHoneyChannel = isHoneypotChannel(message, cfg);
      const honeyRole = cfg.honeypot?.roleId && message.mentions?.roles?.has?.(cfg.honeypot.roleId);
      if (inHoneyChannel || honeyRole) {
        await deleteMessageSafe(message, 'LORES Guard · honeypot');
        const name = message.author?.tag || authorId;
        honeypotOffense(guild, cfg, authorId, {
          name,
          kind: inHoneyChannel ? 'kanal' : 'rol',
          channelId: message.channelId,
          messageId: message.id
        });
        if (cfg.honeypot?.autoReply !== false) {
          const label = HONEYPOT_ACTIONS.find((a) => a.key === (cfg.honeypot?.action || 'timeout'))?.label || 'ceza';
          warnChannel(guild, message.channelId, `🍯 <@${authorId}> bir tuzağa dokundun. Uygulanan işlem: **${label}**.`).catch(() => {});
        }
        return;
      }
    }

    // 2) Reklam motoru
    if (cfg.modules.adGuard !== false) {
      const adExtra = { text: fullText.slice(0, 600) };
      const analysis = analyzeAd(fullText, cfg, adExtra);
      if (analysis.confident) {
        const deleted = await deleteMessageSafe(message, 'LORES Guard · reklam');
        bumpStat(guild.id, 'ads');
        const currentAd = get(guild.id).ad;
        update(guild.id, { ad: { ...currentAd, detected: (currentAd.detected || 0) + 1 } });
        const ev = pushEvent(guild.id, {
          type: 'violation',
          severity: analysis.score >= 6 ? 'high' : 'medium',
          title: 'Reklam tespit edildi',
          detail: `${message.author?.tag || authorId} · #${message.channel?.name || '?'} · skor ${analysis.score} · ${analysis.reasons.slice(0, 3).join(', ') || 'reklam sinyali'}`,
          module: 'adGuard',
          actor: { id: authorId, name: message.author?.tag || authorId },
          channel: message.channelId,
          evidence: content.slice(0, 200) || '(embed/ek)',
          score: analysis.score,
          punishment: cfg.ad.action
        });
        notify(guild, cfg, ev);
        if (deleted) bumpStat(guild.id, 'deleted');
        if (deleted) await warnChannel(guild, message.channelId, `🚫 <@${authorId}> reklam paylaşımı kaldırıldı (skor ${analysis.score}).`);

        const action = cfg.ad.action || 'delete';
        if (action !== 'delete') {
          const meta = { timeout: 'timeout', kick: 'kick', ban: 'ban' }[action];
          if (meta) {
            await enforce(guild, cfg, {
              offenderId: authorId,
              action: meta,
              minutes: meta === 'timeout' ? Math.max(1, Number(cfg.ad.timeoutMinutes) || 10) : null,
              reason: 'Reklam paylaşımı',
              module: 'adGuard',
              evidence: `skor ${analysis.score}`
            });
          }
        }
        return;
      }
    }

    // 3) Mention koruması
    if (cfg.modules.mentionGuard !== false) {
      const mentions = mentionCounts(message);
      const max = Number(cfg.thresholds.maxMentions) || 6;
      const mass = Number(cfg.thresholds.massMention) || 12;
      const punishMass = mentions.total >= mass || (mentions.everyone && mentions.total >= Math.ceil(max / 2));
      if (mentions.total > max) {
        const deleted = await deleteMessageSafe(message, 'LORES Guard · mention');
        const ev = pushEvent(guild.id, {
          type: 'violation',
          severity: punishMass ? 'high' : 'medium',
          title: punishMass ? 'Toplu mention (mass ping)' : 'Aşırı mention',
          detail: `${message.author?.tag || authorId} · #${message.channel?.name || '?'} · ${mentions.total} mention${mentions.everyone ? ' (@everyone/@here)' : ''}`,
          module: 'mentionGuard',
          actor: { id: authorId, name: message.author?.tag || authorId },
          channel: message.channelId,
          count: mentions.total,
          limit: max,
          punishment: punishMass ? cfg.punishment : null
        });
        notify(guild, cfg, ev);
        if (deleted) bumpStat(guild.id, 'deleted');
        if (punishMass) {
          await enforce(guild, cfg, { offenderId: authorId, action: 'timeout', minutes: 60, reason: 'Toplu mention', module: 'mentionGuard' });
        }
        return;
      }
    }

    // 4) Büyük harf / emoji taşması
    const letters = (content.match(/\p{L}/gu) || []).length;
    const uppers = (content.match(/\p{Lu}/gu) || []).length;
    if (cfg.caps?.enabled && letters >= Number(cfg.caps.minLength) && uppers / Math.max(1, letters) >= Number(cfg.caps.percent) / 100) {
      const deleted = await deleteMessageSafe(message, 'LORES Guard · büyük harf');
      bumpStat(guild.id, 'deleted');
      pushEvent(guild.id, {
        type: 'info', severity: 'low', title: 'Aşırı büyük harf mesajı kaldırıldı',
        detail: `${message.author?.tag || authorId} · #${message.channel?.name || '?'} · %${Math.round((uppers / letters) * 100)} büyük harf`,
        module: 'adGuard', actor: { id: authorId, name: message.author?.tag || authorId }, channel: message.channelId
      });
      void deleted;
      return;
    }
    if (cfg.emoji?.enabled && countEmojis(content) > Number(cfg.emoji.max)) {
      const deleted = await deleteMessageSafe(message, 'LORES Guard · emoji');
      bumpStat(guild.id, 'deleted');
      pushEvent(guild.id, {
        type: 'info', severity: 'low', title: 'Emoji bombardımanı kaldırıldı',
        detail: `${message.author?.tag || authorId} · #${message.channel?.name || '?'} · ${countEmojis(content)} emoji`,
        module: 'adGuard', actor: { id: authorId, name: message.author?.tag || authorId }, channel: message.channelId
      });
      void deleted;
      return;
    }

    // 5) Spam / tekrar
    if (cfg.modules.spamGuard !== false) {
      const now = Date.now();
      const key = `${guild.id}:${authorId}`;
      const trail = pruneStamps(messageTrail.get(key), now, 20000);
      const hash = contentHash(content) || (message.attachments?.size ? `ek:${message.attachments.size}` : '');
      trail.push({ at: now, hash, channelId: String(message.channelId), content: content.slice(0, 80) });
      messageTrail.set(key, trail.slice(-30));

      const recent8 = trail.filter((x) => now - x.at <= 8000);
      const identical = hash ? trail.filter((x) => x.hash && x.hash === hash && now - x.at <= 12000) : [];
      const channels = new Set(identical.map((x) => x.channelId));
      const flood = recent8.length >= 6;
      const repeat = identical.length >= 3;
      const cross = identical.length >= 3 && channels.size >= 3;

      if ((flood || repeat || cross) && shouldNotify(guild.id, authorId, 'spam', 15000)) {
        const deleted = await purgeRecentByUser(message.channel, authorId, 20);
        bumpStat(guild.id, 'deleted', deleted || 1);
        bumpStat(guild.id, 'timeouts');
        const ev = pushEvent(guild.id, {
          type: 'violation',
          severity: (repeat || cross) ? 'high' : 'medium',
          title: cross ? 'Çoklu kanal spam’i' : repeat ? 'Tekrar eden mesaj spam’i' : 'Mesaj bombardımanı',
          detail: `${message.author?.tag || authorId} · #${message.channel?.name || '?'} · 8 sn'de ${recent8.length} mesaj · tekrar ${identical.length}`,
          module: 'spamGuard',
          actor: { id: authorId, name: message.author?.tag || authorId },
          channel: message.channelId,
          count: recent8.length,
          limit: 6,
          evidence: content.slice(0, 120),
          punishment: 'timeout'
        });
        notify(guild, cfg, ev);
        await enforce(guild, cfg, { offenderId: authorId, action: 'timeout', minutes: 15, reason: 'Spam', module: 'spamGuard', evidence: `8 sn'de ${recent8.length} mesaj` });
      }
    }
  } catch {
    /* Guard asla mesaj işlemeyi bozmamalı */
  }
}

/* --------------------------------------------------------- TUZAK KURULUMU */
async function createHoneypotChannel(guild, { silent = false } = {}) {
  try {
    if (!guild.members?.me?.permissions?.has?.(PermissionsBitField.Flags.ManageChannels)) {
      return { ok: false, error: 'Botun "Kanalları Yönet" yetkisi yok.' };
    }
    const cfg = get(guild.id);
    if (cfg.honeypot?.channelId && guild.channels?.cache?.get(cfg.honeypot.channelId)) {
      return { ok: true, channelId: cfg.honeypot.channelId, existing: true };
    }
    const channel = await guild.channels.create({
      name: '・do-not-touch',
      type: ChannelType.GuildText,
      topic: '⚠️ Bu kanal bir tuzaktır. Buraya yazan herkes otomatik cezalandırılır. (LORES Guard honeypot)',
      reason: 'LORES Guard · honeypot kanalı'
    });
    let messageId = null;
    try {
      const sent = await channel.send({
        embeds: [new EmbedBuilder()
          .setColor(COLOR.err)
          .setTitle('⚠️ Bu kanal tuzaktır')
          .setDescription('Buraya mesaj yazan, tepki veren veya bu mesajı alıntılayan herkes **otomatik olarak cezalandırılır**.\n\nBu kanal gerçek bir sohbet alanı değildir. Lütfen buradan uzak dur.')
          .setFooter({ text: 'LORES Guard · honeypot' })]
      });
      messageId = sent?.id || null;
    } catch { /* mesaj gönderilemedi */ }
    update(guild.id, {
      honeypot: { ...get(guild.id).honeypot, enabled: true, channelId: channel.id, messageId, setupAt: Date.now() }
    });
    if (!silent) {
      const ev = pushEvent(guild.id, {
        type: 'action', severity: 'medium', title: '🍯 Honeypot kanalı kuruldu',
        detail: `<#${channel.id}> tuzak olarak ayarlandı. Buraya yazan herkes cezalandırılacak.`,
        module: 'honeypot'
      });
      notify(guild, get(guild.id), ev);
    }
    return { ok: true, channelId: channel.id, messageId, created: true };
  } catch (err) {
    return { ok: false, error: `Honeypot kanalı oluşturulamadı: ${err.message}` };
  }
}

async function createHoneypotRole(guild) {
  try {
    if (!guild.members?.me?.permissions?.has?.(PermissionsBitField.Flags.ManageRoles)) {
      return { ok: false, error: 'Botun "Rolleri Yönet" yetkisi yok.' };
    }
    const cfg = get(guild.id);
    if (cfg.honeypot?.roleId && guild.roles?.cache?.get(cfg.honeypot.roleId)) {
      return { ok: true, roleId: cfg.honeypot.roleId, existing: true };
    }
    const role = await guild.roles.create({
      name: '🛡️ Guard Ekip',
      mentionable: false,
      hoist: false,
      color: 0x2b2d31,
      reason: 'LORES Guard · honeypot rolü (mention tuzak)'
    });
    update(guild.id, { honeypot: { ...get(guild.id).honeypot, roleId: role.id } });
    pushEvent(guild.id, {
      type: 'action', severity: 'medium', title: '🍯 Honeypot rolü kuruldu',
      detail: `@${role.name} mention tuzağı olarak ayarlandı. Bu rolü mention’layan cezalandırılır.`,
      module: 'honeypot'
    });
    return { ok: true, roleId: role.id, created: true };
  } catch (err) {
    return { ok: false, error: `Honeypot rolü oluşturulamadı: ${err.message}` };
  }
}

function honeypotDisable(guildId) {
  const cfg = get(guildId);
  update(guildId, { honeypot: { ...cfg.honeypot, enabled: false } });
  return { ok: true };
}

/* ----------------------------------------------------------------- PANİK MODU */
async function panic(guild, actorName = 'panel') {
  const cfg = get(guild.id);
  if (!isAllowed(guild.id)) return { ok: false, error: 'Koruma bu sunucuda etkin değil (whitelist).' };
  const results = { members: 0, roles: 0, invites: 0, errors: [] };
  try {
    const whitelist = new Set((cfg.whitelist || []).map(String));
    const me = guild.members?.me;
    const botTop = me?.roles?.highest?.position ?? 0;
    const members = guild.members?.cache ? [...guild.members.cache.values()] : [];
    for (const member of members) {
      if (member.user?.bot) continue;
      if (member.id === guild.ownerId) continue;
      if (whitelist.has(String(member.id))) continue;
      if (!canModerate(guild, member)) continue;
      const removed = await stripDangerousRoles(guild, member, 'LORES Guard · panik modu');
      if (removed) {
        results.members += 1;
        results.roles += removed;
      }
      void botTop;
    }
    try {
      if (guild.invites?.fetch && guild.members?.me?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) {
        const invites = await guild.invites.fetch();
        for (const invite of invites.values()) {
          try { await invite.delete('LORES Guard · panik modu'); results.invites += 1; } catch { /* yoksay */ }
        }
      }
    } catch { /* yoksay */ }
  } catch (err) {
    results.errors.push(err.message);
  }
  bumpStat(guild.id, 'stripped', results.roles);
  const ev = pushEvent(guild.id, {
    type: 'action',
    severity: 'high',
    title: '🚨 PANİK MODU çalıştırıldı',
    detail: `${actorName} tarafından: ${results.members} üyeden ${results.roles} yetkili rol alındı, ${results.invites} davet silindi.`,
    module: 'antiNuke'
  });
  notify(guild, cfg, ev);
  return { ok: true, ...results };
}

/* --------------------------------------------------------- GÜVENLİK DENETİMİ */
async function safetyAudit(guild) {
  const cfg = guardActive(guild);
  if (!cfg) return;
  try {
    // Guard kanalı var mı?
    await ensureLogChannel(guild, cfg);
    // Doğrulama seviyesi
    if (cfg.safety?.verifyLevel !== false) {
      const level = guild.verificationLevel;
      if (typeof level === 'number' && level < 2 && guild.members?.me?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) {
        await guild.setVerificationLevel(2, 'LORES Guard · güvenlik denetimi');
        recordInfo(guild, { title: 'Doğrulama seviyesi yükseltildi', detail: 'Sunucu doğrulaması "Orta" seviyesine alındı.', severity: 'medium', module: 'antiNuke' });
      }
    }
    // 2FA
    if (cfg.safety?.twoFactor !== false && typeof guild.mfaLevel === 'number' && guild.mfaLevel === 0) {
      if (shouldNotify(guild.id, 'safety', '2fa', 6 * 3600000)) {
        recordInfo(guild, {
          title: '2FA önerilir',
          detail: 'Sunucuda iki adımlı doğrulama kapalı. Sunucu Ayarları > Güvenlik > "Yöneticiler için 2FA zorunlu" açılmalı.',
          severity: 'medium', module: 'antiNuke'
        });
      }
    }
    // Raid modu süresi bitti mi? Kilidi geri al.
    const rm = raidMode.get(guild.id);
    if (rm && rm.action === 'lockdown' && Date.now() > rm.until) {
      raidMode.delete(guild.id);
      if (typeof rm.previousLevel === 'number' && guild.members?.me?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) {
        await guild.setVerificationLevel(rm.previousLevel, 'LORES Guard · raid kilidi sona erdi').catch(() => {});
      }
    }
  } catch { /* yoksay */ }
}

/** Alan adlarını normalize eder: küçük harf, www. temizliği, tekleme, biçim süzgeci. */
function normalizeDomains(list) {
  const clean = [];
  for (const raw of Array.isArray(list) ? list : []) {
    let d = String(raw).toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    if (!/^[a-z0-9.-]{3,80}$/.test(d)) continue;
    if (!clean.includes(d)) clean.push(d);
    if (clean.length >= 60) break;
  }
  return clean;
}

/** Panelden/komuttan ayar güncelleme (güvenli alanlar). */
function setConfig(guildId, patch = {}) {
  const cfg = get(guildId);
  const next = {};
  if (patch.logChannelId !== undefined) next.logChannelId = patch.logChannelId || null;
  if (patch.jailRoleId !== undefined) next.jailRoleId = patch.jailRoleId || null;
  if (patch.mutedRoleId !== undefined) next.mutedRoleId = patch.mutedRoleId || null;
  if (patch.punishment !== undefined) {
    if (!PUNISHMENTS.some((p) => p.key === patch.punishment)) return { ok: false, error: 'Geçersiz ceza türü.' };
    next.punishment = patch.punishment;
  }
  if (patch.windowSeconds !== undefined) {
    const n = Math.floor(Number(patch.windowSeconds));
    if (!Number.isFinite(n) || n < 5 || n > 600) return { ok: false, error: 'Pencere 5–600 saniye olmalı.' };
    next.windowSeconds = n;
  }
  if (patch.timeoutMinutes !== undefined) {
    const n = Math.floor(Number(patch.timeoutMinutes));
    if (!Number.isFinite(n) || n < 1 || n > 1440) return { ok: false, error: 'Timeout 1–1440 dakika olmalı.' };
    next.timeoutMinutes = n;
  }
  const mergeObj = (key, allowed) => {
    if (!patch[key] || typeof patch[key] !== 'object') return;
    const clean = {};
    for (const [k, v] of Object.entries(patch[key])) {
      if (!allowed.includes(k)) continue;
      clean[k] = v;
    }
    if (Object.keys(clean).length) next[key] = clean;
  };
  mergeObj('ad', ['action', 'timeoutMinutes', 'allowInvites', 'trustedDomains']);
  mergeObj('caps', ['enabled', 'minLength', 'percent']);
  mergeObj('emoji', ['enabled', 'max']);
  mergeObj('newAccount', ['enabled', 'days', 'minMembers', 'action']);
  mergeObj('safety', ['verifyLevel', 'twoFactor', 'watchIntegrations', 'autoRestore', 'restoreMaxPerWindow']);
  mergeObj('honeypot', ['enabled', 'action', 'hours', 'autoReply']);
  mergeObj('thresholds', ['massDestructive', 'maxMentions', 'massMention']);
  if (next.honeypot?.action !== undefined && !HONEYPOT_ACTIONS.some((a) => a.key === next.honeypot.action)) delete next.honeypot.action;
  if (next.ad?.action !== undefined && !AD_ACTIONS.some((a) => a.key === next.ad.action)) delete next.ad.action;
  if (next.newAccount?.action !== undefined && !NEW_ACCOUNT_ACTIONS.some((a) => a.key === next.newAccount.action)) delete next.newAccount.action;
  if (patch.raidAction && RAID_ACTIONS.some((a) => a.key === patch.raidAction)) next.raidAction = patch.raidAction;
  if (patch.botAction && BOT_ACTIONS.some((a) => a.key === patch.botAction)) next.botAction = patch.botAction;
  if (patch.modules && typeof patch.modules === 'object') {
    const modules = {};
    for (const m of MODULES) if (patch.modules[m.key] !== undefined) modules[m.key] = Boolean(patch.modules[m.key]);
    if (Object.keys(modules).length) next.modules = modules;
  }
  if (patch.limits && typeof patch.limits === 'object') {
    const limits = {};
    for (const a of LIMIT_ACTIONS) {
      if (patch.limits[a.key] === undefined) continue;
      const n = Math.floor(Number(patch.limits[a.key]));
      if (!Number.isFinite(n) || n < 1 || n > 100) return { ok: false, error: `${a.label} limiti 1–100 arasında olmalı.` };
      limits[a.key] = n;
    }
    if (Object.keys(limits).length) next.limits = limits;
  }
  if (patch.ratios && typeof patch.ratios === 'object') {
    const ratios = {};
    for (const a of LIMIT_ACTIONS) {
      if (patch.ratios[a.key] === undefined) continue;
      const n = Math.floor(Number(patch.ratios[a.key]));
      if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false, error: `${a.label} oranı 0–100 arasında olmalı.` };
      ratios[a.key] = n;
    }
    if (Object.keys(ratios).length) next.ratios = ratios;
  }
  // ad.trustedDomains özel: temizle
  if (next.ad && Array.isArray(next.ad.trustedDomains)) {
    next.ad.trustedDomains = normalizeDomains(next.ad.trustedDomains);
  }
  if (patch.ad?.trustedDomains && !next.ad) {
    next.ad = { trustedDomains: normalizeDomains(patch.ad.trustedDomains) };
  }
  if (patch.enabled !== undefined && Boolean(patch.enabled) !== cfg.enabled) {
    setEnabled(guildId, Boolean(patch.enabled));
  }
  if (Object.keys(next).length) update(guildId, next);
  return { ok: true, guard: get(guildId) };
}

/* ------------------------------------------------------------------ HAZIR AYARLAR */
const PRESETS = [
  { key: 'dengeli', label: 'Dengeli', desc: 'Önerilen varsayılan: gerçek müdahale, yanlış pozitife karşı toleranslı.' },
  { key: 'siki', label: 'Sıkı', desc: 'Maksimum koruma: düşük limitler, oran eşikleri, agresif cezalar.' },
  { key: 'gevsek', label: 'Gevşek', desc: 'Yalnızca bariz saldırılar: yüksek limitler, rollerini alma cezası.' }
];

function applyPreset(guildId, name) {
  const key = String(name || '').toLowerCase();
  if (!PRESETS.some((p) => p.key === key)) return { ok: false, error: 'Bilinmeyen hazır ayar.' };
  const base = {};
  if (key === 'sikı' || key === 'siki' || key === 'sıkı' || key === 'strict') {
    Object.assign(base, {
      punishment: 'ban',
      windowSeconds: 45,
      timeoutMinutes: 30,
      raidAction: 'lockdown',
      botAction: 'ban-inviter',
      thresholds: { massDestructive: 4, maxMentions: 5, massMention: 9 },
      ad: { action: 'kick', timeoutMinutes: 30, allowInvites: false },
      caps: { enabled: true, minLength: 10, percent: 65 },
      emoji: { enabled: true, max: 6 },
      newAccount: { enabled: true, days: 14, minMembers: 10, action: 'kick' },
      safety: { verifyLevel: true, twoFactor: true, watchIntegrations: true, autoRestore: true, restoreMaxPerWindow: 8 },
      honeypot: { action: 'ban', hours: 24 }
    });
    base.modules = Object.fromEntries(MODULES.map((m) => [m.key, true]));
    base.limits = { ban: 2, kick: 2, memberPrune: 1, channelDelete: 1, channelCreate: 2, channelRename: 2, roleDelete: 1, roleCreate: 2, roleUpdate: 2, webhook: 1, webhookDelete: 1, botAdd: 1, emojiDelete: 2, integration: 1, inviteCreate: 3 };
  } else if (key === 'gevsek' || key === 'gevşek' || key === 'relaxed') {
    Object.assign(base, {
      punishment: 'roles',
      windowSeconds: 120,
      timeoutMinutes: 10,
      raidAction: 'notify',
      botAction: 'kick',
      thresholds: { massDestructive: 8, maxMentions: 8, massMention: 15 },
      ad: { action: 'delete', timeoutMinutes: 10, allowInvites: true },
      caps: { enabled: false, minLength: 20, percent: 85 },
      emoji: { enabled: false, max: 14 },
      newAccount: { enabled: false, days: 3, minMembers: 50, action: 'notify' },
      safety: { verifyLevel: false, twoFactor: false, watchIntegrations: true, autoRestore: true, restoreMaxPerWindow: 4 },
      honeypot: { action: 'timeout', hours: 1 }
    });
    base.modules = Object.fromEntries(MODULES.map((m) => [m.key, m.key !== 'accountGuard']));
    base.limits = { ban: 5, kick: 5, memberPrune: 2, channelDelete: 4, channelCreate: 6, channelRename: 6, roleDelete: 4, roleCreate: 5, roleUpdate: 5, webhook: 4, webhookDelete: 4, botAdd: 1, emojiDelete: 6, integration: 2, inviteCreate: 8 };
  } else {
    Object.assign(base, {
      punishment: 'ban',
      windowSeconds: 60,
      timeoutMinutes: 10,
      raidAction: 'notify',
      botAction: 'kick',
      thresholds: { massDestructive: 5, maxMentions: 6, massMention: 12 },
      ad: { action: 'timeout', timeoutMinutes: 10, allowInvites: false },
      caps: { enabled: true, minLength: 12, percent: 70 },
      emoji: { enabled: true, max: 8 },
      newAccount: { enabled: true, days: 7, minMembers: 15, action: 'notify' },
      safety: { verifyLevel: true, twoFactor: true, watchIntegrations: true, autoRestore: true, restoreMaxPerWindow: 6 },
      honeypot: { action: 'timeout', hours: 1 }
    });
    base.modules = Object.fromEntries(MODULES.map((m) => [m.key, true]));
    base.limits = Object.fromEntries(LIMIT_ACTIONS.map((a) => [a.key, a.def]));
  }
  update(guildId, base);
  pushEvent(guildId, {
    type: 'action', severity: 'low',
    title: `Hazır ayar: ${PRESETS.find((x) => x.key === key)?.label || 'Dengeli'}`,
    detail: 'Modüller, limitler, cezalar ve eşikler bu profile göre güncellendi.',
    module: null
  });
  return { ok: true, preset: key, guard: get(guildId) };
}

/* --------------------------------------------------------------- İSTATİSTİK */
function daySeries(guildId, days = 7) {
  const cfg = get(guildId);
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const day = cfg.stats.byDay?.[d] || {};
    out.push({
      day: d,
      blocked: Number(day.blocked) || 0,
      deleted: Number(day.deleted) || 0,
      honeypot: Number(day.honeypot) || 0,
      ads: Number(day.ads) || 0
    });
  }
  return out;
}

/* ================================================================== SLASH */
function addOption(builder, kind, { name, description, required = false, choices = null, min = null, max = null }) {
  const method = { string: 'addStringOption', integer: 'addIntegerOption', user: 'addUserOption', channel: 'addChannelOption', role: 'addRoleOption' }[kind];
  builder[method]((o) => {
    o.setName(name).setDescription(description);
    if (required) o.setRequired(true);
    if (choices) o.addChoices(...choices);
    if (min != null) { if (kind === 'string') o.setMinLength(min); else o.setMinValue(min); }
    if (max != null) { if (kind === 'string') o.setMaxLength(max); else o.setMaxValue(max); }
    return o;
  });
  return builder;
}

function buildGuardCommand() {
  const cmd = new SlashCommandBuilder()
    .setName('guard')
    .setDescription('Sunucu korumasını yönetir (gerçek müdahale aktif)');

  cmd.addSubcommand((s) => s.setName('durum').setDescription('Koruma durumunu, modülleri, cezaları ve istatistikleri gösterir'));
  cmd.addSubcommand((s) => s.setName('aç').setDescription('Sunucu korumasını açar'));
  cmd.addSubcommand((s) => s.setName('kapat').setDescription('Sunucu korumasını kapatır'));

  cmd.addSubcommand((s) => {
    s.setName('modül').setDescription('Bir koruma modülünü açar veya kapatır');
    addOption(s, 'string', { name: 'modül', description: 'Koruma modülü', required: true, choices: MODULES.map((m) => ({ name: m.label, value: m.key })) });
    addOption(s, 'string', { name: 'durum', description: 'Aç veya kapat', required: true, choices: [{ name: 'Açık', value: 'acik' }, { name: 'Kapalı', value: 'kapali' }] });
    return s;
  });

  cmd.addSubcommand((s) => {
    s.setName('limit').setDescription('Bir işlem için sınır belirler');
    addOption(s, 'string', { name: 'işlem', description: 'İzlenen işlem', required: true, choices: LIMIT_ACTIONS.map((a) => ({ name: a.label, value: a.key })) });
    addOption(s, 'integer', { name: 'sayı', description: 'Pencere içinde izin verilen işlem sayısı', required: true, min: 1, max: 100 });
    return s;
  });

  cmd.addSubcommand((s) => {
    s.setName('oran').setDescription('Sunucu büyüklüğüne göre otomatik eşik (0 = kapalı)');
    addOption(s, 'string', { name: 'işlem', description: 'İzlenen işlem', required: true, choices: LIMIT_ACTIONS.map((a) => ({ name: a.label, value: a.key })) });
    addOption(s, 'integer', { name: 'oran', description: 'Örn. 3 → her 3 üyede 1 işlem sınırı', required: true, min: 0, max: 100 });
    return s;
  });

  cmd.addSubcommand((s) => {
    s.setName('pencere').setDescription('Limit sayım penceresini saniye olarak belirler');
    addOption(s, 'integer', { name: 'saniye', description: 'Sayım penceresi (5-600 saniye)', required: true, min: 5, max: 600 });
    return s;
  });

  cmd.addSubcommand((s) => {
    s.setName('ceza').setDescription('Sınır aşımında uygulanacak cezayı seçer');
    addOption(s, 'string', { name: 'tür', description: 'Ceza türü', required: true, choices: PUNISHMENTS.map((p) => ({ name: p.label, value: p.key })) });
    return s;
  });

  cmd.addSubcommand((s) => {
    s.setName('süre').setDescription('Timeout cezasının süresini dakika olarak belirler');
    addOption(s, 'integer', { name: 'dakika', description: '1-1440 dakika', required: true, min: 1, max: 1440 });
    return s;
  });

  cmd.addSubcommand((s) => {
    s.setName('kanal').setDescription('Guard kayıtlarının yazılacağı kanalı belirler');
    addOption(s, 'channel', { name: 'kanal', description: 'Guard kanalı', required: true });
    return s;
  });

  cmd.addSubcommand((s) => {
    s.setName('güvenli').setDescription('Güvenli listeyi yönetir (limitlere ve cezalara takılmaz)');
    addOption(s, 'string', { name: 'işlem', description: 'Ekle, çıkar veya listele', required: true, choices: [{ name: 'Ekle', value: 'ekle' }, { name: 'Çıkar', value: 'cikar' }, { name: 'Liste', value: 'liste' }] });
    addOption(s, 'user', { name: 'kullanıcı', description: 'Listeye eklenecek veya çıkarılacak kullanıcı' });
    return s;
  });

  cmd.addSubcommand((s) => {
    s.setName('honeypot').setDescription('Tuzak kanal/rol kurar veya durumunu gösterir');
    addOption(s, 'string', {
      name: 'işlem',
      description: 'Kur, rol kur, kaldır veya durum',
      required: true,
      choices: [{ name: 'Kanal kur', value: 'kur' }, { name: 'Tuzak rol kur', value: 'rol' }, { name: 'Kaldır', value: 'kaldir' }, { name: 'Durum', value: 'durum' }]
    });
    addOption(s, 'string', {
      name: 'ceza',
      description: 'Tuzak tetiklenince uygulanacak ceza',
      choices: HONEYPOT_ACTIONS.map((a) => ({ name: a.label, value: a.key }))
    });
    return s;
  });

  cmd.addSubcommand((s) => {
    s.setName('reklam').setDescription('Reklam korumasını ve güvenilir alan adlarını yönetir');
    addOption(s, 'string', {
      name: 'işlem',
      description: 'Ceza seç, alan adı ekle/çıkar veya liste',
      required: true,
      choices: [
        { name: 'Ceza: sadece sil', value: 'sil' },
        { name: 'Ceza: timeout', value: 'timeout' },
        { name: 'Ceza: at', value: 'kick' },
        { name: 'Ceza: yasakla', value: 'ban' },
        { name: 'Davet linklerine izin ver', value: 'davet-ac' },
        { name: 'Davet linklerini engelle', value: 'davet-kapat' },
        { name: 'Güvenilir alan adı ekle', value: 'ekle' },
        { name: 'Güvenilir alan adı çıkar', value: 'cikar' },
        { name: 'Güvenilir alan adları', value: 'liste' }
      ]
    });
    addOption(s, 'string', { name: 'değer', description: 'Alan adı (örn. youtube.com)' });
    return s;
  });

  cmd.addSubcommand((s) => {
    s.setName('simülasyon').setDescription('Bir metnin reklam skorunu test eder (işlem yapmaz)');
    addOption(s, 'string', { name: 'metin', description: 'Test edilecek mesaj', required: true, max: 1200 });
    return s;
  });

  cmd.addSubcommand((s) => s.setName('olaylar').setDescription('Son guard kayıtlarını gösterir'));
  cmd.addSubcommand((s) => s.setName('yedek').setDescription('Rol ve kanal listesinin yedeğini alır'));
  cmd.addSubcommand((s) => s.setName('geri-yükle').setDescription('Yedekten eksik rol ve kanalları yeniden kurar'));
  cmd.addSubcommand((s) => s.setName('panik').setDescription('Tüm yetkili rollerini soy, davetleri sil (acil durum)'));
  cmd.addSubcommand((s) => s.setName('test').setDescription('Örnek bir guard kaydı üretir (gerçek işlem yapmaz)'));

  return cmd;
}

const guardSlashCommands = [buildGuardCommand().setDMPermission(false).toJSON()];

function embed({ title, description, color = COLOR.main, fields = [], footer }) {
  const e = new EmbedBuilder().setColor(color).setAuthor({ name: 'LORES Guard' }).setTitle(title).setDescription(description).setTimestamp();
  if (fields.length) e.addFields(fields);
  if (footer) e.setFooter({ text: footer });
  return e;
}

function limitLines(cfg) {
  return LIMIT_ACTIONS.map((a) => `\`${a.label}\` **${cfg.limits[a.key]}** / ${cfg.windowSeconds} sn${cfg.ratios[a.key] ? ` · oran 1/${cfg.ratios[a.key]}` : ''}`).join('\n');
}

function statusLines(cfg) {
  return MODULES.map((m) => `${cfg.modules[m.key] ? '🟢' : '⚪'} ${m.label}`).join('\n');
}

async function handleGuardInteraction(interaction) {
  if (interaction.commandName !== 'guard') return false;
  const guild = interaction.guild;
  if (!guild) return true;
  const sub = interaction.options.getSubcommand();
  const member = interaction.member;
  const isAdminUser = member?.permissions?.has?.(PermissionsBitField.Flags.Administrator);
  const reply = (payload) => (interaction.deferred || interaction.replied ? interaction.editReply(payload) : interaction.reply(payload));

  if (!isAdminUser) {
    await interaction.reply({ embeds: [embed({ title: 'Yetki gerekli', description: 'Guard ayarlarını yalnızca **Yönetici** yetkisine sahip üyeler değiştirebilir.', color: COLOR.err })], ephemeral: true });
    return true;
  }

  const cfg = get(guild.id);

  if (sub === 'durum') {
    const s = summary(guild.id, guild);
    const stat = s.stats || {};
    await reply({
      embeds: [embed({
        title: s.enabled ? '🛡️ Koruma aktif — gerçek müdahale açık' : 'Koruma kapalı',
        description: s.enabled
          ? `Guard ${s.modulesActive}/${s.modulesTotal} modülle izliyor. İhlalde **${s.punishmentLabel}** uygulanır.`
          : 'Koruma kapalı. Açmak için `/guard aç`.',
        color: s.enabled ? COLOR.ok : COLOR.warn,
        fields: [
          { name: 'Modüller', value: statusLines(cfg), inline: true },
          { name: 'Ceza', value: `${s.punishmentLabel}\nTimeout: ${cfg.timeoutMinutes} dk\nPencere: ${cfg.windowSeconds} sn`, inline: true },
          { name: 'Guard kanalı', value: s.logChannelName ? `#${s.logChannelName}` : 'Seçilmedi', inline: true },
          { name: '🍯 Honeypot', value: s.honeypot.enabled ? `${s.honeypot.channelName ? `#${s.honeypot.channelName}` : 'Kanal yok'}\n${s.honeypot.hits} tetikleme` : 'Kapalı', inline: true },
          { name: 'Reklam', value: `Skor ≥ 3 · ${AD_ACTIONS.find((a) => a.key === cfg.ad.action)?.label || cfg.ad.action}\n${(cfg.ad.trustedDomains || []).length} güvenilir alan adı`, inline: true },
          { name: 'İstatistik', value: `${stat.blocked || 0} müdahale\n${stat.deleted || 0} mesaj silindi\n${stat.ads || 0} reklam`, inline: true },
          { name: 'Limitler', value: limitLines(cfg) }
        ],
        footer: 'Gerçek zamanlı koruma — ihlalde otomatik ceza uygulanır'
      })]
    });
    settings.log(guild.id, 'guard', `${interaction.user.tag} /guard durum çalıştırdı`);
    return true;
  }

  if (sub === 'aç' || sub === 'kapat') {
    const enabled = sub === 'aç';
    setEnabled(guild.id, enabled, interaction.user.tag);
    settings.log(guild.id, 'guard', `${interaction.user.tag} korumayı ${enabled ? 'açtı' : 'kapattı'}`);
    await reply({
      embeds: [embed({
        title: enabled ? 'Koruma açıldı' : 'Koruma kapatıldı',
        description: enabled
          ? `Guard ${MODULES.filter((m) => get(guild.id).modules[m.key]).length} modülle izlemeye başladı. İhlalde **${punishLabel(get(guild.id).punishment)}** uygulanır.`
          : 'İzleme ve otomatik müdahale durduruldu. Tekrar açmak için `/guard aç`.',
        color: enabled ? COLOR.ok : COLOR.warn
      })]
    });
    return true;
  }

  if (sub === 'modül') {
    const key = interaction.options.getString('modül');
    const enabled = interaction.options.getString('durum') === 'acik';
    const res = setModule(guild.id, key, enabled);
    if (!res.ok) {
      await reply({ embeds: [embed({ title: 'İşlem yapılamadı', description: res.error, color: COLOR.err })], ephemeral: true });
      return true;
    }
    settings.log(guild.id, 'guard', `${interaction.user.tag} ${res.label} modülünü ${enabled ? 'açtı' : 'kapattı'}`);
    await reply({ embeds: [embed({ title: `${res.label} ${enabled ? 'açıldı' : 'kapatıldı'}`, description: MODULE_BY_KEY[key].desc, color: enabled ? COLOR.ok : COLOR.warn })] });
    return true;
  }

  if (sub === 'limit') {
    const key = interaction.options.getString('işlem');
    const value = interaction.options.getInteger('sayı');
    const res = setLimit(guild.id, key, value);
    if (!res.ok) {
      await reply({ embeds: [embed({ title: 'İşlem yapılamadı', description: res.error, color: COLOR.err })], ephemeral: true });
      return true;
    }
    settings.log(guild.id, 'guard', `${interaction.user.tag} ${res.label} limitini ${res.limit} yaptı`);
    await reply({ embeds: [embed({ title: 'Limit güncellendi', description: `\`${res.label}\` artık ${cfg.windowSeconds} saniyede en fazla **${res.limit}** işlem.`, color: COLOR.ok })] });
    return true;
  }

  if (sub === 'oran') {
    const key = interaction.options.getString('işlem');
    const value = interaction.options.getInteger('oran');
    const res = setRatio(guild.id, key, value);
    if (!res.ok) {
      await reply({ embeds: [embed({ title: 'İşlem yapılamadı', description: res.error, color: COLOR.err })], ephemeral: true });
      return true;
    }
    settings.log(guild.id, 'guard', `${interaction.user.tag} ${res.label} oranını 1/${res.ratio} yaptı`);
    await reply({ embeds: [embed({ title: 'Oran güncellendi', description: res.ratio === 0 ? `\`${res.label}\` için oran kapatıldı (yalnızca sabit limit).` : `\`${res.label}\` için oran **1/${res.ratio}** — sunucu büyüklüğüne göre otomatik eşik.`, color: COLOR.ok })] });
    return true;
  }

  if (sub === 'pencere') {
    const seconds = interaction.options.getInteger('saniye');
    update(guild.id, { windowSeconds: seconds });
    settings.log(guild.id, 'guard', `${interaction.user.tag} limit penceresini ${seconds} sn yaptı`);
    await reply({ embeds: [embed({ title: 'Sayım penceresi güncellendi', description: `Limitler artık **${seconds} saniye** içinde sayılıyor.`, color: COLOR.ok })] });
    return true;
  }

  if (sub === 'ceza') {
    const type = interaction.options.getString('tür');
    update(guild.id, { punishment: type });
    settings.log(guild.id, 'guard', `${interaction.user.tag} cezayı ${punishLabel(type)} yaptı`);
    await reply({ embeds: [embed({ title: 'Ceza güncellendi', description: `Sınır aşımında: **${punishLabel(type)}**.\nBu ceza gerçekten uygulanır.`, color: COLOR.ok })] });
    return true;
  }

  if (sub === 'süre') {
    const minutes = interaction.options.getInteger('dakika');
    update(guild.id, { timeoutMinutes: minutes });
    settings.log(guild.id, 'guard', `${interaction.user.tag} timeout süresini ${minutes} dk yaptı`);
    await reply({ embeds: [embed({ title: 'Timeout süresi güncellendi', description: `Zaman aşımı cezası **${minutes} dakika** olarak uygulanacak.`, color: COLOR.ok })] });
    return true;
  }

  if (sub === 'kanal') {
    const channel = interaction.options.getChannel('kanal');
    update(guild.id, { logChannelId: channel.id });
    settings.log(guild.id, 'guard', `${interaction.user.tag} guard kanalını #${channel.name} yaptı`);
    await reply({ embeds: [embed({ title: 'Guard kanalı ayarlandı', description: `Koruma kayıtları <#${channel.id}> kanalına yazılacak.`, color: COLOR.ok })] });
    return true;
  }

  if (sub === 'güvenli') {
    const op = interaction.options.getString('işlem');
    const user = interaction.options.getUser('kullanıcı');
    if (op === 'liste') {
      const list = cfg.whitelist.length ? cfg.whitelist.map((id) => `<@${id}> \`${id}\``).join('\n') : 'Güvenli liste boş.';
      await reply({ embeds: [embed({ title: 'Güvenli liste', description: list, color: COLOR.main })] });
      return true;
    }
    if (!user) {
      await reply({ embeds: [embed({ title: 'Kullanıcı gerekli', description: 'Ekleme/çıkarma için bir kullanıcı seç.', color: COLOR.err })], ephemeral: true });
      return true;
    }
    const res = op === 'ekle' ? addWhitelist(guild.id, user.id) : removeWhitelist(guild.id, user.id);
    if (!res.ok) {
      await reply({ embeds: [embed({ title: 'İşlem yapılamadı', description: res.error, color: COLOR.err })], ephemeral: true });
      return true;
    }
    settings.log(guild.id, 'guard', `${interaction.user.tag} güvenli listeye ${user.tag} ${op === 'ekle' ? 'ekledi' : 'çıkardı'}`);
    await reply({ embeds: [embed({ title: op === 'ekle' ? 'Güvenli listeye eklendi' : 'Güvenli listeden çıkarıldı', description: `${user.tag} \`${user.id}\`\nListede ${res.whitelist.length} kullanıcı var.`, color: COLOR.ok })] });
    return true;
  }

  if (sub === 'honeypot') {
    const op = interaction.options.getString('işlem');
    const action = interaction.options.getString('ceza');
    if (action && HONEYPOT_ACTIONS.some((a) => a.key === action)) {
      update(guild.id, { honeypot: { ...get(guild.id).honeypot, action } });
    }
    if (op === 'kur') {
      await interaction.deferReply();
      const res = await createHoneypotChannel(guild);
      if (!res.ok) {
        await reply({ embeds: [embed({ title: 'Honeypot kurulamadı', description: res.error, color: COLOR.err })] });
        return true;
      }
      settings.log(guild.id, 'guard', `${interaction.user.tag} honeypot kanalı kurdu`);
      await reply({
        embeds: [embed({
          title: '🍯 Honeypot kuruldu',
          description: `${res.existing ? 'Mevcut tuzak kanal kullanılıyor' : 'Yeni tuzak kanal oluşturuldu'}: <#${res.channelId}>\nTuzak: ${HONEYPOT_ACTIONS.find((a) => a.key === get(guild.id).honeypot.action)?.label || 'timeout'}\n\n**Kimseye söylemeyin.** Buraya yazan herkes otomatik cezalandırılır.`,
          color: COLOR.err
        })]
      });
      return true;
    }
    if (op === 'rol') {
      await interaction.deferReply();
      const res = await createHoneypotRole(guild);
      if (!res.ok) {
        await reply({ embeds: [embed({ title: 'Tuzak rol kurulamadı', description: res.error, color: COLOR.err })] });
        return true;
      }
      await reply({ embeds: [embed({ title: '🍯 Tuzak rol kuruldu', description: `@${guild.roles.cache.get(res.roleId)?.name || res.roleId} artık tuzak. Bu rolü mention’layan cezalandırılır.`, color: COLOR.err })] });
      return true;
    }
    if (op === 'kaldir') {
      honeypotDisable(guild.id);
      await reply({ embeds: [embed({ title: 'Honeypot kapatıldı', description: 'Tuzak kanal/rol devre dışı.', color: COLOR.warn })] });
      return true;
    }
    const h = get(guild.id).honeypot;
    await reply({
      embeds: [embed({
        title: '🍯 Honeypot durumu',
        description: h.enabled ? 'Aktif' : 'Kapalı',
        color: h.enabled ? COLOR.ok : COLOR.warn,
        fields: [
          { name: 'Kanal', value: h.channelId ? `<#${h.channelId}>` : 'Kurulmadı', inline: true },
          { name: 'Rol', value: h.roleId ? `<@&${h.roleId}>` : 'Kurulmadı', inline: true },
          { name: 'Ceza', value: HONEYPOT_ACTIONS.find((a) => a.key === h.action)?.label || h.action, inline: true },
          { name: 'Tetikleme', value: `${h.hits || 0} kez${h.lastAt ? `\nSon: <t:${Math.floor(h.lastAt / 1000)}:R>` : ''}`, inline: true }
        ]
      })]
    });
    return true;
  }

  if (sub === 'reklam') {
    const op = interaction.options.getString('işlem');
    const value = interaction.options.getString('değer');
    const current = get(guild.id);
    if (op === 'sil' || op === 'timeout' || op === 'kick' || op === 'ban') {
      update(guild.id, { ad: { ...current.ad, action: op } });
      await reply({ embeds: [embed({ title: 'Reklam cezası güncellendi', description: `Reklam tespitinde: **${AD_ACTIONS.find((a) => a.key === op)?.label}**`, color: COLOR.ok })] });
      return true;
    }
    if (op === 'davet-ac' || op === 'davet-kapat') {
      update(guild.id, { ad: { ...current.ad, allowInvites: op === 'davet-ac' } });
      await reply({ embeds: [embed({ title: 'Davet kuralı güncellendi', description: op === 'davet-ac' ? 'Davet linkleri artık serbest.' : 'Davet linkleri reklam sayılıp silinecek.', color: COLOR.ok })] });
      return true;
    }
    if (op === 'liste') {
      const list = (current.ad.trustedDomains || []).length ? current.ad.trustedDomains.join('\n') : 'Güvenilir alan adı yok.';
      await reply({ embeds: [embed({ title: 'Güvenilir alan adları', description: list, color: COLOR.main })] });
      return true;
    }
    if (!value) {
      await reply({ embeds: [embed({ title: 'Alan adı gerekli', description: 'Örnek: `/guard reklam işlem:ekle değer:youtube.com`', color: COLOR.err })], ephemeral: true });
      return true;
    }
    const domain = String(value).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    if (!/^[a-z0-9.-]{3,80}$/.test(domain)) {
      await reply({ embeds: [embed({ title: 'Geçersiz alan adı', description: 'Örnek: `youtube.com`', color: COLOR.err })], ephemeral: true });
      return true;
    }
    const list = new Set(current.ad.trustedDomains || []);
    if (op === 'ekle') list.add(domain);
    else list.delete(domain);
    update(guild.id, { ad: { ...current.ad, trustedDomains: [...list] } });
    await reply({ embeds: [embed({ title: op === 'ekle' ? 'Alan adı eklendi' : 'Alan adı çıkarıldı', description: `\`${domain}\`\nToplam ${list.size} güvenilir alan adı.`, color: COLOR.ok })] });
    return true;
  }

  if (sub === 'simülasyon') {
    const text = interaction.options.getString('metin');
    const analysis = analyzeAd(text, cfg);
    await reply({
      embeds: [embed({
        title: analysis.confident ? '🚫 Reklam sayılır' : '✅ Temiz görünüyor',
        description: `**Skor:** ${analysis.score} / 3 gerekli\n${analysis.reasons.length ? analysis.reasons.map((r) => `• ${r}`).join('\n') : 'Reklam sinyali yok.'}`,
        color: analysis.confident ? COLOR.err : COLOR.ok,
        footer: `Bağlantılar: ${analysis.links.length ? analysis.links.slice(0, 3).join(', ') : 'yok'}`
      })]
    });
    return true;
  }

  if (sub === 'olaylar') {
    const list = events(guild.id, 8);
    const description = list.length
      ? list.map((e) => `**${e.title}** — ${new Date(e.at).toLocaleTimeString('tr-TR')}${e.actor?.name ? ` · ${e.actor.name}` : ''}${e.detail ? `\n${e.detail}` : ''}`).join('\n\n')
      : 'Henüz guard kaydı yok.';
    await reply({ embeds: [embed({ title: 'Son guard kayıtları', description, color: COLOR.main, footer: `${events(guild.id).length} kayıt saklanıyor` })] });
    return true;
  }

  if (sub === 'yedek') {
    await interaction.deferReply();
    const res = takeBackup(guild);
    settings.log(guild.id, 'guard', `${interaction.user.tag} yedek aldı (${res.roles} rol, ${res.channels} kanal)`);
    await reply({ embeds: [embed({ title: 'Yedek alındı', description: `**${res.roles} rol** ve **${res.channels} kanal** kaydedildi.\nTarih: ${new Date(res.at).toLocaleString('tr-TR')}`, color: COLOR.ok })] });
    return true;
  }

  if (sub === 'geri-yükle') {
    await interaction.deferReply();
    const res = await restoreBackup(guild, { limiter: 80 });
    if (!res.ok) {
      await reply({ embeds: [embed({ title: 'Geri yüklenemedi', description: res.error, color: COLOR.err })] });
      return true;
    }
    settings.log(guild.id, 'guard', `${interaction.user.tag} yedekten geri yükledi (${res.roles} rol, ${res.channels} kanal)`);
    await reply({
      embeds: [embed({
        title: 'Yedek geri yüklendi',
        description: `**${res.roles} rol**, **${res.channels} kanal** yeniden oluşturuldu.${res.failed.length ? `\n\n${res.failed.length} hata:\n${res.failed.slice(0, 5).join('\n')}` : ''}`,
        color: res.roles + res.channels ? COLOR.ok : COLOR.warn
      })]
    });
    return true;
  }

  if (sub === 'panik') {
    await interaction.deferReply();
    const res = await panic(guild, interaction.user.tag);
    if (!res.ok) {
      await reply({ embeds: [embed({ title: 'Panik modu çalıştırılamadı', description: res.error, color: COLOR.err })] });
      return true;
    }
    settings.log(guild.id, 'guard', `${interaction.user.tag} panik modu çalıştırdı`);
    await reply({
      embeds: [embed({
        title: '🚨 Panik modu tamamlandı',
        description: `${res.members} üyeden ${res.roles} yetkili rol alındı.\n${res.invites} davet silindi.`,
        color: COLOR.err,
        footer: 'Yetkileri geri vermek için rolleri elle ataman gerekir.'
      })]
    });
    return true;
  }

  if (sub === 'test') {
    const ev = runTest(guild, interaction.user.tag);
    settings.log(guild.id, 'guard', `${interaction.user.tag} guard testi çalıştırdı`);
    await reply({
      embeds: [embed({
        title: 'Guard testi tamamlandı',
        description: `Örnek kayıt üretildi ve ${cfg.logChannelId ? `<#${cfg.logChannelId}> kanalına yazıldı` : 'olay akışına eklendi'}.\n\n**${ev.title}**\n${ev.detail}\nSayaç: ${ev.count} işlem / sınır ${ev.limit}\n\nGerçek bir işlem yapılmadı, ceza uygulanmadı.`,
        color: COLOR.main
      })]
    });
    return true;
  }

  return true;
}

/* ================================================================== BAŞLAT */
function start(client) {
  if (!client) return null;
  const { Events } = require('discord.js');

  client.on(Events.GuildAuditLogEntryCreate, (entry, guild) => { onAuditEntry(entry, guild).catch(() => {}); });
  client.on(Events.GuildMemberAdd, (member) => { try { onMemberAdd(member); } catch { /* yoksay */ } });

  if (client.options?.intents?.has(GatewayIntentBits.GuildMessages)) {
    client.on(Events.MessageCreate, (message) => { onMessage(message).catch(() => {}); });
  }

  // Periyodik güvenlik denetimi + raid kilidi geri alma (her 5 dakika).
  const timer = setInterval(() => {
    try {
      for (const guild of client.guilds?.cache?.values?.() || []) safetyAudit(guild).catch(() => {});
    } catch { /* yoksay */ }
  }, 5 * 60 * 1000);
  if (typeof timer.unref === 'function') timer.unref();

  // Honeypot/role tuzaklarını otomatik kurma: panelden veya komuttan yapılır.
  return client;
}

module.exports = {
  DEFAULT_GUARD,
  MODULES,
  LIMIT_ACTIONS,
  PUNISHMENTS,
  HONEYPOT_ACTIONS,
  AD_ACTIONS,
  BOT_ACTIONS,
  RAID_ACTIONS,
  NEW_ACCOUNT_ACTIONS,
  get,
  update,
  setConfig,
  setEnabled,
  setModule,
  setLimit,
  setRatio,
  addWhitelist,
  removeWhitelist,
  isWhitelisted,
  events,
  pushEvent,
  clearEvents,
  summary,
  takeBackup,
  restoreBackup,
  runTest,
  DEFAULT_POLICY,
  STATUS_LABEL,
  policy,
  savePolicy,
  isAllowed,
  isBlocked,
  isOperational,
  guildStatus,
  setSilent,
  approveGuild,
  revokeGuild,
  setAutoBlock,
  setNote,
  syncGuild,
  syncAll,
  adminSummary,
  guildStates,
  policyStats,
  pushOps,
  ops,
  clearOps,
  registerAction,
  registerDestructive,
  recordViolation,
  recordInfo,
  start,
  isSelfActor,
  isSelfMessage,
  analyzeAd,
  normalizeText,
  extractLinks,
  createHoneypotChannel,
  createHoneypotRole,
  honeypotDisable,
  honeypotOffense,
  panic,
  enforce,
  safetyAudit,
  daySeries,
  PRESETS,
  applyPreset,
  guardSlashCommands,
  handleGuardInteraction,
  AUDIT_MAP
};
