import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const money = (v) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(v || 0))

export default function DepositAdmin() {
  const [isAdmin, setIsAdmin] = useState(false)
  const [requests, setRequests] = useState([])
  const [methods, setMethods] = useState([])
  const [label, setLabel] = useState('')
  const [upiId, setUpiId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [message, setMessage] = useState('')
  const [proofUrls, setProofUrls] = useState({})

  const refresh = useCallback(async () => {
    setLoading(true); setMessage('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setMessage('Please sign in.'); setLoading(false); return }
    const { data: adminRow, error: adminError } = await supabase.from('wallet_admins').select('user_id').eq('user_id', user.id).maybeSingle()
    if (adminError || !adminRow) { setIsAdmin(false); setMessage('This account is not authorized to access the deposit admin panel.'); setLoading(false); return }
    setIsAdmin(true)
    const [depositResult, methodResult] = await Promise.all([
      supabase.from('wallet_deposits').select('id,user_id,amount_rupees,status,payment_reference,payment_method,proof_path,created_at,review_note,assigned_upi_id').eq('provider', 'manual_upi').order('created_at', { ascending: false }).limit(100),
      supabase.from('wallet_payment_methods').select('id,label,upi_id,active,created_at').order('created_at', { ascending: false }),
    ])
    if (depositResult.error) setMessage('Could not load requests: ' + depositResult.error.message)
    else {
      setRequests(depositResult.data || [])
      const urls = {}
      for (const item of (depositResult.data || [])) {
        if (item.proof_path) {
          const { data: signed } = await supabase.storage.from('wallet-payment-proofs').createSignedUrl(item.proof_path, 300)
          if (signed?.signedUrl) urls[item.id] = signed.signedUrl
        }
      }
      setProofUrls(urls)
    }
    if (methodResult.error) setMessage('Could not load UPI accounts: ' + methodResult.error.message)
    else setMethods(methodResult.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const addMethod = async (event) => {
    event.preventDefault(); setMessage('')
    const cleanLabel = label.trim()
    const cleanUpi = upiId.trim()
    if (!cleanLabel || !cleanUpi || !/^[^\s@]+@[^\s@]+$/.test(cleanUpi)) { setMessage('Enter a label and a valid-looking UPI ID.'); return }
    setBusyId('method')
    const { error } = await supabase.from('wallet_payment_methods').insert({ label: cleanLabel, upi_id: cleanUpi, active: true })
    if (error) setMessage('Could not add account: ' + error.message)
    else { setLabel(''); setUpiId(''); setMessage('UPI receiving account added.'); await refresh() }
    setBusyId('')
  }

  const toggleMethod = async (method) => {
    setBusyId(method.id); setMessage('')
    const { error } = await supabase.from('wallet_payment_methods').update({ active: !method.active, updated_at: new Date().toISOString() }).eq('id', method.id)
    if (error) setMessage('Could not update account: ' + error.message)
    else await refresh()
    setBusyId('')
  }

  const deleteMethod = async (method) => {
    if (!window.confirm('Delete this UPI account from the active account list? Existing deposit records keep their saved UPI ID.')) return
    setBusyId(method.id); setMessage('')
    const { error } = await supabase.from('wallet_payment_methods').delete().eq('id', method.id)
    if (error) setMessage('Could not delete account: ' + error.message)
    else await refresh()
    setBusyId('')
  }

  const review = async (item, approve) => {
    const promptText = approve
      ? 'Confirm you checked your bank transaction history, the exact amount arrived to ' + (item.assigned_upi_id || 'the assigned account') + ', and the reference matches. Type OK to credit this wallet.'
      : 'Optional reason for rejecting this request:'
    const answer = window.prompt(promptText, approve ? '' : 'Payment not verified')
    if (answer === null || (approve && answer.trim().toUpperCase() !== 'OK')) return
    setBusyId(item.id); setMessage('')
    const { data, error } = await supabase.rpc('review_manual_wallet_deposit', {
      p_deposit_id: item.id, p_approve: approve, p_note: answer.trim() || null,
    })
    if (error) setMessage('Review failed: ' + error.message)
    else setMessage(data === 'credited' ? 'Deposit approved and wallet credited.' : 'Deposit request rejected.')
    setBusyId(''); await refresh()
  }

  return <section className="wallet-page deposit-admin-page">
    <div className="wallet-heading"><div><p className="wallet-eyebrow">PRIVATE HOST TOOLS</p><h1>Deposit Requests &amp; UPI Accounts</h1><p className="wallet-subtitle">Manage receiving accounts. Verify every payment in the relevant bank transaction history before approving.</p></div><button className="wallet-refresh" onClick={refresh} disabled={loading}>Refresh</button></div>
    {message && <p className="wallet-message" role="status">{message}</p>}
    {!isAdmin ? <div className="wallet-history-card"><h2>Admin access required</h2><p className="wallet-subtitle">Add your authenticated user ID to public.wallet_admins in the correct Supabase project before using these tools.</p></div> : <>
      <div className="wallet-history-card"><h2>Add receiving UPI account</h2><p>Only add accounts you control and are permitted to use for this activity.</p><form onSubmit={addMethod} className="deposit-method-form"><label htmlFor="deposit-method-label">Account label</label><input id="deposit-method-label" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. SBI UPI" maxLength={60} required /><label htmlFor="deposit-method-upi">UPI ID</label><input id="deposit-method-upi" value={upiId} onChange={e => setUpiId(e.target.value)} placeholder="name@bank" maxLength={255} autoCapitalize="none" required /><button className="wallet-buy-button" type="submit" disabled={busyId === 'method'}>{busyId === 'method' ? 'Adding…' : 'Add UPI account'}</button></form>
      <h3>Saved receiving accounts</h3>{methods.length === 0 ? <p className="wallet-empty">No UPI accounts added yet. Add at least one active account before players can start deposits.</p> : <div className="deposit-admin-list">{methods.map(method => <article className="deposit-admin-card" key={method.id}><div className="deposit-admin-card-head"><div><strong>{method.label}</strong><small>{method.upi_id}</small></div><span className={'wallet-deposit-status ' + (method.active ? 'credited' : 'failed')}>{method.active ? 'active' : 'disabled'}</span></div><div className="deposit-admin-actions"><button disabled={busyId === method.id} onClick={() => toggleMethod(method)}>{method.active ? 'Disable' : 'Enable'}</button><button className="reject" disabled={busyId === method.id} onClick={() => deleteMethod(method)}>Delete</button></div></article>)}</div>}</div>
      <div className="deposit-admin-stats"><div><span>Pending</span><strong>{requests.filter(x => x.status === 'pending').length}</strong></div><div><span>Approved</span><strong>{requests.filter(x => x.status === 'credited').length}</strong></div><div><span>Rejected</span><strong>{requests.filter(x => x.status === 'failed').length}</strong></div></div>
      {loading ? <p className="wallet-empty">Loading requests…</p> : requests.length === 0 ? <div className="wallet-history-card"><p className="wallet-empty">No deposit requests yet.</p></div> : <div className="deposit-admin-list">{requests.map(item => <article className="deposit-admin-card" key={item.id}>
        <div className="deposit-admin-card-head"><div><strong>{money(item.amount_rupees)}</strong><small>{new Date(item.created_at).toLocaleString('en-IN')}</small></div><span className={'wallet-deposit-status ' + item.status}>{item.status}</span></div>
        <p><b>Player ID:</b> <span className="deposit-reference">{item.user_id}</span></p><p><b>Assigned UPI:</b> <span className="deposit-reference">{item.assigned_upi_id || 'Not recorded'}</span></p><p><b>UPI reference:</b> <span className="deposit-reference">{item.payment_reference || 'Not provided'}</span></p>
        {proofUrls[item.id] && <a className="deposit-proof-link" href={proofUrls[item.id]} target="_blank" rel="noreferrer">View payment screenshot</a>}
        {item.review_note && <p><b>Review note:</b> {item.review_note}</p>}
        {item.status === 'pending' && <div className="deposit-admin-actions"><button disabled={busyId === item.id} onClick={() => review(item, true)}>Verify &amp; Approve</button><button className="reject" disabled={busyId === item.id} onClick={() => review(item, false)}>Reject</button></div>}
      </article>)}</div>}
    </>}
  </section>
}
