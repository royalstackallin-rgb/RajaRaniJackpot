import { useMemo, useState } from 'react'
import './RubyRush.css'

const TILE_COUNT = 25
const STARTING_CREDITS = 1000
const BET_OPTIONS = [10, 25, 50, 100]

function shuffledTiles() {
  const tiles = Array.from({ length: TILE_COUNT }, (_, index) => index)
  for (let index = tiles.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[tiles[index], tiles[swapIndex]] = [tiles[swapIndex], tiles[index]]
  }
  return tiles
}

function formatCredits(value) {
  return Math.round(value).toLocaleString('en-IN')
}

export default function RubyRush() {
  const [credits, setCredits] = useState(STARTING_CREDITS)
  const [bet, setBet] = useState(25)
  const [mineCount, setMineCount] = useState(4)
  const [round, setRound] = useState(null)
  const [message, setMessage] = useState('Choose your stake and start a vault run.')
  const [history, setHistory] = useState([])

  const multiplier = useMemo(() => {
    if (!round?.safePicks) return 1
    let chance = 1
    for (let i = 0; i < round.safePicks; i += 1) {
      chance *= (TILE_COUNT - mineCount - i) / (TILE_COUNT - i)
    }
    const base = Math.floor((0.97 / chance) * 100) / 100
    return Number((base * Math.pow(1.2, round.relicsFound)).toFixed(2))
  }, [round, mineCount])

  const potentialReturn = round?.status === 'playing'
    ? Math.floor(bet * multiplier)
    : 0
  const displayedMultiplier = round?.safePicks ? multiplier : 1
  const roundStatus = !round ? 'READY TO PLAY' : round.status === 'playing' ? 'VAULT OPEN' : round.status === 'lost' ? 'MINE TRIGGERED' : 'VAULT SECURED'

  const startRound = () => {
    if (round?.status === 'playing') return
    if (credits < bet) {
      setMessage('Not enough practice credits. Choose a smaller stake or reset your demo credits.')
      return
    }
    const shuffled = shuffledTiles()
    const mines = new Set(shuffled.slice(0, mineCount))
    const relics = new Set(shuffled.slice(mineCount, mineCount + 2))
    setCredits((value) => value - bet)
    setRound({
      mines,
      relics,
      revealed: new Set(),
      safePicks: 0,
      relicsFound: 0,
      status: 'playing',
      outcome: null,
    })
    setMessage('Vault unlocked. Find gems, watch the multiplier, and cash out when ready.')
  }

  const revealTile = (index) => {
    if (!round || round.status !== 'playing' || round.revealed.has(index)) return
    const revealed = new Set(round.revealed)
    revealed.add(index)
    if (round.mines.has(index)) {
      const finished = { ...round, revealed, status: 'lost', outcome: 'mine' }
      setRound(finished)
      setHistory((items) => [{ result: 'Mine hit', amount: -bet }, ...items].slice(0, 5))
      setMessage('BOOM! You found a mine. Start another vault run and try a different strategy.')
      return
    }

    const foundRelic = round.relics.has(index)
    const safePicks = round.safePicks + 1
    const relicsFound = round.relicsFound + (foundRelic ? 1 : 0)
    setRound({ ...round, revealed, safePicks, relicsFound })
    setMessage(foundRelic
      ? 'RELIC FOUND! Your vault boost adds 20% to the multiplier. Cash out or keep exploring.'
      : 'Safe gem! Your multiplier has climbed. Cash out or risk another tile.')
  }

  const cashOut = () => {
    if (!round || round.status !== 'playing' || round.safePicks === 0) return
    const payout = Math.floor(bet * multiplier)
    setCredits((value) => value + payout)
    setRound({ ...round, status: 'cashed', outcome: 'cashout', payout })
    setHistory((items) => [{ result: 'Cashed out', amount: payout - bet }, ...items].slice(0, 5))
    setMessage(`Vault secured! ${formatCredits(payout)} practice credits returned to your balance.`)
  }

  const resetCredits = () => {
    if (round?.status === 'playing') return
    setCredits(STARTING_CREDITS)
    setHistory([])
    setMessage('Demo balance reset to 1,000 practice credits.')
  }

  const tileLabel = (index) => {
    if (!round || (round.status === 'playing' && !round.revealed.has(index))) return '◆'
    if (round?.mines.has(index)) return '✹'
    if (round?.relics.has(index)) return '✦'
    return '♦'
  }

  const tileClass = (index) => {
    if (!round || (round.status === 'playing' && !round.revealed.has(index))) return 'ruby-tile'
    if (round?.mines.has(index)) return 'ruby-tile is-mine'
    if (round?.relics.has(index)) return 'ruby-tile is-relic'
    return 'ruby-tile is-gem'
  }

  return (
    <section className="ruby-rush">
      <div className="ruby-hero">
        <div className="ruby-hero-copy">
          <span className="ruby-kicker">TARGETORSTAKE ORIGINAL · PRACTICE MODE</span>
          <h1>RUBY <span>RUSH</span></h1>
          <p>Crack the vault. Find the gems. Know when to walk away.</p>
        </div>
        <div className="ruby-vault-mark" aria-hidden="true"><span>✦</span></div>
      </div>

      <div className="ruby-balance-row">
        <div className="ruby-balance-copy"><span>PRACTICE CREDITS</span><strong>{formatCredits(credits)}</strong></div>
        <div className="ruby-balance-actions"><span className={`ruby-round-status ${round?.status || 'ready'}`}><i />{roundStatus}</span><button type="button" onClick={resetCredits} disabled={round?.status === 'playing'}>Reset demo</button></div>
      </div>

      <div className="ruby-layout">
        <div className="ruby-board-panel">
          <div className="ruby-board-top">
            <div><span className="ruby-label">VAULT MULTIPLIER</span><strong className={`ruby-multiplier ${round?.status === 'playing' ? 'is-live' : ''}`}>{displayedMultiplier.toFixed(2)}×</strong><span className="ruby-board-caption">{round?.status === 'cashed' ? `Final return: ${formatCredits(round.payout)} credits` : round?.status === 'lost' ? 'Run ended — vault revealed' : round?.status === 'playing' ? 'Cash out to secure your return' : 'Find a safe tile to begin'}</span></div>
            <div className="ruby-board-stat"><span>SAFE PICKS</span><strong>{round?.safePicks || 0}<small> / {TILE_COUNT - mineCount}</small></strong><div className="ruby-progress-track"><span style={{ width: `${((round?.safePicks || 0) / (TILE_COUNT - mineCount)) * 100}%` }} /></div></div>
          </div>
          <div className="ruby-grid" aria-label="Ruby Rush 5 by 5 vault grid">
            {Array.from({ length: TILE_COUNT }, (_, index) => (
              <button
                type="button"
                key={index}
                className={tileClass(index)}
                onClick={() => revealTile(index)}
                disabled={round?.status !== 'playing' || round.revealed.has(index)}
                aria-label={!round || (round.status === 'playing' && !round.revealed.has(index)) ? `Reveal tile ${index + 1}` : `Tile ${index + 1}: ${round?.mines.has(index) ? 'mine' : round?.relics.has(index) ? 'relic' : 'gem'}`}
              >{tileLabel(index)}</button>
            ))}
          </div>
          <div className={`ruby-message ${round?.status === 'lost' ? 'is-loss' : round?.status === 'cashed' ? 'is-win' : ''}`} role="status"><span className="ruby-message-icon" aria-hidden="true">{round?.status === 'lost' ? '×' : round?.status === 'cashed' ? '✓' : round?.status === 'playing' ? '✦' : 'i'}</span><span>{message}</span></div>
          <div className="ruby-action-row">
            {round?.status === 'playing' ? (
              <button type="button" className="ruby-cashout" onClick={cashOut} disabled={!round.safePicks}>
                CASH OUT · {formatCredits(potentialReturn)} <small>credits</small>
              </button>
            ) : (
              <button type="button" className="ruby-start" onClick={startRound}>
                {round ? 'PLAY AGAIN' : 'OPEN THE VAULT'} <span>→</span>
              </button>
            )}
          </div>
          {round?.status === 'playing' && <p className="ruby-risk-note">Your stake is already in play. A mine ends this run — cash out after at least one safe pick.</p>}
          <p className="ruby-disclaimer">Practice credits only. No deposits, withdrawals, or cash prizes.</p>
        </div>

        <aside className="ruby-controls">
          <div className="ruby-control-card">
            <span className="ruby-label">YOUR STAKE</span>
            <div className="ruby-bet-options">
              {BET_OPTIONS.map((amount) => (
                <button key={amount} type="button" className={bet === amount ? 'is-selected' : ''} onClick={() => setBet(amount)} disabled={round?.status === 'playing'}>{amount}</button>
              ))}
            </div>
          </div>
          <div className="ruby-control-card">
            <span className="ruby-label">HIDDEN MINES</span>
            <div className="ruby-mine-options">
              {[2, 4, 6, 8, 12].map((amount) => (
                <button key={amount} type="button" className={mineCount === amount ? 'is-selected' : ''} onClick={() => setMineCount(amount)} disabled={round?.status === 'playing'}>{amount}</button>
              ))}
            </div>
            <p>More mines means a riskier vault and faster multiplier growth.</p><div className="ruby-risk-meter" aria-label={`${mineCount} mines selected`}>{Array.from({ length: 12 }, (_, index) => <i key={index} className={index < mineCount ? 'is-filled' : ''} />)}</div>
          </div>
          <div className={`ruby-relic-card ${round?.relicsFound ? 'is-found' : ''}`}>
            <span className="ruby-relic-icon">✦</span>
            <div><strong>RELIC BOOST <span>{round?.relicsFound ? 'FOUND +' : 'HIDDEN'}</span></strong><p>Two hidden relics are tucked among the safe tiles. Each one found adds 20% to your multiplier.</p></div>
          </div>
          <div className="ruby-history-card">
            <span className="ruby-label">RECENT RUNS</span>
            {history.length ? history.map((item, index) => (
              <div className="ruby-history-row" key={`${item.result}-${index}`}><span>{item.result}</span><strong className={item.amount >= 0 ? 'is-positive' : 'is-negative'}>{item.amount > 0 ? '+' : ''}{formatCredits(item.amount)}</strong></div>
            )) : <p>Your completed vault runs will show here.</p>}
          </div>
        </aside>
      </div>
    </section>
  )
}
