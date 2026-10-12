import { useState } from 'react'

const SYMBOLS = [
  { name: 'Cherry', weight: 28 },
  { name: 'Lemon', weight: 24 },
  { name: 'Bell', weight: 18 },
  { name: 'Clover', weight: 14 },
  { name: 'Diamond', weight: 10 },
  { name: 'Crown', weight: 6 },
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

function SymbolArt({ name }) {
  const common = { fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }
  if (name === 'Crown') return (
    <svg className="slot-symbol slot-symbol-crown" viewBox="0 0 100 100" role="img" aria-label="Crown">
      <path d="M19 36 35 50 49 23 64 50 82 34 75 69 26 69Z" fill="#d9a83f" stroke="#ffe7a0" strokeWidth="3" strokeLinejoin="round"/>
      <path d="M27 78H74M31 70H70" stroke="#fff0bc" strokeWidth="4" strokeLinecap="round"/>
      <circle cx="19" cy="34" r="5" fill="#ed2445"/><circle cx="49" cy="20" r="5" fill="#ed2445"/><circle cx="83" cy="32" r="5" fill="#ed2445"/>
      <path d="M37 51 42 64M63 51 58 64" stroke="#fff0bc" strokeWidth="3"/>
    </svg>
  )
  if (name === 'Diamond') return (
    <svg className="slot-symbol slot-symbol-diamond" viewBox="0 0 100 100" role="img" aria-label="Diamond">
      <path d="M50 13 82 42 50 86 18 42Z" fill="#9ee8f4" stroke="#e4fbff" strokeWidth="3" strokeLinejoin="round"/>
      <path d="M18 42H82M38 18 31 42 50 86 69 42 62 18" fill="none" stroke="#4a9fb8" strokeWidth="2.5" strokeLinejoin="round"/>
      <path d="M39 25 29 39" stroke="#fff" strokeWidth="4" strokeLinecap="round"/>
    </svg>
  )
  if (name === 'Bell') return (
    <svg className="slot-symbol slot-symbol-bell" viewBox="0 0 100 100" role="img" aria-label="Bell">
      <path d="M24 65Q31 55 31 39A19 19 0 0 1 69 39Q69 55 76 65L81 71H19Z" fill="#d9a83f" stroke="#ffe7a0" strokeWidth="3" strokeLinejoin="round"/>
      <path d="M42 79Q50 91 58 79" fill="#ed2445" stroke="#ed2445" strokeWidth="4" strokeLinecap="round"/>
      <path d="M43 17Q50 10 57 17" fill="none" stroke="#fff0bc" strokeWidth="4" strokeLinecap="round"/>
      <path d="M38 39V52" stroke="#fff0bc" strokeWidth="3" strokeLinecap="round"/>
    </svg>
  )
  if (name === 'Clover') return (
    <svg className="slot-symbol slot-symbol-clover" viewBox="0 0 100 100" role="img" aria-label="Clover">
      <g fill="#64bd83" stroke="#c1f0c9" strokeWidth="2.5">
        <circle cx="39" cy="35" r="17"/><circle cx="61" cy="35" r="17"/><circle cx="39" cy="57" r="17"/><circle cx="61" cy="57" r="17"/>
      </g>
      <path d="M50 51Q51 72 67 83" fill="none" stroke="#c1f0c9" strokeWidth="6" strokeLinecap="round"/>
      <path d="M50 48 50 63" stroke="#21784a" strokeWidth="3" strokeLinecap="round"/>
    </svg>
  )
  if (name === 'Lemon') return (
    <svg className="slot-symbol slot-symbol-lemon" viewBox="0 0 100 100" role="img" aria-label="Lemon">
      <path d="M17 52Q32 40 38 27Q49 17 62 28Q72 37 84 45Q87 60 73 72Q52 87 32 73Q15 66 17 52Z" fill="#f5c845" stroke="#fff0a3" strokeWidth="3" strokeLinejoin="round"/>
      <path d="M54 26Q60 15 73 19Q69 31 57 32" fill="#5a9d54" stroke="#a7d78c" strokeWidth="2.5" strokeLinejoin="round"/>
      <path d="M32 48Q36 38 44 35" stroke="#fff8cf" strokeWidth="4" strokeLinecap="round"/>
    </svg>
  )
  return (
    <svg className="slot-symbol slot-symbol-cherry" viewBox="0 0 100 100" role="img" aria-label="Cherry">
      <path d="M49 48Q45 27 31 18M49 48Q55 26 69 17" fill="none" stroke="#7dbb69" strokeWidth="4" strokeLinecap="round"/>
      <path d="M49 27Q31 10 22 23Q34 36 49 27Z" fill="#5eaa65" stroke="#b3e4a0" strokeWidth="2"/>
      <circle cx="35" cy="62" r="20" fill="#d71d3b" stroke="#ff8591" strokeWidth="3"/>
      <circle cx="68" cy="62" r="20" fill="#b90f2c" stroke="#ff8591" strokeWidth="3"/>
      <ellipse cx="28" cy="54" rx="5" ry="8" fill="#ffd0d4" transform="rotate(25 28 54)"/>
      <ellipse cx="61" cy="54" rx="5" ry="8" fill="#ffd0d4" transform="rotate(25 61 54)"/>
    </svg>
  )
}

export default function SlotGame() {
  const [credits, setCredits] = useState(STARTING_CREDITS)
  const [bet, setBet] = useState(10)
  const [reels, setReels] = useState([SYMBOLS[0], SYMBOLS[1], SYMBOLS[2]])
  const [message, setMessage] = useState('Choose a stake and spin the reels.')
  const [lastPayout, setLastPayout] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const [spins, setSpins] = useState(0)

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
    setMessage('Spinning…')
    window.setTimeout(() => {
      setReels(next)
      setCredits((current) => current + payout)
      setLastPayout(payout)
      setSpins((current) => current + 1)
      setMessage(payout > 0 ? `MATCH FOUND · ${payout} practice credits returned` : 'No match this time. Try another spin.')
      setSpinning(false)
    }, 850)
  }

  const reset = () => {
    if (spinning) return
    setCredits(STARTING_CREDITS)
    setBet(10)
    setReels([SYMBOLS[0], SYMBOLS[1], SYMBOLS[2]])
    setMessage('Practice credits reset.')
    setLastPayout(0)
    setSpins(0)
  }

  return (
    <section className="slot-page">
      <div className="slot-heading">
        <span className="slot-kicker">THE ARCADE <i /> PRACTICE PLAY</span>
        <h1>Royal <em>Reels</em></h1>
        <p>Three reels. One spin at a time. Free practice credits only.</p>
      </div>

      <div className="slot-machine">
        <div className="slot-machine-top">
          <span className="slot-brand-mark"><i /> ROYAL REELS</span>
          <span className="slot-demo-tag">DEMO PLAY</span>
        </div>
        <div className="slot-reels" aria-label={`Reels: ${reels.map((symbol) => symbol.name).join(', ')}`}>
          {reels.map((symbol, index) => (
            <div className={`slot-reel ${spinning ? 'is-spinning' : ''}`} key={index}>
              <span className="slot-reel-index">0{index + 1}</span>
              <SymbolArt name={spinning ? ['Lemon', 'Bell', 'Cherry'][index] : symbol.name} />
            </div>
          ))}
        </div>
        <div className="slot-machine-rule"><span /><span>✦</span><span /></div>
        <div className={`slot-message ${lastPayout > 0 ? 'is-win' : ''}`} role="status">{message}</div>
        <div className="slot-credit-row">
          <div><span>PRACTICE BALANCE</span><strong>{credits.toLocaleString('en-IN')}</strong></div>
          <div><span>LAST RETURN</span><strong>{lastPayout.toLocaleString('en-IN')}</strong></div>
        </div>
        <div className="slot-bet-label">CHOOSE YOUR STAKE</div>
        <div className="slot-bet-options">
          {BETS.map((value) => (
            <button key={value} type="button" className={bet === value ? 'selected' : ''} onClick={() => setBet(value)} disabled={spinning || credits < value}>
              <span>{value}</span><small>CREDITS</small>
            </button>
          ))}
        </div>
        <button type="button" className="slot-spin-button" onClick={spin} disabled={spinning || credits < bet}>
          <span>{spinning ? 'SPINNING' : 'SPIN'}</span><i aria-hidden="true">↗</i>
        </button>
        <div className="slot-footer-row">
          <span>SPINS PLAYED <strong>{spins}</strong></span>
          <button type="button" className="slot-reset-button" onClick={reset} disabled={spinning}>RESET CREDITS</button>
        </div>
      </div>

      <div className="slot-paytable">
        <div className="slot-paytable-heading"><div><span className="slot-kicker">REWARDS</span><h2>Match &amp; win</h2></div><span className="slot-paytable-note">PRACTICE ONLY</span></div>
        <div className="slot-paytable-row"><span className="slot-paytable-symbols"><SymbolArt name="Crown"/><SymbolArt name="Crown"/><SymbolArt name="Crown"/></span><strong>12×</strong></div>
        <div className="slot-paytable-row"><span className="slot-paytable-symbols"><SymbolArt name="Diamond"/><SymbolArt name="Diamond"/><SymbolArt name="Diamond"/></span><strong>10×</strong></div>
        <div className="slot-paytable-row"><span className="slot-paytable-symbols"><SymbolArt name="Clover"/><SymbolArt name="Clover"/><SymbolArt name="Clover"/></span><strong>8×</strong></div>
        <div className="slot-paytable-row"><span>Three matching symbols</span><strong>5×</strong></div>
        <div className="slot-paytable-row"><span>Any pair</span><strong>1×</strong></div>
        <small>*Crown and diamond pairs have special multipliers. Practice credits are temporary, have no cash value, and cannot be deposited, transferred, or redeemed.</small>
      </div>
    </section>
  )
}
