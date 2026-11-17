/**
 * Discord botu: komutlar, eğlence, moderasyon, hoş geldin, otomatik rol.
 * Panel aynı süreci (aynı client) kullandığı için panelden yapılan işlemler anında etkili olur.
 */
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  PermissionsBitField,
  EmbedBuilder,
  ActivityType
} = require('discord.js');

const settings = require('./settings');
const mod = require('./moderation');
const eco = require('./economy');
const games = require('./games');

const COLOR = {
  main: 0x5865f2,
  ok: 0x2ecc71,
  err: 0xed4245,
  warn: 0xfaa61a,
  gold: 0xf1c40f
};

const botState = {
  client: null,
  ready: false,
  error: null,
  startedAt: null,
  commands: 0,
  lastError: null
};

function buildClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildModeration
    ],
    partials: [Partials.GuildMember, Partials.User]
  });

  client.on(Events.ClientReady, (c) => {
    botState.ready = true;
    botState.startedAt = Date.now();
    botState.error = null;
    console.log(`[bot] Aktif: ${c.user.tag} — ${c.guilds.cache.size} sunucu`);
    c.user.setPresence({
      activities: [{ name: 'panelden yönetiliyor 🎛️', type: ActivityType.Watching }],
      status: 'online'
    });
  });

  client.on(Events.Error, (err) => {
    console.error('[bot] Hata:', err.message);
    botState.lastError = err.message;
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    const cfg = settings.get(member.guild.id);
    if (cfg.autoRoleId) {
      const role = member.guild.roles.cache.get(cfg.autoRoleId);
      if (role) {
        member.roles.add(role, 'Otomatik rol').catch(() => {});
      }
    }
    if (cfg.welcomeChannelId) {
      const channel = member.guild.channels.cache.get(cfg.welcomeChannelId);
      if (channel && channel.isTextBased()) {
        const text = (cfg.welcomeMessage || 'Hoş geldin {user}!')
          .replaceAll('{user}', `<@${member.id}>`)
          .replaceAll('{name}', member.user.username)
          .replaceAll('{guild}', member.guild.name);
        channel.send({ content: text }).catch(() => {});
      }
    }
  });

  client.on(Events.MessageCreate, (message) => handleMessage(message).catch((e) => console.error('[bot] komut hatası:', e)));

  return client;
}

function startBot() {
  if (!process.env.DISCORD_TOKEN) {
    botState.error = 'DISCORD_TOKEN tanımlı değil. Render > Environment bölümünden ekle.';
    console.warn('[bot]', botState.error);
    return null;
  }
  if (botState.client) return botState.client;
  const client = buildClient();
  botState.client = client;
  client.login(process.env.DISCORD_TOKEN).catch((err) => {
    botState.error = `Giriş başarısız: ${err.message}`;
    console.error('[bot]', botState.error);
  });
  return client;
}

// ------------------------------------------------------------------ YARDIMCILAR
function parseAmount(input, balance) {
  if (!input) return null;
  const s = String(input).toLowerCase().replace(',', '.');
  if (s === 'all' || s === 'tümü' || s === 'hepsi') return balance;
  if (s === 'half' || s === 'yarısı') return Math.floor(balance / 2);
  const n = Math.floor(Number(s));
  return Number.isFinite(n) ? n : null;
}

function resultEmbed({ title, description, color = COLOR.main, footer }) {
  const embed = new EmbedBuilder().setColor(color).setTitle(title).setDescription(description);
  if (footer) embed.setFooter({ text: footer });
  return embed;
}

async function runModeration(message, fn) {
  const res = await fn();
  if (res.ok) {
    await message.reply({ embeds: [resultEmbed({ title: '✅ İşlem tamam', description: res.message, color: COLOR.ok })] });
  } else {
    await message.reply({ embeds: [resultEmbed({ title: '⛔ İşlem yapılamadı', description: res.error, color: COLOR.err })] });
  }
  return res;
}

// ------------------------------------------------------------------ KOMUTLAR
const commands = new Map();

function cmd(names, description, usage, run, opts = {}) {
  for (const name of [].concat(names)) {
    commands.set(name, { name, description, usage, run, ...opts });
  }
}

