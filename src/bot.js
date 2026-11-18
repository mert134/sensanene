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
  ActivityType,
  SlashCommandBuilder
} = require('discord.js');
const path = require('path');

const settings = require('./settings');
const mod = require('./moderation');
const eco = require('./economy');
const games = require('./games');
const { funSlashCommands, handleFunInteraction } = require('./funCommands');
const guard = require('./guard');

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

  client.on(Events.ClientReady, async (c) => {
    botState.ready = true;
    botState.startedAt = Date.now();
    botState.error = null;
    console.log(`[bot] Aktif: ${c.user.tag} — ${c.guilds.cache.size} sunucu`);
    c.user.setPresence({
      activities: [{ name: '/yardım • Lores Bot', type: ActivityType.Watching }],
      status: 'online'
    });
    await registerSlashCommands(c);
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

  client.on(Events.InteractionCreate, (interaction) => {
    if (interaction.isChatInputCommand()) handleInteraction(interaction).catch((e) => handleInteractionError(interaction, e));
  });
  client.on(Events.GuildCreate, (guild) => registerSlashForGuild(guild));

  // Guard (koruma) izlemesi: denetim kaydı, üye katılımı ve mesaj akışı.
  guard.start(client);

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

const GAME_MEDIA = {
  coin: { name: 'lores-coin.gif', path: path.join(__dirname, '../public/assets/games/lores-coin.gif') },
  dice: { name: 'lores-dice.gif', path: path.join(__dirname, '../public/assets/games/lores-dice.gif') }
};

function gameFile(type) {
  const media = GAME_MEDIA[type];
  return { attachment: media.path, name: media.name };
}

function gameEmbed(ctx, { title, description, color, type, fields = [] }) {
  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: 'LORES • NEON CASINO', iconURL: ctx.client.user.displayAvatarURL() })
    .setTitle(title)
    .setDescription(description)
    .addFields(fields)
    .setImage(`attachment://${GAME_MEDIA[type].name}`)
    .setFooter({ text: `LORES • ${ctx.guild.name}`, iconURL: ctx.guild.iconURL() || ctx.client.user.displayAvatarURL() })
    .setTimestamp();
}

function resultEmbed({ title, description, color = COLOR.main, footer, image, thumbnail }) {
  const embed = new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp();
  if (footer) embed.setFooter({ text: footer });
  if (image) embed.setImage(image);
  if (thumbnail) embed.setThumbnail(thumbnail);
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
cmd(['yardım', 'help', 'komutlar'], 'Tüm komutları listeler', '/yardım', async (ctx) => {
  const categories = [
    {
      name: '🛡️ Moderasyon',
      value: '`/ban` • `/unban` • `/kick`\n`/mute` • `/unmute` • `/warn`\n`/uyarılar` • `/temizle`'
    },
    {
      name: '🛡️ Guard',
      value: '`/guard durum` • `/guard aç` • `/guard kapat`\n`/guard modül` • `/guard limit` • `/guard pencere`\n`/guard ceza` • `/guard kanal` • `/guard güvenli`\n`/guard olaylar` • `/guard yedek` • `/guard test`'
    },
    {
      name: '📁 Kanal',
      value: '`/kanal-oluştur` • `/kanal-ad` • `/kanal-sil`'
    },
    {
      name: '🎭 Rol',
      value: '`/rol-ver` • `/rol-al`'
    },
    {
      name: '🎰 Eğlence & Ekonomi',
      value: '`/yazıtura` • `/zar`\n`/günlük` • `/bakiye` • `/sıralama`'
    },
    {
      name: '💞 Sosyal Etkileşim',
      value: '`/sarıl` • `/öp` • `/okşa` • `/tokat` • `/dans`\n`/gıdıkla` • `/el-tut` • `/göz-kırp` • `/iltifat`'
    },
    {
      name: '📊 Eğlenceli Ölçerler',
      value: '`/aşk` • `/çekicilik` • `/karizma` • `/azgınlık`\n`/zekâ` • `/coolluk` • `/sadakat` • `/toksiklik`'
    },
    {
      name: '🔮 Mini Oyunlar & Araçlar',
      value: '`/taşkağıtmakas` • `/zar-at` • `/yazı-tura`\n`/fal` • `/kim` • `/yüzde` • `/profil` • `/sunucu`'
    }
  ];
  const embed = new EmbedBuilder()
    .setColor(COLOR.main)
    .setAuthor({ name: 'LORES • Komut Merkezi', iconURL: ctx.client.user.displayAvatarURL() })
    .setTitle('✨ Güç senin elinde')
    .setDescription(`**${slashCommands.length} özel /** komutundan birini seç. Discord yazarken seçenekleri otomatik gösterecek.`)
    .addFields(categories)
    .setThumbnail(ctx.client.user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: `${ctx.guild.name} • Süreler: 10m, 2h, 1g • Bahis en az 10 coin`, iconURL: ctx.guild.iconURL() || undefined })
    .setTimestamp();
  await ctx.message.reply({ embeds: [embed] });
});

