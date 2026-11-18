/**
 * GUARD (sunucu koruması) — gösterim sürümü.
 *
 * Neler gerçek:
 *  - Yapılandırma (koruma açık/kapalı, modüller, limitler, ceza kuralı, guard
 *    kanalı, güvenli liste, yedek) veritabanında saklanır ve komutlarla/panelden
 *    değiştirilir.
 *  - İzleme gerçek Discord olaylarından beslenir (denetim kaydı, üye katılımı,
 *    mesaj akışı); sınır aşımı ve şüpheli hareketler guard kanalına yazılır ve
 *    olay akışında listelenir.
 *  - Yedek, sunucudaki rol/kanal listesinin gerçek bir anlık görüntüsüdür.
 *
 * Neler gösterim (simulation):
 *  - Sınır aşımında OTOMATİK CEZA UYGULANMAZ. Yapılandırılmış ceza bir kural
 *    olarak gösterilir, ihlal kayda geçer. Yani guard burada "kayıt + uyarı"
 *    katmanıdır; yetkisiz bir işlem gerçekten engellenmez/cezalandırılmaz.
 */
const { SlashCommandBuilder, EmbedBuilder, AuditLogEvent, GatewayIntentBits } = require('discord.js');
const { db, save } = require('./store');
const settings = require('./settings');

const COLOR = { main: 0x5865f2, ok: 0x2ecc71, err: 0xed4245, warn: 0xfaa61a };

/** Koruma modülleri — panelde ve /guard modül komutunda listelenir. */
const MODULES = [
  { key: 'antiNuke', label: 'Anti-Nuke', desc: 'Toplu kanal/rol silme ve yetkisiz yönetici işlemleri izlenir.' },
  { key: 'antiRaid', label: 'Anti-Raid', desc: 'Kısa sürede çok sayıda katılım ve toplu üye atma izlenir.' },
  { key: 'channelGuard', label: 'Kanal Koruması', desc: 'Kanal oluşturma ve silme işlemleri sınırla izlenir.' },
  { key: 'roleGuard', label: 'Rol Koruması', desc: 'Rol oluşturma, silme ve yetki değişikliği izlenir.' },
  { key: 'webhookGuard', label: 'Webhook Koruması', desc: 'Yetkisiz webhook oluşturma ve webhook hareketleri izlenir.' },
  { key: 'botGuard', label: 'Bot Koruması', desc: 'Güvenli listede olmayan botların eklenmesi izlenir.' },
  { key: 'urlGuard', label: 'Reklam Koruması', desc: 'Davet linki ve reklam içerikli mesajlar izlenir.' },
  { key: 'spamGuard', label: 'Spam Koruması', desc: 'Aynı mesajın tekrarı ve hızlı mesaj akışı izlenir.' }
];

/** İzlenen işlemler ve varsayılan limitleri (pencere: windowSeconds). */
const LIMIT_ACTIONS = [
  { key: 'ban', label: 'Yasaklama', def: 3, module: 'antiNuke' },
  { key: 'kick', label: 'Atma', def: 3, module: 'antiNuke' },
  { key: 'memberPrune', label: 'Toplu üye atma', def: 1, module: 'antiRaid' },
  { key: 'channelDelete', label: 'Kanal silme', def: 2, module: 'channelGuard' },
  { key: 'channelCreate', label: 'Kanal oluşturma', def: 3, module: 'channelGuard' },
  { key: 'roleDelete', label: 'Rol silme', def: 2, module: 'roleGuard' },
  { key: 'roleCreate', label: 'Rol oluşturma', def: 3, module: 'roleGuard' },
  { key: 'webhook', label: 'Webhook oluşturma', def: 3, module: 'webhookGuard' },
  { key: 'botAdd', label: 'Bot ekleme', def: 1, module: 'botGuard' }
];

const PUNISHMENTS = [
  { key: 'ban', label: 'Yasakla' },
  { key: 'kick', label: 'Sunucudan at' },
  { key: 'roles', label: 'Rollerini al' }
];

