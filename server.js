/**
 * Web paneli sunucusu.
 * - Discord OAuth2 ile giriş (botu yönetmek isteyen kullanıcı, sunucudaki kendi yetkileriyle işlem yapar)
 * - Moderasyon / kanal / rol / eğlence API'leri
 * - Discord.js client aynı süreçte çalışır (tek servis, Render ücretsiz plana uygun)
 */
const express = require('express');
const cookieSession = require('cookie-session');
const crypto = require('crypto');
const path = require('path');
const { PermissionsBitField } = require('discord.js');

const settings = require('./src/settings');
const mod = require('./src/moderation');
const eco = require('./src/economy');
const games = require('./src/games');
const { botState, startBot } = require('./src/bot');
const { db } = require('./src/store');

const app = express();
const anonymousWebhookCache = new Map();
const PORT = process.env.PORT || 10000;

async function getAnonymousWebhook(channel) {
  const cached = anonymousWebhookCache.get(String(channel.id));
  if (cached) return cached;

  const hooks = await channel.fetchWebhooks();
  let hook = hooks.find((webhook) => webhook.owner?.id === botState.client.user.id && ['Anonymous', 'Anonim Modu', 'LORES Anonymous'].includes(webhook.name));
  if (hook && hook.name !== 'Anonymous') {
    hook = await hook.edit({ name: 'Anonymous', reason: 'Anonymous mesaj modu güncellemesi' });
  }
  if (!hook) {
    hook = await channel.createWebhook({ name: 'Anonymous', reason: 'Anonymous mesaj modu' });
  }
  anonymousWebhookCache.set(String(channel.id), hook);
  return hook;
}

async function sendAnonymousMessage(channel, payload) {
  let hook = await getAnonymousWebhook(channel);
  try {
    return await hook.send(payload);
  } catch (err) {
    if (Number(err.code) !== 10015) throw err;
    anonymousWebhookCache.delete(String(channel.id));
    hook = await getAnonymousWebhook(channel);
    return hook.send(payload);
  }
}
const CLIENT_ID = (process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID || '').trim();
const ADMIN_USER = (process.env.ADMIN_USER || process.env.PANEL_USER || '').trim();
const ADMIN_PASS = (process.env.ADMIN_PASS || process.env.PANEL_PASS || '').trim();

function detectBaseUrl(port) {
  const clean = (v) => String(v || '').trim().replace(/\/+$/, '');
  const explicit = clean(process.env.PUBLIC_URL);
  const renderUrl = clean(process.env.RENDER_EXTERNAL_URL);
  const renderHost = clean(process.env.RENDER_EXTERNAL_HOSTNAME);
  if (explicit && !/localhost|127\.0\.0\.1/i.test(explicit)) return explicit;
  if (renderUrl) return renderUrl;
  if (renderHost) return `https://${renderHost}`;
  return explicit || `http://localhost:${port}`;
}

const BASE_URL = detectBaseUrl(PORT);
const SESSION_SECRET = (
  process.env.SESSION_SECRET ||
  crypto.createHash('sha256').update(`${ADMIN_USER}:${ADMIN_PASS}:${process.env.DISCORD_TOKEN || 'panel'}`).digest('hex')
).trim();

const CRED_HASH =
  ADMIN_USER && ADMIN_PASS
    ? crypto.createHash('sha256').update(`${ADMIN_USER}\0${ADMIN_PASS}`).digest('hex').slice(0, 16)
    : '';

function safeEqual(a, b) {
  const h1 = crypto.createHash('sha256').update(String(a || '')).digest();
  const h2 = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(h1, h2);
}

// Hatalı şifre denemelerine karşı basit IP koruması (15 dk içinde en fazla 8 deneme)
const loginAttempts = new Map();
const MAX_ATTEMPTS = 8;
const LOCK_WINDOW_MS = 15 * 60 * 1000;

function checkLoginLimit(ip) {
  const rec = loginAttempts.get(ip);
  if (!rec) return null;
  if (Date.now() > rec.resetAt) {
    loginAttempts.delete(ip);
    return null;
  }
  if (rec.count >= MAX_ATTEMPTS) {
    const mins = Math.max(1, Math.ceil((rec.resetAt - Date.now()) / 60000));
    return `Çok fazla hatalı deneme. ${mins} dakika sonra tekrar dene.`;
  }
  return null;
}

function recordFailedLogin(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec || now > rec.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOCK_WINDOW_MS });
  } else {
    rec.count += 1;
  }
}

app.use(express.json());
app.set('trust proxy', 1);
app.use(
  cookieSession({
    name: 'panel',
    secret: SESSION_SECRET,
    maxAge: 1000 * 60 * 60 * 24 * 7,
    sameSite: 'lax',
    httpOnly: true
  })
);
app.use(express.static(path.join(__dirname, 'public')));

// DEMO_MODE=1 ise Discord tokeni olmadan sahte veriyle panel denenebilir.
const DEMO_MODE = process.env.DEMO_MODE === '1' || process.env.DEMO_MODE === 'true';
if (DEMO_MODE) {
  console.log('[demo] DEMO_MODE aktif — sahte sunucu verisi kullanılıyor.');
  app.use(require('./src/demo').router());
}

// ---------------------------------------------------------------- OTURUM DOĞRULAMA
function isAuthenticated(req) {
  if (DEMO_MODE) return Boolean(req.session && req.session.user);
  if (!ADMIN_USER || !ADMIN_PASS) return false;
  return Boolean(req.session && req.session.user && req.session.credHash === CRED_HASH);
}

