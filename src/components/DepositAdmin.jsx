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
  const [withdrawalRequests, setWithdrawalRequests] = useState([])
  const [withdrawalQrUrls, setWithdrawalQrUrls] = useState({})
  const [depositQrs, setDepositQrs] = useState([])
  const [depositQrLabel, setDepositQrLabel] = useState('')
  const [depositQrFile, setDepositQrFile] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true); setMessage('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setMessage('Please sign in.'); setLoading(false); return }
    const { data: adminRow, error: adminError } = await supabase.from('wallet_admins').select('user_id').eq('user_id', user.id).maybeSingle()
    if (adminError || !adminRow) { setIsAdmin(false); setMessage('This account is not authorized to access the deposit admin panel.'); setLoading(false); return }
    setIsAdmin(true)
    const [depositResult, methodResult, withdrawalResult, qrListResult] = await Promise.all([
      supabase.from('wallet_deposits').select('id,user_id,amount_rupees,status,payment_reference,payment_method,proof_path,created_at,review_note,assigned_upi_id').eq('provider', 'manual_upi').order('created_at', { ascending: false }).limit(100),
      supabase.from('wallet_payment_methods').select('id,label,upi_id,active,created_at').order('created_at', { ascending: false }),
      supabase.from('withdrawal_requests').select('id,user_id,amount_rupees,status,qr_storage_path,created_at,admin_note').order('created_at', { ascending: false }).limit(100),
      supabase.from('wallet_deposit_qrs').select('id,label,storage_path,active,created_at').order('created_at', { ascending: false }),
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
    if (qrListResult.error) setMessage('Could not load host QR codes: ' + qrListResult.error.message)
    else {
      const items = qrListResult.data || []
      const withUrls = await Promise.all(items.map(async item => {
        const { data: signed } = await supabase.storage.from('host-deposit-qr').createSignedUrl(item.storage_path, 300)
        return { ...item, signedUrl: signed?.signedUrl || '' }
      }))
      setDepositQrs(withUrls)
    }
    if (withdrawalResult.error) setMessage("Could not load withdrawals: " + withdrawalResult.error.message)
    else {
      const items = withdrawalResult.data || []
      setWithdrawalRequests(items)
      const urls = {}
      for (const item of items) {
        if (item.qr_storage_path) {
          const { data: signed } = await supabase.storage.from("withdrawal-qr-codes").createSignedUrl(item.qr_storage_path, 300)
          if (signed?.signedUrl) urls[item.id] = signed.signedUrl
        }
      }
      setWithdrawalQrUrls(urls)
    }
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const saveDepositQr = async (event) => {
    event.preventDefault()
    setMessage('')
    const cleanLabel = depositQrLabel.trim()
    if (!cleanLabel) { setMessage('Enter a label for this QR code.'); return }
    if (!depositQrFile) { setMessage('Choose a QR image first.'); return }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(depositQrFile.type) || depositQrFile.size > 5 * 1024 * 1024) {
      setMessage('Choose a JPG, PNG or WEBP QR image under 5 MB.')
      return
    }
    setBusyId('deposit-qr')
    try {
      const safeName = depositQrFile.name.replace(/[^a-zA-Z0-9._-]/g, '-')
      const storagePath = 'host/deposit-qrs/' + Date.now() + '-' + Math.random().toString(36).slice(2, 9) + '-' + safeName
      const { error: uploadError } = await supabase.storage.from('host-deposit-qr').upload(storagePath, depositQrFile, {
        contentType: depositQrFile.type,
        upsert: false,
      })
      if (uploadError) throw uploadError
      const { data: { user } } = await supabase.auth.getUser()
      const { error: insertError } = await supabase.from('wallet_deposit_qrs').insert({
        label: cleanLabel, storage_path: storagePath, active: true, created_by: user?.id || null,
      })
      if (insertError) {
        await supabase.storage.from('host-deposit-qr').remove([storagePath])
        throw insertError
      }
      setDepositQrLabel('')
      setDepositQrFile(null)
      const input = document.getElementById('host-deposit-qr-file')
      if (input) input.value = ''
      setMessage('QR code added. It can now be assigned to player deposit sessions.')
      await refresh()
    } catch (error) {
      setMessage('Could not save deposit QR: ' + (error.message || 'Unknown error'))
    } finally {
      setBusyId('')
    }
  }

  const toggleDepositQr = async (item) => {
    setBusyId(item.id); setMessage('')
    const { error } = await supabase.from('wallet_deposit_qrs').update({ active: !item.active, updated_at: new Date().toISOString() }).eq('id', item.id)
    if (error) setMessage('Could not update QR: ' + error.message)
    else setMessage(item.active ? 'QR disabled for new deposit sessions.' : 'QR enabled for new deposit sessions.')
    setBusyId('')
    await refresh()
  }

  const deleteDepositQr = async (item) => {
    if (!window.confirm('Delete this QR code? Existing deposit requests may still refer to it.')) return
    setBusyId(item.id); setMessage('')
    const { error } = await supabase.from('wallet_deposit_qrs').delete().eq('id', item.id)
    if (error) {
      setMessage('Could not delete QR: ' + error.message)
      setBusyId('')
      return
    }
    const { error: storageError } = await supabase.storage.from('host-deposit-qr').remove([item.storage_path])
    setBusyId('')
    setMessage(storageError ? 'QR record deleted, but its image could not be removed from storage.' : 'QR code deleted.')
    await refresh()
  }

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

  const reviewWithdrawal = async (item, approve) => {
    const promptText = approve
      ? "Approve this withdrawal request? This changes its status to Approved but does not transfer money. Type OK to continue."
      : "Optional reason for rejecting this withdrawal:"
    const answer = window.prompt(promptText, approve ? "" : "Withdrawal request rejected")
    if (answer === null || (approve && answer.trim().toUpperCase() !== "OK")) return
    setBusyId(item.id)
    setMessage("")
    const { data, error } = await supabase.rpc("review_withdrawal_request", {
      p_request_id: item.id,
      p_approve: approve,
      p_note: answer.trim() || null,
    })
    const resultMessage = error
      ? "Withdrawal review failed: " + JSON.stringify({ message: error.message, code: error.code, details: error.details, hint: error.hint })
      : data === "rejected"
        ? "Withdrawal rejected and reserved balance refunded."
        : data === "approved"
          ? "Withdrawal approved. No payment was sent."
          : "Unexpected response from withdrawal review: " + JSON.stringify(data)
    setBusyId("")
    await refresh()
    setMessage(resultMessage)
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
      <div className="wallet-history-card"><h2>Host deposit QR codes</h2><p>Add multiple receiving QR codes. Each player deposit session is assigned one active QR for 5 minutes. Disable a QR to stop assigning it to new sessions.</p><form onSubmit={saveDepositQr} className="deposit-method-form"><label htmlFor="deposit-qr-label">QR label</label><input id="deposit-qr-label" value={depositQrLabel} onChange={e => setDepositQrLabel(e.target.value)} placeholder="e.g. GPay account 1" maxLength={80} required /><label htmlFor="host-deposit-qr-file">UPI QR image (JPG/PNG/WEBP, max 5 MB)</label><input id="host-deposit-qr-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setDepositQrFile(e.target.files?.[0] || null)} required /><button className="wallet-buy-button" type="submit" disabled={busyId === 'deposit-qr' || !depositQrFile || !depositQrLabel.trim()}>{busyId === 'deposit-qr' ? 'Saving QR…' : 'Add QR code'}</button></form>{depositQrs.length === 0 ? <p className="wallet-empty">No host QR codes saved yet. Add at least one active QR before players can start deposits.</p> : <div className="deposit-admin-list">{depositQrs.map(item => <article className="deposit-admin-card" key={item.id}><div className="deposit-admin-card-head"><div><strong>{item.label}</strong><small>{item.active ? 'Active — may be assigned to new sessions' : 'Disabled — not assigned to new sessions'}</small></div><span className={'wallet-deposit-status ' + (item.active ? 'credited' : 'failed')}>{item.active ? 'active' : 'disabled'}</span></div>{item.signedUrl && <img className="wallet-deposit-qr-image" src={item.signedUrl} alt={item.label + ' QR code'} />}<div className="deposit-admin-actions"><button disabled={busyId === item.id} onClick={() => toggleDepositQr(item)}>{item.active ? 'Disable' : 'Enable'}</button><button className="reject" disabled={busyId === item.id} onClick={() => deleteDepositQr(item)}>Delete</button></div></article>)}</div>}</div>
      <div className="wallet-history-card">
        <h2>Withdrawal Requests</h2>
        <p>Approval means approved for further review only. No money is transferred by this action.</p>
        <div className="deposit-admin-stats">
          <div><span>Pending</span><strong>{withdrawalRequests.filter(x => x.status === "pending").length}</strong></div>
          <div><span>Approved</span><strong>{withdrawalRequests.filter(x => x.status === "approved").length}</strong></div>
          <div><span>Rejected</span><strong>{withdrawalRequests.filter(x => x.status === "rejected").length}</strong></div>
        </div>
        {loading ? <p className="wallet-empty">Loading withdrawals...</p> : withdrawalRequests.length === 0 ? <p className="wallet-empty">No withdrawal requests yet.</p> : <div className="deposit-admin-list">{withdrawalRequests.map(item => <article className="deposit-admin-card" key={item.id}>
          <div className="deposit-admin-card-head"><div><strong>{money(item.amount_rupees)}</strong><small>{new Date(item.created_at).toLocaleString("en-IN")}</small></div><span className={"wallet-deposit-status " + item.status}>{item.status === "approved" ? "approved" : item.status}</span></div>
          <p><b>Player ID:</b> <span className="deposit-reference">{item.user_id}</span></p>
          {withdrawalQrUrls[item.id] && <p><a className="deposit-proof-link" href={withdrawalQrUrls[item.id]} target="_blank" rel="noreferrer">View player UPI QR image</a></p>}
          {item.admin_note && <p><b>Review note:</b> {item.admin_note}</p>}
          {item.status === "pending" && <div className="deposit-admin-actions"><button disabled={busyId === item.id} onClick={() => reviewWithdrawal(item, true)}>Approve</button><button className="reject" disabled={busyId === item.id} onClick={() => reviewWithdrawal(item, false)}>Reject &amp; refund</button></div>}
        </article>)}</div>}
      </div>
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