const DEFAULT_GUARD = {
  enabled: false,
  simulation: true,
  logChannelId: null,
  punishment: 'ban',
  windowSeconds: 60,
  whitelist: [],
  jailRoleId: null,
  modules: Object.fromEntries(MODULES.map((m) => [m.key, m.key !== 'spamGuard'])),
  limits: Object.fromEntries(LIMIT_ACTIONS.map((a) => [a.key, a.def])),
  backup: null,
  enabledAt: null
};

const ACTION_BY_KEY = Object.fromEntries(LIMIT_ACTIONS.map((a) => [a.key, a]));
const MODULE_BY_KEY = Object.fromEntries(MODULES.map((m) => [m.key, m]));
const MAX_EVENTS = 80;

/* ------------------------------------------------------------------ YAPILANDIRMA */
function get(guildId) {
  const key = String(guildId);
  if (!db.guard[key]) {
    db.guard[key] = JSON.parse(JSON.stringify(DEFAULT_GUARD));
    save();
  }
  const stored = db.guard[key];
  return {
    ...JSON.parse(JSON.stringify(DEFAULT_GUARD)),
    ...stored,
    modules: { ...DEFAULT_GUARD.modules, ...(stored.modules || {}) },
    limits: { ...DEFAULT_GUARD.limits, ...(stored.limits || {}) },
    whitelist: Array.isArray(stored.whitelist) ? stored.whitelist : []
  };
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
  if (patch.whitelist) next.whitelist = [...new Set(patch.whitelist.map(String))];
  return write(guildId, next);
}

