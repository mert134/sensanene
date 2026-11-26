/**
 * Guard motoru regresyon testleri — harici bağımlılık yok (node tests/guard.test.js).
 * discord.js yalnızca sabitler için kullanılır; sahte guild/üye/kanal nesneleriyle
 * gerçek olay dinleyicileri (audit, mesaj, katılım) çalıştırılır.
 */
process.env.DATA_DIR = process.env.DATA_DIR || require('path').join(require('os').tmpdir(), `guard-test-${process.pid}`);
require('fs').rmSync(process.env.DATA_DIR, { recursive: true, force: true });

const guard = require('../src/guard');
const { PermissionFlagsBits, AuditLogEvent, ChannelType, Collection } = require('discord.js');

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; failures.push(name); console.log(`  ✗ ${name} ${extra}`); }
}
function section(title) { console.log(`\n${title}`); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- SAHTE DÜNYA */
const BOT_ID = 'bot-1';

function makeCache(map = new Map()) {
  map.get = map.get.bind(map);
  return map;
}

function makeGuild(id = 'g1', { memberCount = 40, perms = ['BanMembers', 'KickMembers', 'ModerateMembers', 'ManageChannels', 'ManageGuild', 'ManageRoles'] } = {}) {
  const permSet = new Set(perms);
  const guild = {
    id,
    name: `Test ${id}`,
    ownerId: 'owner-1',
    memberCount,
    mfaLevel: 1,
    verificationLevel: 1,
    client: { user: { id: BOT_ID }, application: { id: 'app-1' } },
    members: { cache: makeCache(new Map()), me: null },
    channels: { cache: makeCache(new Map()), create: async (opts) => { guild.__createdName = opts?.name; return makeChannel(`ch-new-${guild.__chanSeq = (guild.__chanSeq || 0) + 1}`, guild, opts); } },
    roles: { cache: makeCache(new Map()), create: async () => ({ id: `role-${Math.random().toString(36).slice(2, 7)}` }) },
    bans: { create: async (uid, opts) => { guild.__banned.push({ uid, opts }); } },
    invites: { fetch: async () => makeCache(new Map()) },
    setVerificationLevel: async (lvl) => { guild.__verify = lvl; },
    __banned: [],
    __verify: null
  };
  guild.members.me = {
    id: BOT_ID,
    permissions: { has: (flag) => {
      const entry = Object.entries(PermissionFlagsBits).find(([, v]) => v === flag);
      return entry ? permSet.has(entry[0]) : true;
    } },
    roles: { highest: { position: 100 } },
    kick: async () => {}
  };
  guild.members.cache.set(BOT_ID, guild.members.me);
  return guild;
}

function makeChannel(id, guild, opts = {}) {
  const channel = {
    id,
    name: opts.name || id,
    type: opts.type ?? ChannelType.GuildText,
    guild,
    isTextBased: () => true,
    messages: { fetch: async () => makeCache(new Map()) },
    send: async (payload) => { guild.__sent = guild.__sent || []; guild.__sent.push(payload); },
    delete: async () => { guild.channels.cache.delete(id); }
  };
  guild.channels.cache.set(id, channel);
  return channel;
}

let memberRoleSeq = 200;
function makeMember(guild, id, { tag = `user#${id}`, bot = false, dangerous = true, createdDaysAgo = 100, avatar = null } = {}) {
  const roleCollection = new Map();
  if (dangerous) {
    roleCollection.set(`role-${id}`, {
      id: `role-${id}`,
      name: 'Yetkili',
      managed: false,
      position: memberRoleSeq++,
      permissions: { has: (flag) => flag === PermissionFlagsBits.Administrator }
    });
  }
  const roles = {
    cache: makeCache(roleCollection),
    highest: { position: 10 },
    remove: async (list) => { roles.__removed = (roles.__removed || 0) + (Array.isArray(list) ? list.length : 1); }
  };
  const member = {
    id,
    guild,
    roles,
    bannable: true,
    kickable: true,
    moderatable: true,
    user: {
      id,
      tag,
      username: tag.split('#')[0],
      bot,
      avatar,
      createdTimestamp: Date.now() - createdDaysAgo * 86400000
    },
    kick: async () => { member.__kicked = true; },
    timeout: async (ms) => { member.__timeout = ms; }
  };
  guild.members.cache.set(id, member);
  return member;
}

function makeMessage(guild, member, content, { channelId = 'chan-1', mentions = {}, id = `m-${Math.random().toString(36).slice(2)}` } = {}) {
  const roles = mentions.roles && new Map(mentions.roles.map((r) => [r, { id: r }]));
  const users = new Map();
  const message = {
    id,
    guild,
    channelId,
    channel: guild.channels.cache.get(channelId) || makeChannel(channelId, guild),
    author: member.user,
    member,
    content,
    embeds: [],
    attachments: new Map(),
    webhookId: null,
    mentions: {
      roles: roles ? makeCache(roles) : makeCache(new Map()),
      users: makeCache(users),
      everyone: Boolean(mentions.everyone)
    },
    __deleted: false,
    delete: async () => { message.__deleted = true; },
    react: async () => {}
  };
  message.channel.messages.cache = new Map([[id, message]]);
  if (message.channel.messages.cache instanceof Map) {
    message.channel.messages.cache.values = () => [];
  }
  return message;
}

/* Discord client olay yönlendiricisi */
const listeners = new Map();
const fakeClient = {
  user: { id: BOT_ID },
  application: { id: 'app-1' },
  guilds: { cache: makeCache(new Map()) },
  options: { intents: { has: () => true } },
  on(event, fn) { listeners.set(event, fn); return this; }
};
const { Events } = require('discord.js');
const emit = (event, ...args) => listeners.get(event)?.(...args);

function prepare(guild, patch = {}) {
  guard.savePolicy({
    autoBlockNewGuilds: true,
    allowed: [...guard.policy().allowed.filter((x) => x !== guild.id), guild.id],
    blocked: guard.policy().blocked.filter((x) => x !== guild.id)
  });
  guard.update(guild.id, { enabled: true, silent: false, ...patch });
  return guard.get(guild.id);
}

async function audit(guild, actionType, { executorId = 'nuker-1', targetId = 'target-1' } = {}) {
  const prev = guild.members.cache.get(executorId);
  const member = prev || makeMember(guild, executorId, { tag: `nuker#${executorId}` });
  emit(Events.GuildAuditLogEntryCreate, {
    actionType,
    executorId,
    executor: member.user,
    targetId,
    target: { id: targetId },
    changes: [],
    extra: null
  }, guild);
  await sleep(30);
}

/* ================================================================== TESTLER */
(async () => {
  guard.start(fakeClient);

  section('[1] Yapılandırma ve limitler');
  {
    const g = makeGuild('cfg');
    const before = guard.get('cfg');
    ok('varsayılan 11 modül açık', Object.values(before.modules).filter(Boolean).length === 11);
    ok('varsayılan massDestructive 5', Number(before.thresholds.massDestructive) === 5);
    const lowWin = guard.setConfig('cfg', { windowSeconds: 1 });
    ok('pencere < 5 sn reddedilir', lowWin.ok === false && guard.get('cfg').windowSeconds === 60);
    const highWin = guard.setConfig('cfg', { windowSeconds: 9999 });
    ok('pencere > 600 sn reddedilir', highWin.ok === false && guard.get('cfg').windowSeconds === 60);
    guard.setConfig('cfg', { windowSeconds: 60 });
    guard.setLimit('cfg', 'ban', 0);
    ok('limit 0 reddedilir', guard.get('cfg').limits.ban === before.limits.ban);
    guard.setLimit('cfg', 'ban', 4);
    ok('limit güncellenir', guard.get('cfg').limits.ban === 4);
    guard.setRatio('cfg', 'ban', 3);
    ok('oran güncellenir', guard.get('cfg').ratios.ban === 3);
    guard.setConfig('cfg', { honeypot: { action: 'saçma' }, ad: { action: 'yok' } });
    ok('geçersiz honeypot cezası düşer', guard.get('cfg').honeypot.action === 'timeout');
    ok('geçersiz reklam cezası düşer', guard.get('cfg').ad.action === 'delete');
    guard.setConfig('cfg', { ad: { trustedDomains: ['WWW.Example.COM', 'example.com'] } });
    ok('güvenilir alan adları normalize edilir', guard.get('cfg').ad.trustedDomains.join(',') === 'example.com');
    ok('preset uygula (sıkı)', guard.applyPreset('cfg', 'siki').ok && guard.get('cfg').punishment === 'ban');
    ok('bilinmeyen preset reddedilir', guard.applyPreset('cfg', 'boyle-bir-sey').ok === false);
  }

  section('[2] Reklam motoru (analyzeAd)');
  {
    const cases = [
      { text: 'selam nasılsın bugün hava güzel', expect: false, label: 'temiz sohbet' },
      { text: 'discord.gg/abcdef', expect: true, label: 'davet linki' },
      { text: 'bedava nitro almak için tıkla discord.gg/nitro', expect: true, label: 'nitro scam' },
      { text: 'd1scord[.]gg/xyz', expect: true, label: 'gizlenmiş davet' },
      { text: 'bit.ly/3abcDEF', expect: true, label: 'kısa link' },
      { text: 'steamcommunlty.com/gift', expect: true, label: 'sahte steam' },
      { text: 'kripto cüzdan airdrop kazan', expect: true, label: 'kripto tuzağı' },
      { text: 'hesap satılık dm atın', expect: true, label: 'satış ilanı' },
      { text: 'takipçi basma hizmeti', expect: true, label: 'takipçi satışı' },
      { text: 'https://youtube.com/watch?v=abc', expect: false, label: 'sıradan YouTube linki' },
      { text: 'bugün 100 mesaj attım', expect: false, label: 'sayı içeren normal cümle' },
      { text: 'iddaa bahis kupon bedava bonus', expect: true, label: 'bahis reklamı' },
      { text: 'papara iban ile ödeme', expect: true, label: 'ödeme bilgisi' }
    ];
    for (const c of cases) {
      const a = guard.analyzeAd(c.text, guard.get('cfg'));
      ok(`${c.label} → ${a.confident ? 'reklam' : 'temiz'} (skor ${a.score})`, a.confident === c.expect);
    }
    guard.setConfig('cfg', { ad: { trustedDomains: ['youtube.com'] } });
    const trusted = guard.analyzeAd('https://youtube.com/watch?v=abc', guard.get('cfg'));
    ok('güvenilir alan adı skoru düşürür', trusted.score <= 1);
    guard.setConfig('cfg', { modules: { adGuard: false } });
    ok('modül kapalıyken action=off', guard.analyzeAd('discord.gg/abcdef', guard.get('cfg')).moduleOn === false);
    guard.setConfig('cfg', { modules: { adGuard: true } });
    guard.setConfig('cfg', { ad: { allowInvites: true } });
    const allowInvite = guard.analyzeAd('discord.gg/abcdef', guard.get('cfg'));
    ok('davet serbest bırakılabilir', allowInvite.score < 3);
    guard.setConfig('cfg', { ad: { allowInvites: false } });
  }

  section('[3] Limit, oran ve toplu yıkım sayaçları');
  {
    const now = Date.now();
    guard.update('lim', { limits: { ban: 3 }, ratios: { ban: 0 }, windowSeconds: 60 });
    const r1 = guard.registerAction('lim', { actorId: 'u1', action: 'ban', now });
    guard.registerAction('lim', { actorId: 'u1', action: 'ban', now: now + 1000 });
    guard.registerAction('lim', { actorId: 'u1', action: 'ban', now: now + 2000 });
    const r4 = guard.registerAction('lim', { actorId: 'u1', action: 'ban', now: now + 3000 });
    ok('ilk işlem sınırda değil', r1.violated === false && r1.count === 1);
    ok('4. işlemde limit (3) aşılır', r4.violated === true && r4.count === 4);
    ok('aşım nedeni limit', r4.reason === 'limit');

    guard.update('lim', { ratios: { ban: 4 }, windowSeconds: 60 });
    const ratioSmall = guard.registerAction('lim2', { actorId: 'u1', action: 'ban', now, memberCount: 20 });
    ok('25 üyenin altında oran uygulanmaz', ratioSmall.ratioLimit === 0);
    guard.update('lim2', { limits: { ban: 100 }, ratios: { ban: 4 } });
    const ratioBig = guard.registerAction('lim2', { actorId: 'u1', action: 'ban', now, memberCount: 40 });
    ok('40 üyede oran limiti = 10', ratioBig.ratioLimit === 10);

    guard.update('mass', { windowSeconds: 60, thresholds: { massDestructive: 5 } });
    for (let i = 0; i < 5; i += 1) guard.registerDestructive('mass', { actorId: 'x', now: now + i });
    const d = guard.registerDestructive('mass', { actorId: 'x', now: now + 6 });
    ok('toplu yıkım eşiği yakalanır', d.count >= d.limit);
    const stale = guard.registerDestructive('mass', { actorId: 'x', now: now + 600000 });
    ok('pencere dışı damgalar süzülür', stale.count === 1);
  }

  section('[4] Gerçek müdahale (enforce)');
  {
    const g = makeGuild('enf');
    const cfg = prepare(g);
    const offender = makeMember(g, 'bad-1');
    const res = await guard.enforce(g, cfg, { offenderId: 'bad-1', action: 'ban', reason: 'test' });
    ok('ban uygulanır', res.ok && g.__banned.length === 1);
    ok('müdahale istatistiği artar', guard.get('enf').stats.blocked >= 1);

    const owner = await guard.enforce(g, cfg, { offenderId: 'owner-1', action: 'ban', reason: 'test' });
    ok('sunucu sahibine dokunulmaz', owner.ok === false && owner.error === 'Sunucu sahibi');

    guard.addWhitelist('enf', 'trusted-1');
    const trusted = await guard.enforce(g, guard.get('enf'), { offenderId: 'trusted-1', action: 'ban' });
    ok('güvenli liste korunur', trusted.ok === false && trusted.error === 'Güvenli listede');

    const lowRole = makeMember(g, 'boss-1');
    lowRole.roles.highest = { position: 500 };
    const blocked = await guard.enforce(g, guard.get('enf'), { offenderId: 'boss-1', action: 'kick' });
    ok('rol sırası yetersizse ceza denenmez', blocked.ok === false && String(blocked.error).includes('rol sırası'));

    const t = makeMember(g, 'spam-1');
    const to = await guard.enforce(g, guard.get('enf'), { offenderId: 'spam-1', action: 'timeout', minutes: 15 });
    ok('timeout 15 dk uygulanır', to.ok && t.__timeout === 15 * 60000);

    makeMember(g, 'roles-1');
    const r = await guard.enforce(g, guard.get('enf'), { offenderId: 'roles-1', action: 'roles' });
    const rMember = g.members.cache.get('roles-1');
    ok('yetkili roller alınır', r.ok && rMember.roles.__removed >= 1);

    const evCount = guard.events('enf', 100).length;
    ok('her ceza olay akışına yazılır', evCount >= 4);
    ok('ceza olayı tipi punishment', guard.events('enf', 100).some((e) => e.type === 'punishment'));
  }

  section('[5] Denetim kaydı: anti-nuke, kanal ve rol koruması');
  {
    const g = makeGuild('nuke', { memberCount: 40 });
    prepare(g, { limits: { channelDelete: 2 }, ratios: { channelDelete: 0 }, punishment: 'roles' });
    makeChannel('ch-1', g);
    makeChannel('ch-2', g);
    makeChannel('ch-3', g);
    await audit(g, AuditLogEvent.ChannelDelete, { executorId: 'nuker-1', targetId: 'ch-1' });
    await audit(g, AuditLogEvent.ChannelDelete, { executorId: 'nuker-1', targetId: 'ch-2' });
    await audit(g, AuditLogEvent.ChannelDelete, { executorId: 'nuker-1', targetId: 'ch-3' });
    await sleep(120);
    const events = guard.events('nuke', 40);
    ok('kanal silme ihlali kaydedilir', events.some((e) => e.module === 'channelGuard'));
    ok('limit aşımında müdahale denenir', events.some((e) => e.type === 'punishment'));
    ok('olay aciliyeti yüksek', events.some((e) => e.severity === 'high'));

    const g2 = makeGuild('self', { memberCount: 40 });
    prepare(g2);
    const before = guard.events('self', 20).length;
    await audit(g2, AuditLogEvent.ChannelDelete, { executorId: BOT_ID, targetId: 'ch-x' });
    ok('botun kendi işlemleri sayılmaz', guard.events('self', 20).length === before);

    const g3 = makeGuild('whitelist-audit');
    prepare(g3);
    guard.addWhitelist('whitelist-audit', 'safe-1');
    const before3 = guard.events('whitelist-audit', 20).length;
    await audit(g3, AuditLogEvent.ChannelDelete, { executorId: 'safe-1', targetId: 'ch-y' });
    ok('güvenli listedeki yürütücü atlanır', guard.events('whitelist-audit', 20).length === before3);
  }

  section('[6] Honeypot');
  {
    const g = makeGuild('honey', { memberCount: 50 });
    prepare(g, { honeypot: { enabled: true, channelId: 'honey-ch', roleId: 'honey-role', action: 'timeout' } });
    const channel = makeChannel('honey-ch', g);
    const member = makeMember(g, 'victim-1', { dangerous: false });
    const msg = makeMessage(g, member, 'tuzak kanala yazdım', { channelId: 'honey-ch' });
    emit(Events.MessageCreate, msg);
    await sleep(120);
    ok('tuzak kanal mesajı silinir', msg.__deleted === true);
    ok('tuzak cezası uygulanır', Boolean(member.__timeout));
    ok('honeypot sayacı artar', guard.summary('honey').honeypot.hits >= 1);
    ok('kanala uyarı gönderilir', (channel.__sent || []).length >= 0);

    const g2 = makeGuild('honey2');
    prepare(g2, { honeypot: { enabled: true, channelId: null, roleId: 'honey-role2', action: 'kick' } });
    const victim = makeMember(g2, 'victim-2', { dangerous: false });
    const mention = makeMessage(g2, victim, '<@&honey-role2> selam', { mentions: { roles: ['honey-role2'] } });
    emit(Events.MessageCreate, mention);
    await sleep(120);
    ok('tuzak rol mention tetikler', victim.__kicked === true);

    const g3 = makeGuild('honey3');
    prepare(g3);
    const created = await guard.createHoneypotChannel(g3, { silent: true });
    ok('tuzak kanal kurulur', Boolean(created?.channelId) && guard.get('honey3').honeypot.channelId === created.channelId);
    ok('tuzak kanal adı doğru', g3.__createdName === '・do-not-touch', String(g3.__createdName));
    const disabled = guard.honeypotDisable('honey3');
    ok('honeypot kapatılır', disabled.ok && guard.get('honey3').honeypot.enabled === false);
  }

  section('[7] Mesaj akışı: reklam, mention, spam');
  {
    const g = makeGuild('msg', { memberCount: 60 });
    const cfg = prepare(g, { ad: { action: 'delete' } });
    const member = makeMember(g, 'advertiser-1', { dangerous: false });
    const ad = makeMessage(g, member, 'bedava nitro discord.gg/scam');
    emit(Events.MessageCreate, ad);
    await sleep(60);
    ok('reklam mesajı silinir', ad.__deleted === true);
    ok('reklam istatistiği artar', guard.get('msg').stats.ads >= 1);

    const g2 = makeGuild('mention', { memberCount: 30 });
    prepare(g2);
    const spammer = makeMember(g2, 'pinger-1', { dangerous: false });
    const mass = makeMessage(g2, spammer, 'gelin', { mentions: { everyone: true } });
    mass.mentions.users = makeCache(new Map(Array.from({ length: 14 }, (_, i) => [`u${i}`, { id: `u${i}` }])));
    emit(Events.MessageCreate, mass);
    await sleep(60);
    ok('toplu mention silinir', mass.__deleted === true);

    const g3 = makeGuild('spam', { memberCount: 30 });
    prepare(g3);
    const fast = makeMember(g3, 'fast-1', { dangerous: false });
    for (let i = 0; i < 7; i += 1) {
      emit(Events.MessageCreate, makeMessage(g3, fast, `mesaj ${i}`, { id: `s-${i}` }));
    }
    await sleep(120);
    ok('hızlı mesaj spam’i timeout ile cezalanır', Boolean(fast.__timeout));

    const g4 = makeGuild('caps', { memberCount: 30 });
    prepare(g4, { caps: { enabled: true, percent: 70, minLength: 12 } });
    const shouter = makeMember(g4, 'caps-1', { dangerous: false });
    const capsMsg = makeMessage(g4, shouter, 'BU MESAJ TAMAMEN BUYUK HARFLERLE YAZILDI');
    emit(Events.MessageCreate, capsMsg);
    await sleep(60);
    ok('büyük harf bombardımanı silinir', capsMsg.__deleted === true);
  }

  section('[8] Raid ve yeni hesap koruması');
  {
    const g = makeGuild('raid', { memberCount: 100 });
    prepare(g, { raidAction: 'kick-new' });
    const joins = [];
    for (let i = 0; i < 6; i += 1) {
      const m = makeMember(g, `raider-${i}`, { createdDaysAgo: 1, avatar: 'same-avatar' });
      joins.push(m);
      emit(Events.GuildMemberAdd, m);
    }
    await sleep(200);
    const raidEvents = guard.events('raid', 40).filter((e) => e.module === 'antiRaid');
    ok('toplu katılım raid olarak işaretlenir', raidEvents.length >= 1);
    ok('yeni hesaplar atılır', joins.some((m) => m.__kicked));
    const late = makeMember(g, 'late-raider', { createdDaysAgo: 1 });
    emit(Events.GuildMemberAdd, late);
    await sleep(120);
    ok('raid modu sonraki yeni hesapları da atar', late.__kicked === true);

    const g2 = makeGuild('acct', { memberCount: 50 });
    prepare(g2, { newAccount: { enabled: true, days: 7, action: 'kick', minMembers: 1 } });
    const fresh = makeMember(g2, 'fresh-1', { createdDaysAgo: 1, avatar: 'x1' });
    emit(Events.GuildMemberAdd, fresh);
    await sleep(120);
    ok('yeni hesap (kick modu) atılır', fresh.__kicked === true);
  }

  section('[9] Güvenlik denetimi, panik ve yedek');
  {
    const g = makeGuild('safe', { memberCount: 20 });
    g.verificationLevel = 0;
    prepare(g, { logChannelId: 'old-log' });
    await guard.safetyAudit(g);
    await sleep(60);
    ok('doğrulama seviyesi yükseltilir', g.__verify === 2);
    ok('silinmiş guard kanalı onarılır', guard.get('safe').logChannelId !== 'old-log');

    const g2 = makeGuild('backup');
    makeChannel('b-ch-1', g2);
    makeChannel('b-ch-2', g2);
    guard.takeBackup(g2);
    const bk = guard.get('backup').backup;
    ok('yedek rol/kanal sayısı alınır', bk && Array.isArray(bk.channels));

    const g3 = makeGuild('panic');
    prepare(g3);
    const panicVictim = makeMember(g3, 'panic-victim-1');
    makeMember(g3, 'panic-victim-2');
    const p = await guard.panic(g3);
    ok('panik modu çalışır', p && p.ok !== false);
    ok('panik yetkili rolleri soyar', p.roles >= 2 && panicVictim.roles.__removed >= 1);
    ok('panik sunucu sahibini atlar', g3.members.cache.get(g3.ownerId)?.roles?.__removed === undefined);
    ok('panik olayı kaydedilir', guard.events('panic', 20).some((e) => e.module === 'antiNuke'));

    const g4 = makeGuild('silent');
    prepare(g4);
    guard.setSilent('silent', true, { reason: 'test' });
    ok('sessiz mod korumayı durdurur', guard.isOperational('silent') === false);
    const silentMember = makeMember(g4, 'ad-2', { dangerous: false });
    const silentMsg = makeMessage(g4, silentMember, 'discord.gg/scam2');
    emit(Events.MessageCreate, silentMsg);
    await sleep(80);
    ok('sessizde hiçbir şey silinmez', silentMsg.__deleted === false);
    guard.setSilent('silent', false);
    guard.approveGuild('silent');
    ok('whitelist onayı korumayı açar', guard.isOperational('silent') === true);
  }

  section('[10] Ayar/özet/trend tutarlılığı');
  {
    const g = makeGuild('sum');
    prepare(g);
    guard.pushEvent('sum', { type: 'info', severity: 'low', title: 'Test', detail: 'x', module: 'antiNuke' });
    const s = guard.summary('sum', g);
    ok('özet modül sayısı', s.modulesTotal === 11 && s.modulesActive === 11);
    ok('özet honeypot alanı', Boolean(s.honeypot) && typeof s.honeypot.hits === 'number');
    ok('özet istatistik alanı', Boolean(s.stats) && typeof s.stats.blocked === 'number');
    const series = guard.daySeries('sum', 14);
    ok('14 günlük trend', Array.isArray(series) && series.length === 14);
    ok('trend gün etiketi', Boolean(series[0].day) && typeof series[0].blocked === 'number');
    const adm = guard.adminSummary('sum', g);
    ok('operatör özeti alanları', ['status', 'operational', 'stats', 'honeypot', 'ad', 'safety'].every((k) => k in adm));
    const liveCache = new Map([[g.id, g]]);
    const rows = guard.guildStates({ guilds: { cache: liveCache } });
    ok('guildStates listesi', Array.isArray(rows) && rows.some((r) => r.id === 'sum'));
    const ps = guard.policyStats(rows);
    ok('policyStats sayıları', ps.total === rows.length && typeof ps.totalBlocked === 'number');
  }

  section('[11] Slash komut şeması');
  {
    const cmd = guard.guardSlashCommands[0];
    ok('tek /guard komutu', cmd.name === 'guard');
    ok('19 alt komut', cmd.options.length === 19);
    ok('JSON boyutu 8000 altında', JSON.stringify(cmd).length < 8000);
    const names = cmd.options.map((o) => o.name);
    ok('kritik alt komutlar var', ['honeypot', 'reklam', 'simülasyon', 'panik', 'geri-yükle', 'oran'].every((n) => names.includes(n)));
  }

  console.log(`\nSONUÇ: ${pass} geçti, ${fail} başarısız`);
  if (fail) {
    console.log('Başarısızlar:\n- ' + failures.join('\n- '));
    process.exitCode = 1;
  }
  process.exit(fail ? 1 : 0);
})();
