/**
 * DEMO MODU — Discord tokeni olmadan paneli denemek için.
 * Render'da DEMO_MODE=1 verirsen sahte sunucu verisiyle çalışır.
 * Gerçek kullanımda bu dosyadaki rotalar devreye girmez.
 */
const express = require('express');
const games = require('./games');
const eco = require('./economy');
const guard = require('./guard');
const { db, save } = require('./store');

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
  { id: 'u10', username: 'kerem', displayName: 'Kerem', bot: false, muted: false, warnings: 0, role: 'Üye', color: '#95a5a6', joinedAt: Date.now() - 8.64e7 * 1, createdAt: Date.now() - 8.64e7 * 60 },
  { id: 'u11', username: 'spamci_01', displayName: 'Spamcı', bot: false, muted: true, warnings: 2, role: 'Üye', color: '#95a5a6', joinedAt: Date.now() - 8.64e7 * 3, createdAt: Date.now() - 8.64e7 * 4 },
  { id: 'u12', username: 'troll_42', displayName: 'Troll', bot: false, muted: true, warnings: 4, role: 'Üye', color: '#95a5a6', joinedAt: Date.now() - 8.64e7 * 2, createdAt: Date.now() - 8.64e7 * 2 }
];

let channels = [
  { id: 'c-cat1', name: 'GENEL', type: 'category', parentId: null, position: 0, topic: null },
  { id: 'c1', name: 'genel-sohbet', type: 'text', parentId: 'c-cat1', position: 1, topic: 'Her konu serbest', locked: false },
  { id: 'c2', name: 'duyurular', type: 'announcement', parentId: 'c-cat1', position: 2, topic: 'Sunucu duyuruları', locked: false },
  { id: 'c3', name: 'bot-komutlari', type: 'text', parentId: 'c-cat1', position: 3, topic: '/yardım', locked: false },
  { id: 'c-cat2', name: 'SESLİ', type: 'category', parentId: null, position: 4, topic: null },
  { id: 'c4', name: 'Sohbet Odası', type: 'voice', parentId: 'c-cat2', position: 5, topic: null },
  { id: 'c5', name: 'Oyun Odası', type: 'voice', parentId: 'c-cat2', position: 6, topic: null },
  { id: 'c6', name: 'muzik', type: 'voice', parentId: 'c-cat2', position: 7, topic: null },
  { id: 'c-honey', name: '・do-not-touch', type: 'text', parentId: 'c-cat1', position: 8, topic: '⚠️ Bu kanal bir tuzaktır. Buraya yazan herkes otomatik cezalandırılır.' }
];

/* Demo: Anonymous webhook'ları OTOMATİK EKLENMEZ — yalnızca panelde "Anonymous ekle"
   düğmesiyle (seçili kanallara) veya anonim gönderimde eklenir. Gerçek sunucudaki
   davranışın aynısı. */
const readyWebhooks = new Set();
const isWebhookable = (ch) => ['text', 'announcement'].includes(ch.type);
const webhookStatusOf = (ch) => (isWebhookable(ch) ? (readyWebhooks.has(ch.id) ? 'ready' : 'missing') : null);
const webhookSummary = (scope = channels) => {
  const eligible = scope.filter(isWebhookable);
  const ready = eligible.filter((ch) => readyWebhooks.has(ch.id)).length;
  return { ready, preparing: 0, missing: eligible.length - ready, noPerm: 0, total: eligible.length, eligible: eligible.length };
};

