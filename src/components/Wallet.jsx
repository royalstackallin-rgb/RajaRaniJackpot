import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const money = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value || 0))

export default function Wallet() {
  const [balance, setBalance] = useState(null)
  const [amount, setAmount] = useState('500')
  const [reference, setReference] = useState('')
  const [proof, setProof] = useState(null)
  const [deposits, setDeposits] = useState([])
  const [assigned, setAssigned] = useState(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(true)
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    setRefreshing(true)
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) { setMessage('Please sign in again to view your wallet.'); setRefreshing(false); return }
    const [walletResult, depositResult] = await Promise.all([
      supabase.from('wallets').select('balance').eq('user_id', user.id).maybeSingle(),
      supabase.from('wallet_deposits').select('id,amount_rupees,status,created_at,payment_reference,review_note,assigned_upi_id')
        .eq('user_id', user.id).order('created_at', { ascending: false }).limit(10),
    ])
    if (walletResult.error) setMessage('Could not load wallet balance. Please try again.')
    else setBalance(walletResult.data?.balance ?? 0)
    if (!depositResult.error) setDeposits(depositResult.data || [])
    setRefreshing(false)
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const startPayment = async () => {
    setMessage('')
    const rupees = Number(amount)
    if (!Number.isSafeInteger(rupees) || rupees < 10 || rupees > 50000) { setMessage('Enter a whole amount between ₹10 and ₹50,000.'); return }
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('assign_manual_upi_method', { p_amount_rupees: rupees })
      if (error) throw error
      const assignment = Array.isArray(data) ? data[0] : data
      if (!assignment?.assignment_id || !assignment?.assigned_upi_id) throw new Error('No UPI account could be assigned. Please contact the host.')
      const method = {
        id: assignment.assignment_id,
        label: assignment.assigned_label,
        upi_id: assignment.assigned_upi_id,
        amount_rupees: assignment.amount_rupees,
        expires_at: assignment.expires_at,
      }
      setAssigned(method)
      const note = 'TARGETORSTAKE deposit ' + method.id.slice(0, 8)
      const upiUrl = 'upi://pay?pa=' + encodeURIComponent(method.upi_id) + '&pn=' + encodeURIComponent(method.label || 'TARGETORSTAKE') + '&am=' + encodeURIComponent(String(rupees)) + '&cu=INR&tn=' + encodeURIComponent(note)
      window.location.href = upiUrl
    } catch (error) {
      setMessage(error.message || 'Could not assign a UPI account.')
    } finally {
      setLoading(false)
    }
  }

  const submitRequest = async (event) => {
    event.preventDefault(); setMessage('')
    const rupees = Number(amount)
    if (!Number.isSafeInteger(rupees) || rupees < 10 || rupees > 50000) { setMessage('Enter a whole amount between ₹10 and ₹50,000.'); return }
    if (!assigned) { setMessage('First tap Pay with UPI to receive an assigned payment account.'); return }
    if (Number(assigned.amount_rupees) !== rupees) { setMessage('Amount changed. Start a new payment assignment.'); return }
    if (!reference.trim()) { setMessage('Enter the UPI transaction reference number.'); return }
    if (!proof) { setMessage('Upload the payment screenshot so the host can review your request.'); return }
    if (!['image/jpeg','image/png','image/webp'].includes(proof.type) || proof.size > 5 * 1024 * 1024) { setMessage('Choose a JPG, PNG or WEBP image under 5 MB.'); return }
    setLoading(true)
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError || !user) throw new Error('Please sign in again.')
      const path = user.id + '/' + crypto.randomUUID() + '-' + proof.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const { error: uploadError } = await supabase.storage.from('wallet-payment-proofs').upload(path, proof, { contentType: proof.type, upsert: false })
      if (uploadError) throw uploadError
      const { error: submitError } = await supabase.rpc('submit_manual_wallet_deposit', {
        p_assignment_id: assigned.id,
        p_payment_reference: reference.trim(),
        p_proof_path: path,
      })
      if (submitError) throw submitError
      setReference(''); setProof(null); setAssigned(null); setMessage('Request submitted. Your wallet will update only after the host verifies and approves the payment.')
      event.target.reset()
      await refresh()
    } catch (error) { setMessage(error.message || 'Could not submit the deposit request.') }
    finally { setLoading(false) }
  }

  return <section className="wallet-page">
    <div className="wallet-heading"><div><p className="wallet-eyebrow">TARGETORSTAKE ACCOUNT</p><h1>Wallet / Buy In</h1><p className="wallet-subtitle">Choose an amount, pay the randomly assigned UPI account, then submit your reference and screenshot for host review.</p></div><button type="button" className="wallet-refresh" onClick={refresh} disabled={refreshing}>Refresh</button></div>
    <div className="wallet-balance-card"><span>AVAILABLE BALANCE</span><strong>{refreshing && balance === null ? 'Loading…' : money(balance)}</strong><small>Pending requests are not included in your balance.</small></div>
    <div className="wallet-deposit-card"><h2>Step 1 · Pay by UPI</h2><label htmlFor="wallet-deposit-amount">Deposit amount (₹)</label><input id="wallet-deposit-amount" type="number" inputMode="numeric" min="10" max="50000" step="1" value={amount} onChange={e => { setAmount(e.target.value); setAssigned(null) }} required /><div className="wallet-quick-amounts">{[100,500,1000,2000].map(v => <button key={v} type="button" className={Number(amount) === v ? 'selected' : ''} onClick={() => { setAmount(String(v)); setAssigned(null) }}>₹{v.toLocaleString('en-IN')}</button>)}</div><button className="wallet-buy-button" type="button" onClick={startPayment} disabled={loading}>{loading ? 'Preparing payment…' : 'Pay with UPI'}</button>{assigned && <div className="wallet-upi-id"><span>Assigned receiving account</span><strong>{assigned.label}</strong><strong>{assigned.upi_id}</strong><p>Pay exactly {money(amount)} to this account. If you cancel the payment, do not submit a deposit request.</p><button type="button" onClick={() => { navigator.clipboard?.writeText(assigned.upi_id); setMessage('UPI ID copied if clipboard permission is available.') }}>Copy UPI ID</button></div>}<p className="wallet-secure-note">Opening a UPI app does not confirm payment. Verify the recipient in your UPI app. Never enter your UPI PIN on this website.</p></div>
    <form className="wallet-deposit-card" onSubmit={submitRequest}>
      <h2>Step 2 · Submit payment request</h2><p>Only submit this after completing the payment. Cancelled payments should not be submitted.</p>
      <label htmlFor="wallet-upi-reference">UPI transaction reference / UTR</label><input id="wallet-upi-reference" value={reference} onChange={e => setReference(e.target.value)} maxLength={100} placeholder="Enter transaction reference" required />
      <label htmlFor="wallet-proof">Payment screenshot (JPG/PNG/WEBP, max 5 MB)</label><input id="wallet-proof" type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setProof(e.target.files?.[0] || null)} required />
      <button className="wallet-buy-button" type="submit" disabled={loading || !assigned}>{loading ? 'Submitting request…' : 'Submit for host approval'}</button>
    </form>
    {message && <p className="wallet-message" role="status">{message}</p>}
    <div className="wallet-history-card"><div className="wallet-history-heading"><h2>My deposit requests</h2><button type="button" onClick={refresh} disabled={refreshing}>Reload</button></div>{deposits.length === 0 ? <p className="wallet-empty">No deposit requests yet.</p> : <div className="wallet-deposit-list">{deposits.map(d => <div className="wallet-deposit-row" key={d.id}><div><strong>{money(d.amount_rupees)}</strong><span>{new Date(d.created_at).toLocaleString('en-IN')}{d.assigned_upi_id ? ' · Paid to: ' + d.assigned_upi_id : ''}{d.payment_reference ? ' · Ref: ' + d.payment_reference : ''}</span>{d.review_note && <span>{d.review_note}</span>}</div><span className={'wallet-deposit-status ' + d.status}>{d.status === 'credited' ? 'approved' : d.status === 'failed' ? 'rejected' : d.status}</span></div>)}</div>}</div><p className="wallet-disclaimer">A screenshot does not prove payment. Wallet credits are added only after host verification. Use only if this activity is legally permitted and approved by your payment provider.</p>
  </section>
}
