/**
 * Eğlence / kumar oyunlarının mantığı (hem Discord komutları hem panel kullanır).
 */
const eco = require('./economy');

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

module.exports = { placeBet, settle, coinflip, dice };