// --- Genel
cmd(['yardım', 'help', 'komutlar'], 'Tüm komutları listeler', '!yardım', async (ctx) => {
  const categories = [
    {
      name: '🛡️ Moderasyon',
      value: '`!ban @üye [sebep]`\n`!unban <id> [sebep]`\n`!kick @üye [sebep]`\n`!mute @üye [10m/2h/1g] [sebep]`\n`!unmute @üye`\n`!warn @üye [sebep]`\n`!uyarılar @üye`\n`!temizle <1-100>`'
    },
    {
      name: '📁 Kanal',
      value: '`!kanal-oluştur <isim> [metin/ses/kategori]`\n`!kanal-ad <isim>`\n`!kanal-sil`'
    },
    {
      name: '🎭 Rol',
      value: '`!rol-ver @üye @rol`\n`!rol-al @üye @rol`'
    },
    {
      name: '🎰 Eğlence & Ekonomi',
      value: '`!slot <bahis>`\n`!yazıtura <bahis> <yazı/tura>`\n`!zar <1-6> <bahis>`\n`!günlük`\n`!bakiye [@üye]`\n`!sıralama`\n`!şans`\n`!8ball <soru>`\n`!espri`'
    }
  ];
  const embed = new EmbedBuilder()
    .setColor(COLOR.main)
    .setTitle('🎛️ Bot Komutları')
    .setDescription('Panelde de aynı işlemleri tıklayarak yapabilirsin.')
    .addFields(categories)
    .setFooter({ text: 'Süreler: s=sn, m=dk, h=saat, g=gün • Bahis en az 10 coin' });
  await ctx.message.reply({ embeds: [embed] });
});

cmd('ping', 'Bot gecikmesi', '!ping', async (ctx) => {
  await ctx.message.reply(`🏓 Pong! Gecikme: **${ctx.client.ws.ping}ms**`);
});

// --- Moderasyon
cmd(['ban', 'yasakla'], 'Üyeyi yasaklar', '!ban @üye [sebep]', async (ctx) => {
  const target = ctx.target;
  if (!target) return ctx.message.reply('Kimi yasaklayacağımı belirt: `!ban @üye sebep`');
  await runModeration(ctx.message, () => mod.ban(ctx.guild, ctx.member, target.id, ctx.reason));
}, { mod: true });

cmd(['unban', 'yasakkaldır'], 'Yasağı kaldırır', '!unban <kullanıcı_id> [sebep]', async (ctx) => {
  const id = ctx.args[0]?.replace(/[<@!>]/g, '');
  if (!id) return ctx.message.reply('Kullanıcı ID gerekli: `!unban 123456789`');
  await runModeration(ctx.message, () => mod.unban(ctx.guild, ctx.member, id, ctx.reason));
}, { mod: true });

cmd(['kick', 'at'], 'Üyeyi atar', '!kick @üye [sebep]', async (ctx) => {
  const target = ctx.target;
  if (!target) return ctx.message.reply('Kimi atacağımı belirt: `!kick @üye sebep`');
  await runModeration(ctx.message, () => mod.kick(ctx.guild, ctx.member, target.id, ctx.reason));
}, { mod: true });

cmd(['mute', 'sustur'], 'Üyeyi susturur', '!mute @üye [10m] [sebep]', async (ctx) => {
  const target = ctx.target;
  if (!target) return ctx.message.reply('Kimi susturacağımı belirt: `!mute @üye 10m sebep`');
  const duration = mod.parseDuration(ctx.args[1]);
  await runModeration(ctx.message, () => mod.mute(ctx.guild, ctx.member, target.id, duration, ctx.reason));
}, { mod: true });

cmd(['unmute', 'susturmakaldır'], 'Susturmayı kaldırır', '!unmute @üye', async (ctx) => {
  const target = ctx.target;
  if (!target) return ctx.message.reply('Kimi açacağımı belirt: `!unmute @üye`');
  await runModeration(ctx.message, () => mod.unmute(ctx.guild, ctx.member, target.id, ctx.reason));
}, { mod: true });

cmd(['warn', 'uyar'], 'Üyeyi uyarır', '!warn @üye [sebep]', async (ctx) => {
  const target = ctx.target;
  if (!target) return ctx.message.reply('Kimi uyaracağımı belirt: `!warn @üye sebep`');
  await runModeration(ctx.message, () => mod.warn(ctx.guild, ctx.member, target.id, ctx.reason));
}, { mod: true });

cmd(['uyarılar', 'warnings'], 'Üyenin uyarılarını gösterir', '!uyarılar @üye', async (ctx) => {
  const target = ctx.target;
  if (!target) return ctx.message.reply('Kimin uyarılarına bakayım: `!uyarılar @üye`');
  const list = mod.warningsOf(ctx.guild.id, target.id);
  if (!list.length) return ctx.message.reply(`✅ <@${target.id}> hiç uyarı almamış.`);
  const text = list
    .map((w, i) => `**${i + 1}.** ${w.reason} — *${w.by}* <t:${Math.floor(w.at / 1000)}:R>`)
    .join('\n');
  await ctx.message.reply({ embeds: [resultEmbed({ title: `⚠️ ${target.user.username} uyarıları`, description: text, color: COLOR.warn })] });
});

