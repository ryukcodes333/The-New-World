'use strict'
/**
 * commands/blackjack.js — Interactive Blackjack
 *
 * .bj <amount>          — start a new game (bet deducted immediately)
 * .bj hit               — draw a card
 * .bj stand             — end your turn; dealer draws
 * .bj double            — double down (first two cards only)
 * .blackjack <action>   — alias for .bj
 *
 * Also handles interactive button IDs: bj_hit_*, bj_stand_*, bj_double_*,
 * bj_again_*, bj_leave_*
 *
 * Layout: Unicode Sans-Serif Bold headings, no decorative borders.
 */

const db = require('../database')

// ── Deck helpers ───────────────────────────────────────────────────────────
const SUITS  = ['♠', '♥', '♦', '♣']
const VALUES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

// Active games keyed by phone (DM) or `${jid}:${phone}` (group)
const bjGames = new Map()

function gameKey(jid, phone) {
  return jid.endsWith('@g.us') ? `${jid}:${phone}` : phone
}

function newDeck() {
  const d = []
  for (const s of SUITS) for (const v of VALUES) d.push({ v, s })
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]]
  }
  return d
}

function cardStr({ v, s }) { return `${v}${s}` }

function handValue(hand) {
  let total = 0, aces = 0
  for (const { v } of hand) {
    if (v === 'A') { total += 11; aces++ }
    else if (['J', 'Q', 'K'].includes(v)) total += 10
    else total += parseInt(v, 10)
  }
  while (total > 21 && aces > 0) { total -= 10; aces-- }
  return total
}

// ── Bold Sans-Serif helper ─────────────────────────────────────────────────
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

// ── Render the game state ─────────────────────────────────────────────────
function renderGame(game, revealDealer = false) {
  const dCards = revealDealer
    ? game.dealer.map(cardStr).join('  ')
    : `${cardStr(game.dealer[0])}  🂠`
  const dVal  = revealDealer ? ` = ${handValue(game.dealer)}` : ''
  const pCards = game.player.map(cardStr).join('  ')
  const pVal   = handValue(game.player)
  return (
    `🃏 ${b('Blackjack')}\n` +
    `\n🎯 ${b('Bet')}\n🍎 ${game.bet.toLocaleString()}` +
    `\n\n🎲 ${b('Event')}\n` +
    `${b('Your Cards')}\n${pCards}\n${pVal}` +
    `\n\n${b('Dealer')}\n${dCards}${dVal}`
  )
}

// ── Actions hint line ─────────────────────────────────────────────────────
function actionsLine(game) {
  const canDouble = game.player.length === 2 && game.bet * 2 <= game.walletSnapshot
  const opts = ['*.bj hit*', '*.bj stand*']
  if (canDouble) opts.push(`*.bj double* (🍎${(game.bet * 2).toLocaleString()})`)
  return `\n\n_${opts.join('  |  ')}_`
}

// ── Send game state (with interactive buttons + text fallback) ────────────
async function sendGameState(sock, jid, game, quoted) {
  const canDouble  = game.player.length === 2 && game.bet * 2 <= game.walletSnapshot
  const text = renderGame(game) + actionsLine(game)

  const interactiveButtons = [
    { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '🃏 Hit',    id: `bj_hit_${game.key}`   }) },
    { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '✋ Stand',  id: `bj_stand_${game.key}` }) },
  ]
  if (canDouble) {
    interactiveButtons.push({
      name: 'quick_reply',
      buttonParamsJson: JSON.stringify({ display_text: `💰 Double (🍎${(game.bet * 2).toLocaleString()})`, id: `bj_double_${game.key}` }),
    })
  }

  try {
    await sock.sendMessage(jid, {
      text, title: '🃏 Blackjack', footer: `Bet: 🍎${game.bet.toLocaleString()}`, interactiveButtons,
    }, quoted ? { quoted } : undefined)
  } catch {
    await sock.sendMessage(jid, { text })
  }
}

