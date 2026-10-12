import { useMemo, useState } from 'react'

const SYMBOLS = [
  { icon: '🍒', name: 'Cherry', weight: 28 },
  { icon: '🍋', name: 'Lemon', weight: 24 },
  { icon: '🔔', name: 'Bell', weight: 18 },
  { icon: '🍀', name: 'Clover', weight: 14 },
  { icon: '💎', name: 'Diamond', weight: 10 },
  { icon: '👑', name: 'Crown', weight: 6 },
]
const STARTING_CREDITS = 1000
const BETS = [10, 25, 50]

function drawSymbol() {
  const total = SYMBOLS.reduce((sum, symbol) => sum + symbol.weight, 0)
  let pick = Math.random() * total
  for (const symbol of SYMBOLS) {
    pick -= symbol.weight
    if (pick < 0) return symbol
  }
  return SYMBOLS[0]
}

function calculatePayout(reels, bet) {
  const [a, b, c] = reels
  if (a.name === b.name && b.name === c.name) {
    const multiplier = a.name === 'Crown' ? 12 : a.name === 'Diamond' ? 10 : a.name === 'Clover' ? 8 : 5
    return bet * multiplier
  }
  if (a.name === b.name || b.name === c.name || a.name === c.name) {
    const pair = a.name === b.name ? a : b.name === c.name ? b : a
    return bet * (pair.name === 'Crown' ? 3 : pair.name === 'Diamond' ? 2 : 1)
  }
  return 0
}

export default function SlotGame() {
  const [credits, setCredits] = useState(STARTING_CREDITS)
  const [bet, setBet] = useState(10)
  const [reels, setReels] = useState([SYMBOLS[0], SYMBOLS[1], SYMBOLS[2]])
  const [message, setMessage] = useState('Choose a stake and spin the reels.')
  const [lastPayout, setLastPayout] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const [spins, setSpins] = useState(0)

  const bestSymbol = useMemo(() => SYMBOLS.find((symbol) => symbol.name === 'Crown'), [])

  const spin = () => {
    if (spinning) return
    if (credits < bet) {
      setMessage('Not enough practice credits. Reset to start again.')
      return
    }
    const next = [drawSymbol(), drawSymbol(), drawSymbol()]
    const payout = calculatePayout(next, bet)
    setSpinning(true)
    setCredits((current) => current - bet)
    setLastPayout(0)
    setMessage('Reels spinning…')
    window.setTimeout(() => {
      setReels(next)
      setCredits((current) => current - bet + payout)
      setLastPayout(payout)
      setSpins((current) => current + 1)
      setMessage(payout > 0 ? `You matched! ${payout} practice credits returned.` : 'No match this time. Try another spin.')
      setSpinning(false)
    }, 550)
  }

  const reset = () => {
    if (spinning) return
    setCredits(STARTING_CREDITS)
    setBet(10)
    setReels([SYMBOLS[0], SYMBOLS[1], SYMBOLS[2]])
    setMessage('Practice credits reset. Good luck!')
    setLastPayout(0)
    setSpins(0)
  }

  return (
    <section className="slot-page">
      <div className="slot-heading">
        <span className="slot-kicker">ARCADE · PRACTICE MODE</span>
        <h1>Royal Reels</h1>
        <p>A quick three-reel slot game. Play with free practice credits only.</p>
      </div>

      <div className="slot-machine">
        <div className="slot-machine-top"><span>ROYAL REELS</span><span className="slot-jackpot-tag">★ BONUS REELS ★</span></div>
        <div className="slot-reels" aria-label={`Reels: ${reels.map((symbol) => symbol.name).join(', ')}`}>
          {reels.map((symbol, index) => (
            <div className={`slot-reel ${spinning ? 'is-spinning' : ''}`} key={index}>
              <span>{spinning ? ['🍋', '🔔', '🍒', '💎'][index] : symbol.icon}</span>
            </div>
          ))}
        </div>
        <div className="slot-machine-lights"><span /><span /><span /><span /><span /><span /><span /></div>
        <div className="slot-message" role="status">{message}</div>
        <div className="slot-credit-row">
          <div><span>PRACTICE CREDITS</span><strong>{credits.toLocaleString('en-IN')}</strong></div>
          <div><span>LAST PAYOUT</span><strong>{lastPayout.toLocaleString('en-IN')}</strong></div>
        </div>
        <div className="slot-bet-label">SELECT PRACTICE STAKE</div>
        <div className="slot-bet-options">
          {BETS.map((value) => (
            <button key={value} type="button" className={bet === value ? 'selected' : ''} onClick={() => setBet(value)} disabled={spinning || credits < value}>
              {value}
            </button>
          ))}
        </div>
        <button type="button" className="slot-spin-button" onClick={spin} disabled={spinning || credits < bet}>
          {spinning ? 'SPINNING…' : 'SPIN REELS'}
        </button>
        <button type="button" className="slot-reset-button" onClick={reset} disabled={spinning}>Reset practice credits</button>
      </div>

      <div className="slot-paytable">
        <h2>Practice paytable</h2>
        <p>Matches are checked across the three reels in any order.</p>
        <div><span>{bestSymbol.icon} {bestSymbol.icon} {bestSymbol.icon}</span><strong>12× stake</strong></div>
        <div><span>💎 💎 💎</span><strong>10× stake</strong></div>
        <div><span>🍀 🍀 🍀</span><strong>8× stake</strong></div>
        <div><span>Three matching symbols</span><strong>5× stake*</strong></div>
        <div><span>Any pair</span><strong>1× stake*</strong></div>
        <small>*Crown and diamond matches have their own pair multipliers. Credits are temporary, have no cash value, and cannot be deposited, transferred, or redeemed.</small>
      </div>
    </section>
  )
}