cmd(['temizle', 'clear', 'purge'], 'Mesaj siler', '!temizle 50', async (ctx) => {
  if (!ctx.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
    return ctx.message.reply('⛔ `Mesajları Yönet` yetkin yok.');
  }
  const count = Math.min(Math.max(parseInt(ctx.args[0] || '10', 10) || 10, 1), 100);
  try {
    const deleted = await ctx.channel.bulkDelete(count, true);
    const msg = await ctx.channel.send(`🧹 **${deleted.size}** mesaj silindi.`);
    setTimeout(() => msg.delete().catch(() => {}), 4000);
  } catch (e) {
    ctx.message.reply(`Silinemedi: ${e.message}`);
  }
}, { mod: true });

// --- Kanal
cmd(['kanal-oluştur', 'kanalolustur'], 'Kanal oluşturur', '!kanal-oluştur isim [metin/ses/kategori]', async (ctx) => {
  const name = ctx.args[0];
  const type = (ctx.args[1] || 'text').toLowerCase();
  if (!name) return ctx.message.reply('Kanal ismi gerekli.');
  await runModeration(ctx.message, () => mod.createChannel(ctx.guild, ctx.member, { name, type }));
}, { mod: true });

cmd(['kanal-ad', 'kanalad'], 'Kanalı yeniden adlandırır', '!kanal-ad yeni-isim', async (ctx) => {
  const name = ctx.args.join(' ');
  if (!name) return ctx.message.reply('Yeni isim gerekli.');
  await runModeration(ctx.message, () => mod.renameChannel(ctx.guild, ctx.member, ctx.channel.id, name));
}, { mod: true });

cmd(['kanal-sil', 'kanalsil'], 'Kanalı siler', '!kanal-sil', async (ctx) => {
  const res = await mod.deleteChannel(ctx.guild, ctx.member, ctx.channel.id);
  if (!res.ok) return ctx.message.reply(`⛔ ${res.error}`);
  settings.log(ctx.guild.id, 'channel', `${ctx.member.user.tag} kanal sildi: #${ctx.channel.name}`);
}, { mod: true });

// --- Rol
cmd(['rol-ver', 'rolver'], 'Üyeye rol verir', '!rol-ver @üye @rol', async (ctx) => {
  const [m, r] = ctx.mentions;
  if (!m || !r) return ctx.message.reply('Kullanım: `!rol-ver @üye @rol`');
  await runModeration(ctx.message, () => mod.addRole(ctx.guild, ctx.member, m.id, r.id));
}, { mod: true });

cmd(['rol-al', 'rolal'], 'Üyeden rol alır', '!rol-al @üye @rol', async (ctx) => {
  const [m, r] = ctx.mentions;
  if (!m || !r) return ctx.message.reply('Kullanım: `!rol-al @üye @rol`');
  await runModeration(ctx.message, () => mod.removeRole(ctx.guild, ctx.member, m.id, r.id));
}, { mod: true });

// --- Ekonomi
cmd(['günlük', 'daily'], 'Günlük coin alır', '!günlük', async (ctx) => {
  const res = eco.daily(ctx.guild.id, ctx.author.id);
  if (!res.ok) {
    const hrs = Math.floor(res.remaining / 3600000);
    const mins = Math.floor((res.remaining % 3600000) / 60000);
    return ctx.message.reply(`⏳ Günlük ödülünü zaten aldın. **${hrs}s ${mins}dk** sonra tekrar gel.`);
  }
  await ctx.message.reply({
    embeds: [resultEmbed({ title: '🎁 Günlük ödül', description: `**+${res.amount} coin** aldın!\nBakiyen: **${res.balance}** coin`, color: COLOR.gold })]
  });
});

cmd(['bakiye', 'bal', 'cüzdan'], 'Coin bakiyesi', '!bakiye [@üye]', async (ctx) => {
  const target = ctx.target || ctx.author;
  const w = eco.wallet(ctx.guild.id, target.id);
  const rank = eco.leaderboard(ctx.guild.id, 999).findIndex((u) => u.userId === target.id) + 1;
  await ctx.message.reply({
    embeds: [
      resultEmbed({
        title: `💰 ${target.username} cüzdanı`,
        description: `**Coin:** ${w.coins}\n**Oyun:** ${w.games} (${w.wins} kazanç)\n**Sıralama:** ${rank > 0 ? `#${rank}` : '—'}`,
        color: COLOR.gold
      })
    ]
  });
});