// ── Send end-of-game result ───────────────────────────────────────────────
async function sendResult(sock, jid, text, key) {
  await sock.sendMessage(jid, { text })
  try {
    await sock.sendMessage(jid, {
      text: 'What would you like to do next?',
      title: '🃏 Blackjack',
      footer: 'Game over',
      interactiveButtons: [
        { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '🔄 Play Again', id: `bj_again_${key}` }) },
        { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '❌ Leave Table', id: `bj_leave_${key}` }) },
      ],
    })
  } catch {
    await sock.sendMessage(jid, { text: '_Type *.bj <amount>* to play again._' })
  }
}

// ── Resolve game: dealer draws, compare hands, pay out ───────────────────
async function resolveGame(sock, jid, game) {
  while (handValue(game.dealer) < 17) game.dealer.push(game.deck.pop())

  const pVal = handValue(game.player)
  const dVal = handValue(game.dealer)

  let outcome, delta
  if (dVal > 21 || pVal > dVal) {
    delta   = game.bet
    outcome = `✅ ${b('You Win!')}  +🍎${game.bet.toLocaleString()}`
  } else if (pVal === dVal) {
    delta   = 0
    outcome = `🤝 ${b('Push!')}  Bet returned.`
  } else {
    delta   = -game.bet
    outcome = `❌ ${b('You Lose!')}  -🍎${game.bet.toLocaleString()}`
  }

  const user      = await db.getOrCreateUser(game.phone)
  const newWallet = Math.max(0, (user.wallet || 0) + game.bet + delta)
  await db.updateUser(game.phone, { wallet: newWallet })
  bjGames.delete(game.key)

  const text =
    renderGame(game, true) +
    `\n\n📊 ${b('Outcome')}\n${outcome}` +
    `\n\n👛 ${b('Balance')}\n🍎 ${newWallet.toLocaleString()}`

  return sendResult(sock, jid, text, game.key)
}

// ── Handle hit ───────────────────────────────────────────────────────────
async function doHit(sock, jid, game) {
  game.player.push(game.deck.pop())
  const val = handValue(game.player)

  if (val > 21) {
    bjGames.delete(game.key)
    const text =
      renderGame(game, true) +
      `\n\n📊 ${b('Outcome')}\n💥 ${b('Bust!')}  You went over 21!\n\n👛 ${b('Balance')}\n🍎 (updating...)`

    // Refetch balance to show accurate figure
    const u2 = await db.getOrCreateUser(game.phone)
    const finalText =
      renderGame(game, true) +
      `\n\n📊 ${b('Outcome')}\n💥 ${b('Bust!')}  You went over 21!\n\nYou lost 🍎${game.bet.toLocaleString()}.` +
      `\n\n👛 ${b('Balance')}\n🍎 ${(u2.wallet || 0).toLocaleString()}`

    return sendResult(sock, jid, finalText, game.key)
  }

  if (val === 21) return resolveGame(sock, jid, game)
  return sendGameState(sock, jid, game)
}

