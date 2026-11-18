# 🤖 Discord Bot + Web Kontrol Paneli

Tek bir **Render Web Service** üzerinde çalışır: Discord botu ile web paneli aynı Node.js sürecindedir.
Panelden yaptığın her işlem (ban, kick, mute, kanal düzenleme, oyunlar) anında Discord sunucuna uygulanır.

## ✨ Özellikler

**Moderasyon (panelden tıklayarak)**
- 👥 Üye listesi + arama (isim / ID), susturulmuşlar ve uyarısı olanlar filtresi
- Bir üyeye tıkla → **Ban** (mesaj geçmişi silme seçenekli), **Kick**, **Mute** (60 sn → 7 gün), **Unmute**, **Uyarı**
- Yetki kontrolü: *kendi Discord yetkin* ve *rol sıralaması* dikkate alınır — yetkin yetmeyeni bot reddeder
- Yasaklılar listesi + tek tıkla veya kullanıcı ID listesiyle toplu yasak kaldırma
- **Toplu üye yönetimi:** seçilen üyelerin tamamını (sayı sınırı yok) birlikte banlama, atma, susturma, susturmayı kaldırma, uyarma ve rol verme/alma; uzun listeler parçalara bölünüp ilerleme çubuğuyla işlenir
- 3 uyarıya ulaşan üye otomatik 30 dk susturulur

**Guard (sunucu koruması)**
- 🛡️ Tek merkezden koruma: **aç/kapat**, 8 modül (Anti-Nuke, Anti-Raid, Kanal Koruması, Rol Koruması, Webhook Koruması, Bot Koruması, Reklam Koruması, Spam Koruması), işlem limitleri, sayım penceresi, ceza kuralı, guard kanalı, koruma rolü ve güvenli liste
- İzleme gerçek Discord olaylarından beslenir: denetim kaydı (kanal/rol silme-oluşturma, webhook, bot ekleme, ban/kick/toplu atma), üye katılımı (toplu katılım/bot eklenmesi) ve mesaj akışı (davet linki, hızlı tekrar)
- Sınır aşımı ve şüpheli hareketler **guard kanalına embed olarak** yazılır ve paneldeki olay akışında önem derecesiyle (YÜKSEK/ORTA/BİLGİ) listelenir
- **Güvenli liste:** listedeki kullanıcılar limitlere takılmaz
- **Yedek:** rol ve kanal listesinin anlık görüntüsü alınır, panelde ve `/guard durum` içinde gösterilir
- Hem `/guard` slash komutlarıyla hem panelden yönetilir; yapılandırma veritabanında saklanır
- Bu sürüm **kayıt ve uyarı modundadır** (gösterim): ihlaller kaydedilir ve bildirilir, otomatik ceza (ban/kick/rol alma) uygulanmaz. Ceza kuralı bir yapılandırma olarak gösterilir.

