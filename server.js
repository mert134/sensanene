/**
 * Web paneli sunucusu.
 * - Discord OAuth2 ile giriş (botu yönetmek isteyen kullanıcı, sunucudaki kendi yetkileriyle işlem yapar)
 * - Moderasyon / kanal / rol / eğlence API'leri
 * - Discord.js client aynı süreçte çalışır (tek servis, Render ücretsiz plana uygun)
 */
const express = require('express');
const cookieSession = require('cookie-session');
const path = require('path');
const { PermissionsBitField, OAuth2Scopes } = require('discord.js');

const settings = require('./src/settings');
const mod = require('./src/moderation');
const eco = require('./src/economy');
const games = require('./src/games');
const { botState, startBot } = require('./src/bot');
const { db } = require('./src/store');

const app = express();
const PORT = process.env.PORT || 10000;
const CLIENT_ID = (process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID || '').trim();
const CLIENT_SECRET = (process.env.CLIENT_SECRET || process.env.DISCORD_CLIENT_SECRET || '').trim();

/**
 * Panel adresini bul. Discord OAuth2 "redirect_uri" birebir eşleşme istediği için
 * PUBLIC_URL yanlış/boşsa Render'ın kendi verdiği RENDER_EXTERNAL_URL'e düşeriz.
 * Böylece "Geçersiz OAuth2 redirect_url" hatası en aza iner.
 */