// ---------------------------------------------------------------- YARDIMCILAR
const client = () => botState.client;

function getGuild(guildId) {
  const c = client();
  if (!c || !botState.ready) throw new Error('Bot henüz Discord\'a bağlanmadı.');
  const guild = c.guilds.cache.get(guildId);
  if (!guild) throw new Error('Sunucu bulunamadı. Bot bu sunucuda mı?');
  return guild;
}

function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  req.session = null;
  res.status(401).json({ error: 'Giriş yapmalısın.' });
}

function wrap(handler) {
  return (req, res) => {
    Promise.resolve(handler(req, res)).catch((err) => {
      console.error('[api]', err);
      res.status(400).json({ error: err.message || 'Beklenmeyen hata' });
    });
  };
}

const MOD_PERMS = PermissionsBitField.Flags;

/** Doğrulanmış panel yöneticisi için aktör nesnesi (sunucu sınırını botun kendi yetkileri belirler). */
async function actorOf(req, guild) {
  const user = req.session.user;
  return {
    id: user.id,
    user: { id: user.id, tag: `${user.username}#panel`, username: user.username },
    permissions: new PermissionsBitField(PermissionsBitField.Flags.Administrator),
    roles: { highest: { position: 999999 }, cache: new Set() },
    guildOwner: true,
    panelFounder: true
  };
}

function botInviteUrl() {
  // Davet edilen uygulama her zaman çalışan bot tokenindeki bot olmalı. Eski veya
  // başka bir uygulamaya ait CLIENT_ID, Discord'un uygulama açılışında takılmasına
  // ya da yanlış botun davet edilmesine yol açabilir.
  const appId = (botState.client && botState.client.user ? botState.client.user.id : '') || CLIENT_ID;
  if (!appId) return null;
  const params = new URLSearchParams({
    client_id: appId,
    permissions: '8',
    scope: 'bot applications.commands',
    integration_type: '0'
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

// ---------------------------------------------------------------- OTURUM
app.get('/auth/login', (req, res) => res.redirect('/'));

app.post('/auth/login', async (req, res) => {
  if (!ADMIN_USER || !ADMIN_PASS) {
    return res.status(400).json({
      error: 'Panel girişi ayarlanmamış. Render > Environment bölümüne ADMIN_USER ve ADMIN_PASS ekle.'
    });
  }
  const ip = req.ip || 'unknown';
  const lockedMsg = checkLoginLimit(ip);
  if (lockedMsg) return res.status(429).json({ error: lockedMsg });

  const { username, password } = req.body || {};
  const okUser = safeEqual(String(username || '').trim(), ADMIN_USER);
  const okPass = safeEqual(String(password || ''), ADMIN_PASS);

  if (!okUser || !okPass) {
    recordFailedLogin(ip);
    await new Promise((r) => setTimeout(r, 300));
    console.warn(`[auth] Hatalı giriş denemesi (${ip})`);
    return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
  }

  loginAttempts.delete(ip);
  req.session = {
    user: {
      id: 'panel-' + ADMIN_USER,
      username: ADMIN_USER,
      globalName: ADMIN_USER,
      avatar: null
    },
    credHash: CRED_HASH
  };
  res.json({ ok: true, user: req.session.user });
});

app.post('/auth/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const loggedIn = isAuthenticated(req);
  if (req.session && req.session.user && !loggedIn) req.session = null;

  const hasAuthCfg = Boolean(ADMIN_USER && ADMIN_PASS);
  const hasToken = Boolean(process.env.DISCORD_TOKEN);

  const out = {
    user: loggedIn ? req.session.user : null,
    authMode: 'password',
    configured: hasAuthCfg && hasToken,
    missingAuth: !hasAuthCfg,
    missingToken: !hasToken,
    botReady: botState.ready
  };

  if (loggedIn) {
    out.botError = botState.error;
    out.botTag = botState.ready ? botState.client.user.tag : null;
    out.inviteUrl = botInviteUrl();
    out.setup = setupReport();
  }
  res.json(out);
});

function setupReport() {
  const checks = [];
  const add = (ok, title, hint) => checks.push({ ok, title, hint });

  add(Boolean(ADMIN_USER), 'ADMIN_USER tanımlı', 'Render > Environment: ADMIN_USER = panel kullanıcı adın');
  add(Boolean(ADMIN_PASS), 'ADMIN_PASS tanımlı', 'Render > Environment: ADMIN_PASS = güçlü bir panel şifresi');
  add(Boolean(process.env.DISCORD_TOKEN), 'DISCORD_TOKEN tanımlı', 'Developer Portal > Bot > Reset Token ile bot tokeni al');
  add(botState.ready, 'Bot Discord sunucusuna bağlı', botState.error || 'Loglarda "[bot]" satırlarına bak');
  add(!DEMO_MODE, 'DEMO_MODE kapalı', 'DEMO_MODE=0 olmalı (1 ise sahte veri kullanılır)');

  return {
    baseUrl: BASE_URL,
    demoMode: DEMO_MODE,
    botReady: botState.ready,
    botError: botState.error,
    node: process.version,
    checks
  };
}

app.get('/setup', (req, res) => {
  if (!isAuthenticated(req)) return res.redirect('/');
  const r = setupReport();
  const rows = r.checks
    .map(
      (c) => `<tr>
        <td style="font-size:20px">${c.ok ? '✅' : '⚠️'}</td>
        <td><b>${c.title}</b><div style="color:#8b93ab;font-size:12.5px;margin-top:2px">${c.hint}</div></td>
      </tr>`
    )
    .join('');

  res.type('html').send(`<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Kurulum Teşhisi</title>
  <style>
    body{font-family:system-ui,'Segoe UI',sans-serif;background:#0b0d13;color:#e8ebf5;padding:24px;line-height:1.6}
    .wrap{max-width:760px;margin:0 auto}
    h1{font-size:22px;margin-bottom:6px}
    .card{background:#161a25;border:1px solid #262c3d;border-radius:14px;padding:20px;margin-top:16px}
    table{width:100%;border-collapse:collapse}td{padding:9px 4px;border-bottom:1px solid #202636;vertical-align:top}
    .big{font-size:15px;margin:8px 0}
    a.btn{display:inline-block;background:#5865f2;color:#fff;padding:11px 18px;border-radius:10px;text-decoration:none;font-weight:600;margin-top:14px}
    .muted{color:#8b93ab;font-size:12.5px}
  </style></head><body><div class="wrap">
    <h1>🔧 Kurulum Teşhisi</h1>
    <div class="card"><table>${rows}</table><a class="btn" href="/">Panele dön</a></div>
    <div class="card">
      <div class="big">Bot durumu</div>
      <div>${r.botReady ? '🟢 Çevrimiçi' : '🔴 Çevrimdışı'}</div>
      ${r.botError ? `<div class="muted" style="margin-top:6px">Hata: ${r.botError}</div>` : ''}
      <div class="muted" style="margin-top:8px">Node: ${r.node} · DEMO_MODE: ${r.demoMode ? 'AÇIK' : 'kapalı'}</div>
    </div>
  </div></body></html>`);
});

/** Botun bulunduğu TÜM sunucular (kurucu her sunucuyu inceleyip yönetebilir). */
app.get(
  '/api/guilds',
  requireAuth,
  wrap(async (req, res) => {
    const c = client();
    const botGuilds = c && botState.ready ? [...c.guilds.cache.values()] : [];

    const result = botGuilds
      .map((g) => {
        const me = g.members.me;
        const perms = me ? me.permissions : new PermissionsBitField(0n);
        const isAdmin = perms.has(MOD_PERMS.Administrator);
        const canManageChannels = perms.has(MOD_PERMS.ManageChannels);
        return {
          id: g.id,
          name: g.name,
          icon: g.iconURL({ size: 128 }),
          ownerId: g.ownerId,
          owner: g.ownerId === req.session.user.id,
          canManage: isAdmin || canManageChannels || perms.has(MOD_PERMS.ManageGuild),
          botIsAdmin: isAdmin,
          memberCount: g.memberCount,
          channelCount: g.channels.cache.size
        };
      })
      .sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0) || a.name.localeCompare(b.name, 'tr'));

    res.json({ guilds: result });
  })
);