**Kanal & kategori yönetimi (tekli ve toplu)**
- Kategoriye göre gruplanmış metin / ses / duyuru kanalları + arama
- Tekli kanal veya kategori **oluştur**, **yeniden adlandır**, **konu düzenle**, **sil**
- Metin/duyuru kanalından bot hesabıyla veya **Anonymous** adlı nötr webhook üzerinden aynı mesajı belirlenen tekrar sayısı kadar gönderme; hızlı seçimden seçili metin/duyuru kanallarına tur tur toplu mesaj (her turda kanallara birer mesaj, tur bitince sonraki tur; kanallar sırayla alınır, aynı anda en fazla 6 istek gider, aynı kanala iki mesaj arasında en az 1,1 sn bırakılır; hız kendini ayarlar — 429 veya yavaş yanıtta düşer, işler açılınca yükselir; sunucuda iki ayrı Discord kapısı vardır (mesaj gönderimi 6, webhook hazırlığı 8 — birbirini yavaşlatmaz), **Anonymous webhook'ları OTOMATİK OLUŞTURULMAZ** — bot gördüğü ya da yeni açtığı kanallara kendiliğinden webhook koymaz; webhook yalnızca hızlı seçimdeki **Anonymous ekle** düğmesiyle (yalnızca seçilen kanallara) veya anonim gönderim sırasında (gönderim için seçilen kanallara) eklenir. Kanal kartındaki durum satırı hangi kanalda webhook hazır olduğunu gösterir (`/api/channels/webhooks/status`), hazırlık webhook kapısından geçer ve gönderim kapısını yavaşlatmaz, hiçbir istek 45 sn'den fazla bekletilmez ve zaman aşımına düşen kanal tekrar denenmez (atlanır, sonuçta listelenir), 429'da o kanal beklerken diğerleri devam eder, ilerleme saniyede bir tazelenir); kullanıcı/rol ve `@everyone`/`@here` etiketleri her tekrarda uygulanır; ilerleme tur/kalan süre bilgisiyle gösterilir ve gönderim durdurulabilir; kanal yazma iznini kilitleme/kaldırma
- **Toplu oluşturma:** satır başına bir ad girerek metin/ses/duyuru kanalları veya kategori oluştur; uygulama düzeyinde sayı sınırı ve ad tekleme yoktur, tekrar eden adlar kabul edilir (yalnızca Discord'un kendi sunucu limitleri geçerlidir)
- **Toplu seçim:** hızlı seçim (tümü, tümü görünenler, tüm ses kanalları, tüm metin kanalları, tüm kategoriler, kategori grubu) + **Anonymous ekle** düğmesi: basınca yalnızca SEÇİLİ metin/duyuru kanallarına Anonymous webhook'unu ekler (seçim yoksa hiçbir şey yapmaz, uyarı verir); ilerleme düğme üzerinde ve durum satırında gösterilir, sonuç bildirimi düşer
- **Toplu düzenleme:** başına/sonuna ekle (`yakında-`), bul & değiştir, hepsini aynı ad yap (`yakında-{n}`), canlı önizleme ve seçili metin kanallarının konusunu birlikte güncelleme
- **Toplu silme:** seçilen onlarca kanalı/kategoriyi tek seferde kaldır

**Erişim güvenliği (kullanıcı adı & şifre kilidi)**
- Panel **kullanıcı adı ve şifre** (`ADMIN_USER`, `ADMIN_PASS`) ile korunur; başka kimse giriş yapamaz, bot sunucularını göremez
- Botun bulunduğu **tüm sunucular** tek panelden incelenip yönetilebilir (Discord tarafındaki bot yetkileri sınırında)

**Rol yönetimi**
- Rol oluştur / sil, üyeye rol ver / al (rol sıralaması korumalı)
- Sınırsız sayıda rolü birlikte oluşturma, ön/son ekle toplu yeniden adlandırma, seçerek toplu silme ve tekil ad/renk düzenleme

**Eğlence & ekonomi (hem panelde hem Discord'da)**
- 🪙 Yazı tura ve 🎲 zar oyunları için özel Lores casino animasyonları
- Günlük ödül, cüzdan, sunucu sıralaması
- Modern Discord `/` komutları: `/yazıtura`, `/zar`, `/günlük`, `/bakiye`, `/sıralama`, `/şans`, `/8ball`, `/espri`, `/yardım`
- Komutlar her sunucuya otomatik kaydolur; Discord seçenekleri ve kullanıcı/rol seçicileri doğrudan gösterir
- Oyunlarda animasyonlu GIF'ler, markalı zengin kartlar, sonuç rengi, zaman ve bakiye bilgisi

**Sunucu ayarları**
- Log kanalı, hoş geldin mesajı + kanalı ve otomatik rol
- Son 200 işlem kaydı (panelde görünür)

## 🚀 Render'da yayına alma

1. **Discord Developer Portal** → [Applications](https://discord.com/developers/applications) → *New Application*
2. **Bot** sekmesi → *Reset Token* → tokeni kopyala
   - **Privileged Gateway Intents** bölümünde **SERVER MEMBERS INTENT** ve **MESSAGE CONTENT INTENT**'i aç (zorunlu)
3. Render'da **New → Web Service** → bu GitHub repoyu seç
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - (Repodaki `render.yaml` ile Blueprint olarak da oluşturabilirsin)
4. **Environment** değişkenleri:

| Değişken | Değer |
|---|---|
| `DISCORD_TOKEN` | Bot tokeni |
| `ADMIN_USER` | Panele giriş kullanıcı adın |
| `ADMIN_PASS` | Panele giriş şifren |
| `PUBLIC_URL` | *(Opsiyonel)* `https://site-adin.onrender.com` |
| `SESSION_SECRET` | *(Opsiyonel)* Rastgele uzun bir yazı |
| `DEMO_MODE` | `0` (paneli Discord'suz denemek için `1`) |

5. Botu sunucuya ekle: panelde giriş yaptıktan sonra **Ayarlar → 🔗 Bot Davet Linkini Kopyala** (yönetici yetkisiyle davet eder)

## ⚠️ Önemli notlar

- **Bot rolü en üstte olmalı.** Discord'da yönetilecek üyelerin rolü botun rolünden düşük olmalı; aksi halde bot işlem yapamaz (panel bunu hata mesajıyla söyler).
- **Render ücretsiz planı 15 dk trafik olmazsa uyur.** Uyku sırasında bot da çevrimdışı olur. Çözüm: ücretli plan ya da [UptimeRobot](https://uptimerobot.com) ile `/health` adresine 5 dakikalık ping.
- **Veri kalıcılığı:** JSON verisi (`data/db.json`) diske yazılır. Render ücretsiz planda disk kalıcı değildir; kalıcı olsun istersen Render'da **Disk** ekleyip `DATA_DIR=/data` ver (Blueprint'te hazır).
- Panel oturumu **`ADMIN_USER` ve `ADMIN_PASS` kullanıcı adı/şifre girişi** ile korunur; hatalı denemelere karşı geçici kilitleme bulunur. Discord sunucusundaki `/ban`, `/kick` gibi slash komutlarında ise her kullanıcının kendi Discord rol/yetki sınırları geçerlidir.

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
src/games.js       → yazı tura ve zar mantığı
src/settings.js    → sunucu ayarları + işlem kayıtları
src/guard.js       → guard (koruma): yapılandırma, izleme, olay akışı, /guard komutları
src/store.js       → JSON veritabanı
src/demo.js        → DEMO_MODE sahte verisi
public/            → panel arayüzü (index.html, app.js, style.css)
```

### 🛡️ Guard Komutları

`/guard` tek komut altında toplanır (yalnızca **Yönetici** yetkisi olan üyeler kullanabilir):

- `/guard durum` — koruma durumu, modüller, limitler, ceza kuralı, güvenli liste, son 24 saat ve yedek bilgisi
- `/guard aç` · `/guard kapat` — izlemeyi başlat/durdur
- `/guard modül <modül> <açık|kapalı>` — Anti-Nuke, Anti-Raid, Kanal/Rol/Webhook/Bot/Reklam/Spam koruması
- `/guard limit <işlem> <sayı>` — yasaklama, atma, kanal/rol silme-oluşturma, webhook, bot ekleme, toplu üye atma
- `/guard pencere <saniye>` — limitlerin sayılacağı süre (5–600 sn)
- `/guard ceza <tür>` — kural: yasakla / sunucudan at / rollerini al
- `/guard kanal <kanal>` — guard kayıtlarının yazılacağı kanal
- `/guard güvenli <ekle|çıkar|liste> [kullanıcı]` — güvenli liste yönetimi
- `/guard olaylar` — son guard kayıtları
- `/guard yedek` — rol ve kanal listesinin anlık görüntüsünü alır
- `/guard test` — örnek bir guard kaydı üretir (gerçek işlem yapmaz, ceza uygulamaz); panelde **Test olayı üret** düğmesi aynı işi görür

### 🎉 Eğlence Merkezi (60 slash komutu)

Bot açıldığında sunuculara toplam **84 `/` komutu** kaydeder — 23 yönetim/moderasyon, 60 eğlence ve 1 guard komutu (Discord'un sunucu başına 100 uygulama komutu sınırının altında). Eğlence tarafı:

- **GIF'li etkileşimler:** `/sarıl`, `/öp`, `/okşa`, `/tokat`, `/yumruk`, `/tekme`, `/gıdıkla`, `/dans`, `/el-tut`, `/göz-kırp`, `/iltifat` ve daha fazlası
- **Eğlenceli ölçerler:** `/aşk`, `/çekicilik`, `/karizma`, `/azgınlık`, `/zekâ`, `/coolluk`, `/sadakat`, `/toksiklik`, `/komiklik` ve daha fazlası
- **Mini oyunlar:** `/taşkağıtmakas`, `/zar-at`, `/yazı-tura`, `/rastgele-sayı`
- **Kehanet ve araçlar:** `/fal`, `/motto`, `/kim`, `/yüzde`, `/seç`, `/gerçekmi`, `/evethayır`, `/avatar`, `/profil`, `/sunucu`

GIF etkileşimleri iki anime GIF sağlayıcısından alınır; bağlantılar Discord'a gönderilmeden önce doğrulanır ve servis geçici olarak erişilemezse yedek animasyon kullanılır. Ölçer sonuçları her kullanımda yenilenir ve yakın sonuçlar tekrarlanmaz.
