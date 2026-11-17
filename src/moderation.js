/**
 * Moderasyon işlemlerinin tek merkezi. Hem Discord komutları hem web panel buradan geçer,
 * böylece "yetki yettiği kadar" kuralı her yerde aynı şekilde uygulanır.
 *
 * Her fonksiyon: { ok: true, ... } veya { ok: false, error: '...' } döndürür.
 */
const { PermissionsBitField, ChannelType } = require('discord.js');

const MUTE_ROLE_NAME = 'Susturulmuş';
const DEFAULT_MUTE_MS = 10 * 60 * 1000;
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000; // Discord üst sınırı
const MUTE_LIMIT_MS = 1000 * 60 * 60 * 23;       // rol tabanlı susturmada pratik sınır

function isAdmin(member) {
  return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

/** Aktör hedefe göre yetkili mi? (rol sırası + Discord kuralları) */
function canActOn(guild, actor, target) {
  if (actor.id === target.id) return 'Kendine bu işlemi uygulayamazsın.';
  if (target.id === guild.ownerId) return 'Sunucu sahibine işlem uygulanamaz.';
  const targetTop = target.roles.highest.position;
  if (!actor.panelFounder && actor.id !== guild.ownerId) {
    const actorTop = actor.roles.highest.position;
    if (targetTop >= actorTop) return 'Bu üyenin rolü seninkinden yüksek veya eşit.';
  }
  if (targetTop >= guild.members.me.roles.highest.position) {
    return 'Bu üyenin rolü botun rolünden yüksek. Bot rolünü yukarı taşı.';
  }
  return null;
}

function requirePerm(actor, flag, label) {
  if (!actor.permissions.has(flag)) return `${label} yetkin yok.`;
  return null;
}

async function fetchMember(guild, userId) {
  try {
    return await guild.members.fetch(userId);
  } catch {
    return null;
  }
}

async function sendDM(user, text) {
  try {
    await user.send(text);
  } catch {
    /* DM kapalı olabilir */
  }
}

// ---------------------------------------------------------------- BAN
async function ban(guild, actor, userId, reason = '', deleteSeconds = 0) {
  const err = requirePerm(actor, PermissionsBitField.Flags.BanMembers, 'Üye yasaklama');
  if (err) return { ok: false, error: err };
  const member = await fetchMember(guild, userId);
  if (member) {
    const blocked = canActOn(guild, actor, member);
    if (blocked) return { ok: false, error: blocked };
  }
  if (!guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
    return { ok: false, error: 'Botun "Üyeleri Yasakla" yetkisi yok.' };
  }
  try {
    await guild.bans.create(userId, {
      reason: `${actor.user.tag}: ${reason || 'Sebep belirtilmedi'}`,
      deleteMessageSeconds: deleteSeconds
    });
    if (member) await sendDM(member.user, `${guild.name} sunucusundan yasaklandın. Sebep: ${reason || 'belirtilmedi'}`);
    return { ok: true, message: `<@${userId}> yasaklandı.` };
  } catch (e) {
    return { ok: false, error: `Yasaklanamadı: ${e.message}` };
  }
}

async function unban(guild, actor, userId, reason = '') {
  const err = requirePerm(actor, PermissionsBitField.Flags.BanMembers, 'Yasak kaldırma');
  if (err) return { ok: false, error: err };
  try {
    await guild.bans.remove(userId, `${actor.user.tag}: ${reason}`);
    return { ok: true, message: `<@${userId}> yasağı kaldırıldı.` };
  } catch (e) {
    return { ok: false, error: `Yasak kaldırılamadı: ${e.message}` };
  }
}

// ---------------------------------------------------------------- KICK
async function kick(guild, actor, userId, reason = '') {
  const err = requirePerm(actor, PermissionsBitField.Flags.KickMembers, 'Üye atma');
  if (err) return { ok: false, error: err };
  const member = await fetchMember(guild, userId);
  if (!member) return { ok: false, error: 'Üye sunucuda bulunamadı.' };
  const blocked = canActOn(guild, actor, member);
  if (blocked) return { ok: false, error: blocked };
  if (!guild.members.me.permissions.has(PermissionsBitField.Flags.KickMembers)) {
    return { ok: false, error: 'Botun "Üyeleri At" yetkisi yok.' };
  }
  try {
    await sendDM(member.user, `${guild.name} sunucusundan atıldın. Sebep: ${reason || 'belirtilmedi'}`);
    await member.kick(`${actor.user.tag}: ${reason || 'sebep belirtilmedi'}`);
    return { ok: true, message: `<@${userId}> sunucudan atıldı.` };
  } catch (e) {
    return { ok: false, error: `Atılamadı: ${e.message}` };
  }
}

// ---------------------------------------------------------------- MUTE
async function getOrCreateMuteRole(guild) {
  let role = guild.roles.cache.find((r) => r.name === MUTE_ROLE_NAME && !r.managed);
  if (role) return role;
  if (!guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    throw new Error('Botun "Rolleri Yönet" yetkisi yok.');
  }
  role = await guild.roles.create({
    name: MUTE_ROLE_NAME,
    color: 0x95a5a6,
    reason: 'Susturma rolü otomatik oluşturuldu'
  });
  for (const [, channel] of guild.channels.cache) {
    try {
      if (channel.isTextBased()) {
        await channel.permissionOverwrites.edit(role, {
          SendMessages: false,
          AddReactions: false,
          Speak: false
        });
      } else if (channel.isVoiceBased()) {
        await channel.permissionOverwrites.edit(role, { Speak: false });
      }
    } catch {
      /* yetki yoksa geç */
    }
  }
  return role;
}

async function mute(guild, actor, userId, durationMs = DEFAULT_MUTE_MS, reason = '') {
  const err = requirePerm(actor, PermissionsBitField.Flags.ModerateMembers, 'Susturma');
  if (err) return { ok: false, error: err };
  const member = await fetchMember(guild, userId);
  if (!member) return { ok: false, error: 'Üye sunucuda bulunamadı.' };
  const blocked = canActOn(guild, actor, member);
  if (blocked) return { ok: false, error: blocked };

  const safeDuration = Math.min(Math.max(Number(durationMs) || DEFAULT_MUTE_MS, 1000), MAX_TIMEOUT_MS);
  const until = new Date(Date.now() + safeDuration);

  // Discord'un yerleşik timeout'u (28 güne kadar)
  if (member.moderatable) {
    try {
      await member.timeout(safeDuration, `${actor.user.tag}: ${reason || 'susturma'}`);
      return {
        ok: true,
        mode: 'timeout',
        until: until.toISOString(),
        message: `<@${userId}> ${humanDuration(safeDuration)} susturuldu (timeout).`
      };
    } catch {
      /* timeout olmazsa rol yöntemine düş */
    }
  }

  // Rol tabanlı susturma (kalıcı)
  try {
    const role = await getOrCreateMuteRole(guild);
    await member.roles.add(role, `${actor.user.tag}: ${reason || 'susturma'}`);
    return {
      ok: true,
      mode: 'role',
      until: null,
      message: `<@${userId}> "${MUTE_ROLE_NAME}" rolü ile susturuldu (kalıcı, panelden kaldırılabilir).`
    };
  } catch (e) {
    return { ok: false, error: `Susturulamadı: ${e.message}` };
  }
}

async function unmute(guild, actor, userId, reason = '') {
  const err = requirePerm(actor, PermissionsBitField.Flags.ModerateMembers, 'Susturma kaldırma');
  if (err) return { ok: false, error: err };
  const member = await fetchMember(guild, userId);
  if (!member) return { ok: false, error: 'Üye sunucuda bulunamadı.' };
  let done = false;
  try {
    if (member.communicationDisabledUntil) {
      await member.timeout(null, `${actor.user.tag}: ${reason || 'susturma kaldırma'}`);
      done = true;
    }
  } catch { /* geç */ }
  const role = guild.roles.cache.find((r) => r.name === MUTE_ROLE_NAME && !r.managed);
  if (role && member.roles.cache.has(role.id)) {
    try {
      await member.roles.remove(role, `${actor.user.tag}: ${reason || 'susturma kaldırma'}`);
      done = true;
    } catch { /* geç */ }
  }
  return done
    ? { ok: true, message: `<@${userId}> susturması kaldırıldı.` }
    : { ok: false, error: 'Üyenin aktif bir susturması yok.' };
}

// ---------------------------------------------------------------- UYARI
const { db, save } = require('./store');

async function warn(guild, actor, userId, reason = '') {
  const err = requirePerm(actor, PermissionsBitField.Flags.ModerateMembers, 'Uyarı verme');
  if (err) return { ok: false, error: err };
  const member = await fetchMember(guild, userId);
  if (member) {
    const blocked = canActOn(guild, actor, member);
    if (blocked) return { ok: false, error: blocked };
  }
  if (!db.warnings[guild.id]) db.warnings[guild.id] = {};
  if (!db.warnings[guild.id][userId]) db.warnings[guild.id][userId] = [];
  db.warnings[guild.id][userId].push({
    reason: reason || 'sebep belirtilmedi',
    by: actor.user.tag,
    at: Date.now()
  });
  save();
  if (member) {
    await sendDM(member.user, `${guild.name} sunucusunda uyarı aldın. Sebep: ${reason || 'belirtilmedi'}`);
  }
  const count = db.warnings[guild.id][userId].length;
  if (count >= 3 && guild.members.me.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
    const botTop = guild.members.me?.roles?.highest?.position || 99;
    const sysActor = {
      id: 'system',
      user: { tag: 'Sistem' },
      permissions: new PermissionsBitField(PermissionsBitField.Flags.Administrator),
      roles: { highest: { position: botTop } }
    };
    await mute(guild, sysActor, userId, 30 * 60 * 1000, '3 uyarı sınırı');
  }
  return { ok: true, count, message: `<@${userId}> uyarıldı (toplam ${count}).` };
}

function warningsOf(guildId, userId) {
  return (db.warnings[guildId] && db.warnings[guildId][userId]) || [];
}

function clearWarnings(guildId, userId) {
  if (db.warnings[guildId]) {
    delete db.warnings[guildId][userId];
    save();
  }
}

// ---------------------------------------------------------------- KANAL İŞLEMLERİ
function channelTypeName(type) {
  if (type === ChannelType.GuildText) return 'text';
  if (type === ChannelType.GuildVoice) return 'voice';
  if (type === ChannelType.GuildCategory) return 'category';
  if (type === ChannelType.GuildAnnouncement) return 'announcement';
  if (type === ChannelType.GuildStageVoice) return 'stage';
  if (type === ChannelType.GuildForum) return 'forum';
  return 'other';
}

async function renameChannel(guild, actor, channelId, name) {
  const err = requirePerm(actor, PermissionsBitField.Flags.ManageChannels, 'Kanal yönetme');
  if (err) return { ok: false, error: err };
  const channel = guild.channels.cache.get(channelId);
  if (!channel) return { ok: false, error: 'Kanal bulunamadı.' };
  const clean = String(name || '').trim().slice(0, 100);
  if (!clean) return { ok: false, error: 'Yeni isim boş olamaz.' };
  try {
    await channel.setName(clean, `${actor.user.tag}: panelden düzenleme`);
    return { ok: true, message: `Kanal adı "${clean}" olarak değiştirildi.` };
  } catch (e) {
    return { ok: false, error: `Kanal düzenlenemedi: ${e.message}` };
  }
}

async function setChannelTopic(guild, actor, channelId, topic) {
  const err = requirePerm(actor, PermissionsBitField.Flags.ManageChannels, 'Kanal yönetme');
  if (err) return { ok: false, error: err };
  const channel = guild.channels.cache.get(channelId);
  if (!channel) return { ok: false, error: 'Kanal bulunamadı.' };
  if (typeof channel.setTopic !== 'function') return { ok: false, error: 'Bu kanal türü konu desteklemiyor.' };
  try {
    await channel.setTopic(String(topic || '').slice(0, 1024), `${actor.user.tag}: panelden düzenleme`);
    return { ok: true, message: 'Kanal konusu güncellendi.' };
  } catch (e) {
    return { ok: false, error: `Konu güncellenemedi: ${e.message}` };
  }
}

async function deleteChannel(guild, actor, channelId) {
  const err = requirePerm(actor, PermissionsBitField.Flags.ManageChannels, 'Kanal yönetme');
  if (err) return { ok: false, error: err };
  const channel = guild.channels.cache.get(channelId);
  if (!channel) return { ok: false, error: 'Kanal bulunamadı.' };
  try {
    const name = channel.name;
    await channel.delete(`${actor.user.tag}: panelden silme`);
    return { ok: true, message: `"${name}" kanalı silindi.` };
  } catch (e) {
    return { ok: false, error: `Kanal silinemedi: ${e.message}` };
  }
}

async function createChannel(guild, actor, { name, type = 'text', categoryId = null }) {
  const err = requirePerm(actor, PermissionsBitField.Flags.ManageChannels, 'Kanal oluşturma');
  if (err) return { ok: false, error: err };
  const clean = String(name || '').trim().slice(0, 100);
  if (!clean) return { ok: false, error: 'Kanal ismi gerekli.' };
  const types = {
    text: ChannelType.GuildText,
    voice: ChannelType.GuildVoice,
    category: ChannelType.GuildCategory,
    announcement: ChannelType.GuildAnnouncement
  };
  const typeId = types[type];
  if (!typeId) return { ok: false, error: 'Geçersiz kanal türü.' };
  try {
    const created = await guild.channels.create({
      name: clean,
      type: typeId,
      parent: categoryId || undefined,
      reason: `${actor.user.tag}: panelden oluşturma`
    });
    return { ok: true, message: `"${clean}" kanalı oluşturuldu.`, channelId: created.id };
  } catch (e) {
    return { ok: false, error: `Kanal oluşturulamadı: ${e.message}` };
  }
}

async function bulkRenameChannels(guild, actor, items) {
  const err = requirePerm(actor, PermissionsBitField.Flags.ManageChannels, 'Kanal yönetme');
  if (err) return { ok: false, error: err };
  if (!guild.members.me.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
    return { ok: false, error: 'Botun bu sunucuda "Kanalları Yönet" yetkisi yok.' };
  }
  const list = Array.isArray(items) ? items : [];
  let updated = 0;
  let skipped = 0;
  const failed = [];
  for (const item of list) {
    const ch = guild.channels.cache.get(item.channelId);
    if (!ch) {
      failed.push({ id: item.channelId, name: item.channelId, error: 'Kanal bulunamadı' });
      continue;
    }
    const clean = String(item.name || '').trim().slice(0, 100);
    if (!clean) {
      failed.push({ id: ch.id, name: ch.name, error: 'Yeni isim boş olamaz' });
      continue;
    }
    if (clean === ch.name) {
      skipped += 1;
      continue;
    }
    try {
      await ch.setName(clean, `${actor.user.tag}: toplu isim düzenleme`);
      updated += 1;
    } catch (e) {
      failed.push({ id: ch.id, name: ch.name, error: e.message });
    }
  }
  return { ok: true, updated, skipped, failed };
}

async function bulkDeleteChannels(guild, actor, channelIds, deleteChildren = false) {
  const err = requirePerm(actor, PermissionsBitField.Flags.ManageChannels, 'Kanal yönetme');
  if (err) return { ok: false, error: err };
  if (!guild.members.me.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
    return { ok: false, error: 'Botun bu sunucuda "Kanalları Yönet" yetkisi yok.' };
  }
  const idSet = new Set((Array.isArray(channelIds) ? channelIds : []).map(String));
  if (deleteChildren) {
    for (const ch of guild.channels.cache.values()) {
      if (ch.parentId && idSet.has(ch.parentId)) idSet.add(ch.id);
    }
  }
  // Önce alt kanalları, en son kategorileri sil
  const targets = [...idSet]
    .map((id) => guild.channels.cache.get(id))
    .filter(Boolean)
    .sort((a, b) => {
      const aCat = a.type === ChannelType.GuildCategory ? 1 : 0;
      const bCat = b.type === ChannelType.GuildCategory ? 1 : 0;
      return aCat - bCat;
    });

  let deleted = 0;
  const failed = [];
  for (const ch of targets) {
    const name = ch.name;
    try {
      await ch.delete(`${actor.user.tag}: toplu silme`);
      deleted += 1;
    } catch (e) {
      failed.push({ id: ch.id, name, error: e.message });
    }
  }
  return { ok: true, deleted, failed };
}

// ---------------------------------------------------------------- ROL İŞLEMLERİ
async function addRole(guild, actor, userId, roleId) {
  const err = requirePerm(actor, PermissionsBitField.Flags.ManageRoles, 'Rol yönetme');
  if (err) return { ok: false, error: err };
  const member = await fetchMember(guild, userId);
  if (!member) return { ok: false, error: 'Üye bulunamadı.' };
  const role = guild.roles.cache.get(roleId);
  if (!role) return { ok: false, error: 'Rol bulunamadı.' };
  if (!isAdmin(actor) && role.position >= actor.roles.highest.position) {
    return { ok: false, error: 'Bu rolü vermek için yetkin yok (rol seninkinden yüksek).' };
  }
  try {
    await member.roles.add(role, `${actor.user.tag}: panelden rol verme`);
    return { ok: true, message: `@${role.name} rolü verildi.` };
  } catch (e) {
    return { ok: false, error: `Rol verilemedi: ${e.message}` };
  }
}

async function removeRole(guild, actor, userId, roleId) {
  const err = requirePerm(actor, PermissionsBitField.Flags.ManageRoles, 'Rol yönetme');
  if (err) return { ok: false, error: err };
  const member = await fetchMember(guild, userId);
  if (!member) return { ok: false, error: 'Üye bulunamadı.' };
  const role = guild.roles.cache.get(roleId);
  if (!role) return { ok: false, error: 'Rol bulunamadı.' };
  if (!isAdmin(actor) && role.position >= actor.roles.highest.position) {
    return { ok: false, error: 'Bu rolü almak için yetkin yok (rol seninkinden yüksek).' };
  }
  try {
    await member.roles.remove(role, `${actor.user.tag}: panelden rol alma`);
    return { ok: true, message: `@${role.name} rolü alındı.` };
  } catch (e) {
    return { ok: false, error: `Rol alınamadı: ${e.message}` };
  }
}

// ---------------------------------------------------------------- YARDIMCI
function humanDuration(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d} gün`);
  if (h) parts.push(`${h} saat`);
  if (m) parts.push(`${m} dakika`);
  if (!parts.length) parts.push(`${s} saniye`);
  return parts.join(' ');
}

/** "10m", "2h", "1g", "30s" gibi süreleri ms'e çevirir. */
function parseDuration(input) {
  if (!input) return DEFAULT_MUTE_MS;
  const m = String(input).trim().match(/^(\d+)\s*(s|sn|m|dk|h|sa|d|g)?$/i);
  if (!m) return DEFAULT_MUTE_MS;
  const value = parseInt(m[1], 10);
  const unit = (m[2] || 'm').toLowerCase();
  const map = { s: 1000, sn: 1000, m: 60000, dk: 60000, h: 3600000, sa: 3600000, d: 86400000, g: 86400000 };
  return Math.min(value * (map[unit] || 60000), MAX_TIMEOUT_MS);
}

module.exports = {
  MUTE_ROLE_NAME,
  DEFAULT_MUTE_MS,
  MAX_TIMEOUT_MS,
  MUTE_LIMIT_MS,
  isAdmin,
  canActOn,
  ban,
  unban,
  kick,
  mute,
  unmute,
  warn,
  warningsOf,
  clearWarnings,
  renameChannel,
  setChannelTopic,
  deleteChannel,
  createChannel,
  bulkRenameChannels,
  bulkDeleteChannels,
  channelTypeName,
  addRole,
  removeRole,
  humanDuration,
  parseDuration
};
