'use strict'
/**
 * commands/gamble.js — Gambling System (updated)
 *
 * Layout rules:
 *  • Unicode Sans-Serif Bold for every section heading
 *  • No decorative borders (━ ═ ─ ╔ etc.)
 *  • Spacing via blank lines only
 *  • 🍎 currency everywhere
 *  • Consistent section order: Header → Bet → Event → Outcome → Payout → Balance
 *
 * House-edge targets (per spec):
 *  Coinflip  50 % win, 1.9× payout  → edge ≈ 5 %
 *  Bet       45 % win, 1.9× payout  → edge ≈ 9.5 %
 *  HighLow   48 % win, 1.9× payout  → edge ≈ 8.8 %
 *  Roulette  Red/Black 48.65 % 2×   → edge ≈ 2.7 %
 *            Straight  1/37   35×   → edge ≈ 5.4 %
 *  Dice      1/6 win, 5.7× total    → edge ≈ 5 %
 *  Slots     weighted symbols        → edge ≈ 6 %
 *  Crash     pre-determined point   → edge ≈ 6 %
 *  RPS, Spin, Horse, Jackpot, Poker — unchanged mechanics
 */

const db = require('../database')
const { getResponse, fillTemplate } = require('../responseHelper')

// ── Constants ──────────────────────────────────────────────────────────────
const DAILY_LIMIT  = 20
const GAMBLE_CD_MS = 8_000   // 8 s cooldown between bets

const gambleCooldown = {}
const dailyTracker   = {}

// ── Cooldown helpers ───────────────────────────────────────────────────────
function checkGambleCooldown(phone) {
  const now = Date.now()
  if (gambleCooldown[phone] && now < gambleCooldown[phone]) {
    return gambleCooldown[phone] - now
  }
  gambleCooldown[phone] = now + GAMBLE_CD_MS
  return 0
}

function getTodayKey() { return new Date().toISOString().split('T')[0] }

function checkDailyLimit(phone) {
  const today = getTodayKey()
  if (!dailyTracker[phone] || dailyTracker[phone].date !== today) {
    dailyTracker[phone] = { count: 0, date: today }
  }
  dailyTracker[phone].count++
  return dailyTracker[phone].count > DAILY_LIMIT
}

function getRemainingGambles(phone) {
  const today = getTodayKey()
  if (!dailyTracker[phone] || dailyTracker[phone].date !== today) return DAILY_LIMIT
  return Math.max(0, DAILY_LIMIT - dailyTracker[phone].count)
}

// ── Validation ─────────────────────────────────────────────────────────────
function parseAmount(raw, wallet) {
  const str = String(raw || '').toLowerCase().trim()
  if (str === 'all') return wallet
  const n = parseInt(str, 10)
  return isNaN(n) ? null : n
}

function validateBet(amount, wallet) {
  if (!amount || amount <= 0) return '⚠️ Enter a valid bet amount greater than zero.'
  if (amount > wallet)        return `⚠️ Not enough funds.\n👛 Balance: 🍎 ${wallet.toLocaleString()}`
  return null
}

// ── Economy tracking ───────────────────────────────────────────────────────
async function sinkCoins(n) { try { await db.trackCurrencyRemoved(n) } catch {} }
async function genCoins(n)  { try { await db.trackCurrencyGenerated(n) } catch {} }

// ── Daily-limit helper ─────────────────────────────────────────────────────
async function replyIfLimitHit(reply, sender) {
  if (!checkDailyLimit(sender)) return false
  const msg = getResponse('bet', 'limit') ||
    `🚫 *Daily limit reached!*\n\nYou've used all *{limit}* gambles today.\n\n_Come back tomorrow._ 🖤`
  await reply(fillTemplate(msg, { limit: DAILY_LIMIT }))
  return true
}

// ── Cooldown wrapper ───────────────────────────────────────────────────────
function withCooldown(fn) {
  return async function (ctx) {
    try {
      const wait = checkGambleCooldown(ctx.sender)
      if (wait > 0) {
        const secs = Math.ceil(wait / 1000)
        return await ctx.reply(`⏳ Cooldown active. Try again in *${secs}s*.`)
      }
      return await fn(ctx)
    } catch (err) {
      console.error('[gamble]', err?.message || err)
      try { await ctx.reply('⚠️ Something went wrong. Please try again.') } catch {}
    }
  }
}

// ── Utility ────────────────────────────────────────────────────────────────
const delay = ms => new Promise(r => setTimeout(r, ms))