app.post(
  '/api/guild/select',
  requireAuth,
  wrap(async (req, res) => {
    const { guildId } = req.body || {};
    if (!guildId) throw new Error('guildId gerekli.');
    const guild = getGuild(guildId);
    req.session.guildId = guildId;
    res.json({ ok: true, guild: { id: guild.id, name: guild.name } });
  })
);

// ---------------------------------------------------------------- SUNUCU DURUMU
app.get(
  '/api/overview',
  requireAuth,
  wrap(async (req, res) => {
    const guild = getGuild(req.session.guildId);
    const actor = await actorOf(req, guild);
    const me = guild.members.me;
    const botPerms = me ? me.permissions : new PermissionsBitField(0n);

    const memberCount = guild.memberCount;
    const channels = [...guild.channels.cache.values()];
    const counts = { text: 0, voice: 0, category: 0, other: 0 };
    for (const ch of channels) {
      const t = mod.channelTypeName(ch.type);
      if (t === 'text' || t === 'announcement' || t === 'forum') counts.text += 1;
      else if (t === 'voice' || t === 'stage') counts.voice += 1;
      else if (t === 'category') counts.category += 1;
      else counts.other += 1;
    }

    const bans = await guild.bans.fetch().catch(() => null);

    res.json({
      guild: {
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL({ size: 128 }),
        ownerId: guild.ownerId,
        createdAt: guild.createdTimestamp,
        memberCount,
        botCount: guild.members.cache.filter((m) => m.user.bot).size,
        boostLevel: guild.premiumTier,
        boostCount: guild.premiumSubscriptionCount || 0,
        locale: guild.preferredLocale,
        description: guild.description
      },
      user: {
        id: actor.id,
        username: actor.user.username,
        isAdmin: mod.isAdmin(actor),
        isOwner: actor.guildOwner,
        permissions: actor.permissions.toArray()
      },
      bot: {
        ready: botState.ready,
        tag: botState.ready ? botState.client.user.tag : null,
        ping: botState.ready ? botState.client.ws.ping : null,
        uptime: botState.ready ? Date.now() - botState.client.readyTimestamp : 0,
        commands: botState.commands,
        guildCount: botState.ready ? botState.client.guilds.cache.size : 0,
        permissions: botPerms.toArray()
      },
      counts: {
        ...counts,
        bans: bans ? bans.size : null,
        roles: guild.roles.cache.size,
        emojis: guild.emojis.cache.size
      },
      recentLogs: (db.logs[guild.id] || []).slice(0, 12)
    });
  })
);

