# 🤖 Discord Bot + Web Kontrol Paneli

Tek bir **Render Web Service** üzerinde çalışır: Discord botu ile web paneli aynı Node.js sürecindedir.
Panelden yaptığın her işlem (ban, kick, mute, kanal düzenleme, oyunlar) anında Discord sunucuna uygulanır.

## ✨ Özellikler

**Moderasyon (panelden tıklayarak)**
- 👥 Üye listesi + arama (isim / ID), susturulmuşlar ve uyarısı olanlar filtresi
- Bir üyeye tıkla → **Ban** (mesaj geçmişi silme seçenekli), **Kick**, **Mute** (60 sn → 7 gün), **Unmute**, **Uyarı**
- Yetki kontrolü: *kendi Discord yetkin* ve *rol sıralaması* dikkate alınır — yetkin yetmeyeni bot reddeder
- Yasaklılar listesi + tek tıkla yasak kaldırma
- 3 uyarıya ulaşan üye otomatik 30 dk susturulur

**Kanal yönetimi**
- Kategoriye göre gruplanmış metin / ses / duyuru kanalları
- Kanal **oluştur**, **yeniden adlandır**, **konu düzenle**, **sil**

**Rol yönetimi**
- Rol oluştur / sil, üyeye rol ver / al (rol sıralaması korumalı)

**Eğlence & ekonomi (hem panelde hem Discord'da)**
- 🎰 Slot makinesi (animasyonlu, ağırlıklı semboller), 🪙 yazı tura, 🎲 zar
- Günlük ödül, cüzdan, sunucu sıralaması
- Discord komutları: `!slot`, `!yazıtura`, `!zar`, `!günlük`, `!bakiye`, `!sıralama`, `!şans`, `!8ball`, `!espri`, `!yardım`

**Sunucu ayarları**
- Log kanalı, hoş geldin mesajı + kanalı, otomatik rol, komut ön eki
- Son 200 işlem kaydı (panelde görünür)

## 🚀 Render'da yayına alma

1. **Discord Developer Portal** → [Applications](https://discord.com/developers/applications) → *New Application*
2. **Bot** sekmesi → *Reset Token* → tokeni kopyala
   - **Privileged Gateway Intents** bölümünde **SERVER MEMBERS INTENT** ve **MESSAGE CONTENT INTENT**'i aç (zorunlu)
3. **OAuth2** sekmesi → *Client ID* ve *Client Secret*'ı kopyala
4. **OAuth2 → Redirects** kısmına şunu ekle:
   ```
   https://SERVIS-ADIN.onrender.com/auth/callback
   ```
5. Render'da **New → Web Service** → bu GitHub repoyu seç
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - (Repodaki `render.yaml` ile Blueprint olarak da oluşturabilirsin)
6. **Environment** değişkenleri:

| Değişken | Değer |
|---|---|
| `DISCORD_TOKEN` | Bot tokeni |
| `CLIENT_ID` | Uygulama (client) ID |
| `CLIENT_SECRET` | OAuth2 client secret |
| `PUBLIC_URL` | `https://SERVIS-ADIN.onrender.com` (sonunda `/` yok) |
| `SESSION_SECRET` | Rastgele uzun bir yazı |
| `DEMO_MODE` | `0` (paneli Discord'suz denemek için `1`) |

7. Botu sunucuya ekle: panelde **Ayarlar → 🔗 Bot Davet Linkini Kopyala** (yönetici yetkisiyle davet eder)

## ⚠️ Önemli notlar

- **Bot rolü en üstte olmalı.** Discord'da yönetilecek üyelerin rolü botun rolünden düşük olmalı; aksi halde bot işlem yapamaz (panel bunu hata mesajıyla söyler).
- **Render ücretsiz planı 15 dk trafik olmazsa uyur.** Uyku sırasında bot da çevrimdışı olur. Çözüm: ücretli plan ya da [UptimeRobot](https://uptimerobot.com) ile `/health` adresine 5 dakikalık ping.
- **Veri kalıcılığı:** JSON verisi (`data/db.json`) diske yazılır. Render ücretsiz planda disk kalıcı değildir; kalıcı olsun istersen Render'da **Disk** ekleyip `DATA_DIR=/data` ver (Blueprint'te hazır).
- Panel oturumu Discord OAuth2 ile açılır; **herkes yalnızca kendi yetkisi kadar** işlem yapabilir.

## 🧪 Yerel çalıştırma

```bash
npm install
# .env.example dosyasını .env yapıp doldur, ya da:
DEMO_MODE=1 npm start     # Discord olmadan paneli dene
```

Panel: http://localhost:10000

## 📁 Yapı

```
server.js          → Express sunucusu + tüm API rotaları + OAuth2
src/bot.js         → Discord client, komutlar, hoş geldin/otomatik rol
src/moderation.js  → ban/kick/mute/uyarı/kanal/rol (yetki kontrolleri burada)
src/economy.js     → coin cüzdanı, günlük ödül, sıralama
src/games.js       → slot, yazı tura, zar mantığı
src/settings.js    → sunucu ayarları + işlem kayıtları
src/store.js       → JSON veritabanı
src/demo.js        → DEMO_MODE sahte verisi
public/            → panel arayüzü (index.html, app.js, style.css)
```