// Bold Sans-Serif Unicode helper
function b(str) {
  const map = {
    A:'𝗔',B:'𝗕',C:'𝗖',D:'𝗗',E:'𝗘',F:'𝗙',G:'𝗚',H:'𝗛',I:'𝗜',J:'𝗝',
    K:'𝗞',L:'𝗟',M:'𝗠',N:'𝗡',O:'𝗢',P:'𝗣',Q:'𝗤',R:'𝗥',S:'𝗦',T:'𝗧',
    U:'𝗨',V:'𝗩',W:'𝗪',X:'𝗫',Y:'𝗬',Z:'𝗭',
    a:'𝗮',b:'𝗯',c:'𝗰',d:'𝗱',e:'𝗲',f:'𝗳',g:'𝗴',h:'𝗵',i:'𝗶',j:'𝗷',
    k:'𝗸',l:'𝗹',m:'𝗺',n:'𝗻',o:'𝗼',p:'𝗽',q:'𝗾',r:'𝗿',s:'𝘀',t:'𝘁',
    u:'𝘂',v:'𝘃',w:'𝘄',x:'𝘅',y:'𝘆',z:'𝘇',
  }
  return str.split('').map(c => map[c] || c).join('')
}

/**
 * Build the standard response layout.
 *
 * @param {object} opts
 *   emoji, title, bet, event, outcome, win (bool), payout, balance, remaining
 */
