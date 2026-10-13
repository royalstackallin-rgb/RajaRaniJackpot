import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

function todayIST() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}
function displayTime(value) {
  const [h, m] = String(value).slice(0, 5).split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

export default function DoubleResults() {
  const [date, setDate] = useState(todayIST())
  const [rounds, setRounds] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function loadResults(event) {
    event?.preventDefault()
    setLoading(true)
    setError('')
    try {
      const { data, error: queryError } = await supabase
        .from('double_rounds')
        .select('id, round_code, game_date, round_time, status, winning_number, drawn_at')
        .eq('game_date', date)
        .in('status', ['drawn', 'settled'])
        .order('round_time', { ascending: false })
      if (queryError) throw queryError
      setRounds(data || [])
    } catch (err) {
      setError(err.message || 'Could not load Twin Fortune results.')
      setRounds([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadResults() }, [])

  return (
    <section className="history-page">
      <div className="history-heading">
        <span className="history-eyebrow">OFFICIAL HISTORY</span>
        <h2>Twin Fortune Results</h2>
        <p>Completed Double rounds and winning numbers.</p>
      </div>
      <form className="results-search" onSubmit={loadResults}>
        <label>
          Date
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </label>
        <button className="submit-button" type="submit" disabled={loading}>
          {loading ? 'Searching…' : 'Search Results'}
        </button>
      </form>
      {error && <p className="history-error" role="alert">{error}</p>}
      {loading && <p className="history-message">Loading results…</p>}
      {!loading && !error && rounds.length === 0 && (
        <div className="history-empty">
          <h3>No completed results found</h3>
          <p>Try another date.</p>
        </div>
      )}
      <div className="results-list">
        {rounds.map((round) => (
          <article className="result-card" key={round.id}>
            <div className="result-card-heading">
              <div>
                <h3>Twin Fortune</h3>
                <p>{round.game_date} · {displayTime(round.round_time)}</p>
              </div>
              <span className="booking-status won">COMPLETED</span>
            </div>
            <div className="result-number-grid">
              <div className="result-number-item">
                <span>WINNING NUMBER</span>
                <strong>{round.winning_number ?? '—'}</strong>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
