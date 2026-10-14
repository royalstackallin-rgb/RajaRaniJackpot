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
  const [depositQrPath, setDepositQrPath] = useState('')
  const [depositQrUrl, setDepositQrUrl] = useState('')
  const [depositQrFile, setDepositQrFile] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true); setMessage('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setMessage('Please sign in.'); setLoading(false); return }
    const { data: adminRow, error: adminError } = await supabase.from('wallet_admins').select('user_id').eq('user_id', user.id).maybeSingle()
    if (adminError || !adminRow) { setIsAdmin(false); setMessage('This account is not authorized to access the deposit admin panel.'); setLoading(false); return }
    setIsAdmin(true)
    const [depositResult, methodResult, withdrawalResult, qrSettingsResult] = await Promise.all([
      supabase.from('wallet_deposits').select('id,user_id,amount_rupees,status,payment_reference,payment_method,proof_path,created_at,review_note,assigned_upi_id').eq('provider', 'manual_upi').order('created_at', { ascending: false }).limit(100),
      supabase.from('wallet_payment_methods').select('id,label,upi_id,active,created_at').order('created_at', { ascending: false }),
      supabase.from('withdrawal_requests').select('id,user_id,amount_rupees,status,qr_storage_path,created_at,admin_note').order('created_at', { ascending: false }).limit(100),
      supabase.from('wallet_deposit_settings').select('qr_storage_path').eq('id', 1).maybeSingle(),
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
    if (qrSettingsResult.error) setMessage('Could not load host QR settings: ' + qrSettingsResult.error.message)
    else {
      const path = qrSettingsResult.data?.qr_storage_path || ''
      setDepositQrPath(path)
      if (path) {
        const { data: signed } = await supabase.storage.from('host-deposit-qr').createSignedUrl(path, 300)
        setDepositQrUrl(signed?.signedUrl || '')
      } else setDepositQrUrl('')
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
    if (!depositQrFile) { setMessage('Choose a QR image first.'); return }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(depositQrFile.type) || depositQrFile.size > 5 * 1024 * 1024) {
      setMessage('Choose a JPG, PNG or WEBP QR image under 5 MB.')
      return
    }
    setBusyId('deposit-qr')
    try {
      const { error: uploadError } = await supabase.storage.from('host-deposit-qr').upload('host/deposit-qr', depositQrFile, {
        contentType: depositQrFile.type,
        upsert: true,
      })
      if (uploadError) throw uploadError
      const { error: settingsError } = await supabase.from('wallet_deposit_settings').update({
        qr_storage_path: 'host/deposit-qr',
        updated_at: new Date().toISOString(),
      }).eq('id', 1)
      if (settingsError) throw settingsError
      setDepositQrPath('host/deposit-qr')
      setDepositQrFile(null)
      setMessage('Host deposit QR saved. Players will see it during five-minute deposit sessions.')
      await refresh()
    } catch (error) {
      setMessage('Could not save deposit QR: ' + (error.message || 'Unknown error'))
    } finally {
      setBusyId('')
    }
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
      <div className="wallet-history-card"><h2>Host deposit QR code</h2><p>Upload one QR code for all player deposits. Replace it whenever your receiving QR changes. Players will see it for 5 minutes per deposit session.</p><form onSubmit={saveDepositQr} className="deposit-method-form"><label htmlFor="host-deposit-qr-file">UPI QR image (JPG/PNG/WEBP, max 5 MB)</label><input id="host-deposit-qr-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setDepositQrFile(e.target.files?.[0] || null)} required={!depositQrPath} /><button className="wallet-buy-button" type="submit" disabled={busyId === 'deposit-qr' || !depositQrFile}>{busyId === 'deposit-qr' ? 'Saving QR…' : depositQrPath ? 'Replace host QR' : 'Save host QR'}</button></form>{depositQrUrl ? <div className="host-deposit-qr-preview"><h3>Current player deposit QR</h3><img className="wallet-deposit-qr-image" src={depositQrUrl} alt="Current host deposit QR" /><p className="wallet-empty">Saved QR is active for new deposit sessions.</p></div> : <p className="wallet-empty">No host QR saved yet. Players cannot start deposits until you upload one.</p>}</div>
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