cmd('ping', 'Bot gecikmesi', '/ping', async (ctx) => {
  await ctx.message.reply({ embeds: [resultEmbed({ title: '🏓 Sistem çevrimiçi', description: `**Discord gecikmesi:** ${ctx.client.ws.ping}ms\n**Durum:** Tüm sistemler çalışıyor`, color: ctx.client.ws.ping < 150 ? COLOR.ok : COLOR.warn, thumbnail: ctx.client.user.displayAvatarURL() })] });
});

// --- Moderasyon
cmd(['ban', 'yasakla'], 'Üyeyi yasaklar', '/ban @üye [sebep]', async (ctx) => {
  const target = ctx.target;
  if (!target) return ctx.message.reply('Kimi yasaklayacağımı belirt: `/ban @üye sebep`');
  await runModeration(ctx.message, () => mod.ban(ctx.guild, ctx.member, target.id, ctx.reason));
}, { mod: true });

cmd(['unban', 'yasakkaldır'], 'Yasağı kaldırır', '/unban <kullanıcı_id> [sebep]', async (ctx) => {
  const id = ctx.args[0]?.replace(/[<@!>]/g, '');
  if (!id) return ctx.message.reply('Kullanıcı ID gerekli: `/unban 123456789`');
  await runModeration(ctx.message, () => mod.unban(ctx.guild, ctx.member, id, ctx.reason));
}, { mod: true });

cmd(['kick', 'at'], 'Üyeyi atar', '/kick @üye [sebep]', async (ctx) => {
  const target = ctx.target;
  if (!target) return ctx.message.reply('Kimi atacağımı belirt: `/kick @üye sebep`');
  await runModeration(ctx.message, () => mod.kick(ctx.guild, ctx.member, target.id, ctx.reason));
}, { mod: true });

cmd(['mute', 'sustur'], 'Üyeyi susturur', '/mute @üye [10m] [sebep]', async (ctx) => {
  const target = ctx.target;
  if (!target) return ctx.message.reply('Kimi susturacağımı belirt: `/mute @üye 10m sebep`');
  const duration = mod.parseDuration(ctx.args[1]);
  await runModeration(ctx.message, () => mod.mute(ctx.guild, ctx.member, target.id, duration, ctx.reason));
}, { mod: true });

cmd(['unmute', 'susturmakaldır'], 'Susturmayı kaldırır', '/unmute @üye', async (ctx) => {
  const target = ctx.target;
  if (!target) return ctx.message.reply('Kimi açacağımı belirt: `/unmute @üye`');
  await runModeration(ctx.message, () => mod.unmute(ctx.guild, ctx.member, target.id, ctx.reason));
}, { mod: true });

cmd(['warn', 'uyar'], 'Üyeyi uyarır', '/warn @üye [sebep]', async (ctx) => {
  const target = ctx.target;
  if (!target) return ctx.message.reply('Kimi uyaracağımı belirt: `/warn @üye sebep`');
  await runModeration(ctx.message, () => mod.warn(ctx.guild, ctx.member, target.id, ctx.reason));
}, { mod: true });

