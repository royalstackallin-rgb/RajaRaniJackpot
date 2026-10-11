import { useMemo, useState } from 'react'

const NUMBERS = Array.from({ length: 100 }, (_, i) => String(i).padStart(2, '0'))
const TRIAL_OPTIONS = [1000, 10000, 20000]

function buildProbabilities(stakes) {
  const values = NUMBERS.map((number) => Math.max(0, Math.floor(Number(stakes[number]) || 0)))
  const maxStake = Math.max(...values)
  const maxCount = values.filter((stake) => stake === maxStake).length

  if (maxStake === 0 || maxCount === 100) {
    return values.map(() => 0.01)
  }

  const otherWeights = values.map((stake) =>
    stake === maxStake ? 0 : 1 / (1 + stake),
  )
  const otherTotal = otherWeights.reduce((sum, weight) => sum + weight, 0)

  return values.map((stake, index) =>
    stake === maxStake
      ? 0.00005 / maxCount
      : (otherWeights[index] / otherTotal) * 0.99995,
  )
}

export default function ProbabilityLab() {
  const [stakes, setStakes] = useState({})
  const [trialCount, setTrialCount] = useState(10000)
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(false)

  const probabilityInfo = useMemo(() => {
    const probabilities = buildProbabilities(stakes)
    const maxStake = Math.max(0, ...Object.values(stakes).map((v) => Number(v) || 0))
    const highestNumbers = NUMBERS.filter((number) => (Number(stakes[number]) || 0) === maxStake)
    return { probabilities, maxStake, highestNumbers }
  }, [stakes])

  const loadExample = () => {
    setStakes({ '07': '100', '08': '10' })
    setResults(null)
  }

  const runSimulation = () => {
    setBusy(true)
    // Keep this client-only: it never calls Supabase or changes a wallet/round.
    window.setTimeout(() => {
      const counts = Array(100).fill(0)
      const cumulative = []
      let running = 0
      for (const probability of probabilityInfo.probabilities) {
        running += probability
        cumulative.push(running)
      }
      for (let i = 0; i < trialCount; i += 1) {
        const roll = Math.random()
        let index = cumulative.findIndex((limit) => roll < limit)
        if (index < 0) index = 99
        counts[index] += 1
      }
      setResults({ counts, total: trialCount })
      setBusy(false)
    }, 0)
  }

  const highestStakeNumbers = probabilityInfo.maxStake === 0
    ? []
    : probabilityInfo.highestNumbers.filter((number) => (Number(stakes[number]) || 0) === probabilityInfo.maxStake)

  return (
    <section className="probability-lab">
      <div className="probability-lab-header">
        <div>
          <p className="double-eyebrow">SIMULATION ONLY · NO WALLET CHANGES</p>
          <h2>Double Probability Lab</h2>
          <p>Try stake combinations and run local virtual draws. Nothing is saved to the server.</p>
        </div>
      </div>

      <div className="probability-lab-rules">
        <strong>Test rule</strong>
        <ul>
          <li>No stakes: every number has a 1% chance.</li>
          <li>When stakes exist, highest-stake number(s) share a combined 0.005% chance.</li>
          <li>All other numbers share 99.995%, weighted inversely by their stakes.</li>
          <li>If all 100 numbers are tied at the highest stake, odds revert to 1% each.</li>
        </ul>
      </div>

      <div className="probability-lab-actions">
        <button type="button" onClick={loadExample}>Load example stakes</button>
        <button type="button" onClick={() => { setStakes({}); setResults(null) }}>Clear all stakes</button>
      </div>

      <div className="probability-lab-grid">
        {NUMBERS.map((number) => (
          <label key={number} className="probability-lab-number">
            <span>{number}</span>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              placeholder="0"
              value={stakes[number] ?? ''}
              onChange={(event) => {
                const raw = event.target.value
                setStakes((current) => {
                  const next = { ...current }
                  if (raw === '') delete next[number]
                  else next[number] = raw
                  return next
                })
                setResults(null)
              }}
              aria-label={`Virtual stake for number ${number}`}
            />
          </label>
        ))}
      </div>

      <div className="probability-lab-controls">
        <label>
          Simulation draws
          <select value={trialCount} onChange={(event) => setTrialCount(Number(event.target.value))}>
            {TRIAL_OPTIONS.map((count) => <option key={count} value={count}>{count.toLocaleString('en-IN')}</option>)}
          </select>
        </label>
        <button type="button" onClick={runSimulation} disabled={busy}>
          {busy ? 'Running…' : 'Run virtual simulation'}
        </button>
      </div>

      <p className="probability-lab-note">
        Highest stake: <strong>{probabilityInfo.maxStake.toLocaleString('en-IN')}</strong>
        {highestStakeNumbers.length > 0 && <> · Highest number(s): <strong>{highestStakeNumbers.join(', ')}</strong></>}
      </p>

      {results && (
        <div className="probability-lab-results" aria-live="polite">
          <h3>Results from {results.total.toLocaleString('en-IN')} virtual draws</h3>
          <p>Highest-stake number(s) won <strong>{results.counts.reduce((sum, count, index) => sum + (highestStakeNumbers.includes(NUMBERS[index]) ? count : 0), 0).toLocaleString('en-IN')}</strong> times.</p>
          <p>Each highest-stake number's target probability: <strong>{highestStakeNumbers.length ? (0.005 / highestStakeNumbers.length).toFixed(6) : '1.000000'}%</strong>{highestStakeNumbers.length ? ' per number' : ' per number (no stakes)'}</p>
          <div className="probability-lab-results-grid">
            {NUMBERS.map((number, index) => (
              <div className="probability-lab-result" key={number}>
                <span>{number}</span>
                <strong>{results.counts[index]}</strong>
                <small>{(results.counts[index] / results.total * 100).toFixed(2)}%</small>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