// ---------------------------------------------------------------- ÜYELER
app.get(
  '/api/members',
  requireAuth,
  wrap(async (req, res) => {
    const guild = getGuild(req.session.guildId);
    let members;
    if (guild.members.cache.size < guild.memberCount) {
      members = await guild.members.fetch();
    } else {
      members = guild.members.cache;
    }
    const q = String(req.query.q || '').toLowerCase();
    const list = [...members.values()]
      .filter((m) => !q || m.user.username.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q) || m.id.includes(q))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'tr'))
      .slice(0, 500)
      .map((m) => ({
        id: m.id,
        username: m.user.username,
        displayName: m.displayName,
        avatar: m.displayAvatarURL({ size: 64 }),
        bot: m.user.bot,
        joinedAt: m.joinedTimestamp,
        createdAt: m.user.createdTimestamp,
        muted: Boolean(m.communicationDisabledUntil && m.communicationDisabledUntil > Date.now()) ||
          m.roles.cache.some((r) => r.name === mod.MUTE_ROLE_NAME),
        mutedUntil: m.communicationDisabledUntil ? m.communicationDisabledUntil.getTime() : null,
        highestRole: m.roles.highest ? { id: m.roles.highest.id, name: m.roles.highest.name, color: m.roles.highest.hexColor } : null,
        topRolePosition: m.roles.highest.position,
        warnings: mod.warningsOf(guild.id, m.id).length
      }));

    res.json({
      total: guild.memberCount,
      members: list
    });
  })
);

app.get(
  '/api/members/:id',
  requireAuth,
  wrap(async (req, res) => {
    const guild = getGuild(req.session.guildId);
    const member = await guild.members.fetch(req.params.id).catch(() => null);
    if (!member) throw new Error('Üye bulunamadı.');
    const roles = [...member.roles.cache.values()]
      .filter((r) => r.id !== guild.id)
      .sort((a, b) => b.position - a.position)
      .map((r) => ({ id: r.id, name: r.name, color: r.hexColor, position: r.position, managed: r.managed }));

    res.json({
      id: member.id,
      username: member.user.username,
      displayName: member.displayName,
      avatar: member.displayAvatarURL({ size: 256 }),
      banner: member.user.bannerURL({ size: 512 }),
      bot: member.user.bot,
      createdAt: member.user.createdTimestamp,
      joinedAt: member.joinedTimestamp,
      roles,
      muted: Boolean(member.communicationDisabledUntil && member.communicationDisabledUntil > Date.now()) ||
        member.roles.cache.some((r) => r.name === mod.MUTE_ROLE_NAME),
      mutedUntil: member.communicationDisabledUntil ? member.communicationDisabledUntil.getTime() : null,
      warnings: mod.warningsOf(guild.id, member.id)
    });
  })
);

// ---------------------------------------------------------------- MODERASYON
async function modAction(req, res, fn) {
  const guild = getGuild(req.session.guildId);
  const actor = await actorOf(req, guild);
  const { userId, reason } = req.body || {};
  if (!userId) throw new Error('userId gerekli.');
  const result = await fn(guild, actor, userId, req.body || {});
  settings.log(
    guild.id,
    'site',
    `${actor.user.username} → ${result.ok ? 'başarılı' : 'başarısız'} işlem (${userId}) ${reason || ''}`,
    actor.user.username
  );
  const target = guild.members.cache.get(userId);
  if (result.ok) notifyLog(guild.id, `**${actor.user.username}** panelden işlem yaptı: <@${userId}> — ${result.message}`);
  res.json({ ...result, target: target ? { id: target.id, displayName: target.displayName } : null });
}

function notifyLog(guildId, text) {
  const cfg = settings.get(guildId);
  if (!cfg.logChannelId) return;
  const c = client();
  if (!c) return;
  const channel = c.channels.cache.get(cfg.logChannelId);
  if (channel && channel.isTextBased()) channel.send({ content: text }).catch(() => {});
}

app.post('/api/mod/ban', requireAuth, wrap((req, res) => modAction(req, res, (guild, actor, userId, body) => mod.ban(guild, actor, userId, body.reason, Math.min(Number(body.deleteSeconds) || 0, 604800)))));

app.post('/api/mod/unban', requireAuth, wrap((req, res) => modAction(req, res, (guild, actor, userId, body) => mod.unban(guild, actor, userId, body.reason))));

app.post('/api/mod/kick', requireAuth, wrap((req, res) => modAction(req, res, (guild, actor, userId, body) => mod.kick(guild, actor, userId, body.reason))));

app.post('/api/mod/mute', requireAuth, wrap((req, res) => modAction(req, res, (guild, actor, userId, body) => mod.mute(guild, actor, userId, body.durationMs, body.reason))));

app.post('/api/mod/unmute', requireAuth, wrap((req, res) => modAction(req, res, (guild, actor, userId, body) => mod.unmute(guild, actor, userId, body.reason))));

app.post('/api/mod/warn', requireAuth, wrap((req, res) => modAction(req, res, (guild, actor, userId, body) => mod.warn(guild, actor, userId, body.reason))));