function setEnabled(guildId, enabled, actorName = null) {
  const cfg = update(guildId, { enabled: Boolean(enabled), enabledAt: enabled ? Date.now() : null });
  pushEvent(guildId, {
    type: 'action',
    severity: 'low',
    title: enabled ? 'Koruma açıldı' : 'Koruma kapatıldı',
    detail: actorName ? `İşlemi yapan: ${actorName}` : 'Panel üzerinden değiştirildi',
    module: null
  });
  return cfg;
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
  return { ok: true, action: key, label: action.label, limit: n };
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

/* ------------------------------------------------------------------ OLAY AKIŞI */
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
    limit: event.limit ?? null
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

/* ------------------------------------------------------------------ SAYAÇLAR */
/* guildId:actorId:action -> [zaman damgaları]. Pencere dışına çıkanlar atılır. */
const counters = new Map();
const lastNotified = new Map();

function counterKey(guildId, actorId, action) {
  return `${guildId}:${actorId}:${action}`;
}

/**
 * Bir işlemi sayar ve sınır aşımını bildirir.
 * Dönen: { count, limit, violated }
 */
function registerAction(guildId, { actorId, action, now = Date.now() }) {
  const cfg = get(guildId);
  const limit = cfg.limits[action] ?? ACTION_BY_KEY[action]?.def ?? 3;
  const windowMs = Math.max(5, Number(cfg.windowSeconds) || 60) * 1000;
  const key = counterKey(guildId, actorId, action);
  const stamps = (counters.get(key) || []).filter((t) => now - t <= windowMs);
  stamps.push(now);
  counters.set(key, stamps);
  return { count: stamps.length, limit, violated: stamps.length > limit };
}

/** Aynı kullanıcı + aynı olay türü için 30 sn içinde tekrar bildirim gönderme. */
function shouldNotify(guildId, actorId, kind) {
  const key = `${guildId}:${actorId}:${kind}`;
  const last = lastNotified.get(key) || 0;
  if (Date.now() - last < 30000) return false;
  lastNotified.set(key, Date.now());
  return true;
}

/* ------------------------------------------------------------------ ÖZET / YEDEK */
function summary(guildId, guild = null) {
  const cfg = get(guildId);
  const list = events(guildId, 50);
  const activeModules = MODULES.filter((m) => cfg.modules[m.key]);
  return {
    enabled: cfg.enabled,
    simulation: cfg.simulation !== false,
    punishment: cfg.punishment,
    punishmentLabel: PUNISHMENTS.find((p) => p.key === cfg.punishment)?.label || cfg.punishment,
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
    violations24h: list.filter((e) => e.type === 'violation' && Date.now() - e.at < 86400000).length,
    backup: cfg.backup ? { at: cfg.backup.at, roles: cfg.backup.roles.length, channels: cfg.backup.channels.length } : null
  };
}

/** Rol + kanal listesinin anlık görüntüsü (gerçek veri, geri yükleme yapmaz). */
function takeBackup(guild) {
  const roles = [...guild.roles.cache.values()]
    .filter((r) => !r.managed && r.id !== guild.id)
    .slice(0, 200)
    .map((r) => ({ id: r.id, name: r.name, color: String(r.color || 0), position: r.position, permissions: String(r.permissions?.bitfield ?? '0') }));
  const channels = [...guild.channels.cache.values()]
    .slice(0, 300)
    .map((c) => ({ id: c.id, name: c.name, type: c.type, parentId: c.parentId || null, position: c.position, topic: c.topic || null }));
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
 * Guard'ı gösterim amaçlı test eder: örnek bir ihlal kaydı üretir ve guard
 * kanalına yazar. Gerçek bir işlem yapılmaz, ceza uygulanmaz.
 */
function runTest(guild, actorName = null) {
  const cfg = get(guild.id);
  const ev = pushEvent(guild.id, {
    type: 'violation',
    severity: 'medium',
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

/* ------------------------------------------------------------------ BİLDİRİM */
function guardEmbed(cfg, ev) {
  const color = ev.severity === 'high' ? COLOR.err : ev.severity === 'medium' ? COLOR.warn : COLOR.main;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: 'LORES Guard' })
    .setTitle(ev.title)
    .setDescription(ev.detail || null)
    .setTimestamp();
  if (ev.actor?.name) embed.addFields({ name: 'Sorumlu', value: `${ev.actor.name}${ev.actor.id ? `\n\`${ev.actor.id}\`` : ''}`, inline: true });
  if (ev.module && MODULE_BY_KEY[ev.module]) embed.addFields({ name: 'Modül', value: MODULE_BY_KEY[ev.module].label, inline: true });
  if (ev.count != null && ev.limit != null) embed.addFields({ name: 'Sayaç', value: `${ev.count} işlem / ${cfg.windowSeconds} sn\nSınır: ${ev.limit}`, inline: true });
  embed.addFields({ name: 'Ceza kuralı', value: PUNISHMENTS.find((p) => p.key === cfg.punishment)?.label || cfg.punishment, inline: true });
  embed.setFooter({ text: 'LORES Guard · kayıt' });
  return embed;
}

function notify(guild, cfg, ev) {
  settings.log(guild.id, 'guard', `${ev.title}${ev.actor?.name ? ` — ${ev.actor.name}` : ''}${ev.detail ? ` (${ev.detail})` : ''}`);
  if (!cfg.logChannelId) return;
  const channel = guild.channels?.cache?.get(cfg.logChannelId);
  if (!channel || typeof channel.send !== 'function') return;
  channel.send({ embeds: [guardEmbed(cfg, ev)] }).catch(() => {});
}

/** İhlal: olay akışına yaz + guard kanalına bildir. */
function recordViolation(guild, { action, actor, detail, count, limit, severity = 'medium', target = null, label = null, module = null }) {
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
    limit
  });
  notify(guild, cfg, ev);
  return ev;
}

/** Bilgi olayı: yalnızca akışa yaz (guard kanalı seçilmişse oraya da). */
function recordInfo(guild, { title, detail, severity = 'low', module = null, actor = null }) {
  const cfg = get(guild.id);
  const ev = pushEvent(guild.id, { type: 'info', severity, title, detail, module, actor: actor ? { id: actor.id || null, name: actor.name || actor.tag } : null });
  if (cfg.logChannelId) notify(guild, cfg, ev);
  return ev;
}

/* ------------------------------------------------------------------ İZLEME */
const AUDIT_MAP = new Map([
  [AuditLogEvent.ChannelDelete, 'channelDelete'],
  [AuditLogEvent.ChannelCreate, 'channelCreate'],
  [AuditLogEvent.RoleDelete, 'roleDelete'],
  [AuditLogEvent.RoleCreate, 'roleCreate'],
  [AuditLogEvent.WebhookCreate, 'webhook'],
  [AuditLogEvent.WebhookDelete, 'webhook'],
  [AuditLogEvent.BotAdd, 'botAdd'],
  [AuditLogEvent.MemberBanAdd, 'ban'],
  [AuditLogEvent.MemberKick, 'kick'],
  [AuditLogEvent.MemberPrune, 'memberPrune']
]);

const INVITE_RE = /(discord\.(gg|io|me|li)|discordapp\.com\/invite|discord\.com\/invite)\/[A-Za-z0-9-]{2,}/i;
const joinStamps = new Map();   // guildId -> [zaman]
const messageStamps = new Map(); // guildId:userId -> [zaman]

function guardActive(guild) {
  const cfg = get(guild.id);
  return cfg.enabled && cfg;
}

/** Denetim kaydı olayı: kim, ne yaptı, sınırı aştı mı? */
async function onAuditEntry(entry, guild) {
  const cfg = guardActive(guild);
  if (!cfg) return;
  const action = AUDIT_MAP.get(entry.actionType);
  if (!action) return;
  const executorId = entry.executorId || entry.executor?.id;
  if (!executorId || executorId === guild.client?.user?.id) return;
  if (isWhitelisted(cfg, executorId)) return;

  const meta = ACTION_BY_KEY[action];
  if (meta && cfg.modules[meta.module] === false) return;

  const { count, limit, violated } = registerAction(guild.id, { actorId: executorId, action });
  const executorName = entry.executor?.tag || entry.executor?.username || executorId;
  const targetName = entry.target?.name || entry.target?.username || null;

  if (violated && shouldNotify(guild.id, executorId, action)) {
    recordViolation(guild, {
      action,
      actor: { id: executorId, name: executorName },
      detail: targetName ? `Hedef: ${targetName}` : `${meta ? meta.label : action} işlemleri`,
      count,
      limit,
      severity: count >= limit * 2 ? 'high' : 'medium'
    });
    return;
  }
  pushEvent(guild.id, {
    type: 'info',
    severity: 'low',
    title: `${meta ? meta.label : action} kaydedildi`,
    detail: [executorName, targetName].filter(Boolean).join(' · '),
    module: meta ? meta.module : null,
    action,
    actor: { id: executorId, name: executorName },
    count,
    limit
  });
}

/** Üye katılımı: yetkisiz bot ve toplu katılım (raid) izlemesi. */
function onMemberAdd(member) {
  const guild = member.guild;
  const cfg = guardActive(guild);
  if (!cfg) return;

  if (member.user?.bot && cfg.modules.botGuard !== false) {
    recordInfo(guild, {
      title: 'Sunucuya bot eklendi',
      detail: `${member.user.tag} · güvenli listede değilse bot koruması kaydına düşer`,
      severity: 'medium',
      module: 'botGuard',
      actor: { id: member.id, name: member.user.tag }
    });
  }

  if (cfg.modules.antiRaid === false) return;
  const now = Date.now();
  const stamps = (joinStamps.get(guild.id) || []).filter((t) => now - t <= 10000);
  stamps.push(now);
  joinStamps.set(guild.id, stamps);
  if (stamps.length >= 5 && shouldNotify(guild.id, 'raid', 'join')) {
    recordViolation(guild, {
      action: 'join',
      label: 'Toplu katılım',
      module: 'antiRaid',
      actor: { id: null, name: `${stamps.length} yeni katılım` },
      detail: '10 saniye içinde toplu katılım',
      count: stamps.length,
      limit: 5,
      severity: 'high'
    });
  }
}

/** Mesaj akışı: davet linki ve tekrar eden mesaj izlemesi. */
function onMessage(message) {
  if (!message.guild || message.author?.bot) return;
  const cfg = guardActive(message.guild);
  if (!cfg) return;
  if (isWhitelisted(cfg, message.author.id)) return;
  const content = message.content || '';
  if (!content) return;

  if (cfg.modules.urlGuard !== false && INVITE_RE.test(content)) {
    if (shouldNotify(message.guild.id, message.author.id, 'url')) {
      recordInfo(message.guild, {
        title: 'Davet linki görüldü',
        detail: `#${message.channel?.name || '?'} · ${content.slice(0, 120)}`,
        severity: 'medium',
        module: 'urlGuard',
        actor: { id: message.author.id, name: message.author.tag }
      });
    }
  }

  if (cfg.modules.spamGuard === false) return;
  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const stamps = (messageStamps.get(key) || []).filter((t) => now - t <= 10000);
  stamps.push(now);
  messageStamps.set(key, stamps);
  if (stamps.length >= 5 && shouldNotify(message.guild.id, message.author.id, 'spam')) {
    recordViolation(message.guild, {
      action: 'spam',
      label: 'Spam akışı',
      module: 'spamGuard',
      actor: { id: message.author.id, name: message.author.tag },
      detail: `#${message.channel?.name || '?'} · 10 saniyede ${stamps.length} mesaj`,
      count: stamps.length,
      limit: 5,
      severity: 'medium'
    });
  }
}

