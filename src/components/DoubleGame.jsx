import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import './DoubleGame.css'

const TIMES = [
  { value: '00:00', label: '12:00 AM' },
  { value: '03:00', label: '3:00 AM' },
  { value: '06:00', label: '6:00 AM' },
  { value: '09:00', label: '9:00 AM' },
  { value: '12:00', label: '12:00 PM' },
  { value: '15:00', label: '3:00 PM' },
  { value: '18:00', label: '6:00 PM' },
  { value: '21:00', label: '9:00 PM' },
]
const NUMBERS = Array.from({ length: 100 }, (_, i) => String(i).padStart(2, '0'))

const TWIN_FORTUNE_ODDS = [
  { range: '₹0 (no bets)', target: '1.00%' },
  { range: '₹1–₹70', target: '0.70%' },
  { range: '₹71–₹100', target: '0.50%' },
  { range: '₹101–₹300', target: '0.30%' },
  { range: '₹301–₹500', target: '0.20%' },
  { range: 'Above ₹500', target: '0.10%' },
]

function istDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function istClock(date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

function roundTimestamp(round) {
  return new Date(`${round.game_date}T${String(round.round_time).slice(0, 8)}+05:30`).getTime()
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('en-IN')
}

export default function DoubleGame({ historyOnly = false, onOpenBookings, onOpenResults }) {
  const [rounds, setRounds] = useState([])
  const [selectedNumbers, setSelectedNumbers] = useState([])
  const [stakes, setStakes] = useState({})
  const [quickKind, setQuickKind] = useState('ending')
  const [quickDigit, setQuickDigit] = useState('')
  const [quickStake, setQuickStake] = useState('10')
  const [balance, setBalance] = useState(null)
  const [bookings, setBookings] = useState([])
  const [expandedHistory, setExpandedHistory] = useState({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(new Date())

  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const today = istDateString()
    const tomorrowDate = new Date(Date.now() + 36 * 60 * 60 * 1000)
    const tomorrow = istDateString(tomorrowDate)

    const [roundResponse, walletResponse, bookingResponse] = await Promise.all([
      supabase.from('double_rounds')
        .select('id, round_code, game_date, round_time, status, winning_number, drawn_at')
        .gte('game_date', today)
        .lte('game_date', tomorrow)
        .order('game_date', { ascending: true })
        .order('round_time', { ascending: true }),
      supabase.from('wallets').select('balance').eq('user_id', user.id).maybeSingle(),
      supabase.from('double_bookings')
        .select('id, round_id, number, stake, payout, status, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(200),
    ])

    if (!roundResponse.error) setRounds(roundResponse.data || [])
    if (!walletResponse.error && walletResponse.data) setBalance(walletResponse.data.balance)
    if (!bookingResponse.error) setBookings(bookingResponse.data || [])
  }, [])

  useEffect(() => {
    loadData()
    const refresh = setInterval(() => {
      setNow(new Date())
      loadData()
    }, 10000)
    return () => clearInterval(refresh)
  }, [loadData])

  const currentRound = useMemo(() => {
    const timestamp = now.getTime()
    const recentResult = [...rounds].reverse().find((round) => {
      if (!['drawn', 'settled'].includes(round.status) || !round.drawn_at) return false
      const drawnAt = new Date(round.drawn_at).getTime()
      return timestamp >= drawnAt && timestamp - drawnAt < 5 * 60 * 1000
    })
    if (recentResult) return recentResult

    // Keep the next round closed while the scheduled draw is being processed.
    const pendingDraw = [...rounds].reverse().find((round) =>
      round.status === 'open' &&
      timestamp >= roundTimestamp(round) &&
      timestamp - roundTimestamp(round) < 5 * 60 * 1000
    )
    if (pendingDraw) return pendingDraw

    return rounds.find((round) =>
      round.status === 'open' && roundTimestamp(round) > timestamp
    ) || null
  }, [rounds, now])

  const currentRoundTime = currentRound ? roundTimestamp(currentRound) : 0
  const canBook = Boolean(
    currentRound &&
    currentRound.status === 'open' &&
    now.getTime() < currentRoundTime - 5 * 60 * 1000
  )
  const stakeFor = (number) => stakes[number] ?? ''
  const totalStake = selectedNumbers.reduce((sum, number) => sum + (Number(stakeFor(number)) || 0), 0)
  const selectedStakes = selectedNumbers.map((number) => Number(stakeFor(number)) || 0)
  const sameSelectedStake = selectedStakes.length > 0 && selectedStakes.every((amount) => amount === selectedStakes[0])
  const potentialPayout = sameSelectedStake ? selectedStakes[0] * 80 : null
  const applyQuickBooking = (kind) => {
    const digit = quickDigit
    const amount = Number(quickStake)
    if (!/^[0-9]$/.test(digit)) {
      setMessage(`Choose a ${kind} digit from 0 to 9.`)
      return
    }
    if (!Number.isSafeInteger(amount) || amount < 5 || amount > 1000000) {
      setMessage('Enter a whole-number amount from ₹5 to ₹10,00,000 per number.')
      return
    }
    const matchingNumbers = NUMBERS.filter((number) =>
      kind === 'ending' ? number.endsWith(digit) : number.startsWith(digit)
    )
    setStakes((current) => {
      const next = { ...current }
      matchingNumbers.forEach((number) => { next[number] = String(amount) })
      return next
    })
    setSelectedNumbers((current) => [...new Set([...current, ...matchingNumbers])].sort((a, b) => Number(a) - Number(b)))
    setMessage(`Selected ${matchingNumbers.join(', ')}. ₹${formatMoney(amount)} each × 10 numbers = ₹${formatMoney(amount * 10)} total.`)
  }

  const placeBooking = async () => {
    setMessage('')
    if (!currentRound || !canBook) {
      setMessage('Booking is not open for the selected round.')
      return
    }
    if (selectedNumbers.length === 0) {
      setMessage('Please choose at least one number from 00 to 99.')
      return
    }
    const invalidNumber = selectedNumbers.find((number) => {
      const amount = Number(stakeFor(number))
      return !Number.isSafeInteger(amount) || amount < 5 || amount > 1000000
    })
    if (invalidNumber) {
      setMessage(`Enter a whole-number stake from ₹5 to ₹10,00,000 for ${invalidNumber}.`)
      return
    }
    if (!Number.isSafeInteger(totalStake)) {
      setMessage('The combined stake is too large.')
      return
    }
    if (balance !== null && totalStake > Number(balance)) {
      setMessage(`Your wallet needs ₹${formatMoney(totalStake)} for ${selectedNumbers.length} numbers.`)
      return
    }

    setBusy(true)
    try {
      const confirmed = []
      for (const number of selectedNumbers) {
        const amount = Number(stakeFor(number))
        const { error } = await supabase.rpc('book_double_number', {
          p_round_id: currentRound.id,
          p_number: number,
          p_stake: amount,
        })
        if (error) throw new Error(`${number} failed: ${error.message}`)
        confirmed.push(number)
      }
      setMessage(`Booked ${confirmed.join(', ')}. Total stake: ₹${formatMoney(totalStake)}. Each winning number pays 80× its own stake; only the drawn number can win.`)
      setBalance((current) => current === null ? current : Number(current) - totalStake)
      setSelectedNumbers([])
      await loadData()
    } catch (error) {
      setMessage(error.message || 'Could not place booking.')
    } finally {
      setBusy(false)
    }
  }

  const groupedBookings = useMemo(() => {
    const normalized = bookings.map((booking) => ({ ...booking, number: String(booking.number).padStart(2, '0') }))
    const groups = new Map()
    const groupedIds = new Set()

    // Detect the ten-number Starting/Ending quick-booking slips.
    for (const booking of normalized) {
      for (const pattern of [
        { kind: 'Starting', digit: booking.number[0], matches: NUMBERS.filter((n) => n.startsWith(booking.number[0])) },
        { kind: 'Ending', digit: booking.number[1], matches: NUMBERS.filter((n) => n.endsWith(booking.number[1])) },
      ]) {
        const members = normalized.filter((item) =>
          item.round_id === booking.round_id &&
          Number(item.stake) === Number(booking.stake) &&
          item.status === booking.status &&
          pattern.matches.includes(item.number)
        )
        if (!pattern.matches.every((n) => members.some((item) => item.number === n))) continue
        const key = [booking.round_id, booking.stake, booking.status, pattern.kind, pattern.digit].join('|')
        if (!groups.has(key)) {
          groups.set(key, {
            type: 'group', key, round_id: booking.round_id, stake: Number(booking.stake),
            status: booking.status, kind: pattern.kind, digit: pattern.digit,
            bookings: members,
            created_at: members.reduce((latest, item) => new Date(item.created_at) > new Date(latest) ? item.created_at : latest, members[0].created_at),
          })
          members.forEach((item) => groupedIds.add(item.id))
        }
        break
      }
    }

    // Group other numbers placed together within a 15-second booking burst.
    const batches = []
    for (const booking of normalized.filter((item) => !groupedIds.has(item.id))) {
      const time = new Date(booking.created_at).getTime()
      let batch = batches.find((candidate) =>
        candidate.round_id === booking.round_id &&
        candidate.status === booking.status &&
        Math.abs(candidate.firstTime - time) <= 15000
      )
      if (!batch) {
        batch = { type: 'batch', key: `batch-${booking.round_id}-${booking.id}`, round_id: booking.round_id, status: booking.status, firstTime: time, created_at: booking.created_at, bookings: [] }
        batches.push(batch)
      }
      batch.bookings.push(booking)
    }

    const slips = [...groups.values()].map((item) => ({
      ...item,
      bookings: item.bookings,
      totalStake: item.stake * 10,
      potentialPayout: item.stake * 80,
    }))
    for (const batch of batches) {
      batch.bookings.sort((a, b) => a.number.localeCompare(b.number))
      batch.totalStake = batch.bookings.reduce((sum, item) => sum + Number(item.stake || 0), 0)
      batch.potentialPayout = batch.bookings.reduce((sum, item) => sum + Number(item.stake || 0) * 80, 0)
      slips.push(batch)
    }
    return slips.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
  }, [bookings])

  const displayTime = (time) => ({ '00:00': '12:00 AM', '03:00': '3:00 AM', '06:00': '6:00 AM', '09:00': '9:00 AM', '12:00': '12:00 PM', '15:00': '3:00 PM', '18:00': '6:00 PM', '21:00': '9:00 PM' }[String(time).slice(0, 5)] || String(time).slice(0, 5))
  const roundLabel = (round) =>
    round ? `${round.game_date} · ${displayTime(round.round_time)}` : 'No round available'
  const latestDoubleResult = [...rounds].reverse().find((round) => ['drawn', 'settled'].includes(round.status)) || null
  const bookingCountdownTarget = canBook ? currentRoundTime - 5 * 60 * 1000 : currentRoundTime
  const countdownSeconds = Math.max(0, Math.floor((bookingCountdownTarget - now.getTime()) / 1000))
  const countdownText = [Math.floor(countdownSeconds / 3600), Math.floor((countdownSeconds % 3600) / 60), countdownSeconds % 60].map((part) => String(part).padStart(2, '0')).join(':')

  return (
    <section className={`double-page ${historyOnly ? 'double-history-only' : ''}`}>
      {!historyOnly && (<>
      <div className="lobby-history-actions lobby-history-actions-double" aria-label="Twin Fortune history">
        <button type="button" onClick={onOpenBookings}>▤ <span>My Bookings</span><b>→</b></button>
        <button type="button" onClick={onOpenResults}>✦ <span>Game Results</span><b>→</b></button>
      </div>
      <div className="double-heading">
        <div>
          <p className="double-eyebrow">YOUR DOUBLE LOBBY · 00–99</p>
          <h1>Twin Fortune</h1>
          <p>Track the next draw, booking deadline and latest result before choosing your numbers.</p>
        </div>
        <div className="double-wallet">
          <span>WALLET BALANCE</span>
          <strong>{balance === null ? '—' : `₹${formatMoney(balance)}`}</strong>
        </div>
      </div>

      <div className="double-times" aria-label="Daily draw times">
        {TIMES.map((time) => (
          <span key={time.value} className={currentRound && String(currentRound.round_time).slice(0, 5) === time.value ? 'selected' : ''}>
            {time.label}
          </span>
        ))}
      </div>

      <details className="how-to-play how-to-play-twin">
        <summary><span className="how-to-play-icon">?</span><span><strong>How to Play Twin Fortune</strong><small>Numbers, stakes and payouts explained</small></span><span className="how-to-play-chevron">＋</span></summary>
        <div className="how-to-play-content">
          <ol>
            <li><strong>Choose a round.</strong> Twin Fortune has four daily rounds: 9 AM, 12 PM, 3 PM and 6 PM. Booking closes 5 minutes before the draw.</li>
            <li><strong>Choose numbers from 00 to 99.</strong> Enter a stake for each number you want. The minimum stake is ₹5 per number.</li>
            <li><strong>Or use Easy Booking.</strong> Choose a starting digit or ending digit and the digit from 0–9. This selects 10 matching numbers, and the stake you enter applies to each one.</li>
            <li><strong>Check your total.</strong> Your total stake is the sum of the stakes on all selected numbers. For Easy Booking, multiply the stake per number by 10.</li>
            <li><strong>Book before the deadline.</strong> Tap Book Numbers while booking is open. Only the drawn winning number can win.</li>
            <li><strong>Understand the payout.</strong> A winning number pays 80 times the stake placed on that number. Other selected numbers do not win that round.</li>
          </ol>
          <p className="how-to-play-example"><strong>Example:</strong> A ₹10 stake on number 27 has a potential payout of ₹800 if 27 is the winning number. Selecting 10 numbers at ₹10 each costs ₹100 in total.</p>
          <details className="double-odds-disclosure">
            <summary>Published odds <span aria-hidden="true">＋</span></summary>
            <p>For each number, the server totals the stakes from all players in this round and applies the exact percentage in the table. These are actual per-number chances, not weights. A single random draw can land in the remaining probability, in which case the round has no winning number. The odds are calculated when the draw runs.</p>
            <div className="double-odds-table-wrap">
              <table className="double-odds-table">
                <thead><tr><th>Total stake per number (all players)</th><th>Intended relative odds</th></tr></thead>
                <tbody>
                  {TWIN_FORTUNE_ODDS.map((odds) => (
                    <tr key={odds.range}><td>{odds.range}</td><td>{odds.target}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <small>Each number uses its listed exact chance based on combined stakes from all players. If the sum of all numbers’ chances is below 100%, the remainder is the chance of no winning number. Numbers with ₹0 stake have a 1.00% chance each.</small>
          </details>

        </div>
      </details>

      <section className="double-lobby-summary" aria-label="Twin Fortune draw summary">
        <div className="double-lobby-summary-top">
          <div><span className="double-label">NEXT TWIN FORTUNE DRAW</span><strong>{currentRound ? displayTime(currentRound.round_time) : 'Schedule updating'}</strong><small>{currentRound?.game_date || 'Check again shortly'}</small></div>
          <span className={canBook ? 'double-status open' : 'double-status'}>{canBook ? 'BOOKINGS OPEN' : currentRound && now.getTime() >= currentRoundTime - 5 * 60 * 1000 && now.getTime() < currentRoundTime ? 'BOOKINGS CLOSED' : currentRound && ['drawn', 'settled'].includes(currentRound.status) ? 'RESULT POSTED' : 'WAITING FOR DRAW'}</span>
        </div>
        {currentRound && <div className="double-lobby-countdown"><span>{canBook ? 'BOOKING CLOSES IN' : 'DRAW TIME / STATUS'}</span><strong>{countdownText}</strong></div>}
        <div className="double-lobby-latest">
          <span className="double-label">LATEST COMPLETED RESULT</span>
          {latestDoubleResult ? <div className="double-lobby-latest-row"><strong>{latestDoubleResult.winning_number == null ? '—' : String(latestDoubleResult.winning_number).padStart(2, '0')}</strong><span>{latestDoubleResult.winning_number == null ? 'No winning number · ' : ''}{latestDoubleResult.game_date} · {displayTime(latestDoubleResult.round_time)}</span></div> : <p>No completed Twin Fortune result yet.</p>}
        </div>
      </section>

      <div className="double-panel">
        <div className="double-round-row">
          <div>
            <span className="double-label">CURRENT ROUND</span>
            <strong>{roundLabel(currentRound)}</strong>
          </div>
          <span className={currentRound?.status === 'open' ? 'double-status open' : 'double-status'}>
            {currentRound && ['drawn', 'settled'].includes(currentRound.status) ? 'RESULT' : currentRound && currentRound.status === 'open' && now.getTime() >= currentRoundTime ? 'DRAWING' : currentRound && currentRound.status === 'open' && now.getTime() >= currentRoundTime - 5 * 60 * 1000 ? 'BOOKING CLOSED' : currentRound ? currentRound.status.toUpperCase() : 'WAITING'}
          </span>
        </div>
        {currentRound && ['drawn', 'settled'].includes(currentRound.status) && (
          <div className="double-winner">
            <span>{currentRound.winning_number == null ? 'ROUND RESULT' : 'WINNING NUMBER'}</span>
            <strong>{currentRound.winning_number == null ? 'NO WINNER' : String(currentRound.winning_number).padStart(2, '0')}</strong>
          </div>
        )}
        <div className="double-payout-note">Potential payout: <strong>80× stake per winning number</strong>. Stake applies to each selected number.</div>
        <p className="double-selected-summary">Selected: <strong>{selectedNumbers.length ? selectedNumbers.join(', ') : 'none'}</strong></p>
        <div className="double-quick-booking">
          <h3>Easy Booking</h3>
          <p>Choose a starting or ending digit. The amount is applied to all 10 matching numbers.</p>
          <div className="double-quick-mode" role="group" aria-label="Booking type">
            <button type="button" className={quickKind === 'ending' ? 'active' : ''} onClick={() => setQuickKind('ending')}>Ending</button>
            <button type="button" className={quickKind === 'starting' ? 'active' : ''} onClick={() => setQuickKind('starting')}>Starting</button>
          </div>
          <div className="double-quick-fields">
            <label>
              <span>{quickKind === 'ending' ? 'Last digit (0–9)' : 'First digit (0–9)'}</span>
              <select value={quickDigit} onChange={(event) => setQuickDigit(event.target.value)}>
                <option value="">Choose digit</option>
                {Array.from({ length: 10 }, (_, i) => <option key={i} value={String(i)}>{i}</option>)}
              </select>
            </label>
            <label>
              <span>Stake per number (₹)</span>
              <input type="number" inputMode="numeric" min="5" max="1000000" step="1" value={quickStake} onChange={(event) => setQuickStake(event.target.value)} />
            </label>
            <button type="button" className="double-quick-button" onClick={() => applyQuickBooking(quickKind)}>Select 10 Numbers</button>
          </div>
          <p className="double-quick-example">{quickDigit === '' ? 'Choose a digit to see the 10 matching numbers.' : quickKind === 'ending' ? `Ending ${quickDigit}: ${NUMBERS.filter((n) => n.endsWith(quickDigit)).join(', ')}` : `Starting ${quickDigit}: ${NUMBERS.filter((n) => n.startsWith(quickDigit)).join(', ')}`}. Total stake: ₹{formatMoney((Number(quickStake) || 0) * 10)} for 10 numbers.</p>
        </div>
        <div className="double-number-grid" aria-label="Choose numbers and enter individual stakes">
          {NUMBERS.map((number) => (
            <div className={`double-number-tile ${selectedNumbers.includes(number) ? 'selected' : ''}`} key={number}>
              <span className={selectedNumbers.includes(number) ? 'double-number-label chosen' : 'double-number-label'}>
                {number}
              </span>
              <label className="double-tile-stake">
                <span>₹</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="5"
                  max="1000000"
                  step="1"
                  placeholder="0"
                  value={stakeFor(number)}
                  onChange={(event) => {
                    const value = event.target.value
                    setStakes((current) => ({ ...current, [number]: value }))
                    setSelectedNumbers((current) => {
                      if (value !== '' && Number(value) > 0) {
                        return current.includes(number) ? current : [...current, number].sort((a, b) => Number(a) - Number(b))
                      }
                      return current.filter((item) => item !== number)
                    })
                  }}
                  aria-label={`Stake amount for number ${number}`}
                />
              </label>
            </div>
          ))}
        </div>
        <div className="double-booking-controls">
          <div className="double-potential">
            <span>TOTAL STAKE</span>
            <strong>₹{formatMoney(totalStake)}</strong>
          </div>
          <div className="double-potential">
            <span>PAYOUT PER WINNING NUMBER</span>
            <strong>{selectedNumbers.length && selectedNumbers.every((number) => Number.isSafeInteger(Number(stakeFor(number))) && Number(stakeFor(number)) >= 5 && Number(stakeFor(number)) <= 1000000) ? (sameSelectedStake ? `₹${formatMoney(potentialPayout)}` : 'Varies by number') : '—'}</strong>
          </div>
          <button type="button" className="double-submit" disabled={busy || !canBook || !selectedNumbers.length} onClick={placeBooking}>
            {busy ? 'Booking…' : canBook ? `Book ${selectedNumbers.length || ''} Number${selectedNumbers.length === 1 ? '' : 's'}` : 'Booking Closed'}
          </button>
        </div>
        {!canBook && currentRound?.status === 'open' && now.getTime() < currentRoundTime && (
          <p className="double-hint">Bookings stay open until 5 minutes before the draw. The result is shown for 5 minutes, then bookings open for the next round.</p>
        )}
        {message && <p className="double-message" role="status">{message}</p>}
      </div>

      </>)}
      {historyOnly && (
        <div className="double-panel">
          <div className="double-history-heading">
            <h2>My Double Bookings</h2>
            <button type="button" onClick={loadData}>Refresh</button>
          </div>
          {bookings.length === 0 ? (
            <p className="double-empty">Your Double bookings will appear here.</p>
          ) : (
            <div className="double-history-list">
              {groupedBookings.map((item) => {
                const round = rounds.find((candidate) => candidate.id === item.round_id)
                const expanded = Boolean(expandedHistory[item.key])
                const isPattern = item.type === 'group'
                const count = item.bookings.length
                const title = isPattern
                  ? `${item.kind} ${item.digit} · ${roundLabel(round)}`
                  : `${count} number${count === 1 ? '' : 's'} · ${roundLabel(round)}`
                return (
                  <div className="double-history-item double-history-item-expandable" key={item.key}>
                    <button
                      type="button"
                      className="double-history-summary"
                      aria-expanded={expanded}
                      onClick={() => setExpandedHistory((current) => ({ ...current, [item.key]: !current[item.key] }))}
                    >
                      <span className="double-history-number">{isPattern ? item.digit : count === 1 ? item.bookings[0].number : count}</span>
                      <span className="double-history-details">
                        <strong>{title}</strong>
                        <span>{isPattern
                          ? `Stake ₹${formatMoney(item.stake)} each · Total ₹${formatMoney(item.totalStake)} · Potential payout ₹${formatMoney(item.potentialPayout)} per winning number`
                          : `Total stake ₹${formatMoney(item.totalStake)} · Payout per winning number: up to ₹${formatMoney(Math.max(...item.bookings.map((entry) => Number(entry.stake || 0))) * 80)}`}</span>
                      </span>
                      <span className={`double-status ${item.status === 'win' ? 'won' : item.status === 'loss' ? 'lost' : ''}`}>{item.status.toUpperCase()}</span>
                      <span className="double-history-chevron">{expanded ? '−' : '+'}</span>
                    </button>
                    {expanded && (
                      <div className="double-history-expanded">
                        {item.bookings.map((booking) => (
                          <div className="double-history-number-row" key={booking.id}>
                            <span>{booking.number}</span>
                            <span>Stake ₹{formatMoney(booking.stake)}</span>
                            <span>Potential ₹{formatMoney(Number(booking.stake) * 80)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
  
      )}

    </section>
  )
}
