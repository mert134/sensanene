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
        meta: raw.meta || { created: Date.now() }
      };
    }
  } catch (err) {
    console.error('[store] Veritabanı okunamadı:', err.message);
  }
}

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    } catch (err) {
      console.error('[store] Veritabanı yazılamadı:', err.message);
    }
  }, 250);
}

load();
module.exports = { db, save, DATA_DIR };
