const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');

const app = express();
const port = process.env.PORT || 10000;

app.use(express.json());
app.use(express.static('public'));

// Discord Bot Ayarları
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.on('ready', () => {
  console.log(`Bot aktif: ${client.user.tag}`);
});

// Web sitesinden botu kontrol etmek için örnek bir API rotası
app.post('/api/bot-komut', (req, res) => {
  const { mesaj } = req.body;
  // Burada siteden gelen isteğe göre botu yönlendirebilirsin
  res.json({ durum: 'başarılı', alinan: mesaj });
});

// Botu Token ile başlat
client.login(process.env.DISCORD_TOKEN);

// Web sunucusunu Render portunda başlat (0.0.0.0 şarttır!)
app.listen(port, '0.0.0.0', () => {
  console.log(`Web paneli çalışıyor: ${port}`);
});
