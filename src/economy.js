/**
 * Sunucu bazlı ekonomi (coin) sistemi.
 */
const { db, save } = require('./store');

const START_BALANCE = 250;
const DAILY_AMOUNT = 200;
const DAILY_COOLDOWN = 1000 * 60 * 60 * 20; // 20 saat

function wallet(guildId, userId) {
  if (!db.wallets[guildId]) db.wallets[guildId] = {};
  let w = db.wallets[guildId][userId];
  if (!w) {
    w = { coins: START_BALANCE, lastDaily: 0, wins: 0, losses: 0, games: 0 };
    db.wallets[guildId][userId] = w;
    save();
  }
  return w;
}

function getCoins(guildId, userId) {
  return wallet(guildId, userId).coins;
}

function addCoins(guildId, userId, amount) {
  const w = wallet(guildId, userId);
  w.coins = Math.max(0, w.coins + amount);
  save();
  return w.coins;
}

function record(guildId, userId, result) {
  const w = wallet(guildId, userId);
  w.games += 1;
  if (result === 'win') w.wins += 1;
  if (result === 'lose') w.losses += 1;
  save();
}

function daily(guildId, userId) {
  const w = wallet(guildId, userId);
  const now = Date.now();
  const diff = now - (w.lastDaily || 0);
  if (diff < DAILY_COOLDOWN) {
    return { ok: false, remaining: DAILY_COOLDOWN - diff };
  }
  w.lastDaily = now;
  w.coins += DAILY_AMOUNT;
  save();
  return { ok: true, amount: DAILY_AMOUNT, balance: w.coins };
}

function leaderboard(guildId, limit = 10) {
  const guildWallets = db.wallets[guildId] || {};
  return Object.entries(guildWallets)
    .map(([userId, w]) => ({ userId, coins: w.coins || 0, wins: w.wins || 0, games: w.games || 0 }))
    .sort((a, b) => b.coins - a.coins)
    .slice(0, limit);
}

module.exports = {
  START_BALANCE,
  DAILY_AMOUNT,
  wallet,
  getCoins,
  addCoins,
  record,
  daily,
  leaderboard
};
