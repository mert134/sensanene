const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const COLORS = {
  pink: 0xeb459e,
  purple: 0x9b59b6,
  blue: 0x5865f2,
  gold: 0xf1c40f,
  green: 0x57f287,
  red: 0xed4245
};

// nekos.best doğrudan animasyonlu GIF döndürür. Servis ulaşılamazsa kart yine çalışır.
const ACTIONS = {
  sarıl: { api: 'hug', emoji: '🤗', verb: 'sıcacık sarıldı', lines: ['Kemikler çatırdadı ama değdi.', 'Günün en güzel sarılması!', 'Mutluluk seviyesi yükseldi.'] },
  öp: { api: 'kiss', emoji: '😘', verb: 'tatlı bir öpücük gönderdi', lines: ['Aşk havada!', 'Kalpler hızlandı.', 'Bu anı kimse görmedi sayalım.'] },
  okşa: { api: 'pat', emoji: '☺️', verb: 'başını sevgiyle okşadı', lines: ['Uslu çocuk modu aktif.', 'Huzur +100.', 'Tam ihtiyacı olan şeydi.'] },
  tokat: { api: 'slap', emoji: '🖐️', verb: 'şak diye tokadı yapıştırdı', lines: ['Ses üç sunucu öteden duyuldu.', 'Şiddet değil, tamamen çizgi film fiziği.', 'Ekran bir an sallandı.'] },
  yumruk: { api: 'punch', emoji: '👊', verb: 'çizgi film yumruğunu savurdu', lines: ['Kritik vuruş!', 'Hasar: gurur -50.', 'Respawn süresi: 3 saniye.'] },
  tekme: { api: 'kick', emoji: '🦵', verb: 'uçan tekme attı', lines: ['Fizik kuralları sohbetten ayrıldı.', 'Mükemmel isabet!', 'VAR incelemesi başladı.'] },
  ısır: { api: 'bite', emoji: '🧛', verb: 'minik bir ısırık aldı', lines: ['Vampir modu açıldı.', 'Acıktığında kendisi olmuyor.', 'Isırık sevgi göstergesiydi… galiba.'] },
  gıdıkla: { api: 'tickle', emoji: '😂', verb: 'gıdıklama saldırısı başlattı', lines: ['Kaçış yok!', 'Kahkaha barı doldu.', 'Savunma tamamen çöktü.'] },
  besle: { api: 'feed', emoji: '🍰', verb: 'elleriyle yemek yedirdi', lines: ['Afiyet bal şeker olsun.', 'Açlık barı tamamen doldu.', 'Şefin özel menüsü.'] },
  'el-tut': { api: 'handhold', emoji: '🤝', verb: 'elini tuttu', lines: ['Bırakmak yok.', 'Kalp ritimleri senkronlandı.', 'Güvenli alan oluşturuldu.'] },
  çak: { api: 'highfive', emoji: '✋', verb: 'efsane bir beşlik çaktı', lines: ['Takım ruhu +100.', 'Mükemmel zamanlama!', 'Avuçlar hâlâ titreşiyor.'] },
  selamla: { api: 'wave', emoji: '👋', verb: 'uzaktan selam verdi', lines: ['Selam alındı!', 'Nezaket seviyesi maksimum.', 'Yeni bir dostluk doğuyor.'] },
  'göz-kırp': { api: 'wink', emoji: '😉', verb: 'gizemli şekilde göz kırptı', lines: ['Mesaj alındı.', 'Karizma seviyesi yükseldi.', 'Bu bakışın bir anlamı var.'] },
  bakış: { api: 'stare', emoji: '👀', verb: 'uzun uzun bakmaya başladı', lines: ['Göz teması kilitlendi.', 'Kim önce kırpacak?', 'Ortam sessizleşti.'] },
  dans: { api: 'dance', emoji: '💃', verb: 'dans pistine davet etti', lines: ['Ritim kaçsa da enerji tam!', 'Disko topu otomatik açıldı.', 'Pist artık onların.'] },
  ağla: { api: 'cry', emoji: '😭', verb: 'omzunda ağladı', lines: ['Peçeteler hazır.', 'Duygu seli başladı.', 'Bir sarılma iyi gelebilir.'] },
  utan: { api: 'blush', emoji: '😳', verb: 'karşısında kıpkırmızı oldu', lines: ['Yanaktaki sıcaklık ölçülemiyor.', 'Göz göze gelmek zor.', 'Utangaçlık seviyesi kritik.'] },
  gülümse: { api: 'smile', emoji: '😊', verb: 'ona kocaman gülümsedi', lines: ['Oda bir anda aydınlandı.', 'Mutluluk bulaşıcıdır.', 'Günün enerjisi geldi.'] },
  düşün: { api: 'think', emoji: '🤔', verb: 'hakkında derin düşüncelere daldı', lines: ['Beyin işlem yapıyor…', 'Büyük planlar var.', 'Sonuç henüz yükleniyor.'] },
  aferin: { api: 'thumbsup', emoji: '👍', verb: 'onay mührünü bastı', lines: ['Kalite kontrolden geçti.', 'Harika iş!', 'Lores Bot onayladı.'] },
  dürt: { api: 'poke', emoji: '👉', verb: 'dürtüp kaçtı', lines: ['Yakalanmadan uzaklaştı.', 'Dikkat başarıyla çekildi.', 'Şimdi sıra karşı tarafta.'] },
  kovala: { api: 'run', emoji: '🏃', verb: 'peşinden koşmaya başladı', lines: ['Kaçış rotası hesaplanıyor.', 'Nefesler kesildi.', 'Kovalama sahnesi başladı.'] },
  'ateş-et': { api: 'shoot', emoji: '🔫', verb: 'piksel tabancasını ateşledi', lines: ['Tamamen oyun efekti!', 'Respawn noktası yakında.', 'Pew pew!'] },
  ye: { api: 'nom', emoji: '😋', verb: 'yanaklarını nom nom yaptı', lines: ['Çok tatlı olmanın sonuçları.', 'Bir lokma sevgi.', 'Nom seviyesi maksimum.'] }
};

