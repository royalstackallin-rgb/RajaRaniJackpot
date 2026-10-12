import { useEffect, useState } from 'react'
import DoubleResults from './DoubleResults'
import { supabase } from '../lib/supabase'

function localDateString() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function formatRoundTime(value) {
  const [hours, minutes] = String(value).slice(0, 5).split(':').map(Number)
  const period = hours >= 12 ? 'PM' : 'AM'
  const hour12 = hours % 12 || 12
  return `${hour12}:${String(minutes).padStart(2, '0')} ${period}`
}

const ROUND_NAMES = {
  '00:00': 'MIDNIGHT JACKPOT',
  '01:00': 'SILVER STAR',
  '02:00': 'LUCKY MOON',
  '03:00': 'DIAMOND NIGHT',
  '04:00': 'ROYAL DAWN',
  '05:00': 'FIRST LIGHT',
  '06:00': 'MORNING GLORY',
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
  '19:00': 'RAJARANI',
  '20:00': 'MOONLIGHT',
  '21:00': 'MIDNIGHT STAR',
  '22:00': 'NIGHT DIAMOND',
  '23:00': 'ROYAL DREAM',
}

function getRoundName(round) {
  if (!round?.round_time) return 'RAJARANI JACKPOT'
  const time = String(round.round_time).slice(0, 5)
  return ROUND_NAMES[time] || 'RAJARANI JACKPOT'
}

function GameResults({ initialGame = null }) {
  const [selectedGame, setSelectedGame] = useState(initialGame)
  const [date, setDate] = useState(localDateString())
  const [time, setTime] = useState('')
  const [rounds, setRounds] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')

  async function searchResults(event) {
    event?.preventDefault()
    setLoading(true)
    setError('')
    setSearched(true)

    try {
      let query = supabase
        .from('game_rounds')
        .select(`
          id,
          round_code,
          game_date,
          round_time,
          status,
          game_round_results (
            ticket_row,
            winning_number
          )
        `)
        .eq('game_date', date)
        .in('status', ['drawn', 'settled'])
        .order('round_time', { ascending: false })

      if (time) {
        query = query
          .gte('round_time', `${time}:00`)
          .lt('round_time', `${time}:59.999999`)
      }

      const { data, error: queryError } = await query

      if (queryError) throw queryError

      setRounds(data || [])
    } catch (err) {
      setError(err.message || 'Could not load game results.')
      setRounds([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    searchResults()
  }, [])

  if (selectedGame === 'double') {
    return (
      <section className="history-page">

        <DoubleResults />
      </section>
    )
  }

  if (selectedGame === null) {
    return (
      <section className="history-page">
        <div className="history-heading">
          <span className="history-eyebrow">OFFICIAL HISTORY</span>
          <h2>Game Results</h2>
          <p>Choose a game to view its completed results.</p>
        </div>
        <div className="booking-list">
          <button type="button" className="history-empty" style={{ display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer' }} onClick={() => setSelectedGame('classic')}>
            <h3>StakeClassic</h3>
            <p>View A–G winning numbers for completed rounds.</p>
          </button>
          <button type="button" className="history-empty" style={{ display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer' }} onClick={() => setSelectedGame('double')}>
            <h3>Targetor Double</h3>
            <p>View completed rounds and Double winning numbers.</p>
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="history-page">

      <div className="history-heading">
        <span className="history-eyebrow">OFFICIAL HISTORY</span>
        <h2>Game Results</h2>
        <p>Look up completed rounds and their A–G winning numbers.</p>
      </div>

      <form className="results-search" onSubmit={searchResults}>
        <label>
          Date
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            required
          />
        </label>

        <label>
          Time (optional)
          <input
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
          />
        </label>

        <button className="submit-button" type="submit" disabled={loading}>
          {loading ? 'Searching…' : 'Search Results'}
        </button>
      </form>

      {error && (
        <p className="history-error" role="alert">
          {error}
        </p>
      )}

      {loading && <p className="history-message">Loading results…</p>}

      {!loading && !error && searched && rounds.length === 0 && (
        <div className="history-empty">
          <h3>No completed results found</h3>
          <p>Try another date or clear the time filter.</p>
        </div>
      )}

      <div className="results-list">
        {rounds.map((round) => {
          const rowResults = round.game_round_results || []

          return (
            <article className={`result-card round-theme-${String(round?.round_time || '').slice(0, 5).replace(':', '-')}`} key={round.id}>
              <div className="result-card-heading">
                <div>
                  <h3>{getRoundName(round)}</h3>
                  <p className="booking-time">{round.round_code}</p>
                  <p>
                    {round.game_date} · {formatRoundTime(round.round_time)}
                  </p>
                </div>
                <span className="booking-status won">COMPLETED</span>
              </div>

              <div className="result-number-grid">
                {['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((row) => {
                  const result = rowResults.find(
                    (item) => item.ticket_row === row,
                  )

                  return (
                    <div className="result-number-item" key={row}>
                      <span>ROW {row}</span>
                      <strong>{result?.winning_number ?? '—'}</strong>
                    </div>
                  )
                })}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

export default GameResults
