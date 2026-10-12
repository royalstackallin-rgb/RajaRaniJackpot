import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

function todayLocal() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function formatTime(value) {
  const [hours, minutes] = String(value || '').slice(0, 5).split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 'Time pending'
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours >= 12 ? 'PM' : 'AM'}`
}

function formatCountdown(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return [hours, minutes, remainder].map((part) => String(part).padStart(2, '0')).join(':')
}

export default function HomeDashboard({ onOpenGame, onOpenBookings, onOpenResults }) {
  const [nextRound, setNextRound] = useState(null)
  const [latestRound, setLatestRound] = useState(null)
  const [nextDoubleRound, setNextDoubleRound] = useState(null)
  const [latestDoubleRound, setLatestDoubleRound] = useState(null)
  const [now, setNow] = useState(new Date())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadDashboard() {
      setLoadError('')
      try {
        const today = todayLocal()
        const [nextResult, latestResult, nextDoubleResult, latestDoubleResult] = await Promise.all([
          supabase
            .from('game_rounds')
            .select('id, round_code, game_date, round_time, status')
            .gte('game_date', today)
            .eq('status', 'open')
            .order('game_date', { ascending: true })
            .order('round_time', { ascending: true })
            .limit(1),
          supabase
            .from('game_rounds')
            .select('id, round_code, game_date, round_time, status, game_round_results(ticket_row, winning_number)')
            .in('status', ['drawn', 'settled'])
            .order('game_date', { ascending: false })
            .order('round_time', { ascending: false })
            .limit(1),
          supabase
            .from('double_rounds')
            .select('id, round_code, game_date, round_time, status, winning_number, drawn_at')
            .gte('game_date', today)
            .eq('status', 'open')
            .order('game_date', { ascending: true })
            .order('round_time', { ascending: true })
            .limit(1),
          supabase
            .from('double_rounds')
            .select('id, round_code, game_date, round_time, status, winning_number, drawn_at')
            .in('status', ['drawn', 'settled'])
            .not('winning_number', 'is', null)
            .order('game_date', { ascending: false })
            .order('round_time', { ascending: false })
            .limit(1),
        ])
        if (nextResult.error) throw nextResult.error
        if (latestResult.error) throw latestResult.error
        if (nextDoubleResult.error) throw nextDoubleResult.error
        if (latestDoubleResult.error) throw latestDoubleResult.error
        if (!cancelled) {
          setNextRound(nextResult.data?.[0] || null)
          setLatestRound(latestResult.data?.[0] || null)
          setNextDoubleRound(nextDoubleResult.data?.[0] || null)
          setLatestDoubleRound(latestDoubleResult.data?.[0] || null)
        }
      } catch (error) {
        if (!cancelled) setLoadError(error.message || 'Could not load draw information.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadDashboard()
    const refresh = setInterval(loadDashboard, 30000)
    return () => {
      cancelled = true
      clearInterval(refresh)
    }
  }, [])

  const nextDrawAt = nextRound ? new Date(`${nextRound.game_date}T${nextRound.round_time}`) : null
  const cutoffAt = nextDrawAt ? new Date(nextDrawAt.getTime() - 5 * 60 * 1000) : null
  const bookingOpen = Boolean(cutoffAt && now < cutoffAt && now >= new Date(nextDrawAt.getTime() - 60 * 60 * 1000))
  const bookingClosed = Boolean(nextDrawAt && cutoffAt && now >= cutoffAt && now < nextDrawAt)
  const bookingStatus = !nextRound
    ? 'Schedule updating'
    : bookingOpen
      ? 'Bookings open'
      : bookingClosed
        ? 'Bookings closed'
        : 'Opening soon'
  const statusClass = bookingOpen ? 'is-open' : bookingClosed ? 'is-closed' : 'is-waiting'
  const doubleDrawAt = nextDoubleRound ? new Date(`${nextDoubleRound.game_date}T${String(nextDoubleRound.round_time).slice(0, 8)}+05:30`) : null
  const doubleCutoffAt = doubleDrawAt ? new Date(doubleDrawAt.getTime() - 5 * 60 * 1000) : null
  const doubleBookingOpen = Boolean(doubleCutoffAt && now < doubleCutoffAt && now >= new Date(doubleDrawAt.getTime() - 60 * 60 * 1000))
  const doubleBookingClosed = Boolean(doubleDrawAt && doubleCutoffAt && now >= doubleCutoffAt && now < doubleDrawAt)
  const doubleBookingStatus = !nextDoubleRound ? 'Schedule updating' : doubleBookingOpen ? 'Bookings open' : doubleBookingClosed ? 'Bookings closed' : 'Opening soon'
  const doubleStatusClass = doubleBookingOpen ? 'is-open' : doubleBookingClosed ? 'is-closed' : 'is-waiting'
  const resultRows = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((letter) => ({
    letter,
    number: latestRound?.game_round_results?.find((item) => item.ticket_row === letter)?.winning_number,
  }))

  return (
    <section className="home-dashboard">
      <div className="home-welcome">
        <span className="home-eyebrow">WELCOME TO TARGETORSTAKE</span>
        <h1>Every draw, at a glance.</h1>
        <p>Your next draw, booking status and latest result — all in one place.</p>
      </div>

      <article className="home-next-draw">
        <div className="home-card-topline">
          <span className="home-eyebrow">NEXT STAKECLASSIC DRAW</span>
          <span className={`home-status ${statusClass}`}>{bookingStatus}</span>
        </div>
        {loading ? (
          <p className="home-loading">Checking the draw schedule…</p>
        ) : nextRound ? (
          <>
            <div className="home-draw-main">
              <div>
                <strong className="home-draw-time">{formatTime(nextRound.round_time)}</strong>
                <span className="home-draw-date">{nextRound.game_date}</span>
              </div>
              <div className="home-countdown">
                <span>{bookingOpen ? 'BOOKING CLOSES IN' : bookingClosed ? 'DRAW STARTS IN' : 'DRAW STARTS IN'}</span>
                <strong>{formatCountdown(nextDrawAt - now - (bookingOpen ? 5 * 60 * 1000 : 0))}</strong>
              </div>
            </div>
            <p className="home-round-code">{nextRound.round_code || 'Upcoming round'}</p>
          </>
        ) : (
          <p className="home-loading">No upcoming round is available right now. Please check again shortly.</p>
        )}
        {loadError && <p className="home-error" role="status">{loadError}</p>}
        <button type="button" className="home-primary-button" onClick={() => onOpenGame('tickets')}>Enter StakeClassic Lobby <span>→</span></button>
      </article>

      <article className="home-latest-card home-center-result">
        <div className="home-section-heading">
          <div><span className="home-eyebrow">MOST RECENT COMPLETED ROUND</span><h2>Latest StakeClassic result</h2></div>
          <button type="button" onClick={onOpenResults}>All results →</button>
        </div>
        {latestRound ? (
          <>
            <div className="home-result-meta">{latestRound.game_date} <span>·</span> {formatTime(latestRound.round_time)}</div>
            <div className="home-result-grid">
              {resultRows.map((item) => <div className="home-result-number" key={item.letter}><span>{item.letter}</span><strong>{item.number ?? '—'}</strong></div>)}
            </div>
          </>
        ) : <p className="home-loading">The latest StakeClassic result will appear here.</p>}
      </article>

      <div className="home-game-grid home-game-grid-bottom">
        <button type="button" className="home-game-card" onClick={() => onOpenGame('tickets')}>
          <span className="home-game-icon">A–G</span>
          <span className="home-game-copy"><strong>StakeClassic Lobby</strong><small>Next draw, seven rows and ticket booking</small><em>ENTER LOBBY</em></span>
          <span className="home-arrow">→</span>
        </button>
        <button type="button" className="home-game-card home-double-card" onClick={() => onOpenGame('double')}>
          <span className="home-game-icon home-game-icon-double">00–99</span>
          <span className="home-game-copy"><strong>Targetor Double Lobby</strong><small>Next draw: {nextDoubleRound ? formatTime(nextDoubleRound.round_time) : 'Schedule updating'} · {nextDoubleRound?.game_date || '—'}</small><span className={`home-status ${doubleStatusClass}`}>{doubleBookingStatus}</span><small>{doubleBookingOpen ? 'Booking closes in' : 'Draw countdown'} · {doubleDrawAt ? formatCountdown(doubleDrawAt - now - (doubleBookingOpen ? 5 * 60 * 1000 : 0)) : '—'}</small><span className="home-double-latest">{latestDoubleRound ? `Latest result: ${String(latestDoubleRound.winning_number).padStart(2, '0')} · ${formatTime(latestDoubleRound.round_time)}` : 'Latest result: waiting for first draw'}</span><em>ENTER LOBBY</em></span>
          <span className="home-arrow">→</span>
        </button>
      </div>

      <article className="home-latest-card home-double-result">
        <div className="home-section-heading">
          <div><span className="home-eyebrow">MOST RECENT COMPLETED ROUND</span><h2>Latest Targetor Double result</h2></div>
          <button type="button" onClick={onOpenResults}>All results →</button>
        </div>
        {latestDoubleRound ? (
          <>
            <div className="home-result-meta">{latestDoubleRound.game_date} <span>·</span> {formatTime(latestDoubleRound.round_time)}</div>
            <div className="home-double-result-number"><span>WINNING NUMBER</span><strong>{String(latestDoubleRound.winning_number).padStart(2, '0')}</strong></div>
          </>
        ) : <p className="home-loading">The latest Targetor Double result will appear here.</p>}
      </article>
        <div className="home-section-heading">
          <div><span className="home-eyebrow">MOST RECENT COMPLETED ROUND</span><h2>Latest result</h2></div>
          <button type="button" onClick={onOpenResults}>All results →</button>
        </div>
        {latestRound ? (
          <>
            <div className="home-result-meta">{latestRound.game_date} <span>·</span> {formatTime(latestRound.round_time)}</div>
            <div className="home-result-grid">
              {resultRows.map((item) => <div className="home-result-number" key={item.letter}><span>{item.letter}</span><strong>{item.number ?? '—'}</strong></div>)}
            </div>
          </>
        ) : (
          <p className="home-loading">The latest completed result will appear here.</p>
        )}
      </article>
    </section>
  )
}
