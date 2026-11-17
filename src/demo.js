/**
 * DEMO MODU — Discord tokeni olmadan paneli denemek için.
 * Render'da DEMO_MODE=1 verirsen sahte sunucu verisiyle çalışır.
 * Gerçek kullanımda bu dosyadaki rotalar devreye girmez.
 */
const express = require('express');
const games = require('./games');
const eco = require('./economy');
const { db } = require('./store');

const GUILD = { id: 'demo-guild', name: 'Demo Sunucu', ownerId: 'u1' };

let members = [
  { id: 'u1', username: 'kaptan', displayName: 'Kaptan', bot: false, muted: false, warnings: 0, role: 'Kurucu', color: '#f1c40f', joinedAt: Date.now() - 8.64e7 * 210, createdAt: Date.now() - 8.64e7 * 900 },
  { id: 'u2', username: 'ayse.dev', displayName: 'Ayşe', bot: false, muted: false, warnings: 1, role: 'Moderatör', color: '#2ecc71', joinedAt: Date.now() - 8.64e7 * 120, createdAt: Date.now() - 8.64e7 * 700 },
  { id: 'u3', username: 'mehmet_42', displayName: 'Mehmet', bot: false, muted: true, warnings: 3, role: 'Üye', color: '#95a5a6', joinedAt: Date.now() - 8.64e7 * 40, createdAt: Date.now() - 8.64e7 * 400 },
  { id: 'u4', username: 'zeynep', displayName: 'Zeynep', bot: false, muted: false, warnings: 0, role: 'Üye', color: '#95a5a6', joinedAt: Date.now() - 8.64e7 * 30, createdAt: Date.now() - 8.64e7 * 300 },
  { id: 'u5', username: 'can_o', displayName: 'Can', bot: false, muted: false, warnings: 0, role: 'Üye', color: '#95a5a6', joinedAt: Date.now() - 8.64e7 * 12, createdAt: Date.now() - 8.64e7 * 260 },
  { id: 'u6', username: 'elifs', displayName: 'Elif', bot: false, muted: false, warnings: 2, role: 'Üye', color: '#95a5a6', joinedAt: Date.now() - 8.64e7 * 9, createdAt: Date.now() - 8.64e7 * 220 },
  { id: 'u7', username: 'burak', displayName: 'Burak', bot: false, muted: false, warnings: 0, role: 'Üye', color: '#95a5a6', joinedAt: Date.now() - 8.64e7 * 4, createdAt: Date.now() - 8.64e7 * 180 },
  { id: 'u8', username: 'musicbot', displayName: 'MüzikBot', bot: true, muted: false, warnings: 0, role: 'Bot', color: '#5865f2', joinedAt: Date.now() - 8.64e7 * 60, createdAt: Date.now() - 8.64e7 * 500 },
  { id: 'u9', username: 'deniz', displayName: 'Deniz', bot: false, muted: false, warnings: 0, role: 'Üye', color: '#95a5a6', joinedAt: Date.now() - 8.64e7 * 2, createdAt: Date.now() - 8.64e7 * 90 },
  { id: 'u10', username: 'kerem', displayName: 'Kerem', bot: false, muted: false, warnings: 0, role: 'Üye', color: '#95a5a6', joinedAt: Date.now() - 8.64e7 * 1, createdAt: Date.now() - 8.64e7 * 60 }
];

let channels = [
  { id: 'c-cat1', name: 'GENEL', type: 'category', parentId: null, position: 0, topic: null },
  { id: 'c1', name: 'genel-sohbet', type: 'text', parentId: 'c-cat1', position: 1, topic: 'Her konu serbest' },
  { id: 'c2', name: 'duyurular', type: 'announcement', parentId: 'c-cat1', position: 2, topic: 'Sunucu duyuruları' },
  { id: 'c3', name: 'bot-komutlari', type: 'text', parentId: 'c-cat1', position: 3, topic: '!yardım' },
  { id: 'c-cat2', name: 'SESLİ', type: 'category', parentId: null, position: 4, topic: null },
  { id: 'c4', name: 'Sohbet Odası', type: 'voice', parentId: 'c-cat2', position: 5, topic: null },
  { id: 'c5', name: 'Oyun Odası', type: 'voice', parentId: 'c-cat2', position: 6, topic: null },
  { id: 'c6', name: 'muzik', type: 'voice', parentId: 'c-cat2', position: 7, topic: null }
];