app.post('/api/mod/bulk', requireAuth, wrap(async (req, res) => {
  const guild = getGuild(req.session.guildId);
  const actor = await actorOf(req, guild);
  const { action, userIds, reason, durationMs, deleteSeconds, roleId } = req.body || {};
  const ids = [...new Set(Array.isArray(userIds) ? userIds.map(String) : [])].slice(0, 50);
  if (!ids.length) throw new Error('İşlem yapılacak üye seçilmedi.');
  const actions = {
    ban: (id) => mod.ban(guild, actor, id, reason, Math.min(Number(deleteSeconds) || 0, 604800)),
    unban: (id) => mod.unban(guild, actor, id, reason),
    kick: (id) => mod.kick(guild, actor, id, reason),
    mute: (id) => mod.mute(guild, actor, id, Number(durationMs) || 600000, reason),
    unmute: (id) => mod.unmute(guild, actor, id, reason),
    warn: (id) => mod.warn(guild, actor, id, reason),
    addRole: (id) => mod.addRole(guild, actor, id, roleId),
    removeRole: (id) => mod.removeRole(guild, actor, id, roleId)
  };
  if (!actions[action]) throw new Error('Geçersiz toplu işlem.');
  if ((action === 'addRole' || action === 'removeRole') && !roleId) throw new Error('Rol seçilmedi.');
  const results = [];
  for (const id of ids) {
    const result = await actions[action](id);
    results.push({ userId: id, ...result });
  }
  const succeeded = results.filter((r) => r.ok).length;
  settings.log(guild.id, 'site', `${actor.user.username} toplu ${action} işlemi yaptı (${succeeded}/${ids.length})`);
  res.json({ ok: succeeded > 0, succeeded, failed: ids.length - succeeded, results });
}));