const METERS = {
  aşk: { emoji: '💘', title: 'Aşk Uyumu', low: 'Arkadaşlık daha güvenli görünüyor.', mid: 'Arada güzel bir elektrik var!', high: 'Bu ikili için düğün salonu bakılsın!' },
  çekicilik: { emoji: '✨', title: 'Çekicilik', low: 'Bugün bakım günü olabilir.', mid: 'Dikkatleri üstüne çekiyor.', high: 'Sunucunun gözleri kamaştı!' },
  karizma: { emoji: '😎', title: 'Karizma', low: 'Karizma güncellemesi bekleniyor.', mid: 'Gayet havalı bir enerji.', high: 'Ortamın bütün karizmasını topladı!' },
  azgınlık: { emoji: '🌶️', title: 'Ateş Ölçer', low: 'Buzdolabı kadar sakin.', mid: 'Hafif bir sıcaklık hissediliyor.', high: 'Ortam fazla ısındı; camları açın!' },
  delilik: { emoji: '🤪', title: 'Delilik', low: 'Fazlasıyla normal görünüyor.', mid: 'Tatlı bir çılgınlık var.', high: 'Mantık sunucudan ayrıldı!' },
  masumluk: { emoji: '😇', title: 'Masumluk', low: 'Geçmiş biraz şüpheli.', mid: 'Melek ve şeytan dengede.', high: 'Kanatlar birazdan çıkacak!' },
  kıskançlık: { emoji: '💚', title: 'Kıskançlık', low: 'Özgüven tam yerinde.', mid: 'Göz ucuyla kontrol ediyor.', high: 'Dedektif modu tamamen açık!' },
  toksiklik: { emoji: '☢️', title: 'Toksiklik', low: 'Tertemiz bir enerji.', mid: 'Arada zehirli şakalar kaçıyor.', high: 'Koruyucu ekipman gerekli!' },
  yakışıklılık: { emoji: '🕴️', title: 'Yakışıklılık', low: 'Işık açısı kötü denk gelmiş.', mid: 'Gayet kaliteli görünüm.', high: 'Podyum hazır, ajanslar sırada!' },
  güzellik: { emoji: '👑', title: 'Güzellik', low: 'Kamera bugün naz yapıyor.', mid: 'Göz alıcı bir enerji.', high: 'Filtreler onun yanında gereksiz!' },
  zenginlik: { emoji: '💸', title: 'Gelecekteki Zenginlik', low: 'Kumbara ile başlanabilir.', mid: 'Yatırımlar umut veriyor.', high: 'Özel jet kataloğu istiyor!' },
  şanslılık: { emoji: '🍀', title: 'Şans', low: 'Bugün risk alma.', mid: 'Şans yanında olabilir.', high: 'Piyango bileti alma zamanı!' },
  oyunculuk: { emoji: '🎮', title: 'Oyunculuk Yeteneği', low: 'Tutorial tekrar izlenebilir.', mid: 'Takıma alınır.', high: 'E-spor takımları DM atıyor!' },
  zekâ: { emoji: '🧠', title: 'Zekâ Gücü', low: 'Beyin enerji tasarrufunda.', mid: 'İşlemci gayet hızlı.', high: 'NASA birazdan arayacak!' },
  tembellik: { emoji: '🛌', title: 'Tembellik', low: 'Yerinde duramıyor.', mid: 'Bir mola fena olmaz.', high: 'Yataktan çıkmak DLC gerektiriyor!' },
  sadakat: { emoji: '🫶', title: 'Sadakat', low: 'Güven testi gerekebilir.', mid: 'Sırtını yaslayabilirsin.', high: 'Sonuna kadar yanında!' },
  komiklik: { emoji: '🤣', title: 'Komiklik', low: 'Espriler beta aşamasında.', mid: 'Güldürmeyi biliyor.', high: 'Stand-up bileti satışta!' },
  enerji: { emoji: '⚡', title: 'Enerji', low: 'Şarj cihazı aranıyor.', mid: 'Güne hazır.', high: 'Elektrik santrali gibi!' },
  coolluk: { emoji: '🧊', title: 'Coolluk', low: 'Biraz ısınmış.', mid: 'Havalı görünüm aktif.', high: 'Buzullar yanında sıcak kalır!' },
  güvenilirlik: { emoji: '🛡️', title: 'Güvenilirlik', low: 'Şifreyi paylaşmamak iyi olur.', mid: 'Sırların çoğu güvende.', high: 'Kasa şifresi bile emanet edilir!' }
};