let roles = [
  { id: 'r1', name: 'Kurucu', color: '#f1c40f', position: 9, memberCount: 1, managed: false },
  { id: 'r2', name: 'Moderatör', color: '#2ecc71', position: 7, memberCount: 2, managed: false },
  { id: 'r3', name: 'Üye', color: '#95a5a6', position: 2, memberCount: 7, managed: false },
  { id: 'r4', name: 'Bot', color: '#5865f2', position: 4, memberCount: 1, managed: true }
];

let bans = [
  { id: 'b1', username: 'troll_123', avatar: 'https://cdn.discordapp.com/embed/avatars/3.png', reason: 'reklam / spam' }
];

let logs = [
  { type: 'site', text: 'kaptan panelden işlem yaptı: Mehmet — timeout', actor: 'kaptan', at: Date.now() - 60000 },
  { type: 'ban', text: 'troll_123 yasaklandı — reklam / spam', at: Date.now() - 1000 * 60 * 42 },
  { type: 'channel', text: 'kaptan "eski-sohbet" kanalını sildi', at: Date.now() - 1000 * 60 * 60 * 5 },
  { type: 'bot', text: 'Bot çevrimiçi oldu (demo)', at: Date.now() - 1000 * 60 * 60 * 26 }
];

let settings = {
  logChannelId: 'c2',
  welcomeChannelId: 'c1',
  welcomeMessage: 'Sunucumuza hoş geldin {user}! 🎉',
  autoRoleId: 'r3',
  entertainmentChannelId: 'c3',
  prefix: '!'
};

const DEMO_USER = { id: 'u1', username: 'kaptan', globalName: 'Kaptan', avatar: null };

function pushLog(type, text, actor = 'kaptan') {
  logs.unshift({ type, text, actor, at: Date.now() });
  logs = logs.slice(0, 60);
}