cmd(['sıralama', 'siralama', 'top', 'leaderboard'], 'En zenginler', '!sıralama', async (ctx) => {
  const list = eco.leaderboard(ctx.guild.id, 10);
  const text = list.length
    ? list.map((u, i) => `**${i + 1}.** <@${u.userId}> — ${u.coins} coin`).join('\n')
    : 'Henüz kimse oynamamış. `!günlük` ile başla!';
  await ctx.message.reply({ embeds: [resultEmbed({ title: '🏆 Coin sıralaması', description: text, color: COLOR.gold })] });
});

// --- Oyunlar
cmd(['slot', 'slots', 'kumar'], 'Slot makinesi', '!slot 100', async (ctx) => {
  const bet = parseAmount(ctx.args[0], eco.getCoins(ctx.guild.id, ctx.author.id));
  const start = games.placeBet(ctx.guild.id, ctx.author.id, bet);
  if (start.error) return ctx.message.reply(`⛔ ${start.error}`);
  const spin = games.spin(bet);
  const balance = games.settle(ctx.guild.id, ctx.author.id, bet, spin.payout, spin.multiplier > 0);
  const line = spin.reels.join(' | ');
  await ctx.message.reply({
    embeds: [
      resultEmbed({
        title: spin.multiplier > 0 ? '🎰 Kazandın!' : '🎰 Kaybettin',
        description:
          `# ${line}\n\n` +
          (spin.multiplier > 0
            ? `**${bet}** coin bahis → **${spin.payout}** coin (x${spin.multiplier}) kazandın!`
            : `**${bet}** coin kaybettin.`),
        color: spin.multiplier > 0 ? COLOR.ok : COLOR.err,
        footer: `Bakiye: ${balance} coin`
      })
    ]
  });
});

cmd(['yazıtura', 'yazitura', 'cf'], 'Yazı tura', '!yazıtura 100 yazı', async (ctx) => {
  const bet = parseAmount(ctx.args[0], eco.getCoins(ctx.guild.id, ctx.author.id));
  const pick = (ctx.args[1] || '').toLowerCase();
  if (!['yazı', 'yazi', 'tura'].includes(pick)) return ctx.message.reply('Seçim: `yazı` veya `tura`. Örnek: `!yazıtura 100 yazı`');
  const finish = pick.startsWith('yaz') ? 'yazı' : 'tura';
  const res = games.coinflip(ctx.guild.id, ctx.author.id, bet, finish);
  if (res.error) return ctx.message.reply(`⛔ ${res.error}`);
  await ctx.message.reply({
    embeds: [
      resultEmbed({
        title: res.won ? '🪙 Kazandın!' : '🪙 Kaybettin',
        description: `Sonuç: **${res.result}**\n${res.won ? `+${res.payout} coin kazandın!` : `-${res.bet} coin.`}`,
        color: res.won ? COLOR.ok : COLOR.err,
        footer: `Bakiye: ${res.balance} coin`
      })
    ]
  });
});

cmd(['zar', 'dice'], 'Zar tahmini', '!zar 3 50', async (ctx) => {
  const guess = parseInt(ctx.args[0], 10);
  const bet = parseAmount(ctx.args[1], eco.getCoins(ctx.guild.id, ctx.author.id));
  const res = games.dice(ctx.guild.id, ctx.author.id, bet, guess);
  if (res.error) return ctx.message.reply(`⛔ ${res.error}`);
  await ctx.message.reply({
    embeds: [
      resultEmbed({
        title: res.won ? '🎲 Tam isabet!' : '🎲 Tutmadı',
        description: `Zar: **${res.result}**\n${res.won ? `x6 → **+${res.payout}** coin!` : `-${res.bet} coin.`}`,
        color: res.won ? COLOR.ok : COLOR.err,
        footer: `Bakiye: ${res.balance} coin`
      })
    ]
  });
});