const ORACLES = {
  seç: ['İlk seçenek!', 'İkinci seçenek!', 'İkisi de olmaz.', 'Kalbinin sesini dinle.', 'Yazı tura atalım; ilk seçenek kazandı.', 'Bugün karar verme, yarına bırak.'],
  gerçek: ['Kesinlikle gerçek.', 'Biraz şüpheli ama gerçek olabilir.', 'Tamamen sallıyor!', 'Kaynak: güven bana kardeşim.', 'Kanıtlar gerçeği gösteriyor.', 'Lores dedektifleri bunun yalan olduğunu söylüyor.'],
  evethayır: ['EVET! ✅', 'HAYIR! ❌', 'Büyük ihtimalle evet.', 'Hiç sanmıyorum.', 'Şu an cevap vermek riskli.', 'Kader “belki” diyor.'],
  bugün: ['Bugün şans senden yana.', 'Küçük bir sürpriz kapıda.', 'Bir mesaj bütün modunu değiştirecek.', 'Harcamalara dikkat et.', 'Bol bol gülümseyeceğin bir gün.', 'Uyku bugün en iyi dostun.']
};

// Metinleri birkaç sabit yanıta hapsetmek yerine parçaları birleştiriyoruz. Sosyal
// aksiyonlarda 3 x 12 x 10 = 360+, falda binlerce farklı doğal kombinasyon oluşur.
const ACTION_MOODS = [
  'Ortam bir anda anime sahnesine döndü.', 'Arka planda açılış müziği çalmaya başladı.',
  'Sunucudaki herkes dönüp bu ana baktı.', 'Kamera dramatik biçimde yakınlaştı.',
  'Efekt bütçesinin tamamı bu sahneye harcandı.', 'Zaman sanki birkaç saniyeliğine durdu.',
  'Bu hareket sezon finaline damga vurdu.', 'Sohbetin enerjisi bir anda yükseldi.',
  'Lores kameraları bu efsane anı kaydetti.', 'Anime yönetmeni bu sahneyi onayladı.',
  'Beklenmedik ama kusursuz bir hamleydi.', 'Sahne tekrar oynatılmak üzere arşivlendi.'
];
const ACTION_ENDINGS = [
  'Devamı bir sonraki bölümde!', 'Karşı hamle gelecek mi?', 'İzleyenlerden tam puan aldı.',
  'Bu an kolay kolay unutulmayacak.', 'Sunucu tarihine altın harflerle yazıldı.',
  'Duygular tavan yaptı.', 'Kritik başarı!', 'Enerji seviyesi: maksimum.',
  'Birileri bunu klip alsın!', 'Lores Bot sonucu resmen onayladı.'
];
const RECENT_TEXT = new Map();
function pickFresh(key, factory, recentLimit = 15) {
  const recent = RECENT_TEXT.get(key) || [];
  let value;
  for (let i = 0; i < 12; i++) {
    value = factory();
    if (!recent.includes(value)) break;
  }
  recent.push(value);
  if (recent.length > recentLimit) recent.shift();
  RECENT_TEXT.set(key, recent);
  return value;
}
function randomOf(list) { return list[Math.floor(Math.random() * list.length)]; }
function actionText(name, info) {
  return pickFresh(`action:${name}`, () => `${randomOf(info.lines)} ${randomOf(ACTION_MOODS)} ${randomOf(ACTION_ENDINGS)}`);
}