function router() {
  const r = express.Router();

  r.use((req, res, next) => {
    req.session.user = DEMO_USER;
    req.session.guildId = GUILD.id;
    next();
  });

  r.post('/auth/login', (req, res) => {
    req.session.user = DEMO_USER;
    req.session.guildId = GUILD.id;
    res.json({ ok: true, user: DEMO_USER });
  });

  r.get('/auth/login', (req, res) => {
    req.session.user = DEMO_USER;
    req.session.guildId = GUILD.id;
    res.redirect('/');
  });

  r.get('/api/me', (req, res) =>
    res.json({ user: DEMO_USER, authMode: 'password', configured: true, botReady: true, botTag: 'DemoBot#0001', demo: true })
  );

  r.get('/api/guilds', (req, res) =>
    res.json({
      guilds: [{ id: GUILD.id, name: `${GUILD.name} (demo)`, icon: null, owner: true, canManage: true, botIsAdmin: true, memberCount: members.length, channelCount: channels.length }]
    })
  );

  r.post('/api/guild/select', (req, res) => res.json({ ok: true, guild: { id: GUILD.id, name: GUILD.name } }));

  r.get('/api/overview', (req, res) => {
    const text = channels.filter((c) => c.type === 'text' || c.type === 'announcement').length;
    const voice = channels.filter((c) => c.type === 'voice').length;
    res.json({
      guild: {
        id: GUILD.id,
        name: GUILD.name,
        icon: null,
        ownerId: 'u1',
        createdAt: Date.now() - 8.64e7 * 800,
        memberCount: members.length,
        botCount: members.filter((m) => m.bot).length,
        boostLevel: 1,
        boostCount: 4,
        locale: 'tr',
        description: 'Deneme sunucusu'
      },
      user: {
        id: DEMO_USER.id,
        username: DEMO_USER.username,
        isAdmin: true,
        isOwner: true,
        permissions: ['Administrator', 'BanMembers', 'KickMembers', 'ModerateMembers', 'ManageChannels', 'ManageRoles', 'ManageGuild', 'ManageMessages']
      },
      bot: { ready: true, tag: 'DemoBot#0001', ping: 42, uptime: 1000 * 60 * 60 * 7, commands: 128, guildCount: 1, permissions: ['Administrator'] },
      counts: { text, voice, category: channels.filter((c) => c.type === 'category').length, other: 0, bans: bans.length, roles: roles.length, emojis: 12 },
      recentLogs: logs.slice(0, 12)
    });
  });

  const memberOut = (m) => ({
    id: m.id,
    username: m.username,
    displayName: m.displayName,
    avatar: `https://cdn.discordapp.com/embed/avatars/${Number(m.id.replace(/\D/g, '')) % 5}.png`,
    bot: m.bot,
    joinedAt: m.joinedAt,
    createdAt: m.createdAt,
    muted: m.muted,
    mutedUntil: m.muted ? Date.now() + 1000 * 60 * 12 : null,
    highestRole: { id: 'rx', name: m.role, color: m.color },
    topRolePosition: 1,
    warnings: m.warnings
  });

  r.get('/api/members', (req, res) => res.json({ total: members.length, members: members.map(memberOut) }));

  r.get('/api/members/:id', (req, res) => {
    const m = members.find((x) => x.id === req.params.id);
    if (!m) return res.status(400).json({ error: 'Üye bulunamadı.' });
    const base = memberOut(m);
    res.json({
      ...base,
      banner: null,
      roles: [{ id: 'r3', name: m.role, color: m.color, position: 4, managed: m.bot }],
      warnings: Array.from({ length: m.warnings }, (_, i) => ({
        reason: ['spam', 'küfür', 'reklam'][i % 3],
        by: 'kaptan#0001',
        at: Date.now() - 8.64e7 * (i + 1)
      }))
    });
  });

  r.post('/api/mod/bulk', (req, res) => {
    const ids = new Set(Array.isArray(req.body.userIds) ? req.body.userIds.map(String) : []);
    const action = req.body.action;
    let succeeded = 0;
    if (action === 'unban') {
      const before = bans.length;
      bans = bans.filter((b) => !ids.has(b.id));
      succeeded = before - bans.length;
      return res.json({ ok: succeeded > 0, succeeded, failed: ids.size - succeeded, results: [] });
    }
    for (const m of [...members]) {
      if (!ids.has(m.id)) continue;
      if (action === 'ban') { bans.push({ id: m.id, username: m.username, avatar: '', reason: req.body.reason || 'sebep yok' }); members = members.filter((x) => x.id !== m.id); }
      else if (action === 'kick') members = members.filter((x) => x.id !== m.id);
      else if (action === 'mute') m.muted = true;
      else if (action === 'unmute') m.muted = false;
      else if (action === 'warn') m.warnings += 1;
      succeeded += 1;
    }
    res.json({ ok: succeeded > 0, succeeded, failed: ids.size - succeeded, results: [] });
  });

  r.post('/api/mod/:action', (req, res) => {
    const { action } = req.params;
    const { userId, reason } = req.body || {};
    const m = members.find((x) => x.id === userId);
    if (!m) return res.status(400).json({ error: 'Üye bulunamadı.' });

    const messages = {
      ban: `<@${userId}> yasaklandı.`,
      unban: `<@${userId}> yasağı kaldırıldı.`,
      kick: `<@${userId}> sunucudan atıldı.`,
      mute: `<@${userId}> susturuldu.`,
      unmute: `<@${userId}> susturması kaldırıldı.`,
      warn: `<@${userId}> uyarıldı (toplam ${m.warnings + 1}).`
    };

    if (action === 'ban') {
      bans.push({ id: m.id, username: m.username, avatar: '', reason: reason || 'sebep yok' });
      members = members.filter((x) => x.id !== m.id);
    }
    if (action === 'kick') members = members.filter((x) => x.id !== m.id);
    if (action === 'mute') m.muted = true;
    if (action === 'unmute') m.muted = false;
    if (action === 'warn') m.warnings += 1;
    if (action === 'unban') bans = bans.filter((b) => b.id !== userId);

    pushLog('site', `${DEMO_USER.username} → ${action} (${m.username}) ${reason || ''}`);
    res.json({ ok: true, message: messages[action] || 'Tamam' });
  });

  r.post('/api/mod/warnings/clear', (req, res) => {
    const m = members.find((x) => x.id === req.body.userId);
    if (m) m.warnings = 0;
    res.json({ ok: true });
  });

  r.get('/api/bans', (req, res) => res.json({ bans }));

  r.get('/api/channels', (req, res) => res.json({ channels }));

  r.post('/api/channels/create', (req, res) => {
    const { name, type = 'text', categoryId } = req.body || {};
    if (!name) return res.json({ ok: false, error: 'Kanal ismi gerekli.' });
    const ch = { id: 'c' + Date.now(), name, type, parentId: categoryId || null, position: channels.length, topic: null };
    channels.push(ch);
    pushLog('channel', `"${name}" kanalı oluşturuldu`);
    res.json({ ok: true, message: `"${name}" kanalı oluşturuldu.`, channelId: ch.id });
  });

  r.post('/api/channels/rename', (req, res) => {
    const ch = channels.find((c) => c.id === req.body.channelId);
    if (!ch) return res.json({ ok: false, error: 'Kanal bulunamadı.' });
    ch.name = req.body.name;
    pushLog('channel', `Kanal yeniden adlandırıldı: ${ch.name}`);
    res.json({ ok: true, message: `Kanal adı "${ch.name}" oldu.` });
  });

  r.post('/api/channels/topic', (req, res) => {
    const ch = channels.find((c) => c.id === req.body.channelId);
    if (!ch) return res.json({ ok: false, error: 'Kanal bulunamadı.' });
    ch.topic = req.body.topic;
    res.json({ ok: true, message: 'Kanal konusu güncellendi.' });
  });

  r.post('/api/channels/delete', (req, res) => {
    const ch = channels.find((c) => c.id === req.body.channelId);
    if (!ch) return res.json({ ok: false, error: 'Kanal bulunamadı.' });
    channels = channels.filter((c) => c.id !== ch.id && c.parentId !== ch.id);
    pushLog('channel', `"${ch.name}" kanalı silindi`);
    res.json({ ok: true, message: `"${ch.name}" kanalı silindi.` });
  });

  r.post('/api/channels/bulk/create', (req, res) => {
    const names = Array.isArray(req.body.names) ? req.body.names.slice(0, 50) : [];
    names.forEach((name, i) => channels.push({ id: `bc${Date.now()}${i}`, name, type: req.body.type || 'text', parentId: req.body.categoryId || null, position: channels.length, topic: null }));
    res.json({ ok: names.length > 0, created: names.length, failed: 0, results: [] });
  });

  r.post('/api/channels/bulk/rename', (req, res) => {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    let updated = 0;
    let skipped = 0;
    const failed = [];
    for (const item of items) {
      const ch = channels.find((c) => c.id === item.channelId);
      if (!ch) { failed.push({ id: item.channelId, name: item.channelId, error: 'Bulunamadı' }); continue; }
      const clean = String(item.name || '').trim().slice(0, 100);
      if (!clean) { failed.push({ id: ch.id, name: ch.name, error: 'İsim boş' }); continue; }
      if (clean === ch.name) { skipped += 1; continue; }
      ch.name = clean;
      updated += 1;
    }
    if (updated) pushLog('channel', `Toplu isim değiştirildi (${updated} kanal)`);
    res.json({ ok: true, updated, skipped, failed });
  });

  r.post('/api/channels/bulk/topic', (req, res) => {
    const ids = new Set(req.body.channelIds || []); let updated = 0;
    for (const ch of channels) if (ids.has(ch.id) && ['text', 'announcement', 'forum'].includes(ch.type)) { ch.topic = req.body.topic || ''; updated += 1; }
    res.json({ ok: updated > 0, updated, failed: ids.size - updated, results: [] });
  });

  r.post('/api/channels/bulk/delete', (req, res) => {
    const ids = new Set((Array.isArray(req.body.channelIds) ? req.body.channelIds : []).map(String));
    if (req.body.deleteChildren) {
      for (const ch of channels) {
        if (ch.parentId && ids.has(ch.parentId)) ids.add(ch.id);
      }
    }
    const before = channels.length;
    channels = channels.filter((c) => !ids.has(c.id));
    const deleted = before - channels.length;
    if (deleted) pushLog('channel', `Toplu silindi (${deleted} kanal)`);
    res.json({ ok: true, deleted, failed: [] });
  });

  r.get('/api/roles', (req, res) => res.json({ roles }));

  r.post('/api/roles/add', (req, res) => res.json({ ok: true, message: 'Rol verildi.' }));
  r.post('/api/roles/remove', (req, res) => res.json({ ok: true, message: 'Rol alındı.' }));

  r.post('/api/roles/create', (req, res) => {
    if (!req.body.name) return res.json({ ok: false, error: 'Rol ismi gerekli.' });
    roles.unshift({ id: 'r' + Date.now(), name: req.body.name, color: req.body.color || '#99aab5', position: roles.length + 3, memberCount: 0, managed: false });
    pushLog('role', `"${req.body.name}" rolü oluşturuldu`);
    res.json({ ok: true, message: `"${req.body.name}" rolü oluşturuldu.` });
  });

  r.post('/api/roles/edit', (req, res) => {
    const role = roles.find((x) => x.id === req.body.roleId);
    if (!role) return res.json({ ok: false, error: 'Rol bulunamadı.' });
    role.name = req.body.name || role.name; role.color = req.body.color || role.color;
    res.json({ ok: true, message: `"${role.name}" rolü güncellendi.` });
  });

  r.post('/api/roles/bulk', (req, res) => {
    let succeeded = 0;
    if (req.body.action === 'create') {
      for (const [i, item] of (req.body.items || []).entries()) { roles.unshift({ id: `br${Date.now()}${i}`, name: item.name, color: item.color || '#99aab5', position: roles.length + 3, memberCount: 0, managed: false }); succeeded += 1; }
    } else {
      const ids = new Set(req.body.roleIds || []);
      if (req.body.action === 'delete') { const before = roles.length; roles = roles.filter((r) => !ids.has(r.id)); succeeded = before - roles.length; }
      if (req.body.action === 'rename') for (const role of roles) if (ids.has(role.id)) { role.name = req.body.mode === 'suffix' ? role.name + req.body.value : req.body.value + role.name; succeeded += 1; }
    }
    res.json({ ok: succeeded > 0, succeeded, failed: 0, results: [] });
  });

  r.post('/api/roles/delete', (req, res) => {
    const role = roles.find((x) => x.id === req.body.roleId);
    if (!role) return res.json({ ok: false, error: 'Rol bulunamadı.' });
    roles = roles.filter((x) => x.id !== role.id);
    pushLog('role', `"${role.name}" rolü silindi`);
    res.json({ ok: true, message: `"${role.name}" rolü silindi.` });
  });

  r.get('/api/settings', (req, res) =>
    res.json({
      settings,
      textChannels: channels.filter((c) => c.type === 'text' || c.type === 'announcement').map((c) => ({ id: c.id, name: c.name })),
      roles: roles.filter((r) => !r.managed)
    })
  );

  r.post('/api/settings', (req, res) => {
    settings = { ...settings, ...req.body };
    pushLog('site', 'Ayarlar güncellendi');
    res.json({ ok: true, settings });
  });

  r.get('/api/logs', (req, res) => res.json({ logs }));

  r.get('/api/play/balance', (req, res) => {
    const w = eco.wallet(GUILD.id, DEMO_USER.id);
    const board = eco.leaderboard(GUILD.id, 10);
    res.json({
      coins: w.coins,
      games: w.games,
      wins: w.wins,
      losses: w.losses,
      rank: board.findIndex((u) => u.userId === DEMO_USER.id) + 1,
      leaderboard: board.map((u) => {
        const m = members.find((x) => x.id === u.userId);
        return { id: u.userId, name: m ? m.displayName : 'Kaptan', avatar: null, coins: u.coins };
      })
    });
  });

  r.post('/api/play/slot', (req, res) => {
    const bet = Math.floor(Number(req.body.bet));
    const start = games.placeBet(GUILD.id, DEMO_USER.id, bet);
    if (start.error) return res.json({ error: start.error });
    const spin = games.spin(bet);
    const balance = games.settle(GUILD.id, DEMO_USER.id, bet, spin.payout, spin.multiplier > 0);
    res.json({ ...spin, bet, balance });
  });

  r.post('/api/play/coinflip', (req, res) =>
    res.json(games.coinflip(GUILD.id, DEMO_USER.id, Math.floor(Number(req.body.bet)), req.body.pick))
  );

  r.post('/api/play/dice', (req, res) =>
    res.json(games.dice(GUILD.id, DEMO_USER.id, Math.floor(Number(req.body.bet)), Number(req.body.guess)))
  );

  r.post('/api/play/daily', (req, res) => res.json(eco.daily(GUILD.id, DEMO_USER.id)));

  r.get('/api/bot/invite', (req, res) =>
    res.json({ url: 'https://discord.com/oauth2/authorize?client_id=DEMO&permissions=8&scope=bot' })
  );

  return r;
}

module.exports = { router };