app.post(
  '/api/mod/warnings/clear',
  requireAuth,
  wrap(async (req, res) => {
    const guild = getGuild(req.session.guildId);
    const actor = await actorOf(req, guild);
    if (!mod.isAdmin(actor)) throw new Error('Bu işlem için yönetici yetkisi gerekli.');
    mod.clearWarnings(guild.id, req.body.userId);
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- YASAKLILAR
app.get(
  '/api/bans',
  requireAuth,
  wrap(async (req, res) => {
    const guild = getGuild(req.session.guildId);
    const bans = await guild.bans.fetch();
    res.json({
      bans: [...bans.values()].map((b) => ({
        id: b.user.id,
        username: b.user.username,
        avatar: b.user.displayAvatarURL({ size: 64 }),
        reason: b.reason
      }))
    });
  })
);

// ---------------------------------------------------------------- KANALLAR
app.get(
  '/api/channels',
  requireAuth,
  wrap(async (req, res) => {
    const guild = getGuild(req.session.guildId);
    const channels = [...guild.channels.cache.values()]
      .map((ch) => ({
        id: ch.id,
        name: ch.name,
        type: mod.channelTypeName(ch.type),
        rawType: ch.type,
        parentId: ch.parentId,
        position: ch.position,
        topic: ch.topic || null,
        locked: Boolean(ch.permissionOverwrites?.cache?.get(guild.id)?.deny?.has(PermissionsBitField.Flags.SendMessages)),
        nsfw: Boolean(ch.nsfw),
        userLimit: ch.userLimit || 0,
        bitrate: ch.bitrate || null
      }))
      .sort((a, b) => a.position - b.position);
    res.json({ channels });
  })
);

app.post('/api/channels/create', requireAuth, wrap(async (req, res) => {
  const guild = getGuild(req.session.guildId);
  const actor = await actorOf(req, guild);
  const result = await mod.createChannel(guild, actor, req.body || {});
  if (result.ok) settings.log(guild.id, 'channel', `${actor.user.username} kanal oluşturdu: ${req.body.name}`);
  res.json(result);
}));

app.post('/api/channels/bulk/create', requireAuth, wrap(async (req, res) => {
  const guild = getGuild(req.session.guildId);
  const actor = await actorOf(req, guild);
  const { names, type, categoryId } = req.body || {};
  const cleanNames = [...new Set(Array.isArray(names) ? names.map((n) => String(n).trim()).filter(Boolean) : [])].slice(0, 50);
  if (!cleanNames.length) throw new Error('Oluşturulacak kanal adlarını gir.');
  const results = [];
  for (const name of cleanNames) results.push({ name, ...(await mod.createChannel(guild, actor, { name, type, categoryId })) });
  const created = results.filter((r) => r.ok).length;
  if (created) settings.log(guild.id, 'channel', `${actor.user.username} toplu kanal oluşturdu (${created})`);
  res.json({ ok: created > 0, created, failed: results.length - created, results });
}));

app.post('/api/channels/rename', requireAuth, wrap(async (req, res) => {
  const guild = getGuild(req.session.guildId);
  const actor = await actorOf(req, guild);
  const { channelId, name } = req.body || {};
  const result = await mod.renameChannel(guild, actor, channelId, name);
  if (result.ok) settings.log(guild.id, 'channel', `${actor.user.username} kanal adını değiştirdi: ${name}`);
  res.json(result);
}));

app.post('/api/channels/topic', requireAuth, wrap(async (req, res) => {
  const guild = getGuild(req.session.guildId);
  const actor = await actorOf(req, guild);
  const { channelId, topic } = req.body || {};
  const result = await mod.setChannelTopic(guild, actor, channelId, topic);
  res.json(result);
}));

app.post('/api/channels/message', requireAuth, wrap(async (req, res) => {
  const guild = getGuild(req.session.guildId);
  const actor = await actorOf(req, guild);
  const channel = guild.channels.cache.get(String(req.body.channelId || ''));
  if (!channel || typeof channel.send !== 'function' || !['text', 'announcement'].includes(mod.channelTypeName(channel.type))) {
    throw new Error('Bu kanala panelden mesaj gönderilemez.');
  }
  const content = String(req.body.content || '').trim().slice(0, 2000);
  if (!content) throw new Error('Mesaj boş olamaz.');
  const botPerms = channel.permissionsFor(guild.members.me);
  if (!botPerms?.has(PermissionsBitField.Flags.SendMessages)) throw new Error('Botun bu kanalda mesaj gönderme yetkisi yok.');
  const allowMentions = Boolean(req.body.allowMentions);
  const allowEveryone = Boolean(req.body.allowEveryone);
  if (allowEveryone && /@(everyone|here)\b/i.test(content) && !botPerms.has(PermissionsBitField.Flags.MentionEveryone)) {
    throw new Error('Botun `@everyone`, `@here` veya tüm rolleri etiketleme yetkisi yok.');
  }
  const parse = [];
  if (allowMentions) parse.push('users', 'roles');
  if (allowEveryone) parse.push('everyone');
  let sent;
  if (req.body.anonymous) {
    if (!botPerms.has(PermissionsBitField.Flags.ManageWebhooks)) {
      throw new Error('Anonim mesaj için botun bu kanalda `Webhookları Yönet` yetkisi olmalı.');
    }
    sent = await sendAnonymousMessage(channel, { content, username: 'Anonymous', allowedMentions: { parse } });
  } else {
    sent = await channel.send({ content, allowedMentions: { parse } });
  }
  settings.log(guild.id, 'channel', `${actor.user.username} #${channel.name} kanalına panelden ${req.body.anonymous ? 'anonim ' : ''}mesaj gönderdi`);
  res.json({ ok: true, anonymous: Boolean(req.body.anonymous), message: req.body.anonymous ? 'Anonim mesaj gönderildi.' : 'Mesaj gönderildi.', messageId: sent.id });
}));

app.post('/api/channels/lock', requireAuth, wrap(async (req, res) => {
  const guild = getGuild(req.session.guildId);
  const actor = await actorOf(req, guild);
  if (!actor.permissions.has(MOD_PERMS.ManageChannels)) throw new Error('`Kanalları Yönet` yetkin yok.');
  const channel = guild.channels.cache.get(String(req.body.channelId || ''));
  if (!channel || !channel.permissionOverwrites || !['text', 'announcement'].includes(mod.channelTypeName(channel.type))) {
    throw new Error('Bu kanal kilitlenemez.');
  }
  if (!guild.members.me.permissions.has(MOD_PERMS.ManageChannels)) throw new Error('Botun `Kanalları Yönet` yetkisi yok.');
  const locked = Boolean(req.body.locked);
  await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: locked ? false : null }, { reason: `${actor.user.username}: panelden ${locked ? 'kilitleme' : 'kilit açma'}` });
  settings.log(guild.id, 'channel', `${actor.user.username} #${channel.name} kanalını ${locked ? 'kilitledi' : 'açtı'}`);
  res.json({ ok: true, locked, message: locked ? 'Kanal yazmaya kapatıldı.' : 'Kanal kilidi kaldırıldı.' });
}));

app.post('/api/channels/delete', requireAuth, wrap(async (req, res) => {
  const guild = getGuild(req.session.guildId);
  const actor = await actorOf(req, guild);
  const { channelId } = req.body || {};
  const channel = guild.channels.cache.get(channelId);
  const result = await mod.deleteChannel(guild, actor, channelId);
  if (result.ok) settings.log(guild.id, 'channel', `${actor.user.username} kanal sildi: ${channel ? channel.name : channelId}`);
  res.json(result);
}));

app.post('/api/channels/bulk/rename', requireAuth, wrap(async (req, res) => {
  const guild = getGuild(req.session.guildId);
  const actor = await actorOf(req, guild);
  const { items } = req.body || {};
  if (!Array.isArray(items) || !items.length) throw new Error('Düzenlenecek kanal seçilmedi.');
  if (items.length > 50) throw new Error('Tek seferde en fazla 50 kanal gönderilebilir.');
  const result = await mod.bulkRenameChannels(guild, actor, items);
  if (result.ok && result.updated > 0) {
    settings.log(guild.id, 'channel', `${actor.user.username} toplu kanal adı değiştirdi (${result.updated} kanal)`);
  }
  res.json(result);
}));

app.post('/api/channels/bulk/topic', requireAuth, wrap(async (req, res) => {
  const guild = getGuild(req.session.guildId);
  const actor = await actorOf(req, guild);
  const ids = [...new Set(Array.isArray(req.body.channelIds) ? req.body.channelIds.map(String) : [])].slice(0, 50);
  if (!ids.length) throw new Error('Kanal seçilmedi.');
  const results = [];
  for (const channelId of ids) results.push({ channelId, ...(await mod.setChannelTopic(guild, actor, channelId, req.body.topic)) });
  const updated = results.filter((r) => r.ok).length;
  res.json({ ok: updated > 0, updated, failed: results.length - updated, results });
}));

app.post('/api/channels/bulk/delete', requireAuth, wrap(async (req, res) => {
  const guild = getGuild(req.session.guildId);
  const actor = await actorOf(req, guild);
  const { channelIds, deleteChildren } = req.body || {};
  if (!Array.isArray(channelIds) || !channelIds.length) throw new Error('Silinecek kanal seçilmedi.');
  if (channelIds.length > 50) throw new Error('Tek seferde en fazla 50 kanal gönderilebilir.');
  const result = await mod.bulkDeleteChannels(guild, actor, channelIds, Boolean(deleteChildren));
  if (result.ok && result.deleted > 0) {
    settings.log(guild.id, 'channel', `${actor.user.username} toplu kanal sildi (${result.deleted} kanal)`);
  }
  res.json(result);
}));

// ---------------------------------------------------------------- ROLLER
app.get(
  '/api/roles',
  requireAuth,
  wrap(async (req, res) => {
    const guild = getGuild(req.session.guildId);
    const roles = [...guild.roles.cache.values()]
      .filter((r) => r.id !== guild.id)
      .sort((a, b) => b.position - a.position)
      .map((r) => ({
        id: r.id,
        name: r.name,
        color: r.hexColor,
        position: r.position,
        managed: r.managed,
        memberCount: r.members.size
      }));
    res.json({ roles });
  })
);

app.post('/api/roles/add', requireAuth, wrap(async (req, res) => {
  const guild = getGuild(req.session.guildId);
  const actor = await actorOf(req, guild);
  const { userId, roleId } = req.body || {};
  const result = await mod.addRole(guild, actor, userId, roleId);
  if (result.ok) settings.log(guild.id, 'role', `${actor.user.username} rol verdi: ${result.message}`);
  res.json(result);
}));

app.post('/api/roles/remove', requireAuth, wrap(async (req, res) => {
  const guild = getGuild(req.session.guildId);
  const actor = await actorOf(req, guild);
  const { userId, roleId } = req.body || {};
  const result = await mod.removeRole(guild, actor, userId, roleId);
  if (result.ok) settings.log(guild.id, 'role', `${actor.user.username} rol aldı: ${result.message}`);
  res.json(result);
}));

app.post('/api/roles/create', requireAuth, wrap(async (req, res) => {
  const guild = getGuild(req.session.guildId);
  const actor = await actorOf(req, guild);
  if (!actor.permissions.has(MOD_PERMS.ManageRoles)) throw new Error('`Rolleri Yönet` yetkin yok.');
  const { name, color } = req.body || {};
  if (!name) throw new Error('Rol ismi gerekli.');
  const role = await guild.roles.create({
    name: String(name).slice(0, 100),
    color: color || undefined,
    reason: `${actor.user.username}: panelden oluşturma`
  });
  settings.log(guild.id, 'role', `${actor.user.username} rol oluşturdu: ${role.name}`);
  res.json({ ok: true, message: `"${role.name}" rolü oluşturuldu.`, roleId: role.id });
}));

app.post('/api/roles/edit', requireAuth, wrap(async (req, res) => {
  const guild = getGuild(req.session.guildId);
  const actor = await actorOf(req, guild);
  if (!actor.permissions.has(MOD_PERMS.ManageRoles)) throw new Error('`Rolleri Yönet` yetkin yok.');
  const role = guild.roles.cache.get(req.body.roleId);
  if (!role || role.managed || !role.editable) throw new Error('Bu rol düzenlenemez.');
  const name = String(req.body.name || role.name).trim().slice(0, 100);
  await role.edit({ name, color: req.body.color || role.color, reason: `${actor.user.username}: panelden düzenleme` });
  res.json({ ok: true, message: `"${name}" rolü güncellendi.` });
}));

app.post('/api/roles/bulk', requireAuth, wrap(async (req, res) => {
  const guild = getGuild(req.session.guildId);
  const actor = await actorOf(req, guild);
  if (!actor.permissions.has(MOD_PERMS.ManageRoles)) throw new Error('`Rolleri Yönet` yetkin yok.');
  const { action } = req.body || {};
  const results = [];
  if (action === 'create') {
    const items = (Array.isArray(req.body.items) ? req.body.items : []).slice(0, 50);
    for (const item of items) {
      try {
        const role = await guild.roles.create({ name: String(item.name || '').trim().slice(0, 100), color: item.color || undefined, reason: `${actor.user.username}: toplu rol oluşturma` });
        results.push({ ok: true, roleId: role.id, name: role.name });
      } catch (e) { results.push({ ok: false, error: e.message, name: item.name }); }
    }
  } else {
    const ids = [...new Set(Array.isArray(req.body.roleIds) ? req.body.roleIds.map(String) : [])].slice(0, 50);
    if (!ids.length) throw new Error('Rol seçilmedi.');
    for (const id of ids) {
      const role = guild.roles.cache.get(id);
      if (!role || role.managed || !role.editable) { results.push({ ok: false, roleId: id, error: 'Rol düzenlenemez.' }); continue; }
      try {
        if (action === 'delete') await role.delete(`${actor.user.username}: toplu rol silme`);
        else if (action === 'rename') {
          const mode = req.body.mode || 'prefix';
          const value = String(req.body.value || '').slice(0, 80);
          const name = mode === 'suffix' ? role.name + value : value + role.name;
          await role.setName(name.slice(0, 100), `${actor.user.username}: toplu rol düzenleme`);
        } else throw new Error('Geçersiz toplu rol işlemi.');
        results.push({ ok: true, roleId: id });
      } catch (e) { results.push({ ok: false, roleId: id, error: e.message }); }
    }
  }
  const succeeded = results.filter((r) => r.ok).length;
  res.json({ ok: succeeded > 0, succeeded, failed: results.length - succeeded, results });
}));

app.post('/api/roles/delete', requireAuth, wrap(async (req, res) => {
  const guild = getGuild(req.session.guildId);
  const actor = await actorOf(req, guild);
  if (!actor.permissions.has(MOD_PERMS.ManageRoles)) throw new Error('`Rolleri Yönet` yetkin yok.');
  const role = guild.roles.cache.get(req.body.roleId);
  if (!role) throw new Error('Rol bulunamadı.');
  if (!role.editable) throw new Error('Bu rol botun rolünden yüksek, silinemez.');
  await role.delete(`${actor.user.username}: panelden silme`);
  settings.log(guild.id, 'role', `${actor.user.username} rol sildi: ${role.name}`);
  res.json({ ok: true, message: `"${role.name}" rolü silindi.` });
}));

// ---------------------------------------------------------------- AYARLAR + LOG
app.get(
  '/api/settings',
  requireAuth,
  wrap(async (req, res) => {
    const guild = getGuild(req.session.guildId);
    const cfg = settings.get(guild.id);
    const channels = [...guild.channels.cache.values()]
      .filter((c) => c.isTextBased && c.isTextBased())
      .map((c) => ({ id: c.id, name: c.name }));
    const roles = [...guild.roles.cache.values()]
      .filter((r) => r.id !== guild.id && !r.managed)
      .map((r) => ({ id: r.id, name: r.name }));
    res.json({ settings: cfg, textChannels: channels, roles });
  })
);

app.post(
  '/api/settings',
  requireAuth,
  wrap(async (req, res) => {
    const guild = getGuild(req.session.guildId);
    const actor = await actorOf(req, guild);
    if (!actor.permissions.has(MOD_PERMS.ManageGuild)) throw new Error('`Sunucuyu Yönet` yetkin yok.');
    const allowed = ['logChannelId', 'welcomeChannelId', 'welcomeMessage', 'autoRoleId', 'entertainmentChannelId', 'prefix'];
    const patch = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) patch[key] = req.body[key] || null;
    }
    const updated = settings.update(guild.id, patch);
    settings.log(guild.id, 'site', `${actor.user.username} ayarları güncelledi`);
    res.json({ ok: true, settings: updated });
  })
);