const FORTUNE_OPENINGS = [
  'Kristal kürede parlak bir yol beliriyor.', 'Kartlar beklenmedik bir değişimi gösteriyor.',
  'Yıldızların dizilimi sana küçük bir sır veriyor.', 'Sislerin arasından güçlü bir işaret çıkıyor.',
  'Uzaklardan gelen bir enerji sana yaklaşıyor.', 'Kader çizgin bugün farklı parlıyor.',
  'Ay ışığı önündeki kapıyı aydınlatıyor.', 'Evren bugün kulağına bir şey fısıldıyor.',
  'Kahve telvesinde belirgin bir sembol oluştu.', 'Eski bir dileğin yeniden canlanıyor.',
  'Şans çarkı yavaşça senin yönüne dönüyor.', 'Kalbinin pusulası yeni bir yön gösteriyor.'
];
const FORTUNE_EVENTS = [
  'beklemediğin güzel bir haber alacaksın', 'uzun süredir ertelediğin bir başlangıcı yapacaksın',
  'seni gülümsetecek biriyle konuşacaksın', 'küçük bir fırsatı büyük bir başarıya çevireceksin',
  'kaybettiğini düşündüğün motivasyonu yeniden bulacaksın', 'önemli bir konuda doğru kararı vereceksin',
  'eski bir dosttan sürpriz bir mesaj alacaksın', 'yeni bir yeteneğini fark edeceksin',
  'maddi veya manevi küçük bir rahatlama yaşayacaksın', 'cesaret isteyen bir adım atacaksın',
  'çevrendeki birinin gerçek değerini anlayacaksın', 'şanslı bir tesadüfle karşılaşacaksın'
];
const FORTUNE_ADVICE = [
  'İlk işareti küçümseme.', 'Sabırlı ol; doğru an yaklaşmış durumda.', 'Bu kez iç sesine güven.',
  'Geçmişin korkusunu geleceğe taşıma.', 'Karşına çıkan küçük ayrıntıya dikkat et.',
  'Cesur davran ama acele karar verme.', 'Gülümsemeyi ve teşekkür etmeyi unutma.',
  'Planını herkesle paylaşmadan ilerle.', 'Enerjini seni aşağı çeken şeylerden koru.',
  'Önce kendine dürüst ol.', 'Yeni bir teklife hemen hayır deme.', 'Şans geldiğinde hazır ol.'
];
function fortuneText() {
  return pickFresh('oracle:fal', () => `${randomOf(FORTUNE_OPENINGS)} Yakında **${randomOf(FORTUNE_EVENTS)}**. ${randomOf(FORTUNE_ADVICE)}`, 30);
}

const MOTTO_START = ['Bugün', 'Her yeni günde', 'Zorlandığında', 'Yol uzadığında', 'Kimse görmese bile', 'Kendinden şüphe ettiğinde', 'Bir kapı kapandığında', 'Hedefin uzakta görünse de', 'Sessizlikte', 'Başarı geciktiğinde', 'Korktuğun anda', 'Yeniden başlarken'];
const MOTTO_END = ['küçük adımların büyük yollar açtığını hatırla.', 'kendi ışığını kısmadan ilerle.', 'cesaretin korkudan bir adım önde olsun.', 'sabırla kurduğun şeyin kalıcı olacağını bil.', 'başkasını değil dünkü kendini geç.', 'enerjini değiştirebileceğin şeylere ver.', 'yenilginin yalnızca yeni bir ders olduğunu unutma.', 'doğru zamanın bazen sen başlayınca geldiğini bil.', 'sessiz emeğinin bir gün konuşacağını hatırla.', 'vazgeçmek yerine kısa bir mola ver.', 'kalbinle aklını aynı hedefte buluştur.', 'hikâyenin henüz bitmediğini unutma.'];
function mottoText() { return pickFresh('oracle:motto', () => `${randomOf(MOTTO_START)} ${randomOf(MOTTO_END)}`, 25); }

const COMPLIMENT_TRAITS = ['Gülüşün', 'Enerjin', 'Tarzın', 'Samimiyetin', 'Sohbetin', 'Özgüvenin', 'Nezaketin', 'Mizahın', 'Bakış açın', 'Pozitifliğin', 'Dostluğun', 'Varlığın'];
const COMPLIMENT_EFFECTS = ['sunucunun bütün havasını değiştiriyor.', 'bulunduğun her yere iyi geliyor.', 'insanlara güven veriyor.', 'gerçekten fark yaratıyor.', 'günün en güzel ayrıntısı oluyor.', 'çevrendekileri istemeden gülümsetiyor.', 'seni kolay unutulmaz biri yapıyor.', 'fazlasıyla kaliteli bir iz bırakıyor.', 'insanların kendini rahat hissetmesini sağlıyor.', 'her ortamda hemen fark ediliyor.', 'seni olduğundan da özel gösteriyor.', 'bugün ekstra parlıyor.'];
function complimentText() { return pickFresh('oracle:iltifat', () => `${randomOf(COMPLIMENT_TRAITS)} ${randomOf(COMPLIMENT_EFFECTS)}`, 25); }


function actionBuilder(name, info) {
  const builder = new SlashCommandBuilder().setName(name).setDescription(`${info.emoji} Bir üyeye ${name} etkileşimi gönder`);
  if (name === 'kovala') {
    return builder
      .setDescription('🏃 Seçtiğin iki kişi arasında anime kovalama sahnesi başlat')
      .addUserOption(o => o.setName('kovalayan').setDescription('Kovalayan kişi').setRequired(true))
      .addUserOption(o => o.setName('kaçan').setDescription('Kaçan kişi').setRequired(true));
  }
  return builder.addUserOption(o => o.setName('üye').setDescription('Etkileşim kurulacak kişi').setRequired(true));
}