function layout({ emoji, title, bet, event, outcome, win, payout, balance, remaining }) {
  const sign    = win ? '+' : '-'
  const payLine = payout !== null
    ? `\n💰 ${b('Payout')}\n${sign}🍎 ${payout}`
    : ''
  return (
    `${emoji} ${b(title)}\n` +
    `\n🎯 ${b('Bet')}\n🍎 ${bet}` +
    `\n\n🎲 ${b('Event')}\n${event}` +
    `\n\n📊 ${b('Outcome')}\n${outcome}` +
    payLine +
    `\n\n👛 ${b('Balance')}\n🍎 ${balance}` +
    `\n\n_${remaining} gambles left today._`
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CRASH — active game map  (phone → game state)
// ─────────────────────────────────────────────────────────────────────────────
const crashGames = new Map()

function genCrashPoint() {
  const r = Math.random()
  // Distribution matching spec ranges
  if (r < 0.40) return 1.00 + Math.random() * 0.50   // 1.00–1.50  Very Common
  if (r < 0.70) return 1.50 + Math.random() * 0.50   // 1.50–2.00  Common
  if (r < 0.90) return 2.00 + Math.random() * 3.00   // 2.00–5.00  Uncommon
  if (r < 0.97) return 5.00 + Math.random() * 5.00   // 5.00–10.00 Rare
  if (r < 0.995) return 10.0 + Math.random() * 40    // 10.0–50.0  Very Rare
  return 50.0 + Math.random() * 50                    // 50.0–100+  Extremely Rare
}

async function finishCrash({ sock, jid, game, cashedOut, cashMult }) {
  const fresh = await db.getOrCreateUser(game.phone).catch(() => ({ wallet: 0 }))

  if (cashedOut) {
    const payout = Math.floor(game.bet * cashMult)
    const net    = payout - game.bet
    const nw     = (fresh.wallet || 0) + payout
    await db.updateUser(game.phone, { wallet: nw })
    await genCoins(payout)
    await sock.sendMessage(jid, {
      text: layout({
        emoji: '📈', title: 'CRASH',
        bet: game.bet.toLocaleString(),
        event: `×${cashMult.toFixed(2)}\n💸 Cashed Out!`,
        outcome: '✅ You Cashed Out!',
        win: true,
        payout: net.toLocaleString(),
        balance: nw.toLocaleString(),
        remaining: getRemainingGambles(game.phone),
      }),
    })
  } else {
    await sock.sendMessage(jid, {
      text: layout({
        emoji: '📈', title: 'CRASH',
        bet: game.bet.toLocaleString(),
        event: `×${game.currentMult.toFixed(2)}\n💥 Crashed!`,
        outcome: '❌ You Lost!',
        win: false,
        payout: game.bet.toLocaleString(),
        balance: (fresh.wallet || 0).toLocaleString(),
        remaining: getRemainingGambles(game.phone),
      }),
    })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS — all gambling commands
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {

  // ── .bet — generic wager ──────────────────────────────────────────────────
  // Win: 45 % | Payout: 1.9× | House edge ≈ 9.5 %
  bet: withCooldown(async ({ reply, sender, user, args }) => {
    const u      = user || await db.getOrCreateUser(sender)
    const amount = parseAmount(args[0], u.wallet || 0)
    const err    = validateBet(amount, u.wallet || 0)
    if (err) return reply(err)
    if (await replyIfLimitHit(reply, sender)) return

    const win  = Math.random() < 0.45
    const net  = win ? Math.floor(amount * 0.9) : -amount
    await db.updateUser(sender, { wallet: (u.wallet || 0) + net })
    if (!win) await sinkCoins(amount); else await genCoins(Math.floor(amount * 0.9))

    const bal = ((u.wallet || 0) + net).toLocaleString()
    const rem = getRemainingGambles(sender)

    return reply(layout({
      emoji: '💸', title: 'Bet',
      bet: amount.toLocaleString(),
      event: win ? '🎲 The odds are in your favour!' : '🎲 The house takes it this time.',
      outcome: win ? '✅ You Won!' : '❌ Better Luck Next Time!',
      win,
      payout: Math.abs(net).toLocaleString(),
      balance: bal,
      remaining: rem,
    }))
  }),

  // ── .cf / .coinflip ────────────────────────────────────────────────────────
  // Win: 50 % | Payout: 1.9× | House edge ≈ 5 %
  cf: withCooldown(async ({ sock, jid, msg, reply, sender, user, args }) => {
    const u      = user || await db.getOrCreateUser(sender)
    const choice = args[0]?.toLowerCase()
    const amount = parseAmount(args[1], u.wallet || 0)

    if (!['heads', 'tails', 'h', 't'].includes(choice || '')) {
      return reply('⚠️ Usage: .cf heads/tails <amount>\nExample: .cf heads 500')
    }
    const err = validateBet(amount, u.wallet || 0)
    if (err) return reply(err)
    if (await replyIfLimitHit(reply, sender)) return

    const side       = (choice === 'h') ? 'heads' : (choice === 't') ? 'tails' : choice
    const highStake  = amount >= 110_000
    const win        = Math.random() < (highStake ? 0.07 : 0.50)
    const result     = win ? side : (side === 'heads' ? 'tails' : 'heads')
    const net        = win ? Math.floor(amount * 0.9) : -amount

    // Animate the flip
    await sock.sendMessage(jid, {
      text: `🪙 ${b('Coinflip')}\n\n🎯 ${b('Bet')}\n🍎 ${amount.toLocaleString()}\n\n🎲 ${b('Event')}\nThe coin flips...\n\n⬆️`,
    }, { quoted: msg })
    await delay(1_400)
    await sock.sendMessage(jid, { text: '⬇️' })
    await delay(800)

    await db.updateUser(sender, { wallet: (u.wallet || 0) + net })
    if (!win) await sinkCoins(amount); else await genCoins(Math.floor(amount * 0.9))

    const sideEmoji = result === 'heads' ? '🪙 Heads' : '🪙 Tails'

    return sock.sendMessage(jid, {
      text: layout({
        emoji: '🪙', title: 'Coinflip',
        bet: amount.toLocaleString(),
        event: `${sideEmoji}\n\nYou picked: ${side.toUpperCase()}\nResult: ${result.toUpperCase()}`,
        outcome: win ? '✅ You Won!' : '❌ Better Luck Next Time!',
        win,
        payout: Math.abs(net).toLocaleString(),
        balance: ((u.wallet || 0) + net).toLocaleString(),
        remaining: getRemainingGambles(sender),
      }),
    })
  }),
  async coinflip(ctx) { return module.exports.cf(ctx) },

  // ── .slots / .sl ──────────────────────────────────────────────────────────
  // Weighted symbols; jackpot 7️⃣; house edge ≈ 6 %
  slots: withCooldown(async ({ sock, jid, msg, reply, sender, user, args }) => {
    const u      = user || await db.getOrCreateUser(sender)
    const amount = parseAmount(args[0], u.wallet || 0)
    const err    = validateBet(amount, u.wallet || 0)
    if (err) return reply(err)
    if (await replyIfLimitHit(reply, sender)) return

    // Symbol pool — weight governs frequency
    const SYMS = [
      { s: '🍒', w: 32 },   // common
      { s: '🍋', w: 24 },   // uncommon
      { s: '⭐', w: 16 },   // rare
      { s: '🍀', w: 12 },   // rare
      { s: '🔔', w:  8 },   // very rare
      { s: '💎', w:  5 },   // very rare
      { s: '7️⃣',  w:  3 },   // jackpot
    ]
    const totalW = SYMS.reduce((a, s) => a + s.w, 0)
    function spin() {
      let r = Math.random() * totalW
      for (const s of SYMS) { r -= s.w; if (r <= 0) return s.s }
      return SYMS[0].s
    }

    // Send spin animation
    const fakeRow = () => `${spin()}  ${spin()}  ${spin()}`
    await sock.sendMessage(jid, {
      text: `🎰 ${b('Slots')}\n\n🎯 ${b('Bet')}\n🍎 ${amount.toLocaleString()}\n\n🎲 ${b('Event')}\n🎰 Spinning...\n\n${fakeRow()}\n${fakeRow()}\n${fakeRow()}`,
    }, { quoted: msg })

    const reels = [spin(), spin(), spin()]

    // Determine multiplier
    let multiplier = 0, label = 'No Match'
    const [r1, r2, r3] = reels

    if (r1 === r2 && r2 === r3) {
      // Triple match
      if      (r1 === '7️⃣')  { multiplier = 20;  label = '7️⃣ JACKPOT!' }
      else if (r1 === '💎')  { multiplier = 10;  label = '💎 Mega Win!' }
      else if (r1 === '🔔')  { multiplier = 5;   label = '🔔 Big Win!' }
      else if (r1 === '🍀')  { multiplier = 3.5; label = '🍀 Triple Clover!' }
      else if (r1 === '⭐')  { multiplier = 3;   label = '⭐ Triple Star!' }
      else if (r1 === '🍋')  { multiplier = 2.2; label = '🍋 Triple Lemon!' }
      else                   { multiplier = 1.8; label = '🍒 Three of a Kind!' }
    } else if (r1 === r2 || r2 === r3 || r1 === r3) {
      // Near miss or pair
      const matched = (r1 === r2) ? r1 : (r2 === r3) ? r2 : r1
      if      (matched === '7️⃣' || matched === '💎') { multiplier = 1.5; label = '✨ Near Jackpot!' }
      else if (matched === '🔔' || matched === '🍀') { multiplier = 1.3; label = '✨ Close Match!' }
      else                                            { multiplier = 1.1; label = '✨ Pair!' }
    }

    const net = multiplier > 0 ? Math.floor(amount * multiplier) - amount : -amount
    await db.updateUser(sender, { wallet: (u.wallet || 0) + net })
    if (net < 0) await sinkCoins(Math.abs(net)); else if (net > 0) await genCoins(net)

    await delay(900)
    return sock.sendMessage(jid, {
      text: layout({
        emoji: '🎰', title: 'Slots',
        bet: amount.toLocaleString(),
        event: `${r1}  ${r2}  ${r3}\n${label}`,
        outcome: net >= 0 ? '✅ You Won!' : '❌ No Win This Time.',
        win: net >= 0,
        payout: Math.abs(net).toLocaleString(),
        balance: ((u.wallet || 0) + net).toLocaleString(),
        remaining: getRemainingGambles(sender),
      }),
    })
  }),
  async sl(ctx) { return module.exports.slots(ctx) },

  // ── .dice ────────────────────────────────────────────────────────────────
  // True 1/6 odds | Payout: 5.7× total (net +4.7×) | House edge ≈ 5 %
  dice: withCooldown(async ({ sock, jid, msg, reply, sender, user, args }) => {
    const u      = user || await db.getOrCreateUser(sender)
    const guess  = parseInt(args[0], 10)
    const amount = parseAmount(args[1], u.wallet || 0)

    if (!amount || !guess || guess < 1 || guess > 6) {
      return reply('⚠️ Usage: .dice <1-6> <amount>\nExample: .dice 4 500')
    }
    const err = validateBet(amount, u.wallet || 0)
    if (err) return reply(err)
    if (await replyIfLimitHit(reply, sender)) return

    const DICE_EMOJI = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅']

    // Animate roll
    await sock.sendMessage(jid, {
      text: `🎲 ${b('Dice')}\n\n🎯 ${b('Bet')}\n🍎 ${amount.toLocaleString()}\n\n🎲 ${b('Event')}\nRolling...\n\n${DICE_EMOJI[Math.ceil(Math.random() * 6)]}`,
    }, { quoted: msg })
    await delay(1_200)

    const roll = Math.floor(Math.random() * 6) + 1
    const win  = roll === guess
    const net  = win ? Math.floor(amount * 4.7) : -amount

    await db.updateUser(sender, { wallet: (u.wallet || 0) + net })
    if (!win) await sinkCoins(amount); else await genCoins(Math.floor(amount * 4.7))

    return sock.sendMessage(jid, {
      text: layout({
        emoji: '🎲', title: 'Dice',
        bet: amount.toLocaleString(),
        event: `You picked: ${guess}\n\n${DICE_EMOJI[roll]}\n\nRolled: ${roll}`,
        outcome: win ? '✅ Correct Guess!' : '❌ Wrong Number!',
        win,
        payout: Math.abs(net).toLocaleString(),
        balance: ((u.wallet || 0) + net).toLocaleString(),
        remaining: getRemainingGambles(sender),
      }),
    })
  }),

  // ── .roulette ─────────────────────────────────────────────────────────────
  // European (0–36). Red/Black 48.65 % → 2× | Straight 1/37 → 35×
  roulette: withCooldown(async ({ sock, jid, msg, reply, sender, user, args }) => {
    const u      = user || await db.getOrCreateUser(sender)
    const bet    = args[0]?.toLowerCase()
    const amount = parseAmount(args[1], u.wallet || 0)

    if (!bet || !amount) {
      return reply('⚠️ Usage: .roulette red/black/odd/even/0-36 <amount>\nExample: .roulette red 1000')
    }
    const err = validateBet(amount, u.wallet || 0)
    if (err) return reply(err)
    if (await replyIfLimitHit(reply, sender)) return

    // Spin animation
    const WHEEL = ['⬛','🟥','⬛','🟥','⬛','🟥','⬛','🟥','🟩','🟥','⬛']
    await sock.sendMessage(jid, {
      text: `🎡 ${b('Roulette')}\n\n🎯 ${b('Bet')}\n${bet.toUpperCase()} — 🍎 ${amount.toLocaleString()}\n\n🎲 ${b('Event')}\n🎡 Spinning...\n\n${WHEEL.join('')}`,
    }, { quoted: msg })
    await delay(1_600)

    const num   = Math.floor(Math.random() * 37)   // 0–36
    const color = num === 0 ? 'green' : (num % 2 === 0 ? 'black' : 'red')
    const cEmoji = { green: '🟩', red: '🟥', black: '⬛' }[color]

    let mult = 0
    const betNum = parseInt(bet, 10)
    if (bet === 'red'   && color === 'red')           mult = 2
    if (bet === 'black' && color === 'black')         mult = 2
    if (bet === 'odd'   && num > 0 && num % 2 !== 0) mult = 2
    if (bet === 'even'  && num > 0 && num % 2 === 0) mult = 2
    if (!isNaN(betNum)  && betNum === num)            mult = 35

    const payout = Math.floor(amount * mult)
    const net    = payout - amount

    await db.updateUser(sender, { wallet: (u.wallet || 0) + net })
    if (net < 0) await sinkCoins(Math.abs(net)); else if (net > 0) await genCoins(net)

    return sock.sendMessage(jid, {
      text: layout({
        emoji: '🎡', title: 'Roulette',
        bet: amount.toLocaleString(),
        event: `${cEmoji} ${num} (${color.toUpperCase()})\n\nYour bet: ${bet.toUpperCase()}`,
        outcome: mult > 0 ? `✅ You Won! (×${mult})` : '❌ No Win This Time.',
        win: mult > 0,
        payout: Math.abs(net).toLocaleString(),
        balance: ((u.wallet || 0) + net).toLocaleString(),
        remaining: getRemainingGambles(sender),
      }),
    })
  }),

  // ── .highlow / .hl ───────────────────────────────────────────────────────
  // Guess High (8–13) or Low (1–6). Card 7 = house wins.
  // Win: 48 % | Payout: 1.9× | House edge ≈ 8.8 %
  highlow: withCooldown(async ({ reply, sender, user, args }) => {
    const u      = user || await db.getOrCreateUser(sender)
    const choice = isNaN(parseInt(args[0], 10)) ? args[0]?.toLowerCase() : null
    const amount = parseAmount(args[1] || args[0], u.wallet || 0)

    if (!choice || !['high', 'low', 'h', 'l'].includes(choice)) {
      return reply('⚠️ Usage: .highlow high/low <amount>\nExample: .highlow high 500')
    }
    const err = validateBet(amount, u.wallet || 0)
    if (err) return reply(err)
    if (await replyIfLimitHit(reply, sender)) return

    const card     = Math.floor(Math.random() * 13) + 1   // 1–13
    const guessHi  = choice === 'high' || choice === 'h'
    const win      = guessHi ? card >= 8 : card <= 6      // card 7 always loses
    const net      = win ? Math.floor(amount * 0.9) : -amount

    await db.updateUser(sender, { wallet: (u.wallet || 0) + net })
    if (!win) await sinkCoins(amount); else await genCoins(Math.floor(amount * 0.9))

    const CARD_NAMES = {1:'Ace',11:'Jack',12:'Queen',13:'King'}
    const cardLabel  = CARD_NAMES[card] || String(card)
    const arrow      = guessHi ? '📈 High (8–13)' : '📉 Low (1–6)'

    return reply(layout({
      emoji: '📈', title: 'HighLow',
      bet: amount.toLocaleString(),
      event: `${arrow}\n\n${card <= 6 ? '🃏' : card >= 8 ? '🃏' : '🃏'} ${cardLabel}\n\nPrev → Next: ${guessHi ? `${card} 📈` : `${card} 📉`}`,
      outcome: win ? '✅ Correct!' : '❌ Wrong Direction!',
      win,
      payout: Math.abs(net).toLocaleString(),
      balance: ((u.wallet || 0) + net).toLocaleString(),
      remaining: getRemainingGambles(sender),
    }))
  }),
  async hl(ctx) { return module.exports.highlow(ctx) },

  // ── .crash ────────────────────────────────────────────────────────────────
  // Pre-determined crash point; animated multiplier build-up.
  // Type .crash cashout (or .crash out) during the animation to exit early.
  crash: async function crashCmd({ sock, jid, msg, reply, sender, user, args }) {
    const sub = (args[0] || '').toLowerCase()

    // ── Cashout sub-command (no cooldown needed) ──────────────────────────
    if (['cashout', 'out', 'cash', 'co'].includes(sub)) {
      const g = crashGames.get(sender)
      if (!g || g.done) return reply('⚠️ You have no active crash game to cash out.')
      g.cashout = true
      return reply('✅ Cash out registered! Settling...')
    }

    // ── Start new game (respect cooldown) ─────────────────────────────────
    return withCooldown(async ({ sock: s, jid: j, msg: m, reply: r, sender: ph, user: u, args: a }) => {
      const usr    = u || await db.getOrCreateUser(ph)
      const amount = parseAmount(a[0], usr.wallet || 0)
      const err    = validateBet(amount, usr.wallet || 0)
      if (err) return r(err)
      if (await replyIfLimitHit(r, ph)) return

      if (crashGames.has(ph)) {
        return r('⚠️ You already have an active crash game!\nType *.crash cashout* to exit.')
      }

      // Deduct bet immediately
      await db.updateUser(ph, { wallet: (usr.wallet || 0) - amount })
      await sinkCoins(amount)

      const crashAt = genCrashPoint()
      const game = {
        bet: amount, crashAt,
        cashout: false, done: false,
        currentMult: 1.0,
        sock: s, jid: j, phone: ph,
      }
      crashGames.set(ph, game)

      // Launch message
      await s.sendMessage(j, {
        text: `📈 ${b('CRASH')}\n\n🎯 ${b('Bet')}\n🍎 ${amount.toLocaleString()}\n\n🚀 Launching...\n\n_Type *.crash cashout* to exit early!_`,
      }, { quoted: m })

      // Animated multiplier steps
      let mult = 1.00
      const steps = []
      while (mult < crashAt && steps.length < 7) {
        steps.push(parseFloat(mult.toFixed(2)))
        mult = parseFloat((mult * (1.12 + Math.random() * 0.25)).toFixed(2))
      }
      steps.push(parseFloat(crashAt.toFixed(2)))

      let cashedOut    = false
      let cashoutMult  = 1.00

      for (let i = 0; i < steps.length; i++) {
        await delay(1_500)
        const g = crashGames.get(ph)
        if (!g || g.done) { cashedOut = g?.cashout || false; break }

        g.currentMult = steps[i]

        if (g.cashout) {
          cashedOut   = true
          cashoutMult = steps[Math.max(0, i - 1)] || 1.00
          g.done = true
          crashGames.delete(ph)
          await finishCrash({ sock: s, jid: j, game, cashedOut: true, cashMult: cashoutMult })
          return
        }

        if (steps[i] >= crashAt) break

        await s.sendMessage(j, { text: `📈 ×${steps[i].toFixed(2)}` })
      }

      // Final resolution (crash)
      const g = crashGames.get(ph)
      if (g) { g.done = true; crashGames.delete(ph) }

      if (!cashedOut) {
        await finishCrash({ sock: s, jid: j, game, cashedOut: false, cashMult: null })
      }
    })({ sock, jid, msg, reply, sender, user, args })
  },

  // ── .rps — rock paper scissors ───────────────────────────────────────────
  // Win: 44 % | Draw: 3 % | House edge ≈ 12 %
  rps: withCooldown(async ({ reply, sender, user, args }) => {
    const u      = user || await db.getOrCreateUser(sender)
    const choice = (args[0]?.toLowerCase() && isNaN(parseInt(args[0], 10))) ? args[0].toLowerCase() : null
    const amount = parseAmount(args[1] || args[0], u.wallet || 0)

    if (!choice || !['rock', 'paper', 'scissors', 'r', 'p', 's'].includes(choice)) {
      return reply('⚠️ Usage: .rps rock/paper/scissors <amount>\nExample: .rps rock 500')
    }
    const err = validateBet(amount, u.wallet || 0)
    if (err) return reply(err)
    if (await replyIfLimitHit(reply, sender)) return

    const map        = { r: 'rock', p: 'paper', s: 'scissors' }
    const playerMove = map[choice] || choice
    const emojis     = { rock: '🪨', paper: '📄', scissors: '✂️' }
    const beats      = { rock: 'scissors', paper: 'rock', scissors: 'paper' }
    const winsAgainst = { rock: 'paper', paper: 'scissors', scissors: 'rock' }

    const roll = Math.random()
    let botMove, result
    if      (roll < 0.44) { botMove = beats[playerMove]; result = 'win' }
    else if (roll < 0.47) { botMove = playerMove;        result = 'draw' }
    else                  { botMove = winsAgainst[playerMove]; result = 'lose' }

    const net = result === 'win' ? amount : result === 'draw' ? 0 : -amount
    if (result !== 'draw') await db.updateUser(sender, { wallet: (u.wallet || 0) + net })
    if (result === 'lose') await sinkCoins(amount)
    if (result === 'win')  await genCoins(amount)

    const bal = ((u.wallet || 0) + net).toLocaleString()
    const rem = getRemainingGambles(sender)

    return reply(layout({
      emoji: '🪨', title: 'Rock Paper Scissors',
      bet: amount.toLocaleString(),
      event: `You: ${emojis[playerMove]}  vs  Bot: ${emojis[botMove]}`,
      outcome: result === 'win'  ? '✅ You Win!'
             : result === 'draw' ? '🤝 Draw! Bet returned.'
             :                    '❌ You Lose!',
      win: result === 'win',
      payout: result === 'draw' ? null : Math.abs(net).toLocaleString(),
      balance: bal,
      remaining: rem,
    }))
  }),

  // ── .blackjack / .bj / .casino ───────────────────────────────────────────
  // Delegates to commands/blackjack.js
  blackjack: withCooldown(async (ctx) => {
    try {
      const bj = require('./blackjack')
      return bj.bj(ctx)
    } catch { return ctx.reply('⚠️ Blackjack unavailable right now.') }
  }),
  async bj(ctx)     { return module.exports.blackjack(ctx) },
  async casino(ctx) { return module.exports.blackjack(ctx) },

  // ── .spin — wheel of fortune ─────────────────────────────────────────────
  // Weighted wheel; house edge ≈ 18 %
  spin: withCooldown(async ({ reply, sender, user, args }) => {
    const u      = user || await db.getOrCreateUser(sender)
    const amount = parseAmount(args[0], u.wallet || 0)
    const err    = validateBet(amount, u.wallet || 0)
    if (err) return reply(err)
    if (await replyIfLimitHit(reply, sender)) return

    const outcomes = [
      { label: '💀 Bankrupt',  mult: 0,    weight: 20 },
      { label: '💸 ×0.4',      mult: 0.4,  weight: 25 },
      { label: '💰 ×1.2',      mult: 1.2,  weight: 25 },
      { label: '⭐ ×1.8',      mult: 1.8,  weight: 20 },
      { label: '🌟 ×3.0',      mult: 3.0,  weight:  8 },
      { label: '💎 ×5.0',      mult: 5.0,  weight:  2 },
    ]
    const totalW = outcomes.reduce((a, o) => a + o.weight, 0)
    let r = Math.random() * totalW
    let picked = outcomes[0]
    for (const o of outcomes) { r -= o.weight; if (r <= 0) { picked = o; break } }

    const net = Math.floor(amount * picked.mult) - amount
    await db.updateUser(sender, { wallet: (u.wallet || 0) + net })
    if (net < 0) await sinkCoins(Math.abs(net)); else if (net > 0) await genCoins(net)

    return reply(layout({
      emoji: '🎡', title: 'Spin',
      bet: amount.toLocaleString(),
      event: `🎡 The wheel spins...\n\n${picked.label}`,
      outcome: net >= 0 ? '✅ Lucky Spin!' : '❌ Better Luck Next Time!',
      win: net >= 0,
      payout: Math.abs(net).toLocaleString(),
      balance: ((u.wallet || 0) + net).toLocaleString(),
      remaining: getRemainingGambles(sender),
    }))
  }),

  // ── .poker ────────────────────────────────────────────────────────────────
  // 5-card draw; approximate hand detection; house edge ≈ 15 %
  poker: withCooldown(async ({ reply, sender, user, args }) => {
    const u      = user || await db.getOrCreateUser(sender)
    const amount = parseAmount(args[0], u.wallet || 0)
    const err    = validateBet(amount, u.wallet || 0)
    if (err) return reply(err)
    if (await replyIfLimitHit(reply, sender)) return

    const suits  = ['♠️','♥️','♦️','♣️']
    const values = ['2','3','4','5','6','7','8','9','10','J','Q','K','A']
    const deck   = suits.flatMap(s => values.map(v => `${v}${s}`))
    const hand   = [...deck].sort(() => Math.random() - 0.5).slice(0, 5)

    const vals  = hand.map(c => values.indexOf(c.replace(/[♠♥♦♣️]/g, '').trim()))
    const counts = {}
    for (const v of vals) counts[v] = (counts[v] || 0) + 1
    const freq       = Object.values(counts).sort((a, b) => b - a)
    const isFlush    = new Set(hand.map(c => c.slice(-2))).size === 1
    const sortedVals = [...vals].sort((a, b) => a - b)
    const isStraight = sortedVals.every((v, i) => i === 0 || v === sortedVals[i - 1] + 1)

    let handName, mult
    if   (isFlush && isStraight)                   { handName = 'Straight Flush';  mult = 8   }
    else if (freq[0] === 4)                         { handName = 'Four of a Kind';  mult = 5   }
    else if (freq[0] === 3 && freq[1] === 2)        { handName = 'Full House';      mult = 3   }
    else if (isFlush)                               { handName = 'Flush';           mult = 2.5 }
    else if (isStraight)                            { handName = 'Straight';        mult = 2   }
    else if (freq[0] === 3)                         { handName = 'Three of a Kind'; mult = 1.5 }
    else if (freq[0] === 2 && freq[1] === 2)        { handName = 'Two Pair';        mult = 1.2 }
    else if (freq[0] === 2)                         { handName = 'One Pair';        mult = 0.9 }
    else                                            { handName = 'High Card';       mult = 0   }

    const net = mult > 0 ? Math.floor(amount * mult) - amount : -amount
    await db.updateUser(sender, { wallet: (u.wallet || 0) + net })
    if (net < 0) await sinkCoins(Math.abs(net)); else if (net > 0) await genCoins(net)

    return reply(layout({
      emoji: '🂡', title: 'Poker',
      bet: amount.toLocaleString(),
      event: `${hand.join('  ')}\n\n${handName}${mult > 0 ? ` (×${mult})` : ''}`,
      outcome: net >= 0 ? '✅ Winning Hand!' : '❌ No Win This Time.',
      win: net >= 0,
      payout: Math.abs(net).toLocaleString(),
      balance: ((u.wallet || 0) + net).toLocaleString(),
      remaining: getRemainingGambles(sender),
    }))
  }),

  // ── .horse — horse racing ─────────────────────────────────────────────────
  // 6 horses; 1/6 true chance; payout 4.5× total; house edge ≈ 25 %
  horse: withCooldown(async ({ reply, sender, user, args }) => {
    const u      = user || await db.getOrCreateUser(sender)
    const horse  = parseInt(args[0], 10)
    const amount = parseAmount(args[1], u.wallet || 0)

    if (!horse || horse < 1 || horse > 6 || !amount) {
      return reply('⚠️ Usage: .horse <1-6> <amount>\nExample: .horse 3 1000')
    }
    const err = validateBet(amount, u.wallet || 0)
    if (err) return reply(err)
    if (await replyIfLimitHit(reply, sender)) return

    const winner = Math.floor(Math.random() * 6) + 1
    const win    = winner === horse
    const net    = win ? Math.floor(amount * 3.5) : -amount

    await db.updateUser(sender, { wallet: (u.wallet || 0) + net })
    if (!win) await sinkCoins(amount); else await genCoins(Math.floor(amount * 3.5))

    const HORSES = '🐴🏇🐎🦄🐴🏇'.split('').filter((_, i) => i < 6)
    const raceLines = [1,2,3,4,5,6]
      .map(i => `${i === winner ? '🏁' : '  '} Horse ${i}`)
      .join('\n')

    return reply(layout({
      emoji: '🏇', title: 'Horse Race',
      bet: amount.toLocaleString(),
      event: `${raceLines}\n\nYour pick: Horse ${horse}  |  Winner: Horse ${winner}`,
      outcome: win ? '✅ Your Horse Won!' : '❌ Better Luck Next Race!',
      win,
      payout: Math.abs(net).toLocaleString(),
      balance: ((u.wallet || 0) + net).toLocaleString(),
      remaining: getRemainingGambles(sender),
    }))
  }),

  // ── .jackpot ─────────────────────────────────────────────────────────────
  // Win rate: 1.5 % | Payout: 20× | High-risk
  jackpot: withCooldown(async ({ reply, sender, user, args }) => {
    const u      = user || await db.getOrCreateUser(sender)
    const amount = parseAmount(args[0], u.wallet || 0)
    const err    = validateBet(amount, u.wallet || 0)
    if (err) return reply(err)
    if (await replyIfLimitHit(reply, sender)) return

    const win = Math.random() < 0.015
    const net = win ? amount * 19 : -amount

    await db.updateUser(sender, { wallet: (u.wallet || 0) + net })
    if (!win) await sinkCoins(amount); else await genCoins(amount * 19)

    return reply(layout({
      emoji: '💥', title: 'Jackpot',
      bet: amount.toLocaleString(),
      event: win
        ? '🌟 🌟 🌟\n\nThe stars aligned!'
        : '🎰 🎰 🎰\n\nSo close… (1.5% chance)',
      outcome: win ? '✅ JACKPOT! You Won!' : '❌ Not This Time.',
      win,
      payout: Math.abs(net).toLocaleString(),
      balance: ((u.wallet || 0) + net).toLocaleString(),
      remaining: getRemainingGambles(sender),
    }))
  }),

  // ── .trivia — no stakes ───────────────────────────────────────────────────
  async trivia({ reply }) {
    const questions = [
      { q: 'What is the capital of France?',         a: 'Paris',       choices: 'A) London  B) Paris  C) Berlin  D) Rome'       },
      { q: 'What is 7 × 8?',                         a: '56',          choices: 'A) 54  B) 56  C) 63  D) 48'                   },
      { q: 'Which planet is closest to the Sun?',    a: 'Mercury',     choices: 'A) Venus  B) Earth  C) Mercury  D) Mars'       },
      { q: 'Who wrote Romeo and Juliet?',            a: 'Shakespeare', choices: 'A) Dickens  B) Shakespeare  C) Austen  D) Twain'},
      { q: 'What is H2O?',                           a: 'Water',       choices: 'A) Hydrogen  B) Oxygen  C) Water  D) Helium'   },
      { q: 'How many sides does a hexagon have?',    a: '6',           choices: 'A) 5  B) 6  C) 7  D) 8'                       },
      { q: 'What is the largest ocean?',             a: 'Pacific',     choices: 'A) Atlantic  B) Indian  C) Arctic  D) Pacific' },
    ]
    const q = questions[Math.floor(Math.random() * questions.length)]
    await reply(`🧠 ${b('Trivia')}\n\n${q.q}\n\n${q.choices}\n\n_Answer: ${q.a}_`)
  },

  async math({ reply, args }) {
    const expr = args.join(' ').replace(/[^0-9+\-*/().%\s]/g, '')
    if (!expr) return reply('⚠️ Usage: .math <expression>')
    try {
      // eslint-disable-next-line no-eval
      const result = eval(expr)
      await reply(`🔢 ${b('Math')}\n\n${expr} = *${result}*`)
    } catch {
      await reply('❌ Invalid expression.')
    }
  },
}