// --- Şans / eğlence
cmd(['şans', 'sans', 'ship'], 'Aşk ölçer', '!şans @üye', async (ctx) => {
  const target = ctx.target;
  if (!target) return ctx.message.reply('Kimi ölçeceğim? `!şans @üye`');
  const pct = Math.floor(Math.random() * 101);
  const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
  const comment = pct > 80 ? 'Birbiriniz için yaratılmışsınız! 💞' : pct > 50 ? 'Güzel bir potansiyel var. 😊' : pct > 25 ? 'Arkadaş olarak daha iyi. 🤝' : 'Buz gibi bir mesafe var. 🧊';
  await ctx.message.reply({ embeds: [resultEmbed({ title: '💘 Gönül ölçer', description: `${bar}\n**%${pct}**\n${comment}`, color: 0xeb459e })] });
});

cmd(['8ball', '8top'], 'Sihirli küre', '!8ball soru', async (ctx) => {
  const answers = ['Kesinlikle evet.', 'Bence evet.', 'Evet, hiç şüphesiz.', 'Bir dahaki sefere.', 'Şimdi cevaplayamam.', 'Buna güvenme.', 'Hayır.', 'Kesinlikle hayır.', 'Belki.', 'Kaderinde var.'];
  const q = ctx.rest;
  if (!q) return ctx.message.reply('Bir soru sor: `!8ball acaba olacak mı?`');
  const a = answers[Math.floor(Math.random() * answers.length)];
  await ctx.message.reply({ embeds: [resultEmbed({ title: '🎱 ' + q, description: `**${a}**`, color: COLOR.main })] });
});

cmd(['espri', 'joke'], 'Rastgele espri', '!espri', async (ctx) => {
  const jokes = [
    'Neden bilgisayar denize gitmez? Çünkü çok fazla **windows** var. 🪟',
    'Programcı neden kahve içer? Çünkü **c**harpe ihtiyacı var. ☕',
    'Bir byte neden utangaç? Çünkü biraz **bit**kindi. 😄',
    'Mühendis eve neden giremez? Kapıyı **debug** etmeye çalışır. 🔧',
    'Discord botu neden yorulmaz? Çünkü her şeyi **async** yapıyor. ⚡',
    'Neden slot makinesi hep kazanır? Çünkü **olasılık** onun tarafında. 🎰',
    'İnternet neden üşür? Çünkü çok fazla **cache** var. ❄️'
  ];
  await ctx.message.reply(jokes[Math.floor(Math.random() * jokes.length)]);
});

// --- Panel
cmd(['panel'], 'Web paneli linki', '!panel', async (ctx) => {
  const url = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
  await ctx.message.reply({
    embeds: [resultEmbed({ title: '🖥️ Yönetim Paneli', description: url ? `Panel: ${url}` : 'Panel adresi tanımlı değil. `PUBLIC_URL` ortam değişkenini ekle.', color: COLOR.main })]
  });
});

// ------------------------------------------------------------------ MESAJ İŞLEYİCİ
async function handleMessage(message) {
  if (!message.guild || message.author.bot) return;

  const cfg = settings.get(message.guild.id);
  const prefix = cfg.prefix || '!';
  const content = message.content.trim();
  if (!content.startsWith(prefix)) return;

  const withoutPrefix = content.slice(prefix.length).trim();
  if (!withoutPrefix) return;
  const [rawCommand, ...args] = withoutPrefix.split(/\s+/);
  const name = rawCommand.toLowerCase();
  const command = commands.get(name);
  if (!command) return;

  botState.commands += 1;

  const mentions = message.mentions.members
    ? [...message.mentions.members.values()]
    : [];
  const target = mentions[0] || null;
  const rest = withoutPrefix.split(/\s+/).slice(1).join(' ');

  const ctx = {
    client: botState.client,
    message,
    guild: message.guild,
    member: message.member,
    channel: message.channel,
    author: message.author,
    args,
    rest,
    mentions,
    target,
    reason: buildReason(args, target)
  };

  try {
    await command.run(ctx);
    settings.log(message.guild.id, 'site', `${message.author.tag}: ${prefix}${name} kullandı`);
  } catch (err) {
    console.error(`[bot] ${name} komutu hata:`, err);
    await message.reply(`⚠️ Komut çalıştırılırken hata oluştu: ${err.message}`).catch(() => {});
  }
}

function buildReason(args, target) {
  const parts = [...args];
  if (target) {
    const idx = parts.findIndex((p) => p.includes(target.id));
    if (idx !== -1) parts.splice(0, idx + 1);
  }
  const filtered = parts.filter((p) => !/^\d+$/.test(p) && !/^\d+(s|sn|m|dk|h|sa|d|g)$/i.test(p) && !p.startsWith('<@'));
  return filtered.join(' ').trim();
}

module.exports = { startBot, botState, commands, COLOR };
