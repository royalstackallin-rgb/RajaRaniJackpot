import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import DoubleGame from './DoubleGame'

const ROUND_NAMES = {
  '07:00': 'SUBHA',
  '08:00': 'SUNRISE',
  '09:00': 'GOLDEN HOUR',
  '10:00': 'ROYAL STAR',
  '11:00': 'LUCKY CROWN',
  '12:00': 'DUPUR',
  '13:00': 'GOLDEN PALACE',
  '14:00': 'DIAMOND',
  '15:00': 'SILVER MOON',
  '16:00': 'GODHULI',
  '17:00': 'ROYAL NIGHT',
  '18:00': 'SHAHI',
}

function getRoundName(round) {
  if (!round?.round_time) return 'RAJARANI JACKPOT'
  const time = String(round.round_time).slice(0, 5)
  return ROUND_NAMES[time] || 'RAJARANI JACKPOT'
}

function asArray(value) {
  if (Array.isArray(value)) return value
  return value == null ? [] : [value]
}

function getEntryResults(entry) {
  return asArray(entry?.game_results)
}

function MyBookings({ initialGame = null }) {
  const [bookings, setBookings] = useState([])
  const [selectedGame, setSelectedGame] = useState(initialGame)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedBookings, setExpandedBookings] = useState({})

  useEffect(() => {
    let active = true

    async function loadBookings() {
      setLoading(true)
      setError('')

      try {
        const { data: authData, error: authError } =
          await supabase.auth.getUser()

        if (authError) throw authError
        if (!authData.user) throw new Error('Please log in again.')

        const { data, error: queryError } = await supabase
          .from('game_bookings')
          .select(`
            id,
            round_id,
            game_type,
            ticket_row,
            total_tickets,
            total_amount,
            status,
            created_at,
            game_rounds (
              round_code,
              game_date,
              round_time,
              status
            ),
            game_entries (
              id,
              number,
              quantity,
              amount,
              payout_per_ticket,
              game_results (
                result,
                payout
              )
            )
          `)
          .eq('user_id', authData.user.id)
          .order('created_at', { ascending: false })

        if (queryError) throw queryError
        if (active) setBookings(data || [])
      } catch (err) {
        if (active) setError(err.message || 'Could not load bookings.')
      } finally {
        if (active) setLoading(false)
      }
    }

    loadBookings()

    return () => {
      active = false
    }
  }, [])

  function getOutcome(booking) {
    if (booking.status === 'cancelled') {
      return { label: 'CANCELLED', payout: 0 }
    }

    const entries = asArray(booking.game_entries)
    const round = Array.isArray(booking.game_rounds)
      ? booking.game_rounds[0]
      : booking.game_rounds
    const results = entries.flatMap(getEntryResults)
    const isSettled =
      booking.status === 'settled' ||
      round?.status === 'settled' ||
      (entries.length > 0 && results.length === entries.length)

    if (!isSettled) return { label: 'PENDING', payout: 0 }

    const payout = results.reduce(
      (sum, result) => sum + Number(result.payout || 0),
      0,
    )

    return {
      label: payout > 0 ? 'WON' : 'LOST',
      payout,
    }
  }

  if (selectedGame === 'double') {
    return (
      <section className="history-page">
        <div className="history-heading">
          
          <span className="history-eyebrow">YOUR ACTIVITY</span>
          <h2>Twin Fortune Bookings</h2>
          <p>Your Twin Fortune number bookings and results.</p>
        </div>
        <DoubleGame historyOnly />
      </section>
    )
  }

  if (selectedGame === null) {
    return (
      <section className="history-page">
        <div className="history-heading">
          <span className="history-eyebrow">YOUR ACTIVITY</span>
          <h2>My Bookings</h2>
          <p>Choose a game to view your booking history.</p>
        </div>
        <div className="booking-game-choices">
          <button type="button" className="booking-game-choice booking-game-choice-classic" onClick={() => setSelectedGame('classic')}>
            <span className="booking-game-mark">A–G</span>
            <span className="booking-game-copy">
              <span className="booking-game-kicker">SEVEN-ROW DRAW</span>
              <strong>Crown 24</strong>
              <small>Tickets, results and payouts</small>
            </span>
            <span className="booking-game-arrow">→</span>
          </button>
          <button type="button" className="booking-game-choice booking-game-choice-double" onClick={() => setSelectedGame('double')}>
            <span className="booking-game-mark">00–99</span>
            <span className="booking-game-copy">
              <span className="booking-game-kicker">NUMBER DRAW</span>
              <strong>Twin Fortune</strong>
              <small>Starting, Ending and number bets</small>
            </span>
            <span className="booking-game-arrow">→</span>
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="history-page">
      <div className="history-heading">
        
        <span className="history-eyebrow">YOUR ACTIVITY</span>
        <h2>Crown 24 Bookings</h2>
        <p>Your current and previous ticket bookings.</p>
      </div>
      {loading && <p className="history-message">Loading your bookings…</p>}

      {error && (
        <p className="history-error" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && bookings.length === 0 && (
        <div className="history-empty">
          <h3>No bookings yet</h3>
          <p>Your ticket booking history will appear here.</p>
        </div>
      )}

      <div className="booking-list">
        {bookings.map((booking) => {
          const outcome = getOutcome(booking)
          const round = Array.isArray(booking.game_rounds)
            ? booking.game_rounds[0]
            : booking.game_rounds
          const entries = asArray(booking.game_entries)

          return (
            <article className={`booking-card booking-card-compact round-theme-${String(round?.round_time || '').slice(0, 5).replace(':', '-')}`} key={booking.id}>
              <button
                type="button"
                className="booking-compact-summary"
                aria-expanded={Boolean(expandedBookings[booking.id])}
                onClick={() => setExpandedBookings((current) => ({ ...current, [booking.id]: !current[booking.id] }))}
              >
                <span className="booking-compact-main">
                  <span className="booking-compact-title">ROW {booking.ticket_row || '—'} · {getRoundName(round)}</span>
                  <span className="booking-compact-date">{round?.game_date || 'Date unavailable'}{round?.round_time ? ` · ${String(round.round_time).slice(0, 5)}` : ''}</span>
                  <span className="booking-compact-meta">{booking.total_tickets} tickets · ₹{Number(booking.total_amount).toLocaleString('en-IN')} cost · ₹{outcome.payout.toLocaleString('en-IN')} payout</span>
                </span>
                <span className="booking-compact-right">
                  <span className={`booking-status ${outcome.label.toLowerCase()}`}>{outcome.label}</span>
                  <span className="booking-compact-chevron">{expandedBookings[booking.id] ? '−' : '+'}</span>
                </span>
              </button>
              {expandedBookings[booking.id] && (
                <div className="booking-compact-expanded">
                  <p className="booking-time">{round?.round_code || 'Game round'}</p>
                  <div className="booking-details">
                    <div><span>Tickets</span><strong>{booking.total_tickets}</strong></div>
                    <div><span>Cost</span><strong>₹{Number(booking.total_amount).toLocaleString('en-IN')}</strong></div>
                    <div><span>Payout</span><strong>₹{outcome.payout.toLocaleString('en-IN')}</strong></div>
                  </div>
                  <div className="booking-entries">
                    {entries.map((entry) => {
                      const payout = getEntryResults(entry).reduce((total, result) => total + Number(result?.payout || 0), 0)
                      const won = payout > 0
                      return (
                        <div className="booking-entry" key={entry.id} style={won ? { border: '2px solid #22c55e', backgroundColor: 'rgba(22, 101, 52, 0.28)' } : undefined}>
                          <span className="booking-number">{won ? '✓ ' : ''}{entry.number}</span>
                          <span>Qty: {entry.quantity}</span>
                          <span style={won ? { color: '#86efac', fontWeight: 800 } : undefined}>{won ? 'WON · ' : ''}₹{Number(entry.amount).toLocaleString('en-IN')}</span>
                        </div>
                      )
                    })}
                  </div>
                  <p className="booking-created">Booked {new Date(booking.created_at).toLocaleString('en-IN')}</p>
                </div>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}

export default MyBookings
