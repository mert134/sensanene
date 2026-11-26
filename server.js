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
const { Events, PermissionsBitField } = require('discord.js');

const settings = require('./src/settings');
const mod = require('./src/moderation');
const guard = require('./src/guard');
const eco = require('./src/economy');
const games = require('./src/games');
const { botState, startBot } = require('./src/bot');
const { db } = require('./src/store');

const app = express();
const anonymousWebhookCache = new Map();
const anonymousWebhookInflight = new Map();
const PORT = process.env.PORT || 10000;

/* Discord'a giden istekler için sınırlı kapılar.
   Toplu gönderimde yüzlerce istek discord.js'in kendi kuyruğuna yığılıyordu;
   kuyruk şişince her istek onlarca saniye bekliyor, panel "donmuş" gibi
   görünüyordu. Kapılar aynı anda en fazla N Discord işlemi yapılmasını sağlar,
   fazlası burada ÖNGÖRÜLEBİLİR biçimde sırada bekler.
   İki ayrı kapı var: mesaj gönderimi ve webhook hazırlığı birbirini
   yavaşlatmasın diye. Webhook sorgusu/oluşturması kanal başına ayrı hız
   kovası kullandığından daha geniş bir kapıdan güvenle geçebilir. */
function createDiscordGate(defaultLimit, envName) {
  const limit = Number(process.env[envName] || defaultLimit);
  let active = 0;
  const queue = [];
  const acquire = () => {
    if (active < limit) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => queue.push(resolve));
  };
  const release = () => {
    const next = queue.shift();
    if (next) next();
    else active -= 1;
  };
  return {
    limit,
    get active() { return active; },
    get queued() { return queue.length; },
    async run(fn) {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    }
  };
}

const sendGate = createDiscordGate(6, 'DISCORD_SEND_CONCURRENCY');
const webhookGate = createDiscordGate(8, 'DISCORD_WEBHOOK_CONCURRENCY');

/** Geriye uyumluluk: gönderim kapısı. */
const withDiscordSlot = (fn) => sendGate.run(fn);

async function getAnonymousWebhook(channel) {
  const key = String(channel.id);
  const cached = anonymousWebhookCache.get(key);
  if (cached) return cached;

  // Aynı kanal için eşzamanlı istekler webhook'u birden fazla kez oluşturmasın.
  const inflight = anonymousWebhookInflight.get(key);
  if (inflight) return inflight;

  const pending = resolveAnonymousWebhook(channel, key).finally(() => {
    anonymousWebhookInflight.delete(key);
  });
  anonymousWebhookInflight.set(key, pending);
  return pending;
}

const WEBHOOK_RESOLVE_TIMEOUT_MS = Number(process.env.WEBHOOK_RESOLVE_TIMEOUT_MS || 20000);

async function resolveAnonymousWebhook(channel, key) {
  // Webhook sorgusu/oluşturması kendi kapısından geçer; gönderimleri yavaşlatmaz.
  // Kapı slotu sonsuza kadar park etmesin diye çözüme zaman aşımı konur:
  // süre dolarsa slot bırakılır, kanal hata olarak raporlanır, kuyruk akmaya devam eder.
  return webhookGate.run(() => Promise.race([
    (async () => {
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
    })(),
    new Promise((_, reject) => setTimeout(() => {
      reject(new Error(`Webhook hazırlığı ${WEBHOOK_RESOLVE_TIMEOUT_MS / 1000} sn'de tamamlanmadı.`));
    }, WEBHOOK_RESOLVE_TIMEOUT_MS))
  ]));
}

/**
 * Anonim mesaj gönderimi.
 * Webhook normalde kanal açıldığı anda otomatik hazırlandığı için burada
 * önbellekten gelir; eksikse webhookGate'te hazırlanır (gönderim kapısını
 * meşgul etmez). Mesaj gönderimi ise sendGate'te bekler.
 * Webhook çözümünü sendGate İÇİNDE beklersek, webhook yavaşladığında tüm
 * gönderim slotları park eder ve webhook'u hazır olan kanallar bile
 * gönderemezdi (eskiden "7 kanala gönderip kalıyordu" belirtisi buydu).
 */
async function sendAnonymousMessage(channel, payload) {
  let hook = await getAnonymousWebhook(channel);
  try {
    return await sendGate.run(() => hook.send(payload));
  } catch (err) {
    if (Number(err.code) !== 10015) throw err;
    anonymousWebhookCache.delete(String(channel.id));
    hook = await getAnonymousWebhook(channel);
    return sendGate.run(() => hook.send(payload));
  }
}

/* ------------------------------------------------------------------
   ANONYMOUS WEBHOOK YÖNETİMİ (ELLE)
   Webhook'lar OTOMATİK OLARAK OLUŞTURULMAZ. Botun gördüğü ya da yeni açtığı
   her kanala webhook koymak sunucu tarafında şüpheli/tehlikeli algılanabilir.
   Webhook yalnızca iki durumda hazırlanır:
     1) Panelde hızlı seçimdeki "Anonymous ekle" düğmesine basıldığında —
        yalnızca SEÇİLEN kanallara,
     2) Seçilen kanallara anonim mesaj gönderilirken (gönderim için zorunlu).
   Hazırlık her zaman webhook kapısından (DISCORD_WEBHOOK_CONCURRENCY) geçer,
   gönderim kapısını meşgul etmez; takılırsa WEBHOOK_RESOLVE_TIMEOUT_MS ile
   bırakılır.
   ------------------------------------------------------------------ */

function isTextLikeChannel(channel) {
  return Boolean(channel) && typeof channel.send === 'function'
    && ['text', 'announcement'].includes(mod.channelTypeName(channel.type));
}

