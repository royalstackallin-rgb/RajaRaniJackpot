import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const TIMES = ['09:00', '12:00', '15:00', '18:00']
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

export default function DoubleGame() {
  const [rounds, setRounds] = useState([])
  const [selectedNumbers, setSelectedNumbers] = useState([])
  const [stakes, setStakes] = useState({})
  const [balance, setBalance] = useState(null)
  const [bookings, setBookings] = useState([])
  const [userId, setUserId] = useState(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(new Date())

  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)

    const today = istDateString()
    const tomorrowDate = new Date(Date.now() + 36 * 60 * 60 * 1000)
    const tomorrow = istDateString(tomorrowDate)

    const [roundResponse, walletResponse, bookingResponse] = await Promise.all([
      supabase.from('double_rounds')
        .select('id, round_code, game_date, round_time, status, winning_number')
        .gte('game_date', today)
        .lte('game_date', tomorrow)
        .order('game_date', { ascending: true })
        .order('round_time', { ascending: true }),
      supabase.from('wallets').select('balance').eq('user_id', user.id).maybeSingle(),
      supabase.from('double_bookings')
        .select('id, round_id, number, stake, payout, status, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20),
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
    const upcoming = rounds.find((round) =>
      round.status === 'open' && roundTimestamp(round) > timestamp
    )
    if (upcoming) return upcoming
    return [...rounds].reverse().find((round) =>
      (round.status === 'drawn' || round.status === 'settled') &&
      timestamp - roundTimestamp(round) < 4 * 60 * 60 * 1000
    ) || null
  }, [rounds, now])

  const currentRoundTime = currentRound ? roundTimestamp(currentRound) : 0
  const canBook = Boolean(
    currentRound &&
    currentRound.status === 'open' &&
    now.getTime() >= currentRoundTime - 60 * 60 * 1000 &&
    now.getTime() < currentRoundTime - 5 * 60 * 1000
  )
  const stakeFor = (number) => stakes[number] ?? '10'
  const totalStake = selectedNumbers.reduce((sum, number) => sum + (Number(stakeFor(number)) || 0), 0)
  const potentialPayout = selectedNumbers.reduce((sum, number) => sum + (Number(stakeFor(number)) || 0) * 80, 0)
  const toggleNumber = (number) => {
    setSelectedNumbers((current) => current.includes(number)
      ? current.filter((item) => item !== number)
      : [...current, number].sort((a, b) => Number(a) - Number(b)))
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

  const roundLabel = (round) =>
    round ? `${round.game_date} · ${String(round.round_time).slice(0, 5)} IST` : 'No round available'

  return (
    <section className="double-page">
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
          <span key={time} className={currentRound && String(currentRound.round_time).slice(0, 5) === time ? 'selected' : ''}>
            {time} <small>IST</small>
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
            {currentRound ? currentRound.status.toUpperCase() : 'WAITING'}
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
        <div className="double-number-grid" aria-label="Choose a number">
          {NUMBERS.map((number) => (
            <button
              type="button"
              key={number}
              className={selectedNumbers.includes(number) ? 'chosen' : ''}
              onClick={() => toggleNumber(number)}
              aria-pressed={selectedNumbers.includes(number)}
            >
              {number}
            </button>
          ))}
        </div>
        {selectedNumbers.length > 0 && <div className="double-stake-list">
          <h3>Stake per number</h3>
          {selectedNumbers.map((number) => (
            <label className="double-stake-row" key={number}>
              <span>Number <strong>{number}</strong></span>
              <span className="double-stake-input-wrap">₹
                <input type="number" inputMode="numeric" min="1" max="1000000" step="1" value={stakeFor(number)} onChange={(event) => setStakes((current) => ({ ...current, [number]: event.target.value }))} aria-label={`Stake for number ${number}`} />
              </span>
            </label>
          ))}
        </div>}
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
        {!canBook && currentRound?.status === 'open' && (
          <p className="double-hint">Booking opens 1 hour before the draw and closes 5 minutes before it.</p>
        )}
        {message && <p className="double-message" role="status">{message}</p>}
      </div>

      <div className="double-panel">
        <div className="double-history-heading">
          <h2>My Double Bookings</h2>
          <button type="button" onClick={loadData}>Refresh</button>
        </div>
        {bookings.length === 0 ? (
          <p className="double-empty">Your Double bookings will appear here.</p>
        ) : (
          <div className="double-history-list">
            {bookings.map((booking) => {
              const round = rounds.find((item) => item.id === booking.round_id)
              return (
                <div className="double-history-item" key={booking.id}>
                  <div className="double-history-number">{booking.number}</div>
                  <div className="double-history-details">
                    <strong>{roundLabel(round)}</strong>
                    <span>Stake ₹{formatMoney(booking.stake)} · Payout ₹{formatMoney(booking.payout)}</span>
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
      <p className="double-disclaimer">Virtual credits only. No cash value. Results and payouts are processed by the game server.</p>
    </section>
  )
}
