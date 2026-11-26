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

**Guard (sunucu koruması — gerçek zamanlı, tam müdahale)**
- 🛡️ Sıfırdan yazılmış gerçek zamanlı koruma motoru: **tespit ettiğinde gerçekten müdahale eder** (mesaj silme, timeout, atma, yasaklama, yetkili rol soyma, kanal/rol onarımı). Ceza kuralı artık dekorasyon değil.
- **11 modül:** Anti-Nuke, Anti-Raid, Kanal, Rol, Webhook, Bot, Spam, Reklam, Mention, **Honeypot**, Hesap Koruması
- **Honeypot (tuzak):** panelden veya `/guard honeypot kur` ile `・do-not-touch` adında tuzak kanal + `🛡️ Guard Ekip` adında tuzak rol kurulur. Tuzak kanala yazan, tuzak rolü mention'layan veya tuzak kanalı silen kişi **anında cezalandırılır** (timeout / at / yasak / yetkili rol soyma). Tuzak kanal silinirse otomatik yeniden kurulur; pencerede "kimseye söylenmez" uyarısı görünür ve guard kanalına "tuzak" embed'i düşer.
- **Reklam motoru (skorlu):** Discord davet linkleri, link kısaltıcılar (bit.ly, tinyurl, t.co…), **nitro/steam/robux scam**, kripto cüzdan & airdrop tuzakları, bahis/iddaa, hesap-takipçi satışı, fiyat/IBAN/Papara/ininal ifadeleri, gizlenmiş yazımlar (`d1scord[.]gg`, sıfır genişlik karakter, leet), sahte Discord/Steam alan adları, IP adresleri, çoklu link, emoji ve büyük harf bombardımanı puanlanır. Skor **3+** ise reklam sayılır. Güvenilir alan adları listesi, "davet linkleri serbest" anahtarı ve panelden **canlı reklam simülatörü** (skor + gerekçe dökümü) vardır.
- **Anti-Nuke:** sabit limit **ve** sunucu büyüklüğüne göre oran eşiği (örn. her 3 üyede 1 işlem) + "tek kişide toplam yıkıcı işlem" eşiği. Aşılırsa roller soyulur, gerekiyorsa atılır/yasaklanır; kanal/rol silindiyse **yedekten otomatik onarım** yapılır.
- **Anti-Raid:** 12 saniyelik katılım penceresi, tekrar eden avatarlar, yeni hesap yoğunluğu; bildir / yeni hesapları at / **sunucuyu kilitle (doğrulama yükselt)** seçenekleri.
- **Kanal/Rol/Webhook/Bot/Emoji/Entegrasyon/Davet** korumaları; **guard kanalı silinirse otomatik yeniden oluşturulur**, yetkisiz webhook'lar temizlenir, güvenli listede olmayan bot atılır (istenirse davet edeni de yasaklar), tehlikeli rol yetkisi değişiklikleri yakalanır.
- **Spam:** 8 saniyede mesaj bombardımanı, tekrar eden içerik (hash), çoklu kanal spam'i → sohbet temizlenir + timeout.
- **Mention:** mesaj başına mention sınırı, toplu mention (`@everyone` dahil) → mesaj silinir, aşırıda timeout.
- **Hesap Koruması:** yeni hesapları işaretler veya atar; **büyük harf / emoji filtresi**, **güvenlik denetimi** (doğrulama seviyesi, 2FA, guard kanalı varlığı) ve **panik modu** (tüm yetkili rolleri soyar, davetleri siler).
- **Yedek & geri yükleme:** rol/kanal anlık görüntüsü; panelden veya `/guard geri-yükle` ile eksikler yeniden kurulur.
- **İstatistikler:** müdahale, silinen mesaj, honeypot, reklam ve geri kurulan sayıları; 14 günlük trend grafiği (panelde).
- **Hazır ayarlar:** Dengeli / Sıkı / Gevşek profilleri tek tıkla uygular (modüller, limitler, cezalar, eşikler).
- **Kendi işlemlerini tehlike saymaz:** panelin/botun toplu işlemleri ve Anonymous webhook mesajları guard'ı tetiklemez; güvenli listedeki kullanıcılar limit, ceza, reklam ve honeypot'tan muaftır.
- Her ihlal **guard kanalına detaylı embed** olarak (skor, kanıt, ceza, sayaç) yazılır ve paneldeki canlı akışta önem derecesiyle listelenir.
- Arayüz: neon "hero" paneli, animasyonlu kalkan, güç anahtarı, KPI kartları, modül kartları, trend grafiği, honeypot ve reklam motoru kartları, limit/oran tablosu, acil durum bölgesi.