function meterBuilder(name, info) {
  const b = new SlashCommandBuilder().setName(name).setDescription(`${info.emoji} ${info.title} yüzdesini ölç`)
    .addUserOption(o => o.setName('kişi1').setDescription('Ölçülecek kişi').setRequired(true));
  if (name === 'aşk') b.addUserOption(o => o.setName('kişi2').setDescription('Diğer kişi (boşsa sen)').setRequired(false));
  return b;
}

const oracleCommands = [
  new SlashCommandBuilder().setName('seç').setDescription('İki seçenek arasında Lores karar versin').addStringOption(o => o.setName('seçenekler').setDescription('Örnek: Pizza mı hamburger mi?').setRequired(true)),
  new SlashCommandBuilder().setName('gerçekmi').setDescription('Bir iddianın gerçeklik analizini yap').addStringOption(o => o.setName('iddia').setDescription('Kontrol edilecek iddia').setRequired(true)),
  new SlashCommandBuilder().setName('evethayır').setDescription('Soruna net veya gizemli bir cevap al').addStringOption(o => o.setName('soru').setDescription('Sorun').setRequired(true)),
  new SlashCommandBuilder().setName('bugün').setDescription('Günün için mini bir Lores yorumu al'),
  new SlashCommandBuilder().setName('yüzde').setDescription('İstediğin şeyin olma ihtimalini ölç').addStringOption(o => o.setName('konu').setDescription('Neyin ihtimalini ölçelim?').setRequired(true)),
  new SlashCommandBuilder().setName('kim').setDescription('Sunucudan rastgele birini seç').addStringOption(o => o.setName('soru').setDescription('Örnek: En çok kim uyur?').setRequired(true)),
  new SlashCommandBuilder().setName('avatar').setDescription('Bir üyenin avatarını yüksek kalitede göster').addUserOption(o => o.setName('üye').setDescription('Avatarı gösterilecek kişi')),
  new SlashCommandBuilder().setName('sunucu').setDescription('Sunucunun havalı bilgi kartını göster'),
  new SlashCommandBuilder().setName('profil').setDescription('Bir üyenin Discord profil kartını göster').addUserOption(o => o.setName('üye').setDescription('Profili gösterilecek kişi')),
  new SlashCommandBuilder().setName('rastgele-sayı').setDescription('Belirlediğin aralıkta sayı seç').addIntegerOption(o => o.setName('min').setDescription('En küçük sayı').setRequired(true)).addIntegerOption(o => o.setName('max').setDescription('En büyük sayı').setRequired(true)),
  new SlashCommandBuilder().setName('taşkağıtmakas').setDescription('Lores Bot ile taş kağıt makas oyna').addStringOption(o => o.setName('seçim').setDescription('Hamlen').setRequired(true).addChoices({ name: '🪨 Taş', value: 'taş' }, { name: '📄 Kağıt', value: 'kağıt' }, { name: '✂️ Makas', value: 'makas' })),
  new SlashCommandBuilder().setName('zar-at').setDescription('Bahissiz masaüstü zarları at').addIntegerOption(o => o.setName('adet').setDescription('Zar sayısı').setMinValue(1).setMaxValue(10)).addIntegerOption(o => o.setName('yüz').setDescription('Zar yüzü').setMinValue(2).setMaxValue(100)),
  new SlashCommandBuilder().setName('yazı-tura').setDescription('Bahissiz hızlı yazı tura at'),
  new SlashCommandBuilder().setName('fal').setDescription('Lores kristal küresinden eğlencelik fal al'),
  new SlashCommandBuilder().setName('motto').setDescription('Sana özel günlük motto üret'),
  new SlashCommandBuilder().setName('iltifat').setDescription('Bir üyeye rastgele güzel bir iltifat gönder').addUserOption(o => o.setName('üye').setDescription('İltifat edilecek kişi').setRequired(true))
];

const funSlashCommands = [
  ...Object.entries(ACTIONS).map(([name, info]) => actionBuilder(name, info)),
  ...Object.entries(METERS).map(([name, info]) => meterBuilder(name, info)),
  ...oracleCommands
].map(c => c.setDMPermission(false).toJSON());

function seededPercent(...parts) {
  const key = parts.join(':');
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h) % 101;
}

function bar(n) {
  const full = Math.round(n / 10);
  return `${'▰'.repeat(full)}${'▱'.repeat(10 - full)}`;
}

const GIF_RECENT = new Map();
const GIF_VALIDATION = new Map();
const FALLBACK_GIF = 'https://media.tenor.com/2roX3uxz_68AAAAC/cat-space.gif';

