/**
 * Eğlence / kumar oyunlarının mantığı (hem Discord komutları hem panel kullanır).
 */
const eco = require('./economy');

const SLOT_SYMBOLS = ['🍒', '🍋', '🍇', '🍉', '🔔', '⭐', '💎', '7️⃣'];

// Her sembolün ağırlığı (küçük = daha sık çıkar)
const WEIGHTS = { '🍒': 30, '🍋': 25, '🍇': 20, '🍉': 14, '🔔': 8, '⭐': 6, '💎': 2, '7️⃣': 1 };
const TOTAL_WEIGHT = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

function weightedPick() {
  let roll = Math.random() * TOTAL_WEIGHT;
  for (const symbol of SLOT_SYMBOLS) {
    roll -= WEIGHTS[symbol];
    if (roll <= 0) return symbol;
  }
  return SLOT_SYMBOLS[0];
}

function payoutMultiplier(reels) {
  const [a, b, c] = reels;
  if (a === b && b === c) {
    const table = { '7️⃣': 50, '💎': 22, '⭐': 14, '🔔': 10, '🍉': 8, '🍇': 6, '🍋': 5, '🍒': 4 };
    return table[a] || 4;
  }
  // İki aynı sembol: bahsin 1.25 katı (hafif kâr, uzun vadede ev avantajı)
  if (a === b || b === c || a === c) return 1.25;
  return 0;
}

/**
 * Slot çevirir. Bahis zaten düşülmemiş olmalı, bakiye kontrolü çağıran tarafta.
 * @returns { reels, multiplier, payout, profit }
 */
function spin(bet) {
  const reels = [weightedPick(), weightedPick(), weightedPick()];
  const multiplier = payoutMultiplier(reels);
  const payout = Math.floor(bet * multiplier);
  return { reels, multiplier, payout, profit: payout - bet };
}

/**
 * Bahisli tek oyunluk işlem: parayı düşer, sonucu ekler.
 */
function placeBet(guildId, userId, bet) {
  const coins = eco.getCoins(guildId, userId);
  if (!Number.isFinite(bet) || bet < 10) return { error: 'Bahis en az 10 coin olmalı.' };
  if (bet > coins) return { error: `Yeterli coin yok. Bakiyen: **${coins}** coin.` };
  eco.addCoins(guildId, userId, -bet);
  return { ok: true };
}

function settle(guildId, userId, bet, payout, won) {
  if (payout > 0) eco.addCoins(guildId, userId, payout);
  eco.record(guildId, userId, won ? 'win' : 'lose');
  return eco.getCoins(guildId, userId);
}

// --- Yazı tura ---
function coinflip(guildId, userId, bet, pick) {
  const start = placeBet(guildId, userId, bet);
  if (start.error) return { error: start.error };
  const result = Math.random() < 0.5 ? 'yazı' : 'tura';
  const won = pick === result;
  const payout = won ? bet * 2 : 0;
  const balance = settle(guildId, userId, bet, payout, won);
  return { result, won, payout, balance, bet };
}

// --- Zar ---
function dice(guildId, userId, bet, guess) {
  if (!Number.isInteger(guess) || guess < 1 || guess > 6) {
    return { error: '1 ile 6 arasında bir sayı seç.' };
  }
  const start = placeBet(guildId, userId, bet);
  if (start.error) return { error: start.error };
  const result = 1 + Math.floor(Math.random() * 6);
  const won = result === guess;
  const payout = won ? bet * 6 : 0;
  const balance = settle(guildId, userId, bet, payout, won);
  return { result, won, payout, balance, bet };
}

module.exports = { spin, placeBet, settle, coinflip, dice, SLOT_SYMBOLS };