function botCanManageWebhooks(channel) {
  const me = channel.guild?.members?.me;
  if (!me) return false;
  try {
    return Boolean(channel.permissionsFor(me)?.has(PermissionsBitField.Flags.ManageWebhooks));
  } catch {
    return false;
  }
}

/** ready: webhook önbellekte · preparing: hazırlanıyor · missing: henüz yok */
function webhookStatusOf(channelId) {
  const key = String(channelId);
  if (anonymousWebhookCache.has(key)) return 'ready';
  if (anonymousWebhookInflight.has(key)) return 'preparing';
  return 'missing';
}

/** Panel listesi için durum: metin dışı kanallarda null, yetki yoksa 'yetkisiz'. */
function webhookStatusFor(channel) {
  if (!isTextLikeChannel(channel)) return null;
  if (!botCanManageWebhooks(channel)) return 'yetkisiz';
  return webhookStatusOf(channel.id);
}

/** Kanal silindiğinde önbellekteki webhook'u bırakır. */
function forgetAnonymousWebhook(channelId) {
  anonymousWebhookCache.delete(String(channelId));
}

/**
 * Webhook olayları — hiçbir kanala OTOMATİK WEBHOOK KONMAZ.
 * Yalnızca önbellek doğru tutulur; webhook hazırlığı panelden elle
 * (hızlı seçimdeki "Anonymous ekle") veya anonim gönderim sırasında istenir.
 */
function registerWebhookEvents(client) {
  if (!client) return;

  client.on(Events.ChannelDelete, (channel) => {
    forgetAnonymousWebhook(channel?.id);
  });

  // Webhook dışarıdan silindiyse önbelleği bırak; yenisi OTOMATİK oluşturulmaz
  // (bir sonraki anonim gönderimde ya da "Anonymous ekle" ile hazırlanır).
  client.on(Events.WebhooksUpdate, (channel) => {
    const key = String(channel?.id);
    const cached = anonymousWebhookCache.get(key);
    if (!cached) return;
    channel.fetchWebhooks()
      .then((hooks) => {
        if (!hooks.has(cached.id)) anonymousWebhookCache.delete(key);
      })
      .catch(() => {});
  });
}

/** Bir kanal listesinin (veya tüm sunucunun) webhook sayımı — hiçbir şey oluşturmaz. */
function webhookCounts(guild, ids) {
  const source = Array.isArray(ids) && ids.length
    ? ids.map((id) => guild.channels.cache.get(String(id))).filter(Boolean)
    : [...guild.channels.cache.values()];
  const textLike = source.filter((channel) => isTextLikeChannel(channel));
  const eligible = textLike.filter((channel) => botCanManageWebhooks(channel));
  let ready = 0;
  let preparing = 0;
  for (const channel of eligible) {
    const status = webhookStatusOf(channel.id);
    if (status === 'ready') ready += 1;
    else if (status === 'preparing') preparing += 1;
  }
  return { total: eligible.length, ready, preparing, missing: eligible.length - ready - preparing, noPerm: textLike.length - eligible.length };
}

function escapeDisabledBroadcastMentions(content, allowEveryone, allowHere) {
  let safeContent = content;
  if (!allowEveryone) safeContent = safeContent.replace(/@everyone\b/gi, '@\u200beveryone');
  if (!allowHere) safeContent = safeContent.replace(/@here\b/gi, '@\u200bhere');
  return safeContent;
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

/** Discord'un hız sınırı cevabından (429) istemcinin bekleyebileceği süreyi çıkarır. */
function rateLimitInfo(err) {
  const status = Number(err?.status) || Number(err?.code) || 0;
  const headerWait = Number(err?.headers?.['retry-after'] ?? err?.headers?.get?.('retry-after') ?? 0);
  const bodyWait = Number(err?.retryAfterSeconds ?? err?.retryAfter ?? 0);
  const seconds = [headerWait, bodyWait].find((value) => Number.isFinite(value) && value > 0);
  return {
    upstreamStatus: status === 429 ? 429 : undefined,
    retryAfterSeconds: status === 429 && seconds ? Math.min(Math.ceil(seconds), 60) : undefined
  };
}

function wrap(handler) {
  return (req, res) => {
    Promise.resolve(handler(req, res)).catch((err) => {
      console.error('[api]', err);
      res.status(400).json({ error: err.message || 'Beklenmeyen hata', ...rateLimitInfo(err) });
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
  // Uygulama düzeyinde sayı sınırı yok: ne geldiyse işlenir, Discord'un kendi
  // hız sınırları discord.js içinde yönetilir.
  const ids = [...new Set(Array.isArray(userIds) ? userIds.map(String) : [])];
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
        bitrate: ch.bitrate || null,
        anonymousWebhook: webhookStatusFor(ch)
      }))
      .sort((a, b) => a.position - b.position);

    // Liste yalnızca DURUMU gösterir: burada hiçbir kanala webhook oluşturulmaz.
    const counts = webhookCounts(guild, null);
    res.json({
      channels,
      webhooks: { ...counts, eligible: counts.total }
    });
  })
);

app.post('/api/channels/create', requireAuth, wrap(async (req, res) => {
  const guild = getGuild(req.session.guildId);
  const actor = await actorOf(req, guild);
  const result = await mod.createChannel(guild, actor, req.body || {});
  if (result.ok) settings.log(guild.id, 'channel', `${actor.user.username} kanal oluşturdu: ${req.body.name}`);
  // Yeni kanala webhook OTOMATİK KONMAZ; panelden "Anonymous ekle" ile istenir.
  res.json(result);
}));