// Her aksiyon önce tam isimli anime kategorisini dener. İkinci isim yalnızca aynı
// temanın servislerdeki farklı karşılığıdır; örneğin besle -> feed/nom.
const ACTION_GIF_ALIASES = {
  hug: ['hug', 'cuddle'], kiss: ['kiss', 'peck'], pat: ['pat'], slap: ['slap', 'smack'],
  punch: ['punch'], kick: ['kick'], bite: ['bite'], tickle: ['tickle'], feed: ['feed', 'nom'],
  handhold: ['handhold'], highfive: ['highfive'], wave: ['wave'], wink: ['wink'], stare: ['stare'],
  dance: ['dance'], cry: ['cry'], blush: ['blush', 'shy'], smile: ['smile', 'happy'],
  think: ['think', 'confused'], thumbsup: ['thumbsup', 'clap'], poke: ['poke'], run: ['run'],
  shoot: ['shoot'], nom: ['nom']
};

async function validateGifUrl(url) {
  if (!url || !/^https:\/\//i.test(url)) return false;
  const cached = GIF_VALIDATION.get(url);
  if (cached && cached.expires > Date.now()) return cached.ok;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    // Discord da dosyayı uzaktan indirir. Burada küçük bir aralık isteğiyle URL'nin
    // gerçekten erişilebilir bir görsel döndürdüğünü önceden doğruluyoruz.
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { Range: 'bytes=0-1023', Accept: 'image/gif,image/webp,image/apng,image/*' }
    });
    const type = (res.headers && res.headers.get('content-type')) || '';
    const ok = res.ok && type.toLowerCase().startsWith('image/');
    if (res.body && typeof res.body.cancel === 'function') await res.body.cancel().catch(() => {});
    GIF_VALIDATION.set(url, { ok, expires: Date.now() + (ok ? 30 * 60 * 1000 : 2 * 60 * 1000) });
    return ok;
  } catch {
    GIF_VALIDATION.set(url, { ok: false, expires: Date.now() + 2 * 60 * 1000 });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchProviderGif(provider, endpoint) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const apiUrl = provider === 'otaku'
      ? `https://api.otakugifs.xyz/gif?reaction=${encodeURIComponent(endpoint)}`
      : `https://nekos.best/api/v2/${encodeURIComponent(endpoint)}`;
    const res = await fetch(apiUrl, { signal: controller.signal });
    if (!res.ok) return null;
    const json = await res.json();
    const gif = provider === 'otaku'
      ? json.url
      : (json.results && json.results[0] ? json.results[0].url : null);
    return (gif && await validateGifUrl(gif)) ? gif : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getGif(action) {
  const aliases = ACTION_GIF_ALIASES[action] || [action];
  const recent = GIF_RECENT.get(action) || [];
  let duplicate = null;
  // Sağlayıcılar her istekte rastgele GIF verir. Önce Discord CDN'iyle daha uyumlu nekos denenir. Son 30 GIF'i tutup aynı URL gelirse
  // yeniden isteyerek peş peşe aynı animasyonu göstermemeyi sağlarız.
  for (const endpoint of aliases) {
    for (const provider of ['nekos', 'otaku']) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const url = await fetchProviderGif(provider, endpoint);
        if (!url) break;
        if (!recent.includes(url)) {
          recent.push(url);
          if (recent.length > 30) recent.shift();
          GIF_RECENT.set(action, recent);
          return url;
        }
        duplicate = url;
      }
    }
  }
  return duplicate || FALLBACK_GIF;
}

function baseEmbed(interaction, color = COLORS.purple) {
  return new EmbedBuilder().setColor(color)
    .setAuthor({ name: 'LORES • Eğlence Merkezi', iconURL: interaction.client.user.displayAvatarURL() })
    .setFooter({ text: `${interaction.guild.name} • Tamamen eğlence amaçlıdır`, iconURL: interaction.guild.iconURL() || undefined })
    .setTimestamp();
}