app.get(
  '/api/logs',
  requireAuth,
  wrap(async (req, res) => {
    const guild = getGuild(req.session.guildId);
    res.json({
      logs: (db.logs[guild.id] || []).slice(0, 100),
      types: settings.LOG_TYPES
    });
  })
);

// ---------------------------------------------------------------- EĞLENCE (Panelden oynama)
app.get(
  '/api/play/balance',
  requireAuth,
  wrap(async (req, res) => {
    const guildId = req.session.guildId;
    const userId = req.session.user.id;
    const guild = getGuild(guildId);
    const w = eco.wallet(guildId, userId);
    const board = eco.leaderboard(guildId, 10);
    res.json({
      coins: w.coins,
      games: w.games,
      wins: w.wins,
      losses: w.losses,
      rank: board.findIndex((u) => u.userId === userId) + 1,
      leaderboard: await Promise.all(
        board.map(async (u) => {
          const m = guild.members.cache.get(u.userId);
          return {
            id: u.userId,
            name: m ? m.displayName : 'Bilinmeyen',
            avatar: m ? m.displayAvatarURL({ size: 32 }) : null,
            coins: u.coins
          };
        })
      )
    });
  })
);


app.post(
  '/api/play/coinflip',
  requireAuth,
  wrap(async (req, res) => {
    const { bet, pick } = req.body || {};
    const res2 = games.coinflip(req.session.guildId, req.session.user.id, Math.floor(Number(bet)), pick);
    res.json(res2);
  })
);