app.post('/api/channels/bulk/create', requireAuth, wrap(async (req, res) => {
  const guild = getGuild(req.session.guildId);
  const actor = await actorOf(req, guild);
  const { names, type, categoryId } = req.body || {};
  const cleanNames = Array.isArray(names) ? names.map((n) => String(n).trim()).filter(Boolean) : [];
  if (!cleanNames.length) throw new Error('Oluşturulacak kanal adlarını gir.');
  const results = [];
  for (const name of cleanNames) results.push({ name, ...(await mod.createChannel(guild, actor, { name, type, categoryId })) });
  const created = results.filter((r) => r.ok).length;
  if (created) settings.log(guild.id, 'channel', `${actor.user.username} toplu kanal oluşturdu (${created})`);
  // Yeni kanallara webhook OTOMATİK KONMAZ; istenirse "Anonymous ekle" ile eklenir.
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

/**
 * SEÇİLEN kanallara Anonymous webhook'u ekler (hızlı seçimdeki "Anonymous ekle"
 * düğmesi ve anonim toplu gönderimin başlangıcı bu ucu kullanır).
 * Yalnızca istenen kanallara dokunur; hiçbir kanala kendiliğinden webhook konmaz.
 * Yanıt beklemez: hazırlık webhook kapısından geçer, gönderim kapısını meşgul etmez.
 */
app.post('/api/channels/webhooks/warm', requireAuth, wrap(async (req, res) => {
  const guild = getGuild(req.session.guildId);
  const ids = [...new Set(Array.isArray(req.body?.channelIds) ? req.body.channelIds.map(String) : [])];
  if (!ids.length) return res.json({ ok: true, started: 0, ready: 0 });

  const requested = ids.map((id) => guild.channels.cache.get(id)).filter(Boolean);
  const channels = requested.filter((channel) => isTextLikeChannel(channel) && botCanManageWebhooks(channel));
  const noPerm = requested.filter((channel) => isTextLikeChannel(channel) && !botCanManageWebhooks(channel)).length;
  const alreadyReady = channels.filter((channel) => webhookStatusOf(channel.id) === 'ready').length;
  const pending = channels.filter((channel) => webhookStatusOf(channel.id) === 'missing');

  if (pending.length) {
    const requester = req.session?.user?.username || 'Panel';
    const warming = (async () => {
      let ready = 0;
      let failed = 0;
      await Promise.all(pending.map(async (channel) => {
        try {
          await getAnonymousWebhook(channel);
          ready += 1;
        } catch (err) {
          failed += 1;
          console.error(`[webhook] #${channel.name} hazırlanamadı:`, err.message);
        }
      }));
      settings.log(guild.id, 'site', `${requester} Anonymous webhook ekledi: ${ready} kanal hazır, ${failed} hatalı`);
      return { ready, failed };
    })();
    warming.catch(() => {});
  }

  res.json({
    ok: true,
    started: pending.length,
    ready: alreadyReady,
    total: channels.length,
    noPerm,
    webhookGate: { limit: webhookGate.limit, active: webhookGate.active, queued: webhookGate.queued }
  });
}));

/** Webhook sayımı — hiçbir şey oluşturmaz. POST ile yalnızca istenen kanallar sayılır. */
app.get('/api/channels/webhooks/status', requireAuth, wrap(async (req, res) => {
  const guild = getGuild(req.session.guildId);
  res.json({ ok: true, ...webhookCounts(guild, null), webhookGate: { limit: webhookGate.limit, active: webhookGate.active, queued: webhookGate.queued } });
}));

app.post('/api/channels/webhooks/status', requireAuth, wrap(async (req, res) => {
  const guild = getGuild(req.session.guildId);
  const ids = Array.isArray(req.body?.channelIds) ? req.body.channelIds.map(String) : null;
  res.json({ ok: true, ...webhookCounts(guild, ids), webhookGate: { limit: webhookGate.limit, active: webhookGate.active, queued: webhookGate.queued } });
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
  const allowHere = req.body.allowHere === undefined ? allowEveryone : Boolean(req.body.allowHere);
  const hasAllowedGroupMention = (allowEveryone && /@everyone\b/i.test(content)) || (allowHere && /@here\b/i.test(content));
  if (hasAllowedGroupMention && !botPerms.has(PermissionsBitField.Flags.MentionEveryone)) {
    throw new Error('Botun `@everyone` / `@here` etiketleme yetkisi yok.');
  }
  const outgoingContent = escapeDisabledBroadcastMentions(content, allowEveryone, allowHere);
  const parse = [];
  if (allowMentions) parse.push('users', 'roles');
  if (allowEveryone || allowHere) parse.push('everyone');
  let sent;
  // Gönderim Discord kapısından geçer: aynı anda en fazla DISCORD_SEND_CONCURRENCY
  // istek Discord'a çıkar, fazlası sunucuda sırada bekler (kuyruk şişmez).
  if (req.body.anonymous) {
    if (!botPerms.has(PermissionsBitField.Flags.ManageWebhooks)) {
      throw new Error('Anonim mesaj için botun bu kanalda `Webhookları Yönet` yetkisi olmalı.');
    }
    // sendAnonymousMessage kapıları kendi içinde doğru sırada kullanır.
    sent = await sendAnonymousMessage(channel, { content: outgoingContent, username: 'Anonymous', allowedMentions: { parse } });
  } else {
    sent = await withDiscordSlot(() => channel.send({ content: outgoingContent, allowedMentions: { parse } }));
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
  if (result.ok) forgetAnonymousWebhook(channelId);
  res.json(result);
}));

app.post('/api/channels/bulk/rename', requireAuth, wrap(async (req, res) => {
  const guild = getGuild(req.session.guildId);
  const actor = await actorOf(req, guild);
  const { items } = req.body || {};
  if (!Array.isArray(items) || !items.length) throw new Error('Düzenlenecek kanal seçilmedi.');
  const result = await mod.bulkRenameChannels(guild, actor, items);
  if (result.ok && result.updated > 0) {
    settings.log(guild.id, 'channel', `${actor.user.username} toplu kanal adı değiştirdi (${result.updated} kanal)`);
  }
  res.json(result);
}));

app.post('/api/channels/bulk/topic', requireAuth, wrap(async (req, res) => {
  const guild = getGuild(req.session.guildId);
  const actor = await actorOf(req, guild);
  const ids = [...new Set(Array.isArray(req.body.channelIds) ? req.body.channelIds.map(String) : [])];
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
  const result = await mod.bulkDeleteChannels(guild, actor, channelIds, Boolean(deleteChildren));
  if (result.ok && result.deleted > 0) {
    settings.log(guild.id, 'channel', `${actor.user.username} toplu kanal sildi (${result.deleted} kanal)`);
    channelIds.forEach((id) => forgetAnonymousWebhook(id));
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
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    for (const item of items) {
      try {
        const role = await guild.roles.create({ name: String(item.name || '').trim().slice(0, 100), color: item.color || undefined, reason: `${actor.user.username}: toplu rol oluşturma` });
        results.push({ ok: true, roleId: role.id, name: role.name });
      } catch (e) { results.push({ ok: false, error: e.message, name: item.name }); }
    }
  } else {
    const ids = [...new Set(Array.isArray(req.body.roleIds) ? req.body.roleIds.map(String) : [])];
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

// ---------------------------------------------------------------- GUARD (KORUMA)
/** Guard yapılandırması yalnızca yönetici tarafından değiştirilebilir. */
function requireGuardAdmin(actor) {
  if (!mod.isAdmin(actor)) throw new Error('Guard ayarları için `Yönetici` yetkin olmalı.');
}

/** Güvenli listedeki ID'leri panel için isimlendirilmiş kayıtlara çevirir. */
function guardWhitelistView(guild, cfg) {
  return (cfg.whitelist || []).map((id) => {
    const member = guild.members.cache.get(String(id));
    return {
      id: String(id),
      name: member ? (member.user.username || member.displayName) : String(id),
      bot: Boolean(member?.user?.bot)
    };
  });
}

app.get(
  '/api/guard',
  requireAuth,
  wrap(async (req, res) => {
    const guild = getGuild(req.session.guildId);
    const cfg = guard.get(guild.id);
    const textChannels = [...guild.channels.cache.values()]
      .filter((c) => c.isTextBased && c.isTextBased())
      .map((c) => ({ id: c.id, name: c.name }));
    const roles = [...guild.roles.cache.values()]
      .filter((r) => r.id !== guild.id && !r.managed)
      .map((r) => ({ id: r.id, name: r.name }));
    const whitelist = guardWhitelistView(guild, cfg);
    res.json({
      guard: { ...cfg, whitelist },
      admin: guard.adminSummary(guild.id, guild),
      statusLabels: guard.STATUS_LABEL,
      modules: guard.MODULES,
      limitActions: guard.LIMIT_ACTIONS,
      punishments: guard.PUNISHMENTS,
      honeypotActions: guard.HONEYPOT_ACTIONS,
      adActions: guard.AD_ACTIONS,
      botActions: guard.BOT_ACTIONS,
      raidActions: guard.RAID_ACTIONS,
      newAccountActions: guard.NEW_ACCOUNT_ACTIONS,
      presets: guard.PRESETS,
      summary: guard.summary(guild.id, guild),
      statsSeries: guard.daySeries(guild.id, 14),
      events: guard.events(guild.id, 60),
      textChannels,
      roles
    });
  })
);

app.post(
  '/api/guard/config',
  requireAuth,
  wrap(async (req, res) => {
    const guild = getGuild(req.session.guildId);
    const actor = await actorOf(req, guild);
    requireGuardAdmin(actor);
    const body = req.body || {};
    const result = guard.setConfig(guild.id, body);
    if (!result.ok) throw new Error(result.error);
    if (Array.isArray(body.whitelist)) {
      const clean = body.whitelist.map((x) => String(x).replace(/[<@!>]/g, '')).filter((x) => /^\d{5,25}$/.test(x));
      guard.update(guild.id, { whitelist: clean });
    }
    settings.log(guild.id, 'guard', `${actor.user.username} guard ayarlarını güncelledi (${Object.keys(body).join(', ') || 'genel'})`);
    const cfg = guard.get(guild.id);
    res.json({
      ok: true,
      guard: { ...cfg, whitelist: guardWhitelistView(guild, cfg) },
      summary: guard.summary(guild.id, guild),
      events: guard.events(guild.id, 60),
      statsSeries: guard.daySeries(guild.id, 14)
    });
  })
);

app.post(
  '/api/guard/preset',
  requireAuth,
  wrap(async (req, res) => {
    const guild = getGuild(req.session.guildId);
    const actor = await actorOf(req, guild);
    requireGuardAdmin(actor);
    const result = guard.applyPreset(guild.id, req.body?.preset || 'dengeli');
    if (!result.ok) throw new Error(result.error);
    settings.log(guild.id, 'guard', `${actor.user.username} hazır ayar uyguladı: ${result.preset}`);
    const cfg = guard.get(guild.id);
    res.json({
      ok: true,
      guard: { ...cfg, whitelist: guardWhitelistView(guild, cfg) },
      summary: guard.summary(guild.id, guild),
      admin: guard.adminSummary(guild.id, guild),
      statsSeries: guard.daySeries(guild.id, 14)
    });
  })
);

app.post(
  '/api/guard/honeypot',
  requireAuth,
  wrap(async (req, res) => {
    const guild = getGuild(req.session.guildId);
    const actor = await actorOf(req, guild);
    requireGuardAdmin(actor);
    const action = String(req.body?.action || 'setup');
    let result;
    if (action === 'setup') {
      result = await guard.createHoneypotChannel(guild);
    } else if (action === 'role') {
      result = await guard.createHoneypotRole(guild);
    } else if (action === 'disable') {
      result = guard.honeypotDisable(guild.id);
    } else if (action === 'test') {
      result = { ok: true, event: guard.honeypotOffense(guild, guard.get(guild.id), actor.user.id, { name: `${actor.user.username} (test)`, kind: 'test' }) };
    } else {
      throw new Error('Bilinmeyen honeypot işlemi.');
    }
    if (!result.ok) throw new Error(result.error || 'Honeypot işlemi başarısız.');
    settings.log(guild.id, 'guard', `${actor.user.username} honeypot işlemi: ${action}`);
    const cfg = guard.get(guild.id);
    res.json({
      ok: true,
      result,
      guard: { ...cfg, whitelist: guardWhitelistView(guild, cfg) },
      summary: guard.summary(guild.id, guild),
      events: guard.events(guild.id, 60)
    });
  })
);

app.post(
  '/api/guard/ad-sim',
  requireAuth,
  wrap(async (req, res) => {
    const guild = getGuild(req.session.guildId);
    const text = String(req.body?.text || '').slice(0, 2000);
    if (!text.trim()) throw new Error('Test için bir metin yaz.');
    res.json({ ok: true, analysis: guard.analyzeAd(text, guard.get(guild.id)) });
  })
);

app.post(
  '/api/guard/restore',
  requireAuth,
  wrap(async (req, res) => {
    const guild = getGuild(req.session.guildId);
    const actor = await actorOf(req, guild);
    requireGuardAdmin(actor);
    const result = await guard.restoreBackup(guild, { limiter: 80 });
    if (!result.ok) throw new Error(result.error);
    settings.log(guild.id, 'guard', `${actor.user.username} yedekten geri yükledi (${result.roles} rol, ${result.channels} kanal)`);
    res.json({ ok: true, ...result, summary: guard.summary(guild.id, guild), events: guard.events(guild.id, 60) });
  })
);

app.post(
  '/api/guard/panic',
  requireAuth,
  wrap(async (req, res) => {
    const guild = getGuild(req.session.guildId);
    const actor = await actorOf(req, guild);
    requireGuardAdmin(actor);
    const result = await guard.panic(guild, actor.user.username);
    if (!result.ok) throw new Error(result.error);
    settings.log(guild.id, 'guard', `${actor.user.username} panik modu çalıştırdı (${result.roles} rol alındı)`);
    res.json({ ok: true, ...result, summary: guard.summary(guild.id, guild), events: guard.events(guild.id, 60) });
  })
);

app.post(
  '/api/guard/audit',
  requireAuth,
  wrap(async (req, res) => {
    const guild = getGuild(req.session.guildId);
    const actor = await actorOf(req, guild);
    requireGuardAdmin(actor);
    await guard.safetyAudit(guild);
    res.json({ ok: true, summary: guard.summary(guild.id, guild), events: guard.events(guild.id, 60) });
  })
);

app.post(
  '/api/guard/module',
  requireAuth,
  wrap(async (req, res) => {
    const guild = getGuild(req.session.guildId);
    const actor = await actorOf(req, guild);
    requireGuardAdmin(actor);
    const result = guard.setModule(guild.id, String(req.body?.key || ''), Boolean(req.body?.enabled));
    if (!result.ok) throw new Error(result.error);
    settings.log(guild.id, 'guard', `${actor.user.username} ${result.label} modülünü ${result.enabled ? 'açtı' : 'kapattı'}`);
    const cfg = guard.get(guild.id);
    res.json({ ok: true, guard: { ...cfg, whitelist: guardWhitelistView(guild, cfg) }, summary: guard.summary(guild.id, guild) });
  })
);

app.post(
  '/api/guard/limit',
  requireAuth,
  wrap(async (req, res) => {
    const guild = getGuild(req.session.guildId);
    const actor = await actorOf(req, guild);
    requireGuardAdmin(actor);
    const result = guard.setLimit(guild.id, String(req.body?.key || ''), req.body?.value);
    if (!result.ok) throw new Error(result.error);
    settings.log(guild.id, 'guard', `${actor.user.username} ${result.label} limitini ${result.limit} yaptı`);
    const cfg = guard.get(guild.id);
    res.json({ ok: true, guard: { ...cfg, whitelist: guardWhitelistView(guild, cfg) }, summary: guard.summary(guild.id, guild) });
  })
);

app.post(
  '/api/guard/whitelist',
  requireAuth,
  wrap(async (req, res) => {
    const guild = getGuild(req.session.guildId);
    const actor = await actorOf(req, guild);
    requireGuardAdmin(actor);
    const userId = String(req.body?.userId || '').replace(/[<@!>]/g, '');
    if (!/^\d{5,25}$/.test(userId)) throw new Error('Geçerli bir kullanıcı ID gir.');
    const action = req.body?.action === 'remove' ? 'remove' : 'add';
    const result = action === 'add' ? guard.addWhitelist(guild.id, userId) : guard.removeWhitelist(guild.id, userId);
    if (!result.ok) throw new Error(result.error);
    settings.log(guild.id, 'guard', `${actor.user.username} güvenli listeye kullanıcı ${action === 'add' ? 'ekledi' : 'listeden çıkardı'}: ${userId}`);
    const cfg = guard.get(guild.id);
    res.json({ ok: true, guard: { ...cfg, whitelist: guardWhitelistView(guild, cfg) }, summary: guard.summary(guild.id, guild) });
  })
);

app.get(
  '/api/guard/events',
  requireAuth,
  wrap(async (req, res) => {
    const guild = getGuild(req.session.guildId);
    res.json({ events: guard.events(guild.id, 60), summary: guard.summary(guild.id, guild) });
  })
);

app.post(
  '/api/guard/events/clear',
  requireAuth,
  wrap(async (req, res) => {
    const guild = getGuild(req.session.guildId);
    const actor = await actorOf(req, guild);
    requireGuardAdmin(actor);
    guard.clearEvents(guild.id);
    settings.log(guild.id, 'guard', `${actor.user.username} guard olay akışını temizledi`);
    res.json({ ok: true, events: [] });
  })
);

app.post(
  '/api/guard/backup',
  requireAuth,
  wrap(async (req, res) => {
    const guild = getGuild(req.session.guildId);
    const actor = await actorOf(req, guild);
    requireGuardAdmin(actor);
    const result = guard.takeBackup(guild);
    settings.log(guild.id, 'guard', `${actor.user.username} yedek aldı (${result.roles} rol, ${result.channels} kanal)`);
    res.json({ ok: true, ...result, summary: guard.summary(guild.id, guild) });
  })
);

app.post(
  '/api/guard/test',
  requireAuth,
  wrap(async (req, res) => {
    const guild = getGuild(req.session.guildId);
    const actor = await actorOf(req, guild);
    requireGuardAdmin(actor);
    const event = guard.runTest(guild, actor.user.username);
    settings.log(guild.id, 'guard', `${actor.user.username} guard testi çalıştırdı`);
    res.json({ ok: true, event, events: guard.events(guild.id, 60), summary: guard.summary(guild.id, guild) });
  })
);

// ============================================ GUARD MERKEZİ (OPERATÖR KATMANI)
// Bu rotalar sunucu bazlı Discord yetkisine değil, PANEL GİRİŞİNE (operatör)
// dayanır: bottaki tüm sunucuların koruma durumu buradan görülür ve düzenlenir.
// Whitelist/blacklist, sessiz mod ve otomatik pasifleştirme burada yönetilir.
// Discord tarafına bu bilgiler sızmaz.
function centerClient() {
  return botState.client || null;
}

function centerGuild(guildId) {
  const c = centerClient();
  return c?.guilds?.cache?.get(String(guildId)) || null;
}

function requireGuildId(value) {
  const id = String(value || '').trim();
  if (!/^\d{5,25}$/.test(id)) throw new Error('Geçerli bir sunucu ID gir.');
  return id;
}

function centerRow(guildId) {
  const id = String(guildId);
  const row = guard.guildStates(centerClient()).find((g) => g.id === id);
  if (row) return row;
  const adm = guard.adminSummary(id, centerGuild(id));
  return { id, name: id, memberCount: null, online: false, icon: null, ...adm, statusLabel: guard.STATUS_LABEL[adm.status] || adm.status };
}

function centerPayload() {
  const guilds = guard.guildStates(centerClient());
  return {
    ok: true,
    policy: guard.policy(),
    statusLabels: guard.STATUS_LABEL,
    stats: guard.policyStats(guilds),
    guilds,
    ops: guard.ops(80),
    modules: guard.MODULES,
    limitActions: guard.LIMIT_ACTIONS,
    punishments: guard.PUNISHMENTS,
    presets: guard.PRESETS,
    botReady: Boolean(centerClient()?.readyAt)
  };
}

app.get(
  '/api/guard/center',
  requireAuth,
  wrap(async (req, res) => {
    res.json(centerPayload());
  })
);

app.post(
  '/api/guard/center/sync',
  requireAuth,
  wrap(async (req, res) => {
    const synced = guard.syncAll(centerClient());
    settings.log(req.session.guildId, 'guard', `Guard merkezi: ${synced.length} sunucu senkronize edildi`);
    res.json({ ...centerPayload(), synced: synced.length });
  })
);

app.post(
  '/api/guard/center/policy',
  requireAuth,
  wrap(async (req, res) => {
    if (req.body?.autoBlockNewGuilds === undefined) throw new Error('autoBlockNewGuilds gerekli.');
    guard.setAutoBlock(Boolean(req.body.autoBlockNewGuilds), req.session.user.username);
    settings.log(req.session.guildId, 'guard', `Yeni sunucuları otomatik pasifleştirme ${req.body.autoBlockNewGuilds ? 'açıldı' : 'kapatıldı'}`);
    res.json(centerPayload());
  })
);

app.post(
  '/api/guard/center/guild',
  requireAuth,
  wrap(async (req, res) => {
    const guildId = requireGuildId(req.body?.guildId);
    const action = String(req.body?.action || '');
    const actor = req.session.user.username;
    const reason = req.body?.reason ? String(req.body.reason).slice(0, 200) : null;
    let result = null;
    if (action === 'approve') {
      result = guard.approveGuild(guildId, { actor, note: req.body?.note || null });
      settings.log(req.session.guildId, 'guard', `${actor} sunucuyu whitelist'e aldı: ${guildId}`);
    } else if (action === 'revoke') {
      result = guard.revokeGuild(guildId, { actor, reason });
      settings.log(req.session.guildId, 'guard', `${actor} sunucuyu whitelist'ten çıkardı ve sessize aldı: ${guildId}${reason ? ` (${reason})` : ''}`);
    } else if (action === 'silent') {
      result = guard.setSilent(guildId, true, { actor, reason });
      settings.log(req.session.guildId, 'guard', `${actor} sunucuyu sessize aldı: ${guildId}${reason ? ` (${reason})` : ''}`);
    } else if (action === 'unsilent') {
      result = guard.setSilent(guildId, false, { actor });
      settings.log(req.session.guildId, 'guard', `${actor} sunucunun sessiz modunu kaldırdı: ${guildId}`);
    } else if (action === 'enable' || action === 'disable') {
      guard.setEnabled(guildId, action === 'enable', actor);
      settings.log(req.session.guildId, 'guard', `${actor} sunucu görünür korumasını ${action === 'enable' ? 'açtı' : 'kapattı'}: ${guildId}`);
    } else {
      throw new Error('Bilinmeyen işlem. (approve, revoke, silent, unsilent, enable, disable)');
    }
    res.json({ ...centerPayload(), changed: centerRow(guildId), result: result || null });
  })
);

app.get(
  '/api/guard/center/guild/detail',
  requireAuth,
  wrap(async (req, res) => {
    const guildId = requireGuildId(req.query?.guildId);
    const guild = centerGuild(guildId);
    const cfg = guard.get(guildId);
    const textChannels = guild
      ? [...guild.channels.cache.values()].filter((c) => c.isTextBased && c.isTextBased()).map((c) => ({ id: c.id, name: c.name }))
      : [];
    const roles = guild
      ? [...guild.roles.cache.values()].filter((r) => r.id !== guild.id && !r.managed).map((r) => ({ id: r.id, name: r.name }))
      : [];
    res.json({
      ok: true,
      guild: centerRow(guildId),
      admin: guard.adminSummary(guildId, guild),
      guard: { ...cfg, whitelist: guild ? guardWhitelistView(guild, cfg) : cfg.whitelist.map((id) => ({ id: String(id), name: String(id), bot: false })) },
      modules: guard.MODULES,
      limitActions: guard.LIMIT_ACTIONS,
      punishments: guard.PUNISHMENTS,
      honeypotActions: guard.HONEYPOT_ACTIONS,
      adActions: guard.AD_ACTIONS,
      presets: guard.PRESETS,
      statsSeries: guard.daySeries(guildId, 14),
      events: guard.events(guildId, 60),
      ops: guard.ops(200).filter((o) => o.guildId === String(guildId)),
      textChannels,
      roles,
      online: Boolean(guild)
    });
  })
);

app.post(
  '/api/guard/center/config',
  requireAuth,
  wrap(async (req, res) => {
    const guildId = requireGuildId(req.body?.guildId);
    const guild = centerGuild(guildId);
    const actor = req.session.user.username;
    const body = req.body || {};
    const result = guard.setConfig(guildId, body);
    if (!result.ok) throw new Error(result.error);
    if (Array.isArray(body.whitelist)) {
      const clean = body.whitelist.map((x) => String(x).replace(/[<@!>]/g, '')).filter((x) => /^\d{5,25}$/.test(x));
      guard.update(guildId, { whitelist: clean });
    }
    if (body.enabled !== undefined && Boolean(body.enabled) !== guard.get(guildId).enabled) {
      guard.setEnabled(guildId, Boolean(body.enabled), actor);
    }
    guard.pushOps({ guildId, guildName: guild?.name || null, action: 'config', detail: `Ayarlar güncellendi: ${Object.keys(body).join(', ') || 'genel'}`, actor });
    settings.log(req.session.guildId, 'guard', `${actor} guard merkezinden ayar güncelledi: ${guildId}`);
    const updated = guard.get(guildId);
    res.json({
      ok: true,
      guild: centerRow(guildId),
      admin: guard.adminSummary(guildId, guild),
      guard: {
        ...updated,
        whitelist: guild
          ? guardWhitelistView(guild, updated)
          : updated.whitelist.map((id) => ({ id: String(id), name: String(id), bot: false }))
      }
    });
  })
);

app.post(
  '/api/guard/center/preset',
  requireAuth,
  wrap(async (req, res) => {
    const guildId = requireGuildId(req.body?.guildId);
    const guild = centerGuild(guildId);
    const actor = req.session.user.username;
    const result = guard.applyPreset(guildId, req.body?.preset || 'dengeli');
    if (!result.ok) throw new Error(result.error || 'Hazır ayar uygulanamadı.');
    guard.pushOps({ guildId, guildName: guild?.name || null, action: 'preset', detail: `Hazır ayar uygulandı: ${result.preset}`, actor });
    const updated = guard.get(guildId);
    res.json({
      ok: true,
      guild: centerRow(guildId),
      admin: guard.adminSummary(guildId, guild),
      guard: {
        ...updated,
        whitelist: guild ? guardWhitelistView(guild, updated) : updated.whitelist.map((id) => ({ id: String(id), name: String(id), bot: false }))
      },
      statsSeries: guard.daySeries(guildId, 14)
    });
  })
);

app.post(
  '/api/guard/center/honeypot',
  requireAuth,
  wrap(async (req, res) => {
    const guildId = requireGuildId(req.body?.guildId);
    const guild = centerGuild(guildId);
    if (!guild) throw new Error('Bu sunucu bot önbelleğinde yok (bot çevrimdışı olabilir).');
    const action = String(req.body?.action || 'setup');
    let result;
    if (action === 'setup') result = await guard.createHoneypotChannel(guild);
    else if (action === 'role') result = await guard.createHoneypotRole(guild);
    else if (action === 'disable') result = guard.honeypotDisable(guildId);
    else throw new Error('Bilinmeyen honeypot işlemi.');
    if (!result.ok) throw new Error(result.error || 'Honeypot işlemi başarısız.');
    guard.pushOps({ guildId, guildName: guild.name, action: 'honeypot', detail: `Honeypot: ${action}`, actor: req.session.user.username });
    const updated = guard.get(guildId);
    res.json({
      ok: true,
      result,
      guild: centerRow(guildId),
      admin: guard.adminSummary(guildId, guild),
      guard: { ...updated, whitelist: guardWhitelistView(guild, updated) },
      events: guard.events(guildId, 60)
    });
  })
);

app.post(
  '/api/guard/center/ad-sim',
  requireAuth,
  wrap(async (req, res) => {
    const guildId = requireGuildId(req.body?.guildId);
    const text = String(req.body?.text || '').slice(0, 2000);
    if (!text.trim()) throw new Error('Test için bir metin yaz.');
    res.json({ ok: true, analysis: guard.analyzeAd(text, guard.get(guildId)) });
  })
);

app.post(
  '/api/guard/center/restore',
  requireAuth,
  wrap(async (req, res) => {
    const guildId = requireGuildId(req.body?.guildId);
    const guild = centerGuild(guildId);
    if (!guild) throw new Error('Bu sunucu bot önbelleğinde yok (bot çevrimdışı olabilir).');
    const result = await guard.restoreBackup(guild, { limiter: 80 });
    if (!result.ok) throw new Error(result.error);
    guard.pushOps({ guildId, guildName: guild.name, action: 'restore', detail: `Yedekten geri yükleme: ${result.roles} rol, ${result.channels} kanal`, actor: req.session.user.username });
    res.json({ ok: true, ...result, guild: centerRow(guildId), events: guard.events(guildId, 60) });
  })
);

app.post(
  '/api/guard/center/panic',
  requireAuth,
  wrap(async (req, res) => {
    const guildId = requireGuildId(req.body?.guildId);
    const guild = centerGuild(guildId);
    if (!guild) throw new Error('Bu sunucu bot önbelleğinde değil (bot çevrimdışı olabilir).');
    const result = await guard.panic(guild, req.session.user.username);
    if (!result.ok) throw new Error(result.error);
    guard.pushOps({ guildId, guildName: guild.name, action: 'panic', detail: `PANİK: ${result.roles} rol alındı, ${result.invites} davet silindi`, actor: req.session.user.username });
    res.json({ ok: true, ...result, guild: centerRow(guildId), events: guard.events(guildId, 60) });
  })
);

app.post(
  '/api/guard/center/note',
  requireAuth,
  wrap(async (req, res) => {
    const guildId = requireGuildId(req.body?.guildId);
    const result = guard.setNote(guildId, req.body?.text || '', req.session.user.username);
    res.json({ ok: true, note: result.note, guild: centerRow(guildId), ops: guard.ops(80) });
  })
);

app.get(
  '/api/guard/center/events',
  requireAuth,
  wrap(async (req, res) => {
    const guildId = requireGuildId(req.query?.guildId);
    res.json({ ok: true, guildId, events: guard.events(guildId, 80), admin: guard.adminSummary(guildId, centerGuild(guildId)) });
  })
);

app.post(
  '/api/guard/center/events/clear',
  requireAuth,
  wrap(async (req, res) => {
    const guildId = requireGuildId(req.body?.guildId);
    guard.clearEvents(guildId);
    guard.pushOps({ guildId, guildName: centerGuild(guildId)?.name || null, action: 'events-clear', detail: 'Olay akışı temizlendi', actor: req.session.user.username });
    res.json({ ok: true, guildId, events: [] });
  })
);

app.post(
  '/api/guard/center/test',
  requireAuth,
  wrap(async (req, res) => {
    const guildId = requireGuildId(req.body?.guildId);
    const guild = centerGuild(guildId);
    if (!guild) throw new Error('Bu sunucu bot önbelleğinde yok (bot çevrimdışı olabilir).');
    const event = guard.runTest(guild, req.session.user.username);
    guard.pushOps({ guildId, guildName: guild.name, action: 'test', detail: 'Örnek guard kaydı üretildi', actor: req.session.user.username });
    res.json({ ok: true, event, events: guard.events(guildId, 80) });
  })
);

app.post(
  '/api/guard/center/backup',
  requireAuth,
  wrap(async (req, res) => {
    const guildId = requireGuildId(req.body?.guildId);
    const guild = centerGuild(guildId);
    if (!guild) throw new Error('Bu sunucu bot önbelleğinde yok (bot çevrimdışı olabilir).');
    const result = guard.takeBackup(guild);
    guard.pushOps({ guildId, guildName: guild.name, action: 'backup', detail: `Yedek alındı: ${result.roles} rol, ${result.channels} kanal`, actor: req.session.user.username });
    res.json({ ok: true, ...result, guild: centerRow(guildId) });
  })
);

app.get(
  '/api/guard/center/ops',
  requireAuth,
  wrap(async (req, res) => {
    res.json({ ok: true, ops: guard.ops(200) });
  })
);

app.post(
  '/api/guard/center/ops/clear',
  requireAuth,
  wrap(async (req, res) => {
    guard.clearOps();
    res.json({ ok: true, ops: [] });
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
    // Yalnızca önbellek temizliği: hiçbir kanala otomatik webhook konmaz.
    registerWebhookEvents(startBot());
    console.log('[webhook] Anonymous webhook yalnızca istendiğinde eklenir (hızlı seçimde "Anonymous ekle" veya anonim gönderim).');
  }
});
module.exports = { app };