async function runAction(interaction, name, info) {
  const isChase = name === 'kovala';
  const actor = isChase ? interaction.options.getUser('kovalayan') : interaction.user;
  const target = isChase ? interaction.options.getUser('kaçan') : interaction.options.getUser('üye');
  if (!actor || !target) return interaction.reply({ content: '⚠️ Gerekli kullanıcıları seçmelisin.', ephemeral: true });
  if (target.id === actor.id) {
    return interaction.reply({ content: `${info.emoji} İki farklı kullanıcı seçmelisin!`, ephemeral: true });
  }
  await interaction.deferReply();
  const gif = await getGif(info.api);
  const line = actionText(name, info);
  const actionColors = [COLORS.pink, COLORS.purple, COLORS.blue, COLORS.gold, COLORS.green];
  const accent = actionColors[seededPercent(name, actor.id, target.id) % actionColors.length];
  const title = isChase
    ? `🏃 ${actor.username} kovalıyor  ➜  ${target.username} kaçıyor!`
    : `${info.emoji} ${interaction.user.username}  ➜  ${target.username}`;
  const description = isChase
    ? `### 🏁 Anime kovalama sahnesi başladı!\n<@${actor.id}> hızla kovalıyor, <@${target.id}> canını kurtarmak için kaçıyor!\n\n> *${line}*`
    : `### ${info.emoji} Etkileşim başladı!\n<@${interaction.user.id}>, <@${target.id}> kullanıcısına **${info.verb}!**\n\n> *${line}*`;
  const embed = baseEmbed(interaction, accent)
    .setAuthor({ name: `LORES • ${name.toLocaleUpperCase('tr-TR')} ANİMASYONU`, iconURL: interaction.client.user.displayAvatarURL() })
    .setTitle(title)
    .setDescription(description)
    .setThumbnail(target.displayAvatarURL({ size: 256 }))
    .setImage(gif);
  const mentions = [...new Set([actor.id, target.id])];
  return interaction.editReply({ content: mentions.map(id => `<@${id}>`).join(' '), embeds: [embed], allowedMentions: { users: mentions } });
}

const METER_GIFS = {
  aşk: 'love', çekicilik: 'blush', karizma: 'cool', azgınlık: 'nosebleed', delilik: 'laugh',
  masumluk: 'happy', kıskançlık: 'pout', toksiklik: 'smug', yakışıklılık: 'cool', güzellik: 'smile',
  zenginlik: 'celebrate', şanslılık: 'yay', oyunculuk: 'thumbsup', zekâ: 'think', tembellik: 'sleep',
  sadakat: 'handhold', komiklik: 'laugh', enerji: 'dance', coolluk: 'cool', güvenilirlik: 'hug'
};

async function runMeter(interaction, name, info) {
  const one = interaction.options.getUser('kişi1');
  const two = name === 'aşk' ? (interaction.options.getUser('kişi2') || interaction.user) : null;
  await interaction.deferReply();
  const day = Math.floor(Date.now() / 86400000); // Eğlenceli sonuç her gün yenilenir.
  const score = seededPercent(name, one.id, two ? two.id : '', day);
  const comment = score >= 75 ? info.high : score >= 35 ? info.mid : info.low;
  const who = two ? `<@${one.id}> × <@${two.id}>` : `<@${one.id}>`;
  const gif = await getGif(METER_GIFS[name] || 'happy');
  const embed = baseEmbed(interaction, score >= 75 ? COLORS.pink : score >= 35 ? COLORS.purple : COLORS.blue)
    .setTitle(`${info.emoji} ${info.title}: %${score}`)
    .setDescription(`${who}\n\n### ${bar(score)}  **%${score}**\n\n*${comment}*`)
    .setThumbnail(one.displayAvatarURL({ size: 256 }))
    .setImage(gif);
  return interaction.editReply({ embeds: [embed] });
}