function normalizeBaseUrl(raw) {
  let u = String(raw || '').trim();
  if (!u) return '';
  u = u.replace(/\/auth\/callback\/?$/i, '').replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

function detectBaseUrl(port) {
  const explicit = normalizeBaseUrl(process.env.PUBLIC_URL);
  const renderUrl = normalizeBaseUrl(process.env.RENDER_EXTERNAL_URL);
  const renderHost = String(process.env.RENDER_EXTERNAL_HOSTNAME || '').trim().replace(/\/+$/, '');
  const isBadExplicit = (u) => /localhost|127\.0\.0\.1|dashboard\.render\.com|servis-adin/i.test(u);

  if (explicit && !isBadExplicit(explicit)) return { url: explicit, source: 'PUBLIC_URL' };
  if (renderUrl) return { url: renderUrl, source: 'RENDER_EXTERNAL_URL (otomatik)' };
  if (renderHost) return { url: `https://${renderHost}`, source: 'RENDER_EXTERNAL_HOSTNAME (otomatik)' };
  if (explicit) return { url: explicit, source: 'PUBLIC_URL (yerel)' };
  return { url: `http://localhost:${port}`, source: 'varsayılan (yerel)' };
}

const base = detectBaseUrl(PORT);
const BASE_URL = base.url;
const BASE_URL_SOURCE = base.source;
const REDIRECT_URI = `${BASE_URL}/auth/callback`;
const SESSION_SECRET = (process.env.SESSION_SECRET || 'degistir-beni-' + CLIENT_ID).trim();
const HAS_RENDER = Boolean(process.env.RENDER_EXTERNAL_URL || process.env.RENDER_EXTERNAL_HOSTNAME);

app.use(express.json());
app.set('trust proxy', 1);
app.use(
  cookieSession({
    name: 'panel',
    secret: SESSION_SECRET,
    maxAge: 1000 * 60 * 60 * 24 * 7,
    sameSite: 'lax',
    secure: BASE_URL.startsWith('https'),
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

// ---------------------------------------------------------------- YARDIMCILAR
const client = () => botState.client;

function getGuild(guildId) {
  const c = client();
  if (!c || !botState.ready) throw new Error('Bot henüz Discord\'a bağlanmadı.');
  const guild = c.guilds.cache.get(guildId);
  if (!guild) throw new Error('Sunucu bulunamadı. Bot bu sunucuda mı?');
  return guild;
}

/** Discord API'sinden kullanıcının o sunucudaki yetkilerini çeker. */
async function fetchUserPermissions(guildId, accessToken) {
  const res = await fetch(`https://discord.com/api/v10/users/@me/guilds/${guildId}/member`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) {
    if (res.status === 404) return null; // sunucuda değil
    throw new Error(`Discord üye bilgisi alınamadı (${res.status})`);
  }
  return res.json();
}

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
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

function permsOf(member) {
  return new PermissionsBitField(BigInt(member.permissions || 0));
}

/** İstek atan kullanıcının sunucudaki temsilcisini (member) döndürür. */
async function actorOf(req, guild) {
  const data = await fetchUserPermissions(req.session.guildId, req.session.accessToken);
  if (!data) throw new Error('Bu sunucunun üyesi değilsin.');
  const user = req.session.user;
  const id = data.user ? data.user.id : user.id;
  const isOwner = guild.ownerId === id;
  const permissions = isOwner
    ? new PermissionsBitField(PermissionsBitField.Flags.Administrator)
    : permsOf(data);
  const rolePositions = (data.roles || []).map((rid) => guild.roles.cache.get(rid)?.position || 0);
  const highest = Math.max(isOwner ? 999 : 0, ...rolePositions, 0);
  return {
    id,
    user: { id, tag: `${user.username}#${user.discriminator || '0'}`, username: user.username },
    permissions,
    roles: { highest: { position: highest }, cache: new Set(data.roles || []) },
    guildOwner: isOwner
  };
}

// ---------------------------------------------------------------- OTURUM
app.get('/auth/login', (req, res) => {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    const missing = [!CLIENT_ID && 'CLIENT_ID', !CLIENT_SECRET && 'CLIENT_SECRET'].filter(Boolean).join(', ');
    return res
      .status(500)
      .send(`Eksik ortam değişkeni: ${missing}. Render > Environment bölümünden ekleyip Save Changes'e bas, deploy bitince tekrar dene. Teşhis: /setup`);
  }
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: OAuth2Scopes.Identify + ' ' + OAuth2Scopes.Guilds
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

app.get('/auth/callback', async (req, res) => {
  const { code, error, error_description } = req.query;
  if (!code) {
    const msg = error_description || error || 'Giriş iptal edildi.';
    return res.redirect('/?hata=' + encodeURIComponent(msg));
  }
  try {
    const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI
      })
    });
    if (!tokenRes.ok) throw new Error('Token alınamadı: ' + (await tokenRes.text()));
    const token = await tokenRes.json();

    const userRes = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${token.access_token}` }
    });
    const user = await userRes.json();

    req.session.accessToken = token.access_token;
    req.session.user = {
      id: user.id,
      username: user.username,
      globalName: user.global_name,
      avatar: user.avatar
    };
    res.redirect('/');
  } catch (err) {
    console.error('[auth]', err);
    res.redirect('/?hata=' + encodeURIComponent(err.message));
  }
});

app.post('/auth/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

function botInviteUrl() {
  if (!CLIENT_ID) return null;
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    permissions: '8',
    scope: 'bot applications.commands'
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

app.get('/api/me', (req, res) => {
  res.json({
    user: req.session.user || null,
    configured: Boolean(CLIENT_ID && CLIENT_SECRET && process.env.DISCORD_TOKEN),
    botReady: botState.ready,
    botError: botState.error,
    botTag: botState.ready ? botState.client.user.tag : null,
    inviteUrl: botInviteUrl(),
    redirectUri: REDIRECT_URI,
    setup: setupReport()
  });
});

/**
 * Kurulum teşhisi: Discord OAuth2 "Geçersiz redirect_uri" hatası ve bot bağlantı
 * sorunlarını anlamak için. Sır (token/secret) değerleri ASLA döndürülmez.
 */
function setupReport() {
  const checks = [];
  const add = (ok, title, hint) => checks.push({ ok, title, hint });

  add(Boolean(CLIENT_ID), 'CLIENT_ID tanımlı', 'Render > Environment: CLIENT_ID = Discord uygulama ID');
  add(Boolean(CLIENT_SECRET), 'CLIENT_SECRET tanımlı', 'Render > Environment: CLIENT_SECRET = Discord gizli anahtar');
  add(Boolean(process.env.DISCORD_TOKEN), 'DISCORD_TOKEN tanımlı', 'Developer Portal > Bot > Reset Token ile token al');
  add(BASE_URL.startsWith('https://'), 'Panel adresi https', `Şu an: ${BASE_URL} — PUBLIC_URL'i https://... şeklinde gir`);
  add(!/localhost|127\.0\.0\.1/i.test(BASE_URL), 'Panel adresi herkese açık', 'PUBLIC_URL boş kalmış; Render adresini gir ya da Render otomatik algılamasına bırak');
  add(process.env.SESSION_SECRET !== undefined && String(process.env.SESSION_SECRET).length >= 16, 'SESSION_SECRET güçlü', 'En az 16 karakter rastgele bir değer gir');
  add(Boolean(process.env.PUBLIC_URL), 'PUBLIC_URL elle ayarlı', 'Elle ayarlamak zorunlu değil; Render adresi otomatik de algılanır');
  add(botState.ready, 'Bot Discord sunucusuna bağlı', botState.error || 'Loglarda "[bot]" satırlarına bak');
  add(!DEMO_MODE, 'DEMO_MODE kapalı', 'DEMO_MODE=0 olmalı (1 ise sahte veri kullanılır)');

  return {
    baseUrl: BASE_URL,
    baseUrlSource: BASE_URL_SOURCE,
    redirectUri: REDIRECT_URI,
    demoMode: DEMO_MODE,
    botReady: botState.ready,
    botError: botState.error,
    node: process.version,
    checks
  };
}

// Kurulum teşhis sayfası — giriş gerektirmez, sır göstermez.
app.get('/setup', (req, res) => {
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
    code{background:#0f1219;border:1px solid #262c3d;padding:2px 7px;border-radius:6px;font-size:12.5px;word-break:break-all}
    table{width:100%;border-collapse:collapse}td{padding:9px 4px;border-bottom:1px solid #202636;vertical-align:top}
    .big{font-size:15px;margin:8px 0}
    a.btn{display:inline-block;background:#5865f2;color:#fff;padding:11px 18px;border-radius:10px;text-decoration:none;font-weight:600;margin-top:14px}
    .muted{color:#8b93ab;font-size:12.5px}
  </style></head><body><div class="wrap">
    <h1>🔧 Kurulum Teşhisi</h1>
    <div class="muted">Discord girişi / bot bağlantısı çalışmıyorsa sebebi burada yazar. Sırlar gösterilmez.</div>

    <div class="card">
      <div class="big">Panel adresi: <code>${r.baseUrl}</code></div>
      <div class="muted">Kaynak: ${r.baseUrlSource}</div>
      <div class="big" style="margin-top:14px">Discord'a kayıtlı olması gereken yönlendirme adresi:</div>
      <div><code>${r.redirectUri}</code></div>
      <div class="muted" style="margin-top:6px">
        Discord Developer Portal &gt; OAuth2 &gt; Redirects bölümüne <b>birebir</b> bu adresi ekle
        (sonda <code>/</code> olmadan, <code>https://</code> ile).
      </div>
      <a class="btn" href="/">Panele dön</a>
    </div>

    <div class="card"><table>${rows}</table></div>

    <div class="card">
      <div class="big">Bot durumu</div>
      <div>${r.botReady ? '🟢 Çevrimiçi' : '🔴 Çevrimdışı'}</div>
      ${r.botError ? `<div class="muted" style="margin-top:6px">Hata: ${r.botError}</div>` : ''}
      <div class="muted" style="margin-top:8px">Node: ${r.node} · DEMO_MODE: ${r.demoMode ? 'AÇIK' : 'kapalı'}</div>
    </div>
  </div></body></html>`);
});

/** Kullanıcının botun bulunduğu ve yönetebildiği sunucular. */
app.get(
  '/api/guilds',
  requireAuth,
  wrap(async (req, res) => {
    const listRes = await fetch('https://discord.com/api/v10/users/@me/guilds', {
      headers: { Authorization: `Bearer ${req.session.accessToken}` }
    });
    if (!listRes.ok) throw new Error('Sunucu listesi alınamadı.');
    const userGuilds = await listRes.json();
    const c = client();
    const botGuilds = c ? c.guilds.cache : new Map();

    const result = userGuilds
      .filter((g) => botGuilds.has(g.id))
      .map((g) => {
        const botGuild = botGuilds.get(g.id);
        const userPerms = new PermissionsBitField(BigInt(g.permissions || 0));
        const canManage = g.owner || userPerms.has(MOD_PERMS.Administrator) || userPerms.has(MOD_PERMS.ManageGuild);
        return {
          id: g.id,
          name: g.name,
          icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128` : null,
          owner: Boolean(g.owner),
          canManage,
          memberCount: botGuild ? botGuild.memberCount : null
        };
      })
      .sort((a, b) => Number(b.canManage) - Number(a.canManage) || a.name.localeCompare(b.name));

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

app.post('/api/channels/delete', requireAuth, wrap(async (req, res) => {
  const guild = getGuild(req.session.guildId);
  const actor = await actorOf(req, guild);
  const { channelId } = req.body || {};
  const channel = guild.channels.cache.get(channelId);
  const result = await mod.deleteChannel(guild, actor, channelId);
  if (result.ok) settings.log(guild.id, 'channel', `${actor.user.username} kanal sildi: ${channel ? channel.name : channelId}`);
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
  '/api/play/slot',
  requireAuth,
  wrap(async (req, res) => {
    const guildId = req.session.guildId;
    const userId = req.session.user.id;
    const { bet } = req.body || {};
    const start = games.placeBet(guildId, userId, Math.floor(Number(bet)));
    if (start.error) return res.json({ error: start.error });
    const spin = games.spin(Math.floor(Number(bet)));
    const balance = games.settle(guildId, userId, Math.floor(Number(bet)), spin.payout, spin.multiplier > 0);
    res.json({ ...spin, bet: Math.floor(Number(bet)), balance });
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
app.get('/api/bot/invite', (req, res) => {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    permissions: '8',
    scope: 'bot applications.commands'
  });
  res.json({ url: `https://discord.com/oauth2/authorize?${params}` });
});

app.get('/health', (req, res) => {
  const failed = setupReport().checks.filter((c) => !c.ok).map((c) => c.title);
  res.json({
    ok: true,
    botReady: botState.ready,
    botError: botState.error,
    redirectUri: REDIRECT_URI,
    demoMode: DEMO_MODE,
    setupWarnings: failed,
    uptime: process.uptime(),
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
  console.log(`[web] Panel adresi kaynağı: ${BASE_URL_SOURCE}${HAS_RENDER ? '' : ' — Render ortamı algılanmadı'}`);
  console.log(`[web] Discord OAuth2 redirect_uri: ${REDIRECT_URI}`);
  console.log(`[web] Bu adresi Discord > OAuth2 > Redirects listesine birebir ekle. Teşhis: ${BASE_URL}/setup`);
  if (BASE_URL.includes('localhost') && !DEMO_MODE) {
    console.warn('[web] UYARI: Panel adresi localhost görünüyor. Render\'da PUBLIC_URL boşsa RENDER_EXTERNAL_URL otomatik kullanılır; yine de kontrol et.');
  }
  if (!DEMO_MODE) startBot();
});

module.exports = { app };
