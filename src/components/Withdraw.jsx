import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const money = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value || 0))

export default function Withdraw() {
  const [balance, setBalance] = useState(null)
  const [withdrawals, setWithdrawals] = useState([])
  const [withdrawAmount, setWithdrawAmount] = useState('1')
  const [withdrawQr, setWithdrawQr] = useState(null)
  const [withdrawLoading, setWithdrawLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(true)
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    setRefreshing(true)
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      setMessage('Please sign in again to view your wallet.')
      setRefreshing(false)
      return
    }
    const [walletResult, withdrawalResult] = await Promise.all([
      supabase.from('wallets').select('balance').eq('user_id', user.id).maybeSingle(),
      supabase.from('withdrawal_requests').select('id,amount_rupees,status,created_at,admin_note').eq('user_id', user.id).order('created_at', { ascending: false }).limit(10),
    ])
    if (walletResult.error) setMessage('Could not load wallet balance. Please try again.')
    else setBalance(walletResult.data?.balance ?? 0)
    if (!withdrawalResult.error) setWithdrawals(withdrawalResult.data || [])
    setRefreshing(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const maxWithdrawable = balance === null ? 0 : Math.max(0, Number(balance))

  const submitWithdrawal = async (event) => {
    event.preventDefault()
    setMessage('')
    const amountValue = Number(withdrawAmount)
    if (!Number.isSafeInteger(amountValue) || amountValue < 1 || amountValue > 50000) {
      setMessage('Enter a whole withdrawal amount between ₹1 and ₹50,000.')
      return
    }
    if (balance === null || amountValue > Math.max(0, Number(balance))) {
      setMessage('Your wallet balance is insufficient for this withdrawal.')
      return
    }
    if (!withdrawQr) {
      setMessage('Upload your UPI QR image first.')
      return
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(withdrawQr.type) || withdrawQr.size > 5 * 1024 * 1024) {
      setMessage('Choose a JPG, PNG or WEBP image under 5 MB.')
      return
    }
    setWithdrawLoading(true)
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError || !user) throw new Error('Please sign in again.')
      const path = user.id + '/' + crypto.randomUUID() + '-' + withdrawQr.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const { error: uploadError } = await supabase.storage.from('withdrawal-qr-codes').upload(path, withdrawQr, { contentType: withdrawQr.type, upsert: false })
      if (uploadError) throw uploadError
      const { error: requestError } = await supabase.rpc('create_withdrawal_request', {
        p_amount_rupees: amountValue,
        p_qr_storage_path: path,
      })
      if (requestError) throw requestError
      setWithdrawQr(null)
      setMessage('Request submitted. The amount has been reserved from your available balance.')
      event.target.reset()
      await refresh()
    } catch (error) {
      setMessage(error.message || 'Could not submit withdrawal request.')
    } finally {
      setWithdrawLoading(false)
    }
  }

  return <section className="wallet-page">
    <div className="wallet-heading">
      <div>
        <p className="wallet-eyebrow">TARGETORSTAKE ACCOUNT</p>
        <h1>Withdraw</h1>
        <p className="wallet-subtitle">Request a withdrawal and track its review status.</p>
      </div>
      <button type="button" className="wallet-refresh" onClick={refresh} disabled={refreshing}>Refresh</button>
    </div>
    <div className="wallet-balance-card">
      <span>AVAILABLE BALANCE</span>
      <strong>{refreshing && balance === null ? 'Loading…' : money(balance)}</strong>
      <small>Your requested withdrawal amount is reserved when the request succeeds.</small>
    </div>
    <form className="wallet-deposit-card" onSubmit={submitWithdrawal}>
      <h2>Request withdrawal</h2>
      <p>No minimum withdrawal amount. {balance === null ? 'Loading available limit…' : `Maximum you can request now: ${money(Math.min(50000, maxWithdrawable))}.`} Upload your UPI QR image for host review.</p>
      <label htmlFor="withdraw-amount">Withdrawal amount (₹)</label>
      <input id="withdraw-amount" type="number" min="1" max={Math.min(50000, maxWithdrawable)} step="1" value={withdrawAmount} onChange={e => setWithdrawAmount(e.target.value)} required />
      <label htmlFor="withdraw-qr">Your UPI QR image (JPG/PNG/WEBP, max 5 MB)</label>
      <input id="withdraw-qr" type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setWithdrawQr(e.target.files?.[0] || null)} required />
      <button className="wallet-buy-button" type="submit" disabled={withdrawLoading}>{withdrawLoading ? 'Submitting...' : 'Request withdrawal'}</button>
    </form>
    {message && <p className="wallet-message" role="status">{message}</p>}
    <div className="wallet-history-card">
      <div className="wallet-history-heading">
        <h2>My withdrawal requests</h2>
        <button type="button" onClick={refresh} disabled={refreshing}>Reload</button>
      </div>
      {withdrawals.length === 0
        ? <p className="wallet-empty">No withdrawal requests yet.</p>
        : <div className="wallet-deposit-list">{withdrawals.map(w => <div className="wallet-deposit-row" key={w.id}>
            <div>
              <strong>{money(w.amount_rupees)}</strong>
              <span>{new Date(w.created_at).toLocaleString('en-IN')}</span>
              {w.admin_note && <span>{w.admin_note}</span>}
            </div>
            <span className={'wallet-deposit-status ' + w.status}>{w.status === 'approved' ? 'approved' : w.status}</span>
          </div>)}</div>}
    </div>
    <p className="wallet-disclaimer">Approval in this app does not itself transfer money. Confirm any payout with the host.</p>
  </section>
}
