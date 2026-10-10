import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const money = (v) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(v || 0))

export default function DepositAdmin() {
  const [isAdmin, setIsAdmin] = useState(false)
  const [requests, setRequests] = useState([])
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
    const { data, error } = await supabase.from('wallet_deposits')
      .select('id,user_id,amount_rupees,status,payment_reference,payment_method,proof_path,created_at,review_note')
      .eq('provider', 'manual_upi').order('created_at', { ascending: false }).limit(100)
    if (error) setMessage('Could not load requests: ' + error.message)
    else {
      setRequests(data || [])
      const urls = {}
      for (const item of (data || [])) {
        if (item.proof_path) {
          const { data: signed } = await supabase.storage.from('wallet-payment-proofs').createSignedUrl(item.proof_path, 300)
          if (signed?.signedUrl) urls[item.id] = signed.signedUrl
        }
      }
      setProofUrls(urls)
    }
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const review = async (item, approve) => {
    const promptText = approve
      ? 'Confirm you checked your merchant/bank transaction history and the exact payment arrived. Type OK to credit this wallet.'
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
    <div className="wallet-heading"><div><p className="wallet-eyebrow">PRIVATE HOST TOOLS</p><h1>Deposit Requests</h1><p className="wallet-subtitle">Verify each payment in your merchant/bank history before approving. Screenshots alone are not proof.</p></div><button className="wallet-refresh" onClick={refresh} disabled={loading}>Refresh</button></div>
    {message && <p className="wallet-message" role="status">{message}</p>}
    {!isAdmin ? <div className="wallet-history-card"><h2>Admin access required</h2><p className="wallet-subtitle">Add your own authenticated user ID to public.wallet_admins in the correct Supabase project before this panel can be used.</p></div> : <>
      <div className="deposit-admin-stats"><div><span>Pending</span><strong>{requests.filter(x => x.status === 'pending').length}</strong></div><div><span>Approved</span><strong>{requests.filter(x => x.status === 'credited').length}</strong></div><div><span>Rejected</span><strong>{requests.filter(x => x.status === 'failed').length}</strong></div></div>
      {loading ? <p className="wallet-empty">Loading requests…</p> : requests.length === 0 ? <div className="wallet-history-card"><p className="wallet-empty">No deposit requests yet.</p></div> : <div className="deposit-admin-list">{requests.map(item => <article className="deposit-admin-card" key={item.id}>
        <div className="deposit-admin-card-head"><div><strong>{money(item.amount_rupees)}</strong><small>{new Date(item.created_at).toLocaleString('en-IN')}</small></div><span className={'wallet-deposit-status ' + item.status}>{item.status}</span></div>
        <p><b>Player ID:</b> <span className="deposit-reference">{item.user_id}</span></p>
        <p><b>Payment method:</b> {item.payment_method || 'UPI'}</p><p><b>UPI reference:</b> <span className="deposit-reference">{item.payment_reference || 'Not provided'}</span></p>
        {proofUrls[item.id] && <a className="deposit-proof-link" href={proofUrls[item.id]} target="_blank" rel="noreferrer">View payment screenshot</a>}
        {item.review_note && <p><b>Review note:</b> {item.review_note}</p>}
        {item.status === 'pending' && <div className="deposit-admin-actions"><button disabled={busyId === item.id} onClick={() => review(item, true)}>Verify &amp; Approve</button><button className="reject" disabled={busyId === item.id} onClick={() => review(item, false)}>Reject</button></div>}
      </article>)}</div>}
    </>}
  </section>
}