// ── Handle double down ────────────────────────────────────────────────────
async function doDouble(sock, jid, game) {
  const u = await db.getOrCreateUser(game.phone)
  if ((u.wallet || 0) < game.bet) {
    return sock.sendMessage(jid, { text: `❌ Not enough funds to double down.\n👛 Balance: 🍎${(u.wallet || 0).toLocaleString()}` })
  }
  await db.updateUser(game.phone, { wallet: (u.wallet || 0) - game.bet })
  game.bet *= 2
  game.player.push(game.deck.pop())
  return resolveGame(sock, jid, game)
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  bjGames,

  // ── .bj / .blackjack — start or continue a game ──────────────────────────
  async bj({ sock, msg, jid, senderJid, sender, args, reply, user }) {
    const phone = user?.phone || sender
    const key   = gameKey(jid, phone)
    const sub   = (args[0] || '').toLowerCase()

    // ── Text-command continuation (hit / stand / double) ─────────────────
    const activeGame = bjGames.get(key)
    if (activeGame && !activeGame.done) {
      if (sub === 'hit' || sub === 'h') {
        return doHit(sock, jid, activeGame)
      }
      if (sub === 'stand' || sub === 's') {
        return resolveGame(sock, jid, activeGame)
      }
      if (sub === 'double' || sub === 'd') {
        if (activeGame.player.length !== 2) {
          return reply('❌ Double down is only available on your first two cards.')
        }
        return doDouble(sock, jid, activeGame)
      }
      // Any other text when game is active
      return reply(
        `❌ You have an active game!\n\nType:\n*.bj hit*  |  *.bj stand*  |  *.bj double*`
      )
    }

    // ── Start new game ────────────────────────────────────────────────────
    if (!args[0]) return reply('Usage: *.bj <amount>*\nExample: .bj 500')

    const wallet = user?.wallet ?? 0
    let bet
    if (sub === 'all') {
      bet = wallet
    } else {
      bet = parseInt(sub, 10)
    }

    if (isNaN(bet) || bet <= 0)  return reply('❌ Invalid bet amount.')
    if (bet < 10)                return reply('❌ Minimum bet is 🍎 10.')
    if (bet > wallet)            return reply(`❌ Insufficient funds.\n👛 Balance: 🍎 ${wallet.toLocaleString()}`)

    await db.updateUser(phone, { wallet: wallet - bet })

    const deck   = newDeck()
    const player = [deck.pop(), deck.pop()]
    const dealer = [deck.pop(), deck.pop()]
    const game   = { key, phone, jid, bet, deck, player, dealer, walletSnapshot: wallet, done: false }
    bjGames.set(key, game)

    const pVal = handValue(player)

    // ── Blackjack on deal (natural 21) ────────────────────────────────────
    if (pVal === 21) {
      const prize = Math.floor(bet * 1.5)
      const u2    = await db.getOrCreateUser(phone)
      await db.updateUser(phone, { wallet: (u2.wallet || 0) + bet + prize })
      bjGames.delete(key)

      const text =
        renderGame(game, true) +
        `\n\n📊 ${b('Outcome')}\n🎉 ${b('Blackjack!')}  Natural 21!` +
        `\n\n💰 ${b('Payout')}\n+🍎 ${prize.toLocaleString()} (1.5×)` +
        `\n\n👛 ${b('Balance')}\n🍎 ${((u2.wallet || 0) + bet + prize).toLocaleString()}`

      return sendResult(sock, jid, text, key)
    }

    return sendGameState(sock, jid, game, msg)
  },

  // ── Button interactions ───────────────────────────────────────────────────
  async handleButton(sock, msg, buttonId) {
    const jid = msg.key.remoteJid

    if (buttonId.startsWith('bj_leave_')) {
      const key = buttonId.replace('bj_leave_', '')
      bjGames.delete(key)
      return sock.sendMessage(jid, { text: '👋 You left the Blackjack table.' })
    }

    if (buttonId.startsWith('bj_again_')) {
      const key   = buttonId.replace('bj_again_', '')
      const phone = key.includes(':') ? key.split(':')[1] : key
      const user  = await db.getOrCreateUser(phone)
      return module.exports.bj({
        sock, msg, jid,
        senderJid: msg.key.participant || msg.key.remoteJid,
        sender: phone,
        args: ['100'],
        reply: t => sock.sendMessage(jid, { text: t }),
        user,
      })
    }

    const keyMatch = buttonId.match(/^bj_(hit|stand|double)_(.+)$/)
    if (!keyMatch) return
    const [, action, key] = keyMatch
    const game = bjGames.get(key)
    if (!game || game.done) return

    const senderJid   = msg.key.participant || msg.key.remoteJid
    const senderPhone = senderJid.split('@')[0].split(':')[0]
    if (senderPhone !== game.phone) return

    if (action === 'hit')    return doHit(sock, jid, game)
    if (action === 'stand')  return resolveGame(sock, jid, game)
    if (action === 'double') return doDouble(sock, jid, game)
  },
}