**Guard Merkezi (operatör katmanı — yalnızca panelde)**
- Guard **yalnızca senin whitelist'e aldığın sunucularda çalışır**. Bota eklenen her yeni sunucu otomatik olarak **pasif (onay bekliyor)** başlar; sahibi isterse ve sen uygun görürsen tek tıkla whitelist'e alırsın (whitelist'e almak görünür korumayı da açar).
- **Blacklist / sessiz mod:** kötüye kullandığını düşündüğün sunucuyu tek tıkla sessize alırsın. İzleme tamamen durur; buna rağmen o sunucuda `/guard durum` ve diğer `/guard` komutları **aynen normal görünür** (koruma "aktif" yazar, ayarlar değişir), yani korumanın kapalı olduğunu anlayamazlar.
- Operatör bilgileri (`silent`, `whitelist`, `blacklist`, notlar, operatör kayıtları) Discord'a giden **hiçbir çıktıda yer almaz**: `/guard durum` özeti, guard kanalı embed'leri ve sunucunun olay akışı temiz kalır. Bu bilgiler yalnızca panelde görünür.
- **Guard Merkezi** tüm sunucuları tek listede gösterir: durum (koruma çalışıyor / sessizde / onay bekliyor / sunucu kapatmış), üye sayısı, modül–limit–ceza–pencere özeti, olay sayısı, son 24 saat ihlali, yedek durumu, güvenli liste sayısı ve operatör notu. Filtre + isim/ID arama vardır.
- Her sunucunun guard ayarları **merkezden düzenlenebilir**: modüller, limitler, sayım penceresi, ceza kuralı, timeout süresi, guard kanalı, jail rolü, honeypot cezası, reklam cezası, güvenli liste, hazır profiller (Dengeli/Sıkı/Gevşek). Ayrıca o sunucunun olay akışı ve 14 günlük trendi görüntülenebilir; honeypot kurulabilir, örnek test kaydı üretilebilir, yedek alınıp **geri yüklenebilir** ve **panik modu** çalıştırılabilir.
- **Otomatik pasifleştirme** anahtarı: yeni eklenen sunucuların otomatik pasif başlamasını açıp kapatabilirsin (kapalıyken de whitelist'siz sunucuda koruma çalışmaz).
- Operatör işlemleri ayrı bir günlükte tutulur (kim, ne zaman, hangi sunucu, hangi işlem, neden) ve **sunucuların guard olay akışına yazılmaz**.
- Guard Merkezi'nin hiçbir işlemi webhook oluşturmaz; Anonymous webhook politikası (yalnızca manuel) aynen geçerlidir.

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
src/guard.js       → guard (koruma): gerçek zamanlı tespit + müdahale, honeypot, reklam motoru,
                     yedek/geri yükleme, panik modu, /guard komutları
                     + operatör katmanı (whitelist/blacklist, sessiz mod, otomatik pasifleştirme)
src/store.js       → JSON veritabanı
src/demo.js        → DEMO_MODE sahte verisi
public/            → panel arayüzü (index.html, app.js, style.css, guard.css)
```

### 🛡️ Guard Komutları

`/guard` tek komut altında toplanır (yalnızca **Yönetici** yetkisi olan üyeler kullanabilir):

- `/guard durum` — modüller, cezalar, honeypot durumu, reklam ayarı, istatistikler ve limitler
- `/guard aç` · `/guard kapat` — korumayı ve otomatik müdahaleyi başlat/durdur
- `/guard modül <modül> <açık|kapalı>` — 11 modülün her biri tek tek
- `/guard limit <işlem> <sayı>` — 15 izlenen işlem için sabit limit
- `/guard oran <işlem> <oran>` — sunucu büyüklüğüne göre otomatik eşik (0 = kapalı)
- `/guard pencere <saniye>` — limitlerin sayılacağı süre (5–600 sn)
- `/guard ceza <tür>` — yasakla / sunucudan at / rollerini al / timeout
- `/guard süre <dakika>` — timeout cezasının süresi (1–1440 dk)
- `/guard kanal <kanal>` — guard kayıtlarının yazılacağı kanal
- `/guard güvenli <ekle|çıkar|liste> [kullanıcı]` — güvenli liste yönetimi
- `/guard honeypot <kur|rol|kaldir|durum> [ceza]` — tuzak kanal/rol kurulumu ve durumu
- `/guard reklam <sil|timeout|kick|ban|davet-ac|davet-kapat|ekle|çıkar|liste> [değer]` — reklam cezası, davet kuralı ve güvenilir alan adları
- `/guard simülasyon <metin>` — bir metnin reklam skorunu test eder (işlem yapmaz)
- `/guard olaylar` — son guard kayıtları
- `/guard yedek` · `/guard geri-yükle` — anlık görüntü al / eksikleri yeniden kur
- `/guard panik` — tüm yetkili rolleri soy, davetleri sil (acil durum)
- `/guard test` — örnek bir guard kaydı üretir (gerçek işlem yapmaz)

### 🎉 Eğlence Merkezi (60 slash komutu)

Bot açıldığında sunuculara toplam **84 `/` komutu** kaydeder — 23 yönetim/moderasyon, 60 eğlence ve 1 guard komutu (Discord'un sunucu başına 100 uygulama komutu sınırının altında). Eğlence tarafı:

- **GIF'li etkileşimler:** `/sarıl`, `/öp`, `/okşa`, `/tokat`, `/yumruk`, `/tekme`, `/gıdıkla`, `/dans`, `/el-tut`, `/göz-kırp`, `/iltifat` ve daha fazlası
- **Eğlenceli ölçerler:** `/aşk`, `/çekicilik`, `/karizma`, `/azgınlık`, `/zekâ`, `/coolluk`, `/sadakat`, `/toksiklik`, `/komiklik` ve daha fazlası
- **Mini oyunlar:** `/taşkağıtmakas`, `/zar-at`, `/yazı-tura`, `/rastgele-sayı`
- **Kehanet ve araçlar:** `/fal`, `/motto`, `/kim`, `/yüzde`, `/seç`, `/gerçekmi`, `/evethayır`, `/avatar`, `/profil`, `/sunucu`

GIF etkileşimleri iki anime GIF sağlayıcısından alınır; bağlantılar Discord'a gönderilmeden önce doğrulanır ve servis geçici olarak erişilemezse yedek animasyon kullanılır. Ölçer sonuçları her kullanımda yenilenir ve yakın sonuçlar tekrarlanmaz.
