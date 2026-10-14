import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import './RiseOrRuin.css'

const STARTING_POINTS = 100
const MAX_STEPS = 10
const money = (value) => Math.max(0, Number(value) || 0).toLocaleString('en-IN')

export default function RiseOrRuin() {
  const [balance, setBalance] = useState(null)
  const [run, setRun] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('Start with 100 practice points. Climb carefully, then cash out.')
  const [history, setHistory] = useState([])

  const refresh = useCallback(async () => {
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData?.user) { setMessage('Please sign in to play.'); return }
    const [walletResult, runResult] = await Promise.all([
      supabase.from('rise_ruin_wallets').select('balance').eq('user_id', userData.user.id).maybeSingle(),
      supabase.from('rise_ruin_runs').select('id,stake,step,status,payout,created_at').eq('user_id', userData.user.id).eq('status','rising').order('created_at',{ascending:false}).limit(1).maybeSingle(),
    ])
    if (walletResult.error) { setMessage('Rise or Ruin is not ready yet. Apply its Supabase migration first.'); return }
    setBalance(walletResult.data?.balance ?? STARTING_POINTS)
    if (runResult.data) setRun({ id: runResult.data.id, step: runResult.data.step, status: runResult.data.status, stake: runResult.data.stake })
    else setRun(null)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const start = async () => {
    if (busy || run) return
    setBusy(true)
    const { data, error } = await supabase.rpc('rise_ruin_start')
    if (error) setMessage(error.message || 'Could not start a run.')
    else {
      setBalance(Number(data.balance))
      setRun({ id: data.run_id, step: 0, status: 'rising', stake: Number(data.stake) })
      setMessage('The tower is yours. Make your first climb.')
    }
    setBusy(false)
  }

  const climb = async () => {
    if (!run || run.status !== 'rising' || busy) return
    setBusy(true)
    const { data, error } = await supabase.rpc('rise_ruin_climb', { p_run_id: run.id })
    if (error) setMessage(error.message || 'Could not climb. Try again.')
    else if (!data.safe) {
      setRun({ ...run, status: 'ruined' })
      setBalance(Number(data.balance))
      setHistory((items) => [{ status: 'RUINED', step: Number(data.step), payout: 0 }, ...items].slice(0, 5))
      setMessage('RUIN! The tower collapsed. Your 100 practice points are gone.')
    } else {
      setRun({ ...run, step: Number(data.step) })
      setBalance(Number(data.balance))
      setMessage(`Safe step ${data.step}! Your potential cash-out is ${money(data.potential_payout)} practice points.`)
    }
    setBusy(false)
  }

  const cashOut = async () => {
    if (!run || run.status !== 'rising' || run.step < 1 || busy) return
    setBusy(true)
    const { data, error } = await supabase.rpc('rise_ruin_cash_out', { p_run_id: run.id })
    if (error) setMessage(error.message || 'Cash out failed. Your run is still active.')
    else {
      setBalance(Number(data.balance))
      setRun({ ...run, status: 'cashed_out', payout: Number(data.payout) })
      setHistory((items) => [{ status: 'CASHED OUT', step: Number(data.step), payout: Number(data.payout) }, ...items].slice(0, 5))
      setMessage(`Cashed out ${money(data.payout)} practice points. Nice climb!`)
    }
    setBusy(false)
  }

  const multiplier = run ? Number((1.2 ** run.step).toFixed(2)) : 1
  const canStart = balance !== null && balance >= STARTING_POINTS && !run && !busy

  return <main className="rise-game">
    <section className="rise-header">
      <div><span className="rise-eyebrow">TARGETORSTAKE ORIGINAL</span><h1>RISE <em>OR</em> RUIN</h1><p>One more step could change everything.</p></div>
      <div className="rise-balance"><small>PRACTICE POINTS</small><strong>{balance === null ? '—' : money(balance)}</strong></div>
    </section>
    <section className="rise-multiplier-panel">
      <div><span className="rise-eyebrow">CURRENT MULTIPLIER</span><strong>{multiplier.toFixed(2)}×</strong></div>
      <div className="rise-potential"><small>IF YOU CASH OUT</small><strong>{run && run.step > 0 && run.status === 'rising' ? money(Math.floor(100 * multiplier)) : '—'}</strong></div>
    </section>
    <section className="rise-tower" aria-label="Tower progress">
      {Array.from({ length: MAX_STEPS }, (_, index) => {
        const level = MAX_STEPS - index
        const reached = Boolean(run && run.step >= level)
        const current = Boolean(run && run.step === level && run.status === 'rising')
        return <div key={level} className={`rise-level ${reached ? 'is-reached' : ''} ${current ? 'is-current' : ''} ${run?.status === 'ruined' && level === run.step + 1 ? 'is-ruin' : ''}`}><span>{String(level).padStart(2,'0')}</span><div className="rise-level-bar" /><strong>{(1.2 ** level).toFixed(2)}×</strong></div>
      })}
      <div className={`rise-level rise-ground ${run?.step === 0 ? 'is-current' : ''}`}><span>START</span><div className="rise-level-bar" /><strong>1.00×</strong></div>
    </section>
    <section className="rise-controls">
      {!run || run.status !== 'rising' ? <button className="rise-start" type="button" disabled={!canStart} onClick={start}>{busy ? 'PLEASE WAIT…' : balance !== null && balance < STARTING_POINTS ? 'NEED 100 PRACTICE POINTS' : 'START CLIMB · 100 POINTS'}</button> : <>
        <div className="rise-step-copy"><span>{run.step === 0 ? 'THE FIRST STEP IS THE RISKIEST' : `STEP ${run.step} OF ${MAX_STEPS}`}</span><strong>{run.step === 0 ? 'Ready to rise?' : `Potential return: ${money(Math.floor(100 * multiplier))}`}</strong></div>
        <button className="rise-climb" type="button" disabled={busy || run.step >= MAX_STEPS} onClick={climb}>{busy ? 'CLIMBING…' : run.step >= MAX_STEPS ? 'MAX HEIGHT REACHED' : '↑ RISE ONE STEP'}</button>
        <button className="rise-cashout" type="button" disabled={busy || run.step < 1} onClick={cashOut}>SECURE {run.step > 0 ? money(Math.floor(100 * multiplier)) : ''} POINTS</button>
      </>}
      <p className="rise-message" role="status">{message}</p>
      <p className="rise-disclaimer">Practice mode only. Points have no cash value and cannot be transferred to your TARGETORSTAKE wallet.</p>
    </section>
    {history.length > 0 && <section className="rise-history"><h2>RECENT RUNS</h2>{history.map((item,index) => <div className="rise-history-row" key={index}><span>{item.status}</span><span>Step {item.step}</span><strong>{item.payout ? '+'+money(item.payout) : '0'} pts</strong></div>)}</section>}
  </main>
}