/** İstemci olaylarını bağlar. Guard kapalıyken hiçbir şey kaydedilmez. */
function start(client) {
  if (!client) return null;
  const { Events } = require('discord.js');
  client.on(Events.GuildAuditLogEntryCreate, (entry, guild) => { onAuditEntry(entry, guild).catch(() => {}); });
  client.on(Events.GuildMemberAdd, (member) => { try { onMemberAdd(member); } catch { /* yoksay */ } });
  if (client.options?.intents?.has(GatewayIntentBits.GuildMessages)) {
    client.on(Events.MessageCreate, (message) => { try { onMessage(message); } catch { /* yoksay */ } });
  }
  return client;
}

/* ------------------------------------------------------------------ SLASH KOMUTLARI */
function addOption(builder, kind, { name, description, required = false, choices = null, min = null, max = null }) {
  const method = { string: 'addStringOption', integer: 'addIntegerOption', user: 'addUserOption', channel: 'addChannelOption' }[kind];
  builder[method]((o) => {
    o.setName(name).setDescription(description);
    if (required) o.setRequired(true);
    if (choices) o.addChoices(...choices);
    if (min != null) o.setMinValue(min);
    if (max != null) o.setMaxValue(max);
    return o;
  });
  return builder;
}

function buildGuardCommand() {
  const cmd = new SlashCommandBuilder()
    .setName('guard')
    .setDescription('Sunucu korumasını yönetir ve guard kayıtlarını gösterir');

  cmd.addSubcommand((s) => s.setName('durum').setDescription('Koruma durumunu, modülleri ve limitleri gösterir'));
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
    s.setName('pencere').setDescription('Limit sayım penceresini saniye olarak belirler');
    addOption(s, 'integer', { name: 'saniye', description: 'Sayım penceresi (5-600 saniye)', required: true, min: 5, max: 600 });
    return s;
  });

  cmd.addSubcommand((s) => {
    s.setName('ceza').setDescription('Sınır aşımında uygulanacak ceza kuralını seçer');
    addOption(s, 'string', { name: 'tür', description: 'Ceza türü', required: true, choices: PUNISHMENTS.map((p) => ({ name: p.label, value: p.key })) });
    return s;
  });

  cmd.addSubcommand((s) => {
    s.setName('kanal').setDescription('Guard kayıtlarının yazılacağı kanalı belirler');
    addOption(s, 'channel', { name: 'kanal', description: 'Guard kanalı', required: true });
    return s;
  });

  cmd.addSubcommand((s) => {
    s.setName('güvenli').setDescription('Güvenli listeyi yönetir');
    addOption(s, 'string', { name: 'işlem', description: 'Ekle, çıkar veya listele', required: true, choices: [{ name: 'Ekle', value: 'ekle' }, { name: 'Çıkar', value: 'cikar' }, { name: 'Liste', value: 'liste' }] });
    addOption(s, 'user', { name: 'kullanıcı', description: 'Listeye eklenecek veya çıkarılacak kullanıcı' });
    return s;
  });

  cmd.addSubcommand((s) => s.setName('olaylar').setDescription('Son guard kayıtlarını gösterir'));
  cmd.addSubcommand((s) => s.setName('yedek').setDescription('Rol ve kanal listesinin yedeğini alır'));
  cmd.addSubcommand((s) => s.setName('test').setDescription('Örnek bir guard kaydı üretir (gerçek işlem yapmaz, ceza uygulamaz)'));

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
  return LIMIT_ACTIONS.map((a) => `\`${a.label}\` **${cfg.limits[a.key]}** / ${cfg.windowSeconds} sn`).join('\n');
}