app.post(
  '/api/play/dice',
  requireAuth,
  wrap(async (req, res) => {
    const { bet, guess } = req.body || {};
    res.json(games.dice(req.session.guildId, req.session.user.id, Math.floor(Number(bet)), Number(guess)));
  })
);

app.post(
  '/api/play/daily',
  requireAuth,
  wrap(async (req, res) => {
    res.json(eco.daily(req.session.guildId, req.session.user.id));
  })
);

// ---------------------------------------------------------------- BOT BİLGİLERİ
app.get('/api/bot/invite', requireAuth, (req, res) => {
  res.json({ url: botInviteUrl() });
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    version: require('./package.json').version
  });
});

// ---------------------------------------------------------------- BAŞLAT
if (DEMO_MODE) {
  botState.ready = true;
  botState.client = { user: { tag: 'DemoBot#0001' }, guilds: { cache: new Map() }, ws: { ping: 42 }, readyTimestamp: Date.now() };
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[web] Panel çalışıyor: ${BASE_URL} (port ${PORT})${DEMO_MODE ? ' [DEMO]' : ''}`);
  if (!DEMO_MODE) {
    if (!ADMIN_USER || !ADMIN_PASS) {
      console.warn('[auth] UYARI: ADMIN_USER / ADMIN_PASS tanımlı değil — panele giriş yapılamaz!');
    } else {
      console.log(`[auth] Kullanıcı adı/şifre girişi aktif (kullanıcı: ${ADMIN_USER})`);
    }
    startBot();
  }
});
module.exports = { app };
