import { useCallback, useEffect, useMemo, useState } from 'react'
import './RubyRush.css'
import { supabase } from '../lib/supabase'

const TILE_COUNT = 25


function formatCredits(value) {
  return Math.round(value).toLocaleString('en-IN')
}

export default function RubyRush() {
  const [credits, setCredits] = useState(null)
  const [bet, setBet] = useState('25')
  const [betMode, setBetMode] = useState('manual')
  const [mineCount, setMineCount] = useState(4)
  const [round, setRound] = useState(null)
  const [message, setMessage] = useState('Checking your wallet…')
  const [history, setHistory] = useState([])
  const [walletLoading, setWalletLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [userId, setUserId] = useState(null)

  const refreshWallet = useCallback(async () => {
    setWalletLoading(true)
    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError || !authData?.user) {
      setUserId(null)
      setCredits(null)
      setMessage('Please sign in to use your TARGETORSTAKE wallet.')
      setWalletLoading(false)
      return
    }
    setUserId(authData.user.id)
    const { data, error } = await supabase.from('wallets').select('balance').eq('user_id', authData.user.id).maybeSingle()
    if (error || !data) {
      setCredits(null)
      setMessage(error?.message || 'Wallet not found for this account.')
    } else {
      setCredits(Number(data.balance))
      setMessage('Choose your stake and start a vault run.')
    }
    setWalletLoading(false)
  }, [])

  useEffect(() => {
    refreshWallet()
    const { data: authListener } = supabase.auth.onAuthStateChange(() => refreshWallet())
    return () => authListener.subscription.unsubscribe()
  }, [refreshWallet])

  const multiplier = useMemo(() => {
    if (round?.multiplier != null) return Number(round.multiplier)
    if (!round?.safePicks) return 1
    let chance = 1
    for (let i = 0; i < round.safePicks; i += 1) {
      chance *= (TILE_COUNT - mineCount - i) / (TILE_COUNT - i)
    }
    return Math.floor((0.97 / chance) * 100) / 100
  }, [round, mineCount])

  const numericBet = Number(bet)
  const validBet = Number.isSafeInteger(numericBet) && numericBet >= 1 && credits !== null && numericBet <= credits && !walletLoading && !busy && Boolean(userId)
  const potentialReturn = round?.status === 'playing'
    ? Number(round.potentialReturn ?? Math.floor(Number(round.stake) * multiplier))
    : 0
  const displayedMultiplier = round?.safePicks ? multiplier : 1
  const roundStatus = !round ? 'READY TO PLAY' : round.status === 'playing' ? 'VAULT OPEN' : round.status === 'lost' ? 'MINE TRIGGERED' : round.status === 'ended' ? 'ROUND ENDED' : 'VAULT SECURED'

  const startRound = async () => {
    if (round?.status === 'playing' || busy || !userId) return
    if (!Number.isSafeInteger(numericBet) || numericBet < 1) {
      setMessage('Enter a whole stake amount of at least 1 credit.')
      return
    }
    if (credits === null || numericBet > credits) {
      setMessage('Your wallet balance is not enough for that stake.')
      return
    }
    setBusy(true)
    const { data, error } = await supabase.rpc('ruby_rush_start_round', { p_stake: numericBet, p_mine_count: mineCount })
    if (error) {
      setMessage(error.message || 'Could not start the round.')
      setBusy(false)
      await refreshWallet()
      return
    }
    setCredits(Number(data.balance))
    setRound({
      id: data.round_id,
      stake: Number(data.stake),
      mineCount: Number(data.mine_count),
      mines: new Set(),
      revealed: new Set(),
      safePicks: 0,
      multiplier: 1,
      potentialReturn: 0,
      status: 'playing',
      outcome: null,
    })
    setMessage('Vault unlocked. Find gems, watch the multiplier, and cash out when ready.')
    setBusy(false)
  }

  const revealTile = async (index) => {
    if (!round || round.status !== 'playing' || round.revealed.has(index) || busy) return
    setBusy(true)
    const { data, error } = await supabase.rpc('ruby_rush_reveal_tile', { p_round_id: round.id, p_tile: index })
    if (error) {
      if ((error.message || '').toLowerCase().includes('round has ended')) {
        setRound({ ...round, status: 'ended' })
        setMessage('This round has already ended on the server. Start a new vault run.')
      } else {
        setMessage(error.message || 'Could not reveal that tile. Try again.')
      }
      setBusy(false)
      return
    }
    const revealed = new Set((data.revealed_positions || []).map(Number))
    if (data.mine_hit) {
      const mines = new Set((data.mine_positions || []).map(Number))
      setRound({ ...round, mines, revealed, status: 'lost', outcome: 'mine', safePicks: Number(data.safe_picks || 0) })
      setHistory((items) => [{ result: 'Mine hit', amount: -Number(round.stake) }, ...items].slice(0, 5))
      setMessage('BOOM! You found a mine. Start another vault run and try a different strategy.')
    } else {
      const safePicks = Number(data.safe_picks || 0)
      const nextMultiplier = Number(data.multiplier || 1)
      setRound({ ...round, revealed, safePicks, multiplier: nextMultiplier, potentialReturn: Number(data.potential_return || 0) })
      setMessage('Safe gem! Your multiplier has climbed. Cash out or risk another tile.')
    }
    setBusy(false)
  }

  const cashOut = async () => {
    if (!round || round.status !== 'playing' || round.safePicks === 0 || busy) return
    setBusy(true)
    const { data, error } = await supabase.rpc('ruby_rush_cash_out', { p_round_id: round.id })
    if (error) {
      setMessage(error.message || 'Cash out failed. Your round remains open; try again.')
      setBusy(false)
      return
    }
    const payout = Number(data.payout)
    setCredits(Number(data.balance))
    setRound({ ...round, status: 'cashed', outcome: 'cashout', payout, multiplier: Number(data.multiplier) })
    setHistory((items) => [{ result: 'Cashed out', amount: payout - Number(round.stake) }, ...items].slice(0, 5))
    setMessage(`Vault secured! ${formatCredits(payout)} credits returned to your wallet.`)
    setBusy(false)
  }

  const tileLabel = (index) => {
    if (!round || (round.status === 'playing' && !round.revealed.has(index))) return '▣'
    if (round?.mines.has(index)) return '✹'
    return '◆'
  }

  const tileClass = (index) => {
    if (!round || (round.status === 'playing' && !round.revealed.has(index))) return 'ruby-tile'
    if (round?.mines.has(index)) return 'ruby-tile is-mine'
    return 'ruby-tile is-gem'
  }

  return (
    <section className="ruby-rush">
      <div className="ruby-hero">
        <div className="ruby-hero-copy">
          <span className="ruby-kicker">TARGETORSTAKE ORIGINAL · SERVER-VERIFIED ROUNDS</span>
          <h1>RUBY <span>RUSH</span></h1>
          <p>Crack the vault. Find the gems. Know when to walk away.</p>
        </div>
        <div className="ruby-vault-mark" aria-hidden="true"><span>✦</span></div>
      </div>

      <div className="ruby-balance-row">
        <div className="ruby-balance-copy"><span>WALLET BALANCE</span><strong>{walletLoading ? 'Loading…' : credits === null ? '—' : formatCredits(credits)}</strong></div>
        <div className="ruby-balance-actions"><span className={`ruby-round-status ${round?.status || 'ready'}`}><i />{roundStatus}</span><button type="button" onClick={refreshWallet} disabled={walletLoading || busy}>Refresh</button></div>
      </div>

      <div className="ruby-layout">
        <div className="ruby-board-panel">
          <div className="ruby-board-top">
            <div><span className="ruby-label">VAULT MULTIPLIER</span><strong className={`ruby-multiplier ${round?.status === 'playing' ? 'is-live' : ''}`}>{displayedMultiplier.toFixed(2)}×</strong><span className="ruby-board-caption">{round?.status === 'cashed' ? `Final return: ${formatCredits(round.payout)} credits` : round?.status === 'lost' ? 'Run ended — vault revealed' : round?.status === 'playing' ? `Potential return: ${formatCredits(potentialReturn)} credits` : 'Find a safe tile to begin'}</span></div>
            <div className="ruby-board-stat"><span>SAFE PICKS</span><strong>{round?.safePicks || 0}<small> / {TILE_COUNT - mineCount}</small></strong><div className="ruby-progress-track"><span style={{ width: `${((round?.safePicks || 0) / (TILE_COUNT - mineCount)) * 100}%` }} /></div></div>
          </div>
          <div className="ruby-board-heading"><span>THE VAULT</span><small>25 sealed tiles · choose carefully</small></div>
          <div className="ruby-grid" aria-label="Ruby Rush 5 by 5 vault grid">
            {Array.from({ length: TILE_COUNT }, (_, index) => (
              <button
                type="button"
                key={index}
                className={tileClass(index)}
                onClick={() => revealTile(index)}
                disabled={round?.status !== 'playing' || round.revealed.has(index) || busy}
                aria-label={!round || (round.status === 'playing' && !round.revealed.has(index)) ? `Reveal tile ${index + 1}` : `Tile ${index + 1}: ${round?.mines.has(index) ? 'mine' : 'gem'}`}
              ><span className={tileClass(index) === 'ruby-tile is-gem' ? 'ruby-tile-art gem-art' : tileClass(index) === 'ruby-tile is-mine' ? 'ruby-tile-art mine-art' : 'ruby-tile-art sealed-art'} aria-hidden="true">{tileLabel(index)}</span></button>
            ))}
          </div>
          <div className={`ruby-message ${round?.status === 'lost' ? 'is-loss' : round?.status === 'cashed' ? 'is-win' : ''}`} role="status"><span className="ruby-message-icon" aria-hidden="true">{round?.status === 'lost' ? '×' : round?.status === 'cashed' ? '✓' : round?.status === 'playing' ? '✦' : 'i'}</span><span>{message}</span></div>
          {round?.status === 'playing' ? (
            <button type="button" className="ruby-cashout ruby-board-cashout" onClick={cashOut} disabled={!round.safePicks || busy}>CASH OUT · {formatCredits(potentialReturn)} credits</button>
          ) : (
            <button type="button" className="ruby-start ruby-board-cashout ruby-board-replay" onClick={startRound} disabled={!validBet || busy}>{busy ? 'PLEASE WAIT…' : round ? 'PLAY AGAIN' : 'OPEN THE VAULT'}</button>
          )}
          {round?.status === 'playing' && <p className="ruby-risk-note">Your stake is already in play. A mine ends this run — cash out after at least one safe pick.</p>}
        </div>

        <aside className="ruby-controls">
          <div className="ruby-control-card ruby-betting-card">
            <div className="ruby-mode-tabs" role="tablist" aria-label="Betting mode">
              <button type="button" role="tab" aria-selected={betMode === 'manual'} className={betMode === 'manual' ? 'is-selected' : ''} onClick={() => setBetMode('manual')} disabled={round?.status === 'playing'}>Manual</button>
              <button type="button" role="tab" aria-selected={betMode === 'auto'} className={betMode === 'auto' ? 'is-selected' : ''} onClick={() => setBetMode('auto')} disabled={round?.status === 'playing'}>Auto</button>
            </div>
            <label className="ruby-label" htmlFor="ruby-bet-amount">BET AMOUNT <span className="ruby-bet-value">{formatCredits(numericBet)} credits</span></label>
            <div className="ruby-stake-input">
              <input id="ruby-bet-amount" type="number" inputMode="numeric" min="1" max={credits ?? undefined} step="1" value={bet} onChange={(event) => setBet(event.target.value)} disabled={round?.status === 'playing' || walletLoading || busy || !userId} />
              <button type="button" onClick={() => setBet(String(Math.max(1, Math.floor((Number(bet) || 1) / 2))))} disabled={round?.status === 'playing' || walletLoading || busy || credits === null}>½</button>
              <button type="button" onClick={() => setBet(String(Math.min(credits || 1, (Number(bet) || 1) * 2)))} disabled={round?.status === 'playing' || walletLoading || busy || credits === null}>2×</button>
            </div>
            <label className="ruby-label" htmlFor="ruby-mine-count">MINES</label>
            <select id="ruby-mine-count" value={mineCount} onChange={(event) => setMineCount(Number(event.target.value))} disabled={round?.status === 'playing'}>
              {[2, 4, 6, 8, 12].map((amount) => <option key={amount} value={amount}>{amount} mines</option>)}
            </select>
            {betMode === 'auto' && <p className="ruby-auto-note">Auto mode setup is coming next. For now, start and reveal tiles manually.</p>}
            {round?.status === 'playing' ? (
              <p className="ruby-active-round-note">Round in progress — use the Cash Out button directly under the board.</p>
            ) : round ? (
              <p className="ruby-active-round-note">Round finished — use Play Again directly under the board.</p>
            ) : (
              <button type="button" className="ruby-start ruby-bet-main" onClick={startRound} disabled={!validBet}>{busy ? 'PLEASE WAIT…' : walletLoading ? 'LOADING WALLET…' : !userId ? 'SIGN IN TO PLAY' : 'BET'}</button>
            )}
            <p className="ruby-practice-hint">Stake and payouts are checked by the server.</p>
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
