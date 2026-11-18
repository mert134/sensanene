/**
 * Sunucu ayarları (log kanalı, eğlence kanalı, hoş geldin mesajı, otomatik rol...).
 */
const { db, save } = require('./store');

const DEFAULT_SETTINGS = {
  logChannelId: null,
  welcomeChannelId: null,
  welcomeMessage: 'Sunucumuza hoş geldin {user}! 🎉',
  autoRoleId: null,
  entertainmentChannelId: null,
  prefix: '!'
};

function get(guildId) {
  if (!db.settings[guildId]) {
    db.settings[guildId] = { ...DEFAULT_SETTINGS };
    save();
  }
  return { ...DEFAULT_SETTINGS, ...db.settings[guildId] };
}

function update(guildId, patch) {
  const current = get(guildId);
  db.settings[guildId] = { ...current, ...patch };
  save();
  return db.settings[guildId];
}

const LOG_TYPES = {
  ban: '🔨 Yasaklama',
  unban: '🔓 Yasak Kaldırma',
  kick: '👢 Atma',
  mute: '🔇 Susturma',
  unmute: '🔊 Susturma Kaldırma',
  warn: '⚠️ Uyarı',
  channel: '📁 Kanal İşlemi',
  role: '🎭 Rol İşlemi',
  site: '🖥️ Panel İşlemi',
  bot: '🤖 Bot',
  guard: '🛡️ Guard'
};

function log(guildId, type, text, actor = null) {
  if (!db.logs[guildId]) db.logs[guildId] = [];
  db.logs[guildId].unshift({
    type,
    text,
    actor,
    at: Date.now()
  });
  db.logs[guildId] = db.logs[guildId].slice(0, 200);
  save();
}

module.exports = { DEFAULT_SETTINGS, get, update, log, LOG_TYPES };