let roles = [
  { id: 'r1', name: 'Kurucu', color: '#f1c40f', position: 9, memberCount: 1, managed: false },
  { id: 'r2', name: 'Moderatör', color: '#2ecc71', position: 7, memberCount: 2, managed: false },
  { id: 'r3', name: 'Üye', color: '#95a5a6', position: 2, memberCount: 7, managed: false },
  { id: 'r4', name: 'Bot', color: '#5865f2', position: 4, memberCount: 1, managed: true },
  { id: 'r-honey', name: '🛡️ Guard Ekip', color: '#2b2d31', position: 1, memberCount: 0, managed: false }
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

/* ---------------------------------------------------------- GUARD (DEMO)
   Demo, gerçek guard modülünü kullanır: yapılandırma ve olay akışı aynı
   koddan geçer, yalnızca Discord tarafı sahte nesnelerle beslenir. */
const DEMO_TYPE_ID = { text: 0, announcement: 5, voice: 2, category: 4, forum: 15 };

function guardGuild() {
  return {
    id: GUILD.id,
    name: GUILD.name,
    ownerId: 'u1',
    memberCount: 1284,
    members: { cache: new Map() },
    bans: { create: async () => ({ ok: true }) },
    channels: {
      cache: new Map(channels.map((c) => [c.id, {
        id: c.id,
        name: c.name,
        type: DEMO_TYPE_ID[c.type] ?? 0,
        parentId: c.parentId || null,
        position: c.position,
        topic: c.topic || null,
        isTextBased: () => ['text', 'announcement'].includes(c.type)
      }]))
    },
    roles: {
      cache: new Map(roles.map((r) => [r.id, { id: r.id, name: r.name, color: 0, position: r.position, managed: Boolean(r.managed), permissions: { bitfield: 0 } }]))
    }
  };
}

let guardSeeded = false;

function seedGuard() {
  if (guardSeeded) return; // demo oturumu boyunca bir kez hazırlanır
  guardSeeded = true;
  guard.update(GUILD.id, {
    logChannelId: 'c2',
    whitelist: ['u1', 'u2'],
    windowSeconds: 60,
    punishment: 'ban',
    honeypot: { enabled: true, channelId: 'c-honey', roleId: 'r-honey', action: 'timeout', hours: 1, hits: 7, lastAt: Date.now() - 1000 * 60 * 47, setupAt: Date.now() - 86400000 * 20 },
    ad: { action: 'timeout', allowInvites: false, trustedDomains: ['youtube.com', 'twitch.tv'], detected: 34 }
  });
  // Demo istatistikleri: KPI kartları ve 14 günlük trend dolu görünsün.
  {
    const byDay = {};
    for (let i = 13; i >= 0; i -= 1) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      byDay[d] = {
        blocked: [2, 0, 4, 1, 0, 3, 6, 2, 1, 5, 3, 0, 2, 4][13 - i],
        deleted: [5, 2, 9, 3, 1, 6, 12, 4, 2, 8, 7, 1, 3, 6][13 - i],
        honeypot: [0, 0, 1, 0, 0, 1, 2, 0, 0, 1, 1, 0, 0, 1][13 - i],
        ads: [1, 0, 2, 1, 0, 2, 4, 1, 0, 3, 2, 0, 1, 2][13 - i]
      };
    }
    guard.update(GUILD.id, {
      stats: {
        blocked: 33, deleted: 69, timeouts: 14, bans: 6, kicks: 4, stripped: 3, restored: 5,
        honeypot: 7, ads: 19, lastAt: Date.now() - 1000 * 60 * 23, byDay
      }
    });
  }
  guard.setEnabled(GUILD.id, true, 'kaptan');
  guard.update(GUILD.id, {
    backup: {
      at: Date.now() - 86400000 * 2,
      takenBy: 'kaptan',
      roles: [
        ...roles.map((r) => ({ id: r.id, name: r.name, color: '0', position: r.position, hoist: false, mentionable: false, permissions: '0' })),
        // Yedek alındıktan sonra silinmiş roller (geri yükleme gerçekten bir şeyler kursun)
        { id: 'r-arch-1', name: 'Etkinlik Sorumlusu', color: '0', position: 3, hoist: false, mentionable: false, permissions: '0' },
        { id: 'r-arch-2', name: 'Deneme Moderatörü', color: '0', position: 2, hoist: false, mentionable: false, permissions: '0' }
      ],
      channels: [
        ...channels.map((c) => ({ id: c.id, name: c.name, type: DEMO_TYPE_ID[c.type] ?? 0, parentId: c.parentId || null, position: c.position, topic: c.topic || null, nsfw: false })),
        // Yedekten sonra silinmiş kanallar
        { id: 'c-arch-1', name: 'eski-sohbet', type: 0, parentId: null, position: 90, topic: 'Arşiv', nsfw: false },
        { id: 'c-arch-2', name: 'yedek-duyuru', type: 0, parentId: null, position: 91, topic: null, nsfw: false },
        { id: 'c-arch-3', name: 'etkinlik-ses', type: 2, parentId: null, position: 92, topic: null, nsfw: false }
      ]
    }
  });
  const now = Date.now();
  const seed = [
    { at: now - 1000 * 60 * 3, type: 'violation', severity: 'high', title: 'Kanal silme sınırı aşıldı', detail: 'Hedef: #eski-sohbet · 3 işlem / 60 sn', module: 'channelGuard', action: 'channelDelete', actor: { id: 'u6', name: 'elifs' }, count: 3, limit: 2, punishment: 'ban' },
    { at: now - 1000 * 60 * 5, type: 'punishment', severity: 'high', title: '🛡️ Müdahale: yasaklandı', detail: 'elifs · Kanal silme sınırı aşıldı', module: 'channelGuard', actor: { id: 'u6', name: 'elifs' }, punishment: 'ban' },
    { at: now - 1000 * 60 * 11, type: 'info', severity: 'medium', title: 'Sunucuya bot eklendi', detail: 'MüzikBot · güvenli listede değil', module: 'botGuard', action: 'botAdd', actor: { id: 'u8', name: 'musicbot' }, count: 1, limit: 1 },
    { at: now - 1000 * 60 * 23, type: 'violation', severity: 'high', title: 'Reklam tespit edildi', detail: 'spamci_01 · #genel-sohbet · skor 9 · bedava nitro tuzağı, link kısaltıcı', module: 'adGuard', actor: { id: 'u11', name: 'spamci_01' }, score: 9, punishment: 'timeout', evidence: 'BEDAVA NITRO → bit.ly/3xYz' },
    { at: now - 1000 * 60 * 26, type: 'violation', severity: 'medium', title: 'Webhook oluşturma sınırı aşıldı', detail: '#duyurular · 4 işlem / 60 sn', module: 'webhookGuard', action: 'webhook', actor: { id: 'u3', name: 'mehmet_42' }, count: 4, limit: 2 },
    { at: now - 1000 * 60 * 44, type: 'violation', severity: 'high', title: '🍯 Honeypot tetiklendi', detail: 'troll_42 tuzak kanal ile etkileşime girdi. Uygulanan: Timeout (saatlik)', module: 'honeypot', actor: { id: 'u12', name: 'troll_42' }, punishment: 'timeout', evidence: 'Tuzak: kanal' },
    { at: now - 1000 * 60 * 62, type: 'violation', severity: 'high', title: '🚨 Olası raid tespit edildi', detail: '12 saniyede 9 katılım · 5 yeni hesap', module: 'antiRaid', action: 'memberPrune', actor: { id: null, name: '9 yeni katılım' }, count: 9, limit: 6 },
    { at: now - 1000 * 60 * 78, type: 'violation', severity: 'medium', title: 'Toplu mention (mass ping)', detail: 'can_o · #genel-sohbet · 14 mention (@everyone)', module: 'mentionGuard', actor: { id: 'u5', name: 'can_o' }, count: 14, limit: 6 },
    { at: now - 1000 * 60 * 95, type: 'action', severity: 'low', title: 'Koruma açıldı', detail: 'İşlemi yapan: kaptan', module: null, action: null, actor: null, count: null, limit: null },
    { at: now - 1000 * 60 * 140, type: 'action', severity: 'medium', title: '🍯 Honeypot kanalı kuruldu', detail: '#・do-not-touch tuzak olarak ayarlandı.', module: 'honeypot' }
  ];
  db.guardEvents[GUILD.id] = seed.map((e, i) => ({ id: `demo-${i}`, ...e }));
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

  r.get('/api/channels', (req, res) => res.json({
    channels: channels.map((ch) => ({ ...ch, anonymousWebhook: webhookStatusOf(ch) })),
    webhookAuto: true,
    webhooks: webhookSummary()
  }));

  r.post('/api/channels/create', (req, res) => {
    const { name, type = 'text', categoryId } = req.body || {};
    if (!name) return res.json({ ok: false, error: 'Kanal ismi gerekli.' });
    const ch = { id: 'c' + Date.now(), name, type, parentId: categoryId || null, position: channels.length, topic: null };
    channels.push(ch);
    // Yeni kanala webhook OTOMATİK EKLENMEZ.
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

  r.post('/api/channels/webhooks/warm', (req, res) => {
    const ids = [...new Set(Array.isArray(req.body?.channelIds) ? req.body.channelIds.map(String) : [])];
    const eligible = ids.filter((id) => channels.some((c) => c.id === id && isWebhookable(c)));
    const already = eligible.filter((id) => readyWebhooks.has(id)).length;
    const pending = eligible.filter((id) => !readyWebhooks.has(id));
    pending.forEach((id) => readyWebhooks.add(id));
    if (pending.length) pushLog('site', `Anonymous webhook eklendi (demo): ${pending.length} kanal`);
    res.json({ ok: true, started: pending.length, ready: already, total: eligible.length, noPerm: 0, webhookGate: { limit: 8, active: 0, queued: 0 }, demo: true });
  });

  r.get('/api/channels/webhooks/status', (req, res) => {
    res.json({ ok: true, ...webhookSummary(), demo: true });
  });

  r.post('/api/channels/webhooks/status', (req, res) => {
    const ids = new Set((Array.isArray(req.body?.channelIds) ? req.body.channelIds : []).map(String));
    const scope = ids.size ? channels.filter((c) => ids.has(c.id)) : channels;
    res.json({ ok: true, ...webhookSummary(scope), demo: true });
  });

  r.post('/api/channels/message', (req, res) => {
    const ch = channels.find((c) => c.id === req.body.channelId);
    if (!ch || !['text', 'announcement'].includes(ch.type)) return res.status(400).json({ error: 'Bu kanala mesaj gönderilemez.' });
    if (!String(req.body.content || '').trim()) return res.status(400).json({ error: 'Mesaj boş olamaz.' });
    pushLog('channel', `#${ch.name} kanalına panelden ${req.body.anonymous ? 'anonim ' : ''}mesaj gönderildi`);
    res.json({ ok: true, anonymous: Boolean(req.body.anonymous), message: req.body.anonymous ? 'Anonim mesaj gönderildi.' : 'Mesaj gönderildi.', messageId: 'demo-message' });
  });

  r.post('/api/channels/lock', (req, res) => {
    const ch = channels.find((c) => c.id === req.body.channelId);
    if (!ch || !['text', 'announcement'].includes(ch.type)) return res.status(400).json({ error: 'Bu kanal kilitlenemez.' });
    ch.locked = Boolean(req.body.locked);
    res.json({ ok: true, locked: ch.locked, message: ch.locked ? 'Kanal yazmaya kapatıldı.' : 'Kanal kilidi kaldırıldı.' });
  });

  r.post('/api/channels/delete', (req, res) => {
    const ch = channels.find((c) => c.id === req.body.channelId);
    if (!ch) return res.json({ ok: false, error: 'Kanal bulunamadı.' });
    channels = channels.filter((c) => c.id !== ch.id && c.parentId !== ch.id);
    readyWebhooks.delete(ch.id);
    pushLog('channel', `"${ch.name}" kanalı silindi`);
    res.json({ ok: true, message: `"${ch.name}" kanalı silindi.` });
  });

  r.post('/api/channels/bulk/create', (req, res) => {
    const names = Array.isArray(req.body.names) ? req.body.names : [];
    names.forEach((name, i) => {
      channels.push({ id: `bc${Date.now()}${i}`, name, type: req.body.type || 'text', parentId: req.body.categoryId || null, position: channels.length, topic: null });
    });
    // Yeni kanallara webhook OTOMATİK EKLENMEZ; istenirse "Anonymous ekle" ile eklenir.
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
    ids.forEach((id) => readyWebhooks.delete(id));
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


  r.post('/api/play/coinflip', (req, res) =>
    res.json(games.coinflip(GUILD.id, DEMO_USER.id, Math.floor(Number(req.body.bet)), req.body.pick))
  );

  r.post('/api/play/dice', (req, res) =>
    res.json(games.dice(GUILD.id, DEMO_USER.id, Math.floor(Number(req.body.bet)), Number(req.body.guess)))
  );

  r.post('/api/play/daily', (req, res) => res.json(eco.daily(GUILD.id, DEMO_USER.id)));

  // ---------------------------------------------------------------- GUARD
  seedGuard();

  const guardPayload = () => {
    const cfg = guard.get(GUILD.id);
    const guild = guardGuild();
    return {
      guard: {
        ...cfg,
        whitelist: cfg.whitelist.map((id) => {
          const m = members.find((x) => x.id === String(id));
          return { id: String(id), name: m ? m.username : String(id), bot: Boolean(m?.bot) };
        })
      },
      modules: guard.MODULES,
      limitActions: guard.LIMIT_ACTIONS,
      punishments: guard.PUNISHMENTS,
      honeypotActions: guard.HONEYPOT_ACTIONS,
      adActions: guard.AD_ACTIONS,
      botActions: guard.BOT_ACTIONS,
      raidActions: guard.RAID_ACTIONS,
      newAccountActions: guard.NEW_ACCOUNT_ACTIONS,
      presets: guard.PRESETS,
      statsSeries: guard.daySeries(GUILD.id, 14),
      summary: guard.summary(GUILD.id, guild),
      admin: guard.adminSummary(GUILD.id, guild),
      statusLabels: guard.STATUS_LABEL,
      events: guard.events(GUILD.id, 60),
      textChannels: channels.filter((c) => ['text', 'announcement'].includes(c.type)).map((c) => ({ id: c.id, name: c.name })),
      roles: roles.map((r2) => ({ id: r2.id, name: r2.name }))
    };
  };

  r.get('/api/guard', (req, res) => res.json(guardPayload()));

  r.post('/api/guard/config', (req, res) => {
    const body = req.body || {};
    const result = guard.setConfig(GUILD.id, body);
    if (!result.ok) return res.status(400).json({ error: result.error });
    if (Array.isArray(body.whitelist)) {
      guard.update(GUILD.id, { whitelist: body.whitelist.map((x) => String(x).replace(/[<@!>]/g, '')).filter((x) => /^[\w-]{1,32}$/.test(x)) });
    }
    if (body.enabled !== undefined && Boolean(body.enabled) !== guard.get(GUILD.id).enabled) {
      guard.setEnabled(GUILD.id, Boolean(body.enabled), 'kaptan');
      pushLog('guard', `Koruma ${body.enabled ? 'açıldı' : 'kapatıldı'}`);
    }
    const payload = guardPayload();
    res.json({ ok: true, guard: payload.guard, summary: payload.summary, events: payload.events, statsSeries: payload.statsSeries });
  });

  r.post('/api/guard/preset', (req, res) => {
    const result = guard.applyPreset(GUILD.id, req.body?.preset || 'dengeli');
    pushLog('guard', `Hazır ayar uygulandı: ${result.preset}`);
    const payload = guardPayload();
    res.json({ ok: true, guard: payload.guard, summary: payload.summary, admin: payload.admin, statsSeries: payload.statsSeries });
  });

  r.post('/api/guard/honeypot', async (req, res) => {
    const action = String(req.body?.action || 'setup');
    let result;
    if (action === 'setup') {
      const cfg = guard.get(GUILD.id);
      if (cfg.honeypot.channelId) result = { ok: true, channelId: cfg.honeypot.channelId, existing: true };
      else result = await guard.createHoneypotChannel(guardGuild());
    } else if (action === 'role') {
      result = { ok: true, roleId: 'r-honey', existing: true };
    } else if (action === 'disable') {
      result = guard.honeypotDisable(GUILD.id);
    } else if (action === 'test') {
      result = { ok: true, event: guard.honeypotOffense(guardGuild(), guard.get(GUILD.id), 'u12', { name: 'troll_42 (test)', kind: 'kanal', channelId: 'c-honey' }) };
    } else {
      return res.status(400).json({ error: 'Bilinmeyen honeypot işlemi.' });
    }
    if (!result.ok) return res.status(400).json({ error: result.error || 'Honeypot işlemi başarısız.' });
    pushLog('guard', `Honeypot işlemi: ${action}`);
    const payload = guardPayload();
    res.json({ ok: true, result, guard: payload.guard, summary: payload.summary, events: payload.events });
  });

  r.post('/api/guard/ad-sim', (req, res) => {
    const text = String(req.body?.text || '').slice(0, 2000);
    if (!text.trim()) return res.status(400).json({ error: 'Test için bir metin yaz.' });
    res.json({ ok: true, analysis: guard.analyzeAd(text, guard.get(GUILD.id)) });
  });

  r.post('/api/guard/restore', async (req, res) => {
    const cfg = guard.get(GUILD.id);
    if (!cfg.backup) return res.status(400).json({ error: 'Yedek bulunamadı. Önce "Yedek al" düğmesini kullan.' });
    // Demo: sahte sunucuda kanal oluşturulamaz; gerçekçi bir sonuç raporlanır.
    const roles = Math.min(3, Math.max(1, cfg.backup.roles.length - 2));
    const chans = Math.min(4, Math.max(1, cfg.backup.channels.length - 2));
    guard.pushEvent(GUILD.id, {
      type: 'action', severity: 'medium', title: 'Yedekten geri yükleme',
      detail: `${roles} rol, ${chans} kanal yeniden oluşturuldu (demo).`, module: 'antiNuke'
    });
    guard.update(GUILD.id, { stats: { ...cfg.stats, restored: (cfg.stats.restored || 0) + roles + chans } });
    pushLog('guard', `Yedekten geri yükleme: ${roles} rol, ${chans} kanal`);
    const payload = guardPayload();
    res.json({ ok: true, roles, channels: chans, failed: [], summary: payload.summary, events: payload.events });
  });

  r.post('/api/guard/panic', async (req, res) => {
    seedGuardCenter();
    const result = await guard.panic(guardGuild(), 'kaptan');
    pushLog('guard', `Panik modu: ${result.roles || 0} rol alındı`);
    const payload = guardPayload();
    res.json({ ok: true, ...result, summary: payload.summary, events: payload.events });
  });

  r.post('/api/guard/audit', async (req, res) => {
    await guard.safetyAudit(guardGuild());
    const payload = guardPayload();
    res.json({ ok: true, summary: payload.summary, events: payload.events });
  });

  r.post('/api/guard/module', (req, res) => {
    const result = guard.setModule(GUILD.id, String(req.body?.key || ''), Boolean(req.body?.enabled));
    if (!result.ok) return res.status(400).json({ error: result.error });
    pushLog('guard', `${result.label} modülü ${result.enabled ? 'açıldı' : 'kapatıldı'}`);
    const payload = guardPayload();
    res.json({ ok: true, guard: payload.guard, summary: payload.summary });
  });

  r.post('/api/guard/limit', (req, res) => {
    const result = guard.setLimit(GUILD.id, String(req.body?.key || ''), req.body?.value);
    if (!result.ok) return res.status(400).json({ error: result.error });
    pushLog('guard', `${result.label} limiti ${result.limit} oldu`);
    const payload = guardPayload();
    res.json({ ok: true, guard: payload.guard, summary: payload.summary });
  });

  r.post('/api/guard/whitelist', (req, res) => {
    const userId = String(req.body?.userId || '').replace(/[<@!>]/g, '');
    if (!/^\d{5,25}$/.test(userId)) return res.status(400).json({ error: 'Geçerli bir kullanıcı ID gir.' });
    const action = req.body?.action === 'remove' ? 'remove' : 'add';
    const result = action === 'add' ? guard.addWhitelist(GUILD.id, userId) : guard.removeWhitelist(GUILD.id, userId);
    if (!result.ok) return res.status(400).json({ error: result.error });
    pushLog('guard', `Güvenli liste güncellendi (${action === 'add' ? 'ekleme' : 'çıkarma'}): ${userId}`);
    const payload = guardPayload();
    res.json({ ok: true, guard: payload.guard });
  });

  r.get('/api/guard/events', (req, res) => res.json({ events: guard.events(GUILD.id, 60), summary: guard.summary(GUILD.id, guardGuild()) }));

  r.post('/api/guard/events/clear', (req, res) => {
    guard.clearEvents(GUILD.id);
    pushLog('guard', 'Guard olay akışı temizlendi');
    res.json({ ok: true, events: [] });
  });

  r.post('/api/guard/backup', (req, res) => {
    const result = guard.takeBackup(guardGuild());
    pushLog('guard', `Yedek alındı: ${result.roles} rol, ${result.channels} kanal`);
    const payload = guardPayload();
    res.json({ ok: true, ...result, summary: payload.summary });
  });

  r.post('/api/guard/test', (req, res) => {
    const event = guard.runTest(guardGuild(), 'kaptan');
    pushLog('guard', 'Guard testi çalıştırıldı — örnek kayıt üretildi');
    res.json({ ok: true, event, events: guard.events(GUILD.id, 60), summary: guard.summary(GUILD.id, guardGuild()) });
  });

  // ------------------------------------------------- GUARD MERKEZİ (DEMO)
  // Operatör katmanının demo karşılığı: 4 örnek sunucu, whitelist/blacklist,
  // sessiz mod ve otomatik pasifleştirme panelde gerçek veriyle denenir.
  const DEMO_GUILDS = [
    { id: GUILD.id, name: 'Demo Sunucu', memberCount: 1284, addedDaysAgo: 96 },
    { id: '913555340000000001', name: 'Gece Kulübü TR', memberCount: 8420, addedDaysAgo: 41 },
    { id: '913555340000000002', name: 'Anime Sohbet', memberCount: 15330, addedDaysAgo: 0 },
    { id: '913555340000000003', name: 'Oyun Dünyası', memberCount: 612, addedDaysAgo: 12 }
  ];

  const demoGuildMeta = (guildId) => DEMO_GUILDS.find((g) => g.id === String(guildId)) || null;

  function demoGuildData(guildId) {
    const id = String(guildId);
    if (id === GUILD.id) return { channels, roles, members };
    const short = id.slice(-2);
    return {
      channels: [
        { id: `g${short}-c1`, name: 'genel', type: 'text' },
        { id: `g${short}-c2`, name: 'guard-log', type: 'text' },
        { id: `g${short}-c3`, name: 'duyurular', type: 'announcement' }
      ],
      roles: [
        { id: `g${short}-r1`, name: 'Kurucu', position: 9, managed: false },
        { id: `g${short}-r2`, name: 'Yetkili', position: 6, managed: false },
        { id: `g${short}-r3`, name: 'Üye', position: 2, managed: false }
      ],
      members: [
        { id: `g${short}-u1`, username: 'kurucu', bot: false },
        { id: `g${short}-u2`, username: 'yetkili_1', bot: false }
      ]
    };
  }

  let demoCreateSeq = 0;

  function demoGuardGuild(guildId) {
    const id = String(guildId);
    const meta = demoGuildMeta(id);
    const data = demoGuildData(id);
    return {
      id,
      name: meta ? meta.name : id,
      ownerId: `${id}-owner`,
      memberCount: meta ? meta.memberCount : 500,
      bans: { create: async () => ({ ok: true }) },
      invites: { fetch: async () => new Map([['inv-demo-1', { delete: async () => true }], ['inv-demo-2', { delete: async () => true }]]) },
      client: { user: { id: 'bot1' } },
      channels: {
        cache: new Map(data.channels.map((c) => [c.id, {
          id: c.id,
          name: c.name,
          type: DEMO_TYPE_ID[c.type] ?? 0,
          parentId: null,
          position: 1,
          topic: null,
          isTextBased: () => ['text', 'announcement'].includes(c.type),
          send: async () => ({ id: 'demo-msg' })
        }])),
        create: async (opts) => {
          const id = `demo-created-ch-${(demoCreateSeq += 1)}`;
          const ch = {
            id,
            name: opts?.name || id,
            type: opts?.type ?? 0,
            parentId: opts?.parent || null,
            position: 99,
            topic: opts?.topic || null,
            isTextBased: () => ['text', 'announcement', 0, 5, 15].includes(opts?.type ?? 0),
            send: async () => ({ id: 'demo-msg' })
          };
          return ch;
        }
      },
      roles: {
        cache: new Map(data.roles.map((r) => [r.id, { id: r.id, name: r.name, color: 0, position: r.position, managed: Boolean(r.managed), permissions: { bitfield: 0 } }])),
        create: async (opts) => {
          const id = `demo-created-role-${(demoCreateSeq += 1)}`;
          return { id, name: opts?.name || id, color: opts?.color || 0, position: 1, managed: false, permissions: { bitfield: 0 } };
        }
      },
      members: {
        cache: new Map(data.members.map((m, idx) => {
          const dangerous = !m.bot && idx % 2 === 0 && m.id !== `${id}-owner`;
          const roleCol = dangerous
            ? new Map([[`demo-role-${m.id}`, { id: `demo-role-${m.id}`, managed: false, permissions: { has: () => true } }]])
            : new Map();
          return [m.id, {
            id: m.id,
            user: m,
            bannable: true,
            kickable: true,
            moderatable: true,
            kick: async () => true,
            timeout: async () => true,
            roles: { cache: { values: () => roleCol.values() }, highest: { position: dangerous ? 4 : 0 }, remove: async () => roleCol.size }
          }];
        })),
        me: {
          id: 'bot1',
          permissions: { has: () => true },
          roles: { highest: { position: 9999 } }
        }
      }
    };
  }

  function demoWhitelistView(guildId, cfg) {
    const data = demoGuildData(guildId);
    const pool = guildId === GUILD.id ? members : data.members;
    return (cfg.whitelist || []).map((id) => {
      const m = pool.find((x) => x.id === String(id));
      return { id: String(id), name: m ? m.username : String(id), bot: Boolean(m?.bot) };
    });
  }

  let centerSeeded = false;

  function seedGuardCenter() {
    if (centerSeeded) return;
    centerSeeded = true;
    const now = Date.now();
    const day = 86400000;
    const roster = {};
    DEMO_GUILDS.forEach((g) => {
      roster[g.id] = { name: g.name, memberCount: g.memberCount, addedAt: now - g.addedDaysAgo * day, lastSeen: now };
    });
    guard.savePolicy({
      autoBlockNewGuilds: true,
      allowed: [GUILD.id, '913555340000000003'],
      blocked: ['913555340000000001'],
      notes: {
        [GUILD.id]: { text: 'Ana sunucu — koruma tam yetkiyle çalışıyor.', at: now - 40 * day },
        '913555340000000001': { text: 'Guard’ı kötüye kullanıyor: yetkilileri toplu banlıyor. Sahibi iki kez uyarıldı.', at: now - 3 * day },
        '913555340000000003': { text: 'Whitelist’te, sahibi korumayı kendi kapattı.', at: now - 9 * day }
      },
      roster
    });

    // 1) Ana demo sunucusu: aktif
    guard.update(GUILD.id, { addedAt: now - 96 * day, approvedAt: now - 95 * day, approvedBy: 'kaptan', silent: false });

    // 2) Blacklist: sessiz mod (sunucuya normal görünüyor)
    guard.update('913555340000000001', {
      enabled: true,
      logChannelId: 'g01-c2',
      addedAt: now - 41 * day,
      approvedAt: now - 40 * day,
      approvedBy: 'kaptan',
      silent: true,
      silentAt: now - 3 * day,
      silentReason: 'Kötüye kullanım: yetkililere toplu ban',
      whitelist: ['g01-u1']
    });
    db.guardEvents['913555340000000001'] = [
      { id: 's1-1', at: now - 3 * day - 3600000, type: 'violation', severity: 'high', title: 'Yasaklama sınırı aşıldı', detail: 'Hedef: yetkili_1 · 6 işlem / 60 sn', module: 'antiNuke', action: 'ban', actor: { id: 'g01-u2', name: 'yetkili_1' }, count: 6, limit: 3 },
      { id: 's1-2', at: now - 5 * day, type: 'violation', severity: 'medium', title: 'Rol silme sınırı aşıldı', detail: 'Hedef: Moderatör · 3 işlem / 60 sn', module: 'roleGuard', action: 'roleDelete', actor: { id: 'g01-u2', name: 'yetkili_1' }, count: 3, limit: 2 },
      { id: 's1-3', at: now - 9 * day, type: 'info', severity: 'low', title: 'Webhook oluşturma kaydedildi', detail: 'yetkili_1 · #duyurular', module: 'webhookGuard', action: 'webhook', actor: { id: 'g01-u2', name: 'yetkili_1' }, count: 1, limit: 3 }
    ];

    // 3) Yeni eklenen sunucu: otomatik pasif, onay bekliyor
    guard.update('913555340000000002', {
      enabled: true,
      logChannelId: 'g02-c2',
      addedAt: now - 3600000,
      silent: true,
      silentAt: now - 3600000,
      silentReason: 'Yeni sunucu: operatör onayı bekleniyor'
    });

    // 4) Whitelist’te ama sahibi kapatmış
    guard.update('913555340000000001', {
      stats: {
        blocked: 12, deleted: 28, timeouts: 5, bans: 3, kicks: 2, stripped: 1, restored: 0,
        honeypot: 2, ads: 9, lastAt: now - 3 * day,
        byDay: {}
      }
    });
    guard.update('913555340000000003', {
      enabled: false,
      logChannelId: 'g03-c2',
      addedAt: now - 12 * day,
      approvedAt: now - 11 * day,
      approvedBy: 'kaptan',
      silent: false,
      windowSeconds: 120,
      punishment: 'kick'
    });
    db.guardEvents['913555340000000003'] = [
      { id: 's3-1', at: now - 11 * day, type: 'action', severity: 'low', title: 'Koruma kapatıldı', detail: 'İşlemi yapan: kurucu', module: null, action: null, actor: null, count: null, limit: null }
    ];

    // Onay bekleyen sunucuda da yedek görünsün (merkezden geri yükleme denenebilsin)
    guard.update('913555340000000002', {
      backup: {
        at: now - 2 * day,
        takenBy: 'kaptan',
        roles: [
          { id: 'g02-r1', name: 'Kurucu', color: '0', position: 5, hoist: true, mentionable: false, permissions: '8' },
          { id: 'g02-arch', name: 'Eski Yetkili', color: '0', position: 3, hoist: false, mentionable: false, permissions: '0' }
        ],
        channels: [
          { id: 'g02-c1', name: 'sohbet', type: 0, parentId: null, position: 0, topic: 'Sohbet', nsfw: false },
          { id: 'g02-arch-c', name: 'arsiv-sohbet', type: 0, parentId: null, position: 30, topic: null, nsfw: false }
        ]
      }
    });

    db.guardOps = [
      { id: 'op1', at: now - 3 * day, guildId: '913555340000000001', guildName: 'Gece Kulübü TR', action: 'revoke', detail: 'Kötüye kullanım: yetkililere toplu ban', actor: 'kaptan' },
      { id: 'op2', at: now - 3600000, guildId: '913555340000000002', guildName: 'Anime Sohbet', action: 'auto-pending', detail: 'Yeni sunucu eklendi — koruma otomatik pasif başladı (whitelist onayı bekliyor)', actor: 'bot' },
      { id: 'op3', at: now - 9 * day, guildId: '913555340000000003', guildName: 'Oyun Dünyası', action: 'approve', detail: 'Whitelist’e alındı — koruma çalışıyor', actor: 'kaptan' },
      { id: 'op4', at: now - 95 * day, guildId: GUILD.id, guildName: 'Demo Sunucu', action: 'approve', detail: 'Whitelist’e alındı — koruma çalışıyor', actor: 'kaptan' }
    ];
    save();
  }

  function demoCenterRows() {
    const rows = guard.guildStates(null).map((r) => {
      const meta = demoGuildMeta(r.id);
      return meta ? { ...r, name: meta.name, memberCount: meta.memberCount, online: true } : r;
    });
    const order = { pending: 0, silent: 1, active: 2, idle: 3 };
    rows.sort((a, b) => (order[a.status] - order[b.status]) || String(a.name).localeCompare(String(b.name), 'tr'));
    return rows;
  }

  function demoCenterPayload() {
    seedGuardCenter();
    const rows = demoCenterRows();
    return {
      ok: true,
      policy: guard.policy(),
      statusLabels: guard.STATUS_LABEL,
      stats: guard.policyStats(rows),
      guilds: rows,
      ops: guard.ops(80),
      modules: guard.MODULES,
      limitActions: guard.LIMIT_ACTIONS,
      punishments: guard.PUNISHMENTS,
      presets: guard.PRESETS,
      botReady: true
    };
  }

  const demoGuildId = (value) => {
    const id = String(value || '').trim();
    if (!/^[\w-]{3,32}$/.test(id)) throw Object.assign(new Error('Geçerli bir sunucu ID gir.'), { status: 400 });
    return id;
  };

  const demoGuardError = (res, err) => res.status(err.status || 400).json({ error: err.message });

  r.get('/api/guard/center', (req, res) => res.json(demoCenterPayload()));

  r.post('/api/guard/center/sync', (req, res) => {
    seedGuardCenter();
    const rows = demoCenterRows();
    rows.forEach((row) => guard.syncGuild({ id: row.id, name: row.name, memberCount: row.memberCount }));
    pushLog('guard', `Guard merkezi: ${rows.length} sunucu senkronize edildi`);
    res.json({ ...demoCenterPayload(), synced: rows.length });
  });

  r.post('/api/guard/center/policy', (req, res) => {
    seedGuardCenter();
    if (req.body?.autoBlockNewGuilds === undefined) return demoGuardError(res, new Error('autoBlockNewGuilds gerekli.'));
    guard.setAutoBlock(Boolean(req.body.autoBlockNewGuilds), 'kaptan');
    pushLog('guard', `Yeni sunucuları otomatik pasifleştirme ${req.body.autoBlockNewGuilds ? 'açıldı' : 'kapatıldı'}`);
    res.json(demoCenterPayload());
  });

  r.post('/api/guard/center/guild', (req, res) => {
    seedGuardCenter();
    let guildId;
    try { guildId = demoGuildId(req.body?.guildId); } catch (err) { return demoGuardError(res, err); }
    const action = String(req.body?.action || '');
    const reason = req.body?.reason ? String(req.body.reason).slice(0, 200) : null;
    const meta = demoGuildMeta(guildId);
    const name = meta ? meta.name : guildId;
    let result = null;
    if (action === 'approve') {
      result = guard.approveGuild(guildId, { actor: 'kaptan', note: req.body?.note || null });
      pushLog('guard', `${name} whitelist'e alındı — koruma çalışıyor`);
    } else if (action === 'revoke') {
      result = guard.revokeGuild(guildId, { actor: 'kaptan', reason });
      pushLog('guard', `${name} whitelist'ten çıkarıldı ve sessize alındı${reason ? ` (${reason})` : ''}`);
    } else if (action === 'silent') {
      result = guard.setSilent(guildId, true, { actor: 'kaptan', reason });
      pushLog('guard', `${name} sessize alındı — sunucuya normal görünüyor`);
    } else if (action === 'unsilent') {
      result = guard.setSilent(guildId, false, { actor: 'kaptan' });
      pushLog('guard', `${name} sessiz moddan çıkarıldı`);
    } else if (action === 'enable' || action === 'disable') {
      guard.setEnabled(guildId, action === 'enable', 'kaptan');
      pushLog('guard', `${name} için görünür koruma ${action === 'enable' ? 'açıldı' : 'kapatıldı'}`);
    } else {
      return demoGuardError(res, new Error('Bilinmeyen işlem. (approve, revoke, silent, unsilent, enable, disable)'));
    }
    const rows = demoCenterRows();
    res.json({ ...demoCenterPayload(), changed: rows.find((x) => x.id === guildId) || null, result });
  });

  r.get('/api/guard/center/guild/detail', (req, res) => {
    seedGuardCenter();
    let guildId;
    try { guildId = demoGuildId(req.query?.guildId); } catch (err) { return demoGuardError(res, err); }
    const cfg = guard.get(guildId);
    const data = demoGuildData(guildId);
    const g = demoGuardGuild(guildId);
    res.json({
      ok: true,
      guild: demoCenterRows().find((x) => x.id === guildId) || null,
      admin: guard.adminSummary(guildId, g),
      guard: { ...cfg, whitelist: demoWhitelistView(guildId, cfg) },
      modules: guard.MODULES,
      limitActions: guard.LIMIT_ACTIONS,
      punishments: guard.PUNISHMENTS,
      honeypotActions: guard.HONEYPOT_ACTIONS,
      adActions: guard.AD_ACTIONS,
      presets: guard.PRESETS,
      statsSeries: guard.daySeries(guildId, 14),
      events: guard.events(guildId, 60),
      ops: guard.ops(200).filter((o) => o.guildId === guildId),
      textChannels: data.channels.filter((c) => ['text', 'announcement'].includes(c.type)).map((c) => ({ id: c.id, name: c.name })),
      roles: data.roles.map((x) => ({ id: x.id, name: x.name })),
      online: true
    });
  });

  r.post('/api/guard/center/config', (req, res) => {
    seedGuardCenter();
    let guildId;
    try { guildId = demoGuildId(req.body?.guildId); } catch (err) { return demoGuardError(res, err); }
    const body = req.body || {};
    const result = guard.setConfig(guildId, body);
    if (!result.ok) return demoGuardError(res, new Error(result.error));
    if (Array.isArray(body.whitelist)) {
      guard.update(guildId, { whitelist: body.whitelist.map((x) => String(x).replace(/[<@!>]/g, '')).filter((x) => /^[\w-]{3,32}$/.test(x)) });
    }
    if (body.enabled !== undefined && Boolean(body.enabled) !== guard.get(guildId).enabled) guard.setEnabled(guildId, Boolean(body.enabled), 'kaptan');
    guard.pushOps({ guildId, guildName: demoGuildMeta(guildId)?.name || null, action: 'config', detail: `Ayarlar güncellendi: ${Object.keys(body).join(', ') || 'genel'}`, actor: 'kaptan' });
    pushLog('guard', `${demoGuildMeta(guildId)?.name || guildId} guard ayarları merkezden güncellendi`);
    const cfg = guard.get(guildId);
    res.json({
      ok: true,
      guild: demoCenterRows().find((x) => x.id === guildId) || null,
      admin: guard.adminSummary(guildId, demoGuardGuild(guildId)),
      guard: { ...cfg, whitelist: demoWhitelistView(guildId, cfg) }
    });
  });

  r.post('/api/guard/center/preset', (req, res) => {
    seedGuardCenter();
    let guildId;
    try { guildId = demoGuildId(req.body?.guildId); } catch (err) { return demoGuardError(res, err); }
    const result = guard.applyPreset(guildId, req.body?.preset || 'dengeli');
    guard.pushOps({ guildId, guildName: demoGuildMeta(guildId)?.name || null, action: 'preset', detail: `Hazır ayar: ${result.preset}`, actor: 'kaptan' });
    const cfg = guard.get(guildId);
    res.json({
      ok: true,
      guild: demoCenterRows().find((x) => x.id === guildId) || null,
      admin: guard.adminSummary(guildId, demoGuardGuild(guildId)),
      guard: { ...cfg, whitelist: demoWhitelistView(guildId, cfg) },
      statsSeries: guard.daySeries(guildId, 14)
    });
  });

  r.post('/api/guard/center/honeypot', async (req, res) => {
    seedGuardCenter();
    let guildId;
    try { guildId = demoGuildId(req.body?.guildId); } catch (err) { return demoGuardError(res, err); }
    const action = String(req.body?.action || 'setup');
    let result;
    if (action === 'setup') {
      const cfg = guard.get(guildId);
      if (cfg.honeypot.channelId) result = { ok: true, channelId: cfg.honeypot.channelId, existing: true };
      else result = await guard.createHoneypotChannel(demoGuardGuild(guildId));
    } else if (action === 'role') {
      result = { ok: true, roleId: 'r-honey', existing: true };
    } else if (action === 'disable') {
      result = guard.honeypotDisable(guildId);
    } else {
      return demoGuardError(res, new Error('Bilinmeyen honeypot işlemi.'));
    }
    if (!result.ok) return demoGuardError(res, new Error(result.error || 'Honeypot işlemi başarısız.'));
    guard.pushOps({ guildId, guildName: demoGuildMeta(guildId)?.name || null, action: 'honeypot', detail: `Honeypot: ${action}`, actor: 'kaptan' });
    const cfg = guard.get(guildId);
    res.json({
      ok: true,
      result,
      guild: demoCenterRows().find((x) => x.id === guildId) || null,
      admin: guard.adminSummary(guildId, demoGuardGuild(guildId)),
      guard: { ...cfg, whitelist: demoWhitelistView(guildId, cfg) },
      events: guard.events(guildId, 60)
    });
  });

  r.post('/api/guard/center/ad-sim', (req, res) => {
    seedGuardCenter();
    let guildId;
    try { guildId = demoGuildId(req.body?.guildId); } catch (err) { return demoGuardError(res, err); }
    const text = String(req.body?.text || '').slice(0, 2000);
    if (!text.trim()) return demoGuardError(res, new Error('Test için bir metin yaz.'));
    res.json({ ok: true, analysis: guard.analyzeAd(text, guard.get(guildId)) });
  });

  r.post('/api/guard/center/restore', async (req, res) => {
    seedGuardCenter();
    let guildId;
    try { guildId = demoGuildId(req.body?.guildId); } catch (err) { return demoGuardError(res, err); }
    const result = await guard.restoreBackup(demoGuardGuild(guildId), { limiter: 20 });
    if (!result.ok) return demoGuardError(res, Object.assign(new Error(result.error || 'Geri yükleme başarısız.'), { status: 400 }));
    guard.pushOps({ guildId, guildName: demoGuildMeta(guildId)?.name || null, action: 'restore', detail: `Geri yükleme: ${result.roles || 0} rol, ${result.channels || 0} kanal`, actor: 'kaptan' });
    res.json({ ok: true, ...result, guild: demoCenterRows().find((x) => x.id === guildId) || null, events: guard.events(guildId, 60) });
  });

  r.post('/api/guard/center/panic', async (req, res) => {
    seedGuardCenter();
    let guildId;
    try { guildId = demoGuildId(req.body?.guildId); } catch (err) { return demoGuardError(res, err); }
    const result = await guard.panic(demoGuardGuild(guildId), 'kaptan');
    if (!result.ok) return demoGuardError(res, Object.assign(new Error(result.error || 'Panik modu çalıştırılamadı.'), { status: 400 }));
    guard.pushOps({ guildId, guildName: demoGuildMeta(guildId)?.name || null, action: 'panic', detail: `PANİK: ${result.roles || 0} rol`, actor: 'kaptan' });
    res.json({ ok: true, ...result, guild: demoCenterRows().find((x) => x.id === guildId) || null, events: guard.events(guildId, 60) });
  });

  r.post('/api/guard/center/note', (req, res) => {
    seedGuardCenter();
    let guildId;
    try { guildId = demoGuildId(req.body?.guildId); } catch (err) { return demoGuardError(res, err); }
    const result = guard.setNote(guildId, req.body?.text || '', 'kaptan');
    res.json({ ok: true, note: result.note, guild: demoCenterRows().find((x) => x.id === guildId) || null, ops: guard.ops(80) });
  });

  r.get('/api/guard/center/events', (req, res) => {
    seedGuardCenter();
    let guildId;
    try { guildId = demoGuildId(req.query?.guildId); } catch (err) { return demoGuardError(res, err); }
    res.json({ ok: true, guildId, events: guard.events(guildId, 80), admin: guard.adminSummary(guildId, demoGuardGuild(guildId)) });
  });

  r.post('/api/guard/center/events/clear', (req, res) => {
    seedGuardCenter();
    let guildId;
    try { guildId = demoGuildId(req.body?.guildId); } catch (err) { return demoGuardError(res, err); }
    guard.clearEvents(guildId);
    guard.pushOps({ guildId, guildName: demoGuildMeta(guildId)?.name || null, action: 'events-clear', detail: 'Olay akışı temizlendi', actor: 'kaptan' });
    res.json({ ok: true, guildId, events: [] });
  });

  r.post('/api/guard/center/test', (req, res) => {
    seedGuardCenter();
    let guildId;
    try { guildId = demoGuildId(req.body?.guildId); } catch (err) { return demoGuardError(res, err); }
    const event = guard.runTest(demoGuardGuild(guildId), 'kaptan');
    guard.pushOps({ guildId, guildName: demoGuildMeta(guildId)?.name || null, action: 'test', detail: 'Örnek guard kaydı üretildi', actor: 'kaptan' });
    res.json({ ok: true, event, events: guard.events(guildId, 80) });
  });

  r.post('/api/guard/center/backup', (req, res) => {
    seedGuardCenter();
    let guildId;
    try { guildId = demoGuildId(req.body?.guildId); } catch (err) { return demoGuardError(res, err); }
    const result = guard.takeBackup(demoGuardGuild(guildId));
    guard.pushOps({ guildId, guildName: demoGuildMeta(guildId)?.name || null, action: 'backup', detail: `Yedek alındı: ${result.roles} rol, ${result.channels} kanal`, actor: 'kaptan' });
    pushLog('guard', `${demoGuildMeta(guildId)?.name || guildId} yedeği alındı (${result.roles} rol, ${result.channels} kanal)`);
    res.json({ ok: true, ...result, guild: demoCenterRows().find((x) => x.id === guildId) || null });
  });

  r.get('/api/guard/center/ops', (req, res) => {
    seedGuardCenter();
    res.json({ ok: true, ops: guard.ops(200) });
  });

  r.post('/api/guard/center/ops/clear', (req, res) => {
    guard.clearOps();
    pushLog('guard', 'Operatör işlem kayıtları temizlendi');
    res.json({ ok: true, ops: [] });
  });


  r.get('/api/bot/invite', (req, res) =>
    res.json({ url: 'https://discord.com/oauth2/authorize?client_id=DEMO&permissions=8&scope=bot' })
  );

  return r;
}

module.exports = { router };
