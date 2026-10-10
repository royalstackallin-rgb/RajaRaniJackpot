import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const money = (value) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
}).format(Number(value || 0))

export default function Wallet() {
  const [balance, setBalance] = useState(null)
  const [amount, setAmount] = useState('500')
  const [deposits, setDeposits] = useState([])
  const [loading, setLoading] = useState(false)
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

    const [walletResult, depositResult] = await Promise.all([
      supabase.from('wallets').select('balance').eq('user_id', user.id).maybeSingle(),
      supabase.from('wallet_deposits')
        .select('id,amount_rupees,status,created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10),
    ])

    if (walletResult.error) {
      setMessage('Could not load wallet balance. Please try again.')
    } else {
      setBalance(walletResult.data?.balance ?? 0)
    }
    if (!depositResult.error) setDeposits(depositResult.data || [])
    setRefreshing(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const startDeposit = async (event) => {
    event.preventDefault()
    setMessage('')
    const rupees = Number(amount)
    if (!Number.isSafeInteger(rupees) || rupees < 10 || rupees > 50000) {
      setMessage('Enter a whole amount between ₹10 and ₹50,000.')
      return
    }

    setLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('create-upi-deposit', {
        body: { amount: rupees },
      })
      if (error) throw error
      if (!data?.payment_url) throw new Error(data?.error || 'Payment setup is not ready yet.')
      window.location.assign(data.payment_url)
    } catch (error) {
      setMessage(error.message || 'Could not start payment. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const checkStatus = async () => {
    setMessage('Refreshing wallet status. A payment is credited only after the payment provider verifies it.')
    await refresh()
  }

  return (
    <section className="wallet-page">
      <div className="wallet-heading">
        <div>
          <p className="wallet-eyebrow">TARGETORSTAKE ACCOUNT</p>
          <h1>Wallet / Buy In</h1>
          <p className="wallet-subtitle">Add funds through UPI. Your balance updates only after server-side payment verification.</p>
        </div>
        <button type="button" className="wallet-refresh" onClick={checkStatus} disabled={refreshing}>Refresh</button>
      </div>

      <div className="wallet-balance-card">
        <span>AVAILABLE BALANCE</span>
        <strong>{refreshing && balance === null ? 'Loading…' : money(balance)}</strong>
        <small>Balance shown in your game account</small>
      </div>

      <form className="wallet-deposit-card" onSubmit={startDeposit}>
        <h2>Buy In with UPI</h2>
        <p>Choose an amount, then continue to the secure payment page.</p>
        <label htmlFor="wallet-deposit-amount">Deposit amount (₹)</label>
        <input
          id="wallet-deposit-amount"
          type="number"
          inputMode="numeric"
          min="10"
          max="50000"
          step="1"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          required
        />
        <div className="wallet-quick-amounts">
          {[100, 500, 1000, 2000].map((value) => (
            <button key={value} type="button" className={Number(amount) === value ? 'selected' : ''} onClick={() => setAmount(String(value))}>
              ₹{value.toLocaleString('en-IN')}
            </button>
          ))}
        </div>
        <button className="wallet-buy-button" type="submit" disabled={loading}>
          {loading ? 'Preparing payment…' : 'Continue to UPI'}
        </button>
        <p className="wallet-secure-note">We never credit deposits based only on a browser redirect or screenshot.</p>
      </form>

      {message && <p className="wallet-message" role="status">{message}</p>}

      <div className="wallet-history-card">
        <div className="wallet-history-heading">
          <h2>Recent deposits</h2>
          <button type="button" onClick={refresh} disabled={refreshing}>Reload</button>
        </div>
        {deposits.length === 0 ? (
          <p className="wallet-empty">No deposits yet.</p>
        ) : (
          <div className="wallet-deposit-list">
            {deposits.map((deposit) => (
              <div className="wallet-deposit-row" key={deposit.id}>
                <div><strong>{money(deposit.amount_rupees)}</strong><span>{new Date(deposit.created_at).toLocaleString('en-IN')}</span></div>
                <span className={`wallet-deposit-status ${deposit.status}`}>{deposit.status.replaceAll('_', ' ')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="wallet-disclaimer">Deposits are processed by the payment provider. Do not pay if the secure payment page does not open.</p>
    </section>
  )
}
