/**
 * Basit JSON veritabanı katmanı.
 * Render'da kalıcı disk yoksa veriler yeniden başlatmada sıfırlanır;
 * kalıcılık için Render "Disk" ekleyip DATA_DIR=/data vermen yeterli.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_DB = {
  settings: {},   // guildId -> ayarlar
  wallets: {},    // guildId -> userId -> { coins, lastDaily, wins, losses, games }
  warnings: {},   // guildId -> userId -> [uyarı]
  logs: {},       // guildId -> [kayıt]
  guard: {},      // guildId -> guard (koruma) yapılandırması
  guardEvents: {},// guildId -> [guard olayı]
  guardPolicy: {},// operatör politikası: whitelist/blacklist + otomatik pasifleştirme
  guardOps: [],   // operatör işlemleri (yalnızca panelde görünür, sunucuya sızmaz)
  meta: { created: Date.now() }
};

let db = JSON.parse(JSON.stringify(DEFAULT_DB));

function load() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      db = {
        settings: raw.settings || {},
        wallets: raw.wallets || {},
        warnings: raw.warnings || {},
        logs: raw.logs || {},
        guard: raw.guard || {},
        guardEvents: raw.guardEvents || {},
        guardPolicy: raw.guardPolicy || {},
        guardOps: Array.isArray(raw.guardOps) ? raw.guardOps : [],
        meta: raw.meta || { created: Date.now() }
      };
    }
  } catch (err) {
    console.error('[store] Veritabanı okunamadı:', err.message);
  }
}

/**
 * Yazma işi event loop'u kilitlememeli: toplu mesaj gönderimi gibi yoğun
 * işlemlerde her kayıtta dosyaya senkron yazmak botu ve paneli donduruyordu.
 * Bu yüzden yazmalar asenkron, sıkıştırılmış (girintisiz) ve birleştirilir:
 * art arda gelen değişiklikler tek yazmada toplanır, en geç MAX_INTERVAL'de diske iner.
 */
const SAVE_DEBOUNCE_MS = 600;
const SAVE_MAX_INTERVAL_MS = 4000;

let saveTimer = null;
let writing = false;
let pendingWrite = false;
let lastWriteAt = 0;

async function flush() {
  if (writing) {
    pendingWrite = true;
    return;
  }
  writing = true;
  const snapshot = JSON.stringify(db);
  try {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    await fs.promises.writeFile(DB_FILE, snapshot);
    lastWriteAt = Date.now();
  } catch (err) {
    console.error('[store] Veritabanı yazılamadı:', err.message);
  } finally {
    writing = false;
    if (pendingWrite) {
      pendingWrite = false;
      scheduleSave();
    }
  }
}

function scheduleSave() {
  if (saveTimer) return;
  const sinceLastWrite = Date.now() - lastWriteAt;
  const wait = Math.max(0, Math.min(SAVE_DEBOUNCE_MS, SAVE_MAX_INTERVAL_MS - sinceLastWrite));
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flush();
  }, wait);
}

function save() {
  scheduleSave();
}

load();

// Süreç kapanırken bekleyen değişiklikleri senkron olarak diske indir.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    try {
      if (saveTimer || writing || pendingWrite) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(DB_FILE, JSON.stringify(db));
      }
    } catch (err) {
      console.error('[store] Kapanışta yazılamadı:', err.message);
    }
    process.exit(0);
  });
}

module.exports = { db, save, flush, DATA_DIR };
