import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import './DoubleGame.css'

const TIMES = [
  { value: '09:00', label: '9:00 AM' },
  { value: '12:00', label: '12:00 PM' },
  { value: '15:00', label: '3:00 PM' },
  { value: '18:00', label: '6:00 PM' },
]
const NUMBERS = Array.from({ length: 100 }, (_, i) => String(i).padStart(2, '0'))

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

export default function DoubleGame({ historyOnly = false }) {
  const [rounds, setRounds] = useState([])
  const [selectedNumbers, setSelectedNumbers] = useState([])
  const [stakes, setStakes] = useState({})
  const [quickKind, setQuickKind] = useState('ending')
  const [quickDigit, setQuickDigit] = useState('')
  const [quickStake, setQuickStake] = useState('10')
  const [balance, setBalance] = useState(null)
  const [bookings, setBookings] = useState([])
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
  const potentialPayout = selectedNumbers.reduce((sum, number) => sum + (Number(stakeFor(number)) || 0) * 80, 0)
  const applyQuickBooking = (kind) => {
    const digit = quickDigit
    const amount = Number(quickStake)
    if (!/^[0-9]$/.test(digit)) {
      setMessage(`Choose a ${kind} digit from 0 to 9.`)
      return
    }
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000) {
      setMessage('Enter a whole-number amount from ₹1 to ₹10,00,000 per number.')
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
      return !Number.isSafeInteger(amount) || amount < 1 || amount > 1000000
    })
    if (invalidNumber) {
      setMessage(`Enter a whole-number stake from ₹1 to ₹10,00,000 for ${invalidNumber}.`)
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
      setMessage(`Booked ${confirmed.join(', ')}. Total stake: ₹${formatMoney(totalStake)}; combined potential payout: ₹${formatMoney(potentialPayout)}.`)
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
    const normalized = bookings.map((booking) => ({
      ...booking,
      number: String(booking.number).padStart(2, '0'),
    }))
    const groups = new Map()
    const groupedIds = new Set()

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
        // Duplicate bookings for a number should not prevent recognizing a complete
        // starting/ending group. We identify the pattern by its ten distinct numbers.
        if (!pattern.matches.every((n) => members.some((item) => item.number === n))) continue

        const key = [booking.round_id, booking.stake, booking.status, pattern.kind, pattern.digit].join('|')
        if (!groups.has(key)) {
          groups.set(key, {
            type: 'group',
            key,
            round_id: booking.round_id,
            stake: Number(booking.stake),
            status: booking.status,
            kind: pattern.kind,
            digit: pattern.digit,
            numbers: pattern.matches,
            bookings: members,
            created_at: members.reduce((latest, item) =>
              new Date(item.created_at) > new Date(latest) ? item.created_at : latest,
              members[0].created_at
            ),
          })
          members.forEach((item) => groupedIds.add(item.id))
        }
        break
      }
    }

    const groupedItems = [...groups.values()].map((group) => ({
      ...group,
      totalStake: group.stake * 10,
      payoutPerWinningNumber: group.stake * 80,
    }))
    const singles = normalized
      .filter((booking) => !groupedIds.has(booking.id))
      .map((booking) => ({ type: 'single', key: booking.id, booking, created_at: booking.created_at }))

    return [...groupedItems, ...singles].sort((a, b) =>
      new Date(b.created_at || b.booking?.created_at || 0) -
      new Date(a.created_at || a.booking?.created_at || 0)
    )
  }, [bookings])

  const displayTime = (time) => ({ '09:00': '9:00 AM', '12:00': '12:00 PM', '15:00': '3:00 PM', '18:00': '6:00 PM' }[String(time).slice(0, 5)] || String(time).slice(0, 5))
  const roundLabel = (round) =>
    round ? `${round.game_date} · ${displayTime(round.round_time)}` : 'No round available'

  return (
    <section className={`double-page ${historyOnly ? 'double-history-only' : ''}`}>
      {!historyOnly && (<>
      <div className="double-heading">
        <div>
          <p className="double-eyebrow">A SEPARATE GAME</p>
          <h1>Targetor Double</h1>
          <p>Select multiple numbers from 00–99; stake applies to each selected number.</p>
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
        {currentRound?.winning_number && (
          <div className="double-winner">
            <span>WINNING NUMBER</span>
            <strong>{currentRound.winning_number}</strong>
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
              <input type="number" inputMode="numeric" min="1" max="1000000" step="1" value={quickStake} onChange={(event) => setQuickStake(event.target.value)} />
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
                  min="1"
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
            <span>COMBINED POTENTIAL PAYOUT</span>
            <strong>₹{selectedNumbers.length && selectedNumbers.every((number) => Number.isSafeInteger(Number(stakeFor(number))) && Number(stakeFor(number)) > 0 && Number(stakeFor(number)) <= 1000000) ? formatMoney(potentialPayout) : '—'}</strong>
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
              if (item.type === 'group') {
                const round = rounds.find((candidate) => candidate.id === item.round_id)
                return (
                  <div className="double-history-item" key={item.key}>
                    <div className="double-history-number">{item.digit}</div>
                    <div className="double-history-details">
                      <strong>{item.kind} {item.digit} · {roundLabel(round)}</strong>
                      <span>Stake ₹{formatMoney(item.stake)} each · Total ₹{formatMoney(item.totalStake)} · Potential payout ₹{formatMoney(item.payoutPerWinningNumber)} per winning number</span>
                    </div>
                    <span className={`double-status ${item.status === 'win' ? 'won' : item.status === 'loss' ? 'lost' : ''}`}>
                      {item.status.toUpperCase()}
                    </span>
                  </div>
                )
              }
              const booking = item.booking
              const round = rounds.find((candidate) => candidate.id === booking.round_id)
              return (
                <div className="double-history-item" key={booking.id}>
                  <div className="double-history-number">{booking.number}</div>
                  <div className="double-history-details">
                    <strong>{roundLabel(round)}</strong>
                    <span>Stake ₹{formatMoney(booking.stake)} · Potential winning ₹{formatMoney(Number(booking.stake) * 80)}</span>
                  </div>
                  <span className={`double-status ${booking.status === 'win' ? 'won' : booking.status === 'loss' ? 'lost' : ''}`}>
                    {booking.status.toUpperCase()}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
      {!historyOnly && <p className="double-disclaimer">Virtual credits only. No cash value. Results and payouts are processed by the game server.</p>}
    </section>
  )
}