async function handleGuardInteraction(interaction) {
  if (interaction.commandName !== 'guard') return false;
  const guild = interaction.guild;
  if (!guild) return true;
  const sub = interaction.options.getSubcommand();
  const member = interaction.member;
  const isAdminUser = member?.permissions?.has?.('Administrator') || member?.permissions?.has?.(8);

  if (!isAdminUser) {
    await interaction.reply({ embeds: [embed({ title: 'Yetki gerekli', description: 'Guard ayarlarını yalnızca **Yönetici** yetkisine sahip üyeler değiştirebilir.', color: COLOR.err })], ephemeral: true });
    return true;
  }

  const cfg = get(guild.id);
  const reply = (payload) => (interaction.deferred || interaction.replied ? interaction.editReply(payload) : interaction.reply(payload));

  if (sub === 'durum') {
    const s = summary(guild.id, guild);
    await reply({
      embeds: [embed({
        title: s.enabled ? 'Koruma aktif' : 'Koruma kapalı',
        description: s.enabled
          ? `Guard ${s.modulesActive}/${s.modulesTotal} modülle izliyor. İhlaller kayda geçer ve guard kanalına yazılır.`
          : 'Koruma kapalı. Açmak için `/guard aç`.',
        color: s.enabled ? COLOR.ok : COLOR.warn,
        fields: [
          { name: 'Modüller', value: MODULES.map((m) => `${cfg.modules[m.key] ? '●' : '○'} ${m.label}`).join('\n'), inline: true },
          { name: 'Ceza kuralı', value: `${s.punishmentLabel}\nPencere: ${cfg.windowSeconds} sn`, inline: true },
          { name: 'Guard kanalı', value: s.logChannelName ? `#${s.logChannelName}` : 'Seçilmedi', inline: true },
          { name: 'Güvenli liste', value: `${cfg.whitelist.length} kullanıcı`, inline: true },
          { name: 'Son 24 saat', value: `${s.violations24h} ihlal kaydı`, inline: true },
          { name: 'Yedek', value: s.backup ? `${s.backup.roles} rol, ${s.backup.channels} kanal` : 'Alınmadı', inline: true },
          { name: 'Limitler', value: limitLines(cfg) }
        ],
        footer: 'Kayıt ve uyarı modu — otomatik ceza uygulanmaz'
      })]
    });
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
          ? `Guard ${MODULES.filter((m) => cfg.modules[m.key]).length} modülle izlemeye başladı. Sınır aşımları ${cfg.logChannelId ? `<#${cfg.logChannelId}>` : 'guard kanalına (seçilmedi)'} yazılır.`
          : 'İzleme durduruldu. Tekrar açmak için `/guard aç`.',
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
    await reply({
      embeds: [embed({
        title: `${res.label} ${enabled ? 'açıldı' : 'kapatıldı'}`,
        description: MODULE_BY_KEY[key].desc,
        color: enabled ? COLOR.ok : COLOR.warn
      })]
    });
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
    settings.log(guild.id, 'guard', `${interaction.user.tag} ceza kuralını ${PUNISHMENTS.find((p) => p.key === type)?.label} yaptı`);
    await reply({ embeds: [embed({ title: 'Ceza kuralı güncellendi', description: `Sınır aşımında kural: **${PUNISHMENTS.find((p) => p.key === type)?.label}**.`, color: COLOR.ok, footer: 'Kayıt ve uyarı modu — otomatik ceza uygulanmaz' })] });
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
      const list = cfg.whitelist.length
        ? cfg.whitelist.map((id) => `<@${id}> \`${id}\``).join('\n')
        : 'Güvenli liste boş.';
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
    settings.log(guild.id, 'guard', `${interaction.user.tag} güvenli listeye ${user.tag} ${op === 'ekle' ? 'ekledi' : 'listeden çıkardı'}`);
    await reply({
      embeds: [embed({
        title: op === 'ekle' ? 'Güvenli listeye eklendi' : 'Güvenli listeden çıkarıldı',
        description: `${user.tag} \`${user.id}\`\nListede ${res.whitelist.length} kullanıcı var.`,
        color: COLOR.ok
      })]
    });
    return true;
  }

  if (sub === 'olaylar') {
    const list = events(guild.id, 8);
    const description = list.length
      ? list.map((e) => `**${e.title}** — ${new Date(e.at).toLocaleTimeString('tr-TR')}${e.actor?.name ? ` · ${e.actor.name}` : ''}${e.detail ? `
${e.detail}` : ''}`).join('\n\n')
      : 'Henüz guard kaydı yok.';
    await reply({ embeds: [embed({ title: 'Son guard kayıtları', description, color: COLOR.main, footer: `${events(guild.id).length} kayıt saklanıyor` })] });
    return true;
  }

  if (sub === 'yedek') {
    await interaction.deferReply();
    const res = takeBackup(guild);
    settings.log(guild.id, 'guard', `${interaction.user.tag} yedek aldı (${res.roles} rol, ${res.channels} kanal)`);
    await reply({
      embeds: [embed({
        title: 'Yedek alındı',
        description: `**${res.roles} rol** ve **${res.channels} kanal** kaydedildi.\nTarih: ${new Date(res.at).toLocaleString('tr-TR')}`,
        color: COLOR.ok,
        footer: 'Yedek, rol/kanal listesinin anlık görüntüsüdür'
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
        description: `Örnek kayıt üretildi ve ${cfg.logChannelId ? `<#${cfg.logChannelId}> kanalına yazıldı` : 'olay akışına eklendi (guard kanalı seçilmedi)'}.` +
          '\n\n' + `**${ev.title}**\n${ev.detail}\nSayaç: ${ev.count} işlem / sınır ${ev.limit}` +
          '\n\n' + 'Gerçek bir işlem yapılmadı, ceza uygulanmadı.',
        color: COLOR.main,
        footer: 'Kayıt ve uyarı modu — otomatik ceza uygulanmaz'
      })]
    });
    return true;
  }

  return true;
}

module.exports = {
  DEFAULT_GUARD,
  MODULES,
  LIMIT_ACTIONS,
  PUNISHMENTS,
  get,
  update,
  setEnabled,
  setModule,
  setLimit,
  addWhitelist,
  removeWhitelist,
  isWhitelisted,
  events,
  pushEvent,
  clearEvents,
  summary,
  takeBackup,
  runTest,
  registerAction,
  recordViolation,
  recordInfo,
  start,
  guardSlashCommands,
  handleGuardInteraction,
  AUDIT_MAP
};
