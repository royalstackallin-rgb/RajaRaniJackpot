import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

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

function MyBookings() {
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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

    const entries = booking.game_entries || []
    const round = booking.game_rounds
    const results = entries.flatMap((entry) => entry.game_results || [])
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

  return (
    <section className="history-page">
      <div className="history-heading">
        <span className="history-eyebrow">YOUR ACTIVITY</span>
        <h2>My Bookings</h2>
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
          const round = booking.game_rounds
          const entries = booking.game_entries || []

          return (
            <article className="booking-card" key={booking.id}>
              <div className="booking-card-top">
                <div>
                  <span className="booking-row-label">
                    ROW {booking.ticket_row || '—'}
                  </span>
                  <h3>{getRoundName(round)}</h3>
                  <p className="booking-time">{round?.round_code || 'Game round'}</p>
                </div>
                <span
                  className={`booking-status ${outcome.label.toLowerCase()}`}
                >
                  {outcome.label}
                </span>
              </div>

              <p className="booking-time">
                {round?.game_date || 'Date unavailable'}
                {round?.round_time
                  ? ` · ${String(round.round_time).slice(0, 5)}`
                  : ''}
              </p>

              <div className="booking-details">
                <div>
                  <span>Tickets</span>
                  <strong>{booking.total_tickets}</strong>
                </div>
                <div>
                  <span>Cost</span>
                  <strong>{Number(booking.total_amount).toLocaleString('en-IN')} coins</strong>
                </div>
                <div>
                  <span>Payout</span>
                  <strong>{outcome.payout.toLocaleString('en-IN')} coins</strong>
                </div>
              </div>

              <div className="booking-entries">
                {entries.map((entry) => (
                  <div className="booking-entry" key={entry.id}>
                    <span className="booking-number">{entry.number}</span>
                    <span>Qty: {entry.quantity}</span>
                    <span>{Number(entry.amount).toLocaleString('en-IN')} coins</span>
                  </div>
                ))}
              </div>

              <p className="booking-created">
                Booked {new Date(booking.created_at).toLocaleString('en-IN')}
              </p>
            </article>
          )
        })}
      </div>
    </section>
  )
}

export default MyBookings