async function runOracle(interaction) {
  const n = interaction.commandName;
  const e = baseEmbed(interaction, COLORS.blue);
  if (n === 'avatar') {
    const u = interaction.options.getUser('üye') || interaction.user;
    return interaction.reply({ embeds: [e.setTitle(`🖼️ ${u.username} • Avatar`).setImage(u.displayAvatarURL({ size: 1024, extension: 'png' })).setDescription(`[Yüksek kalitede aç](${u.displayAvatarURL({ size: 4096, extension: 'png' })})`)] });
  }
  if (n === 'sunucu') {
    const g = interaction.guild;
    return interaction.reply({ embeds: [e.setTitle(`🏰 ${g.name}`).setThumbnail(g.iconURL({ size: 512 })).addFields(
      { name: '👥 Üyeler', value: String(g.memberCount), inline: true },
      { name: '📅 Kuruluş', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:D>`, inline: true },
      { name: '👑 Sahip', value: `<@${g.ownerId}>`, inline: true },
      { name: '💬 Kanallar', value: String(g.channels.cache.size), inline: true },
      { name: '🎭 Roller', value: String(g.roles.cache.size), inline: true },
      { name: '🚀 Boost', value: String(g.premiumSubscriptionCount || 0), inline: true }
    )] });
  }
  if (n === 'profil') {
    const u = interaction.options.getUser('üye') || interaction.user;
    const m = await interaction.guild.members.fetch(u.id).catch(() => null);
    return interaction.reply({ embeds: [e.setTitle(`👤 ${u.username} • Profil`).setThumbnail(u.displayAvatarURL({ size: 512 })).addFields(
      { name: 'Kullanıcı', value: `<@${u.id}>`, inline: true }, { name: 'Hesap açılışı', value: `<t:${Math.floor(u.createdTimestamp / 1000)}:R>`, inline: true },
      { name: 'Sunucuya katılım', value: m?.joinedTimestamp ? `<t:${Math.floor(m.joinedTimestamp / 1000)}:R>` : 'Bilinmiyor', inline: true },
      { name: 'En yüksek rol', value: m ? `${m.roles.highest}` : '—', inline: true }
    )] });
  }
  if (n === 'kim') {
    const members = await interaction.guild.members.fetch();
    const pool = [...members.values()].filter(m => !m.user.bot);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return interaction.reply({ embeds: [e.setTitle('🎯 Lores seçimini yaptı').setDescription(`**${interaction.options.getString('soru')}**\n\nCevap kesinlikle ${pick}!`).setThumbnail(pick.user.displayAvatarURL({ size: 256 }))] });
  }
  if (n === 'rastgele-sayı') {
    let min = interaction.options.getInteger('min'), max = interaction.options.getInteger('max');
    if (min > max) [min, max] = [max, min];
    const value = min + Math.floor(Math.random() * (max - min + 1));
    return interaction.reply({ embeds: [e.setTitle('🎰 Rastgele Sayı').setDescription(`**${min}** ile **${max}** arasından seçtim:\n\n# ${value}`)] });
  }
  if (n === 'taşkağıtmakas') {
    const icons = { taş: '🪨', kağıt: '📄', makas: '✂️' }, choices = Object.keys(icons);
    const user = interaction.options.getString('seçim'), bot = choices[Math.floor(Math.random() * 3)];
    const win = (user === 'taş' && bot === 'makas') || (user === 'kağıt' && bot === 'taş') || (user === 'makas' && bot === 'kağıt');
    const title = user === bot ? '🤝 Berabere!' : win ? '🏆 Kazandın!' : '🤖 Lores kazandı!';
    return interaction.reply({ embeds: [e.setTitle(title).setDescription(`Sen: ${icons[user]} **${user}**\nLores: ${icons[bot]} **${bot}**`)] });
  }
  if (n === 'zar-at') {
    const count = interaction.options.getInteger('adet') || 1, sides = interaction.options.getInteger('yüz') || 6;
    const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
    return interaction.reply({ embeds: [e.setTitle('🎲 Zarlar atıldı!').setDescription(`**${count}d${sides}:** ${rolls.map(x => `\`${x}\``).join(' ')}\n\n**Toplam:** ${rolls.reduce((a,b) => a+b, 0)}`)] });
  }
  if (n === 'yazı-tura') {
    const result = Math.random() < .5 ? 'YAZI' : 'TURA';
    return interaction.reply({ embeds: [e.setTitle('🪙 Para havada dönüyor…').setDescription(`# ${result}\nKader kararını verdi!`)] });
  }
  if (n === 'yüzde') {
    const topic = interaction.options.getString('konu'), score = seededPercent(topic, interaction.user.id, Math.floor(Date.now()/86400000));
    return interaction.reply({ embeds: [e.setTitle(`📊 Olma ihtimali: %${score}`).setDescription(`**${topic}**\n\n### ${bar(score)}  **%${score}**`)] });
  }
  if (n === 'iltifat') {
    const u = interaction.options.getUser('üye');
    return interaction.reply({ content: `<@${u.id}>`, embeds: [e.setColor(COLORS.pink).setTitle('💐 Sana bir iltifat var!').setDescription(`> ${complimentText()}\n\n— <@${interaction.user.id}>`).setThumbnail(u.displayAvatarURL({ size: 256 }))] });
  }
  if (n === 'fal') {
    return interaction.reply({ embeds: [e.setColor(COLORS.purple).setTitle('🔮 Lores Kristal Küresi').setDescription(`*Dumanlar dağılıyor…*\n\n${fortuneText()}`)] });
  }
  if (n === 'motto') {
    return interaction.reply({ embeds: [e.setColor(COLORS.gold).setTitle('🌟 Günün Mottosu').setDescription(`> **${mottoText()}**`)] });
  }
  const key = n === 'gerçekmi' ? 'gerçek' : n;
  const answers = ORACLES[key] || ORACLES.bugün;
  const question = interaction.options.getString('seçenekler') || interaction.options.getString('iddia') || interaction.options.getString('soru') || 'Bugün seni ne bekliyor?';
  return interaction.reply({ embeds: [e.setTitle('🔮 Lores cevaplıyor').setDescription(`**${question}**\n\n> ${pickFresh(`oracle:${key}`, () => randomOf(answers), Math.min(answers.length - 1, 12))}`)] });
}

async function handleFunInteraction(interaction) {
  const name = interaction.commandName;
  if (ACTIONS[name]) { await runAction(interaction, name, ACTIONS[name]); return true; }
  if (METERS[name]) { await runMeter(interaction, name, METERS[name]); return true; }
  if (oracleCommands.some(c => c.name === name || c.toJSON().name === name)) { await runOracle(interaction); return true; }
  return false;
}

module.exports = { funSlashCommands, handleFunInteraction, ACTIONS, METERS };