cmd(['uyarılar', 'warnings'], 'Üyenin uyarılarını gösterir', '/uyarılar @üye', async (ctx) => {
  const target = ctx.target;
  if (!target) return ctx.message.reply('Kimin uyarılarına bakayım: `/uyarılar @üye`');
  const list = mod.warningsOf(ctx.guild.id, target.id);
  if (!list.length) return ctx.message.reply(`✅ <@${target.id}> hiç uyarı almamış.`);
  const text = list
    .map((w, i) => `**${i + 1}.** ${w.reason} — *${w.by}* <t:${Math.floor(w.at / 1000)}:R>`)
    .join('\n');
  await ctx.message.reply({ embeds: [resultEmbed({ title: `⚠️ ${target.user.username} uyarıları`, description: text, color: COLOR.warn })] });
});

cmd(['temizle', 'clear', 'purge'], 'Mesaj siler', '/temizle 50', async (ctx) => {
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
cmd(['kanal-oluştur', 'kanalolustur'], 'Kanal oluşturur', '/kanal-oluştur isim [metin/ses/kategori]', async (ctx) => {
  const name = ctx.args[0];
  const type = (ctx.args[1] || 'text').toLowerCase();
  if (!name) return ctx.message.reply('Kanal ismi gerekli.');
  await runModeration(ctx.message, () => mod.createChannel(ctx.guild, ctx.member, { name, type }));
}, { mod: true });

cmd(['kanal-ad', 'kanalad'], 'Kanalı yeniden adlandırır', '/kanal-ad yeni-isim', async (ctx) => {
  const name = ctx.args.join(' ');
  if (!name) return ctx.message.reply('Yeni isim gerekli.');
  await runModeration(ctx.message, () => mod.renameChannel(ctx.guild, ctx.member, ctx.channel.id, name));
}, { mod: true });

cmd(['kanal-sil', 'kanalsil'], 'Kanalı siler', '/kanal-sil', async (ctx) => {
  const res = await mod.deleteChannel(ctx.guild, ctx.member, ctx.channel.id);
  if (!res.ok) return ctx.message.reply(`⛔ ${res.error}`);
  settings.log(ctx.guild.id, 'channel', `${ctx.member.user.tag} kanal sildi: #${ctx.channel.name}`);
}, { mod: true });

// --- Rol
cmd(['rol-ver', 'rolver'], 'Üyeye rol verir', '/rol-ver @üye @rol', async (ctx) => {
  const [m, r] = ctx.mentions;
  if (!m || !r) return ctx.message.reply('Kullanım: `/rol-ver @üye @rol`');
  await runModeration(ctx.message, () => mod.addRole(ctx.guild, ctx.member, m.id, r.id));
}, { mod: true });

cmd(['rol-al', 'rolal'], 'Üyeden rol alır', '/rol-al @üye @rol', async (ctx) => {
  const [m, r] = ctx.mentions;
  if (!m || !r) return ctx.message.reply('Kullanım: `/rol-al @üye @rol`');
  await runModeration(ctx.message, () => mod.removeRole(ctx.guild, ctx.member, m.id, r.id));
}, { mod: true });

// --- Ekonomi
cmd(['günlük', 'daily'], 'Günlük coin alır', '/günlük', async (ctx) => {
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

cmd(['bakiye', 'bal', 'cüzdan'], 'Coin bakiyesi', '/bakiye [@üye]', async (ctx) => {
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

cmd(['sıralama', 'siralama', 'top', 'leaderboard'], 'En zenginler', '/sıralama', async (ctx) => {
  const list = eco.leaderboard(ctx.guild.id, 10);
  const text = list.length
    ? list.map((u, i) => `**${i + 1}.** <@${u.userId}> — ${u.coins} coin`).join('\n')
    : 'Henüz kimse oynamamış. `/günlük` ile başla!';
  await ctx.message.reply({ embeds: [resultEmbed({ title: '🏆 Coin sıralaması', description: text, color: COLOR.gold })] });
});

// --- Oyunlar
cmd(['yazıtura', 'yazitura', 'cf'], 'Yazı tura', '/yazıtura 100 yazı', async (ctx) => {
  const bet = parseAmount(ctx.args[0], eco.getCoins(ctx.guild.id, ctx.author.id));
  const pick = (ctx.args[1] || '').toLowerCase();
  if (!['yazı', 'yazi', 'tura'].includes(pick)) return ctx.message.reply('Seçim: `yazı` veya `tura`. Örnek: `/yazıtura 100 yazı`');
  const finish = pick.startsWith('yaz') ? 'yazı' : 'tura';
  const res = games.coinflip(ctx.guild.id, ctx.author.id, bet, finish);
  if (res.error) return ctx.message.reply(`⛔ ${res.error}`);
  await ctx.message.reply({
    embeds: [gameEmbed(ctx, {
      type: 'coin',
      title: res.won ? '🪙 Doğru tahmin • Kazandın!' : '🪙 Para kararını verdi',
      description: `## Sonuç: ${res.result.toLocaleUpperCase('tr-TR')}\n${res.won ? '✨ Tahminin kusursuzdu; bahis ikiye katlandı!' : '🌙 Bu kez diğer yüz geldi.'}`,
      color: res.won ? COLOR.gold : COLOR.err,
      fields: [
        { name: '🎯 Seçimin', value: `**${finish.toLocaleUpperCase('tr-TR')}**`, inline: true },
        { name: res.won ? '💰 Ödeme' : '📉 Kayıp', value: res.won ? `**+${res.payout}** coin` : `**-${res.bet}** coin`, inline: true },
        { name: '👛 Bakiye', value: `**${res.balance}** coin`, inline: true }
      ]
    })],
    files: [gameFile('coin')]
  });
});

cmd(['zar', 'dice'], 'Zar tahmini', '/zar 3 50', async (ctx) => {
  const guess = parseInt(ctx.args[0], 10);
  const bet = parseAmount(ctx.args[1], eco.getCoins(ctx.guild.id, ctx.author.id));
  const res = games.dice(ctx.guild.id, ctx.author.id, bet, guess);
  if (res.error) return ctx.message.reply(`⛔ ${res.error}`);
  await ctx.message.reply({
    embeds: [gameEmbed(ctx, {
      type: 'dice',
      title: res.won ? '🎲 TAM İSABET • x6!' : '🎲 Zarlar durdu',
      description: `## Zar sonucu: ${res.result}\n${res.won ? '⚡ Efsane tahmin! Kasa x6 ödeme yaptı.' : `Tahminin **${guess}** idi; şans bu tur farklı yuvarlandı.`}`,
      color: res.won ? COLOR.gold : COLOR.err,
      fields: [
        { name: '🎯 Tahmin', value: `**${guess}**`, inline: true },
        { name: res.won ? '💰 Ödeme' : '📉 Kayıp', value: res.won ? `**+${res.payout}** coin` : `**-${res.bet}** coin`, inline: true },
        { name: '👛 Bakiye', value: `**${res.balance}** coin`, inline: true }
      ]
    })],
    files: [gameFile('dice')]
  });
});

// --- Şans / eğlence
cmd(['şans', 'sans', 'ship'], 'Aşk ölçer', '/şans @üye', async (ctx) => {
  const target = ctx.target;
  if (!target) return ctx.message.reply('Kimi ölçeceğim? `/şans @üye`');
  const pct = Math.floor(Math.random() * 101);
  const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
  const comment = pct > 80 ? 'Birbiriniz için yaratılmışsınız! 💞' : pct > 50 ? 'Güzel bir potansiyel var. 😊' : pct > 25 ? 'Arkadaş olarak daha iyi. 🤝' : 'Buz gibi bir mesafe var. 🧊';
  await ctx.message.reply({ embeds: [resultEmbed({ title: '💘 Gönül ölçer', description: `${bar}\n**%${pct}**\n${comment}`, color: 0xeb459e })] });
});

cmd(['8ball', '8top'], 'Sihirli küre', '/8ball soru', async (ctx) => {
  const answers = ['Kesinlikle evet.', 'Bence evet.', 'Evet, hiç şüphesiz.', 'Bir dahaki sefere.', 'Şimdi cevaplayamam.', 'Buna güvenme.', 'Hayır.', 'Kesinlikle hayır.', 'Belki.', 'Kaderinde var.'];
  const q = ctx.rest;
  if (!q) return ctx.message.reply('Bir soru sor: `/8ball acaba olacak mı?`');
  const a = answers[Math.floor(Math.random() * answers.length)];
  await ctx.message.reply({ embeds: [resultEmbed({ title: '🎱 ' + q, description: `**${a}**`, color: COLOR.main })] });
});

cmd(['espri', 'joke'], 'Rastgele espri', '/espri', async (ctx) => {
  const jokes = [
    'Neden bilgisayar denize gitmez? Çünkü çok fazla **windows** var. 🪟',
    'Programcı neden kahve içer? Çünkü **c**harpe ihtiyacı var. ☕',
    'Bir byte neden utangaç? Çünkü biraz **bit**kindi. 😄',
    'Mühendis eve neden giremez? Kapıyı **debug** etmeye çalışır. 🔧',
    'Discord botu neden yorulmaz? Çünkü her şeyi **async** yapıyor. ⚡',
    'İnternet neden üşür? Çünkü çok fazla **cache** var. ❄️'
  ];
  await ctx.message.reply({ embeds: [resultEmbed({ title: '😄 Lores Mizah Servisi', description: jokes[Math.floor(Math.random() * jokes.length)], color: 0xeb459e, thumbnail: ctx.client.user.displayAvatarURL() })] });
});


// ------------------------------------------------------------------ SLASH KOMUTLARI
// Sunucu bazlı kayıt anında görünür; global komutlarda görülebilen 1 saate varan bekleme yoktur.
const slashCommands = [
  new SlashCommandBuilder().setName('yardım').setDescription('Lores Bot komut merkezini gösterir'),
  new SlashCommandBuilder().setName('ping').setDescription('Bot ve Discord gecikmesini gösterir'),
  new SlashCommandBuilder().setName('ban').setDescription('Bir üyeyi sunucudan yasaklar')
    .addUserOption(o => o.setName('üye').setDescription('Yasaklanacak üye').setRequired(true))
    .addStringOption(o => o.setName('sebep').setDescription('İşlem sebebi').setMaxLength(300)),
  new SlashCommandBuilder().setName('unban').setDescription('Kullanıcı ID ile yasağı kaldırır')
    .addStringOption(o => o.setName('kullanıcı-id').setDescription('Discord kullanıcı ID').setRequired(true))
    .addStringOption(o => o.setName('sebep').setDescription('İşlem sebebi').setMaxLength(300)),
  new SlashCommandBuilder().setName('kick').setDescription('Bir üyeyi sunucudan atar')
    .addUserOption(o => o.setName('üye').setDescription('Atılacak üye').setRequired(true))
    .addStringOption(o => o.setName('sebep').setDescription('İşlem sebebi').setMaxLength(300)),
  new SlashCommandBuilder().setName('mute').setDescription('Bir üyeye zaman aşımı uygular')
    .addUserOption(o => o.setName('üye').setDescription('Susturulacak üye').setRequired(true))
    .addStringOption(o => o.setName('süre').setDescription('Örnek: 10m, 2h, 1g').setRequired(true))
    .addStringOption(o => o.setName('sebep').setDescription('İşlem sebebi').setMaxLength(300)),
  new SlashCommandBuilder().setName('unmute').setDescription('Üyenin susturmasını kaldırır')
    .addUserOption(o => o.setName('üye').setDescription('Susturması kaldırılacak üye').setRequired(true))
    .addStringOption(o => o.setName('sebep').setDescription('İşlem sebebi').setMaxLength(300)),
  new SlashCommandBuilder().setName('warn').setDescription('Bir üyeyi uyarır')
    .addUserOption(o => o.setName('üye').setDescription('Uyarılacak üye').setRequired(true))
    .addStringOption(o => o.setName('sebep').setDescription('Uyarı sebebi').setRequired(true).setMaxLength(300)),
  new SlashCommandBuilder().setName('uyarılar').setDescription('Bir üyenin uyarı geçmişini gösterir')
    .addUserOption(o => o.setName('üye').setDescription('Geçmişi gösterilecek üye').setRequired(true)),
  new SlashCommandBuilder().setName('temizle').setDescription('Kanaldaki son mesajları topluca siler')
    .addIntegerOption(o => o.setName('adet').setDescription('Silinecek mesaj sayısı').setRequired(true).setMinValue(1).setMaxValue(100)),
  new SlashCommandBuilder().setName('kanal-oluştur').setDescription('Yeni kanal veya kategori oluşturur')
    .addStringOption(o => o.setName('isim').setDescription('Kanal ismi').setRequired(true).setMaxLength(100))
    .addStringOption(o => o.setName('tür').setDescription('Kanal türü').setRequired(true)
      .addChoices({ name: '💬 Metin', value: 'metin' }, { name: '🔊 Ses', value: 'ses' }, { name: '📁 Kategori', value: 'kategori' })),
  new SlashCommandBuilder().setName('kanal-ad').setDescription('Bulunduğun kanalın adını değiştirir')
    .addStringOption(o => o.setName('isim').setDescription('Yeni kanal ismi').setRequired(true).setMaxLength(100)),
  new SlashCommandBuilder().setName('kanal-sil').setDescription('Bulunduğun kanalı kalıcı olarak siler'),
  new SlashCommandBuilder().setName('rol-ver').setDescription('Bir üyeye rol verir')
    .addUserOption(o => o.setName('üye').setDescription('Rol verilecek üye').setRequired(true))
    .addRoleOption(o => o.setName('rol').setDescription('Verilecek rol').setRequired(true)),
  new SlashCommandBuilder().setName('rol-al').setDescription('Bir üyeden rol alır')
    .addUserOption(o => o.setName('üye').setDescription('Rolü alınacak üye').setRequired(true))
    .addRoleOption(o => o.setName('rol').setDescription('Alınacak rol').setRequired(true)),
  new SlashCommandBuilder().setName('günlük').setDescription('20 saatte bir ücretsiz coin ödülünü al'),
  new SlashCommandBuilder().setName('bakiye').setDescription('Coin cüzdanını veya bir üyenin profilini gösterir')
    .addUserOption(o => o.setName('üye').setDescription('Bakiyesi gösterilecek üye')),
  new SlashCommandBuilder().setName('sıralama').setDescription('Sunucunun en zengin 10 üyesini gösterir'),
  new SlashCommandBuilder().setName('yazıtura').setDescription('Yazı tura at ve bahsini ikiye katla')
    .addIntegerOption(o => o.setName('bahis').setDescription('En az 10 coin').setRequired(true).setMinValue(10))
    .addStringOption(o => o.setName('seçim').setDescription('Tarafını seç').setRequired(true)
      .addChoices({ name: '🪙 Yazı', value: 'yazı' }, { name: '👑 Tura', value: 'tura' })),
  new SlashCommandBuilder().setName('zar').setDescription('1–6 arasında tahmin yap; bilirsen x6 kazan')
    .addIntegerOption(o => o.setName('tahmin').setDescription('Zar tahminin').setRequired(true).setMinValue(1).setMaxValue(6))
    .addIntegerOption(o => o.setName('bahis').setDescription('En az 10 coin').setRequired(true).setMinValue(10)),
  new SlashCommandBuilder().setName('şans').setDescription('İki kişi arasındaki uyumu ölçer')
    .addUserOption(o => o.setName('üye').setDescription('Uyumunu ölçeceğin kişi').setRequired(true)),
  new SlashCommandBuilder().setName('8ball').setDescription('Sihirli küre sorunu cevaplasın')
    .addStringOption(o => o.setName('soru').setDescription('Cevabını aradığın soru').setRequired(true).setMaxLength(300)),
  new SlashCommandBuilder().setName('espri').setDescription('Lores Bot sana bir espri yapsın')
].map(c => c.setDMPermission(false).toJSON()).concat(funSlashCommands, guard.guardSlashCommands);

async function registerSlashForGuild(guild) {
  try {
    await guild.commands.set(slashCommands);
    console.log(`[bot] / komutları güncellendi: ${guild.name} (${slashCommands.length})`);
  } catch (e) {
    console.error(`[bot] / komutları kaydedilemedi (${guild.name}):`, e.message);
  }
}

async function registerSlashCommands(client) {
  await Promise.allSettled(client.guilds.cache.map(registerSlashForGuild));
}

function slashPayload(interaction) {
  const name = interaction.commandName;
  const user = interaction.options.getUser('üye');
  const member = user ? interaction.options.getMember('üye') : null;
  const role = interaction.options.getRole('rol');
  const reason = interaction.options.getString('sebep') || '';
  let args = [];
  let rest = '';
  if (['ban', 'kick', 'warn', 'unmute'].includes(name)) args = user ? [`<@${user.id}>`, reason] : [reason];
  else if (name === 'mute') args = [`<@${user.id}>`, interaction.options.getString('süre'), reason];
  else if (name === 'unban') args = [interaction.options.getString('kullanıcı-id'), reason];
  else if (name === 'temizle') args = [String(interaction.options.getInteger('adet'))];
  else if (name === 'kanal-oluştur') args = [interaction.options.getString('isim'), interaction.options.getString('tür')];
  else if (name === 'kanal-ad') args = [interaction.options.getString('isim')];
  else if (['rol-ver', 'rol-al'].includes(name)) args = [`<@${user.id}>`, `<@&${role.id}>`];
  else if (name === 'yazıtura') args = [String(interaction.options.getInteger('bahis')), interaction.options.getString('seçim')];
  else if (name === 'zar') args = [String(interaction.options.getInteger('tahmin')), String(interaction.options.getInteger('bahis'))];
  else if (name === '8ball') { rest = interaction.options.getString('soru'); args = rest.split(/\s+/); }
  return { user, member, role, reason, args, rest };
}

function interactionMessage(interaction) {
  return {
    reply: async payload => {
      const data = typeof payload === 'string' ? { content: payload } : payload;
      if (interaction.deferred || interaction.replied) return interaction.editReply(data);
      return interaction.reply(data);
    },
    mentions: { members: new Map() },
    author: interaction.user,
    member: interaction.member,
    guild: interaction.guild,
    channel: interaction.channel
  };
}

async function handleInteraction(interaction) {
  if (!interaction.guild) return;
  // Guard komutları kendi kaydını ve yanıtını yönetir.
  if (await guard.handleGuardInteraction(interaction)) {
    botState.commands += 1;
    return;
  }
  if (await handleFunInteraction(interaction)) {
    botState.commands += 1;
    settings.log(interaction.guild.id, 'bot', `${interaction.user.tag}: /${interaction.commandName} kullandı`);
    return;
  }
  const command = commands.get(interaction.commandName);
  if (!command) return;
  botState.commands += 1;
  const p = slashPayload(interaction);
  if (p.user && !p.member) p.member = await interaction.guild.members.fetch(p.user.id).catch(() => null);
  const slowCommands = new Set(['ban', 'unban', 'kick', 'mute', 'unmute', 'warn', 'temizle', 'kanal-oluştur', 'kanal-ad', 'kanal-sil', 'rol-ver', 'rol-al']);
  if (slowCommands.has(interaction.commandName)) await interaction.deferReply();
  const message = interactionMessage(interaction);
  const mentions = [p.member, p.role].filter(Boolean);
  const target = p.member || (interaction.commandName === 'bakiye' ? interaction.options.getUser('üye') : null);
  const ctx = {
    client: botState.client,
    message,
    guild: interaction.guild,
    member: interaction.member,
    channel: interaction.channel,
    author: interaction.user,
    args: p.args,
    rest: p.rest,
    mentions,
    target,
    reason: p.reason
  };
  await command.run(ctx);
  settings.log(interaction.guild.id, 'bot', `${interaction.user.tag}: /${interaction.commandName} kullandı`);
}

async function handleInteractionError(interaction, err) {
  console.error(`[bot] /${interaction.commandName || '?'} hatası:`, err);
  const payload = { embeds: [resultEmbed({ title: 'Bir şey ters gitti', description: `Komut tamamlanamadı: ${err.message}`, color: COLOR.err })], ephemeral: true };
  try {
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
    else await interaction.reply(payload);
  } catch { /* etkileşim süresi dolmuş olabilir */ }
}

// ------------------------------------------------------------------ MESAJ İŞLEYİCİ
async function handleMessage(message) {
  if (!message.guild || message.author.bot) return;

  const cfg = settings.get(message.guild.id);
  const prefix = cfg.prefix || '/';
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

module.exports = { startBot, botState, commands, slashCommands, COLOR };
