import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import TicketLobby from './components/TicketLobby'
import HomeDashboard from './components/HomeDashboard'
import MyBookings from './components/MyBookings'
import GameResults from './components/GameResults'
import DoubleGame from './components/DoubleGame'
import RubyRush from './components/RubyRush'
import Wallet from './components/Wallet'
import Withdraw from './components/Withdraw'
import DepositAdmin from './components/DepositAdmin'
import './App.css'

function App() {
  const [mode, setMode] = useState('login')
  const [showForgotPassword, setShowForgotPassword] = useState(false)
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [session, setSession] = useState(null)
  const [isWalletAdmin, setIsWalletAdmin] = useState(false)
  const [view, setView] = useState('home')
  const [viewHistory, setViewHistory] = useState([])

  const navigateTo = (nextView) => {
    setViewHistory((history) => view === nextView ? history : [...history, view])
    setView(nextView)
  }

  const navigateBack = () => {
    if (viewHistory.length > 0) {
      setView(viewHistory[viewHistory.length - 1])
      setViewHistory((history) => history.slice(0, -1))
    } else {
      setView('home')
    }
  }
  const [resultsGame, setResultsGame] = useState(null)
  const [bookingsGame, setBookingsGame] = useState(null)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [showAppMenu, setShowAppMenu] = useState(false)

  useEffect(() => {
    const loadSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      setSession(session)
    }

    loadSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    let cancelled = false
    const checkAdmin = async () => {
      setIsWalletAdmin(false)
      if (!session?.user?.id) return
      const { data, error } = await supabase
        .from('wallet_admins')
        .select('user_id')
        .eq('user_id', session.user.id)
        .maybeSingle()
      if (!cancelled) setIsWalletAdmin(!error && Boolean(data))
    }
    checkAdmin()
    return () => { cancelled = true }
  }, [session?.user?.id])

  const handleForgotPassword = async (event) => {
    event.preventDefault()
    setMessage('')
    if (!email.trim()) {
      setMessage('Enter your email address first, and we will send you a password reset link.')
      return
    }
    setLoading(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: 'https://raja-rani-jackpot-azg9t1jcv-royalstackallin-rgb.vercel.app/',
      })
      if (error) throw error
      setMessage('If an account exists for this email, a password reset link has been sent. Check your inbox and spam folder.')
      setShowForgotPassword(false)
    } catch (error) {
      setMessage(error.message || 'Could not send the password reset email. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setMessage('')
    setLoading(true)

    try {
      if (mode === 'signup') {
        const cleanUsername = username.trim()
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              username: cleanUsername,
            },
          },
        })

        if (error) throw error

        setMessage(
          'Account created. Check your email if email confirmation is enabled.',
        )
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })

        if (error) throw error

        setMessage('Login successful.')
      }
    } catch (error) {
      const errorText = String(error?.message || '')
      if (mode === 'signup' && /username|duplicate key|profiles_username_key/i.test(errorText)) {
        setMessage('That username is already taken. Please try another username.')
      } else if (mode === 'signup' && /Database error saving new user/i.test(errorText)) {
        setMessage('We could not create your account. The username may already be taken, so try another one. If it still fails, please contact support.')
      } else {
        setMessage(error.message)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) {
      setMessage(error.message)
      return
    }
    setShowLogoutConfirm(false)
    setView('home')
    setViewHistory([])
    setMessage('')
  }

  if (session && ['home', 'tickets', 'bookings', 'results', 'double', 'ruby-rush', 'wallet', 'withdraw', 'deposit-admin'].includes(view)) {
    return (
      <main className={`app-page app-view-${view}`}>
        <div className="app-shell">
          <header className="app-header">
            <button type="button" className="app-brand app-brand-home" onClick={() => navigateTo('home')} aria-label="Go to Home"><img src="/targetora-wordmark.svg" alt="TARGETORSTAKE" style={{ width: "clamp(220px, 72vw, 330px)", maxWidth: "100%", display: "block" }} /></button>
            <div className="app-menu-wrap">
              <button
                type="button"
                className={`app-menu-trigger ${showAppMenu ? 'is-open' : ''}`}
                aria-label={showAppMenu ? 'Close menu' : 'Open menu'}
                aria-expanded={showAppMenu}
                onClick={() => setShowAppMenu((open) => !open)}
              >
                <svg className="app-menu-profile-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4.5 20c.7-4 3.2-6 7.5-6s6.8 2 7.5 6" /></svg>
              </button>
              {showAppMenu && (
                <div className="app-menu-dropdown">
                  <div className="app-menu-account">
                    <span>ACCOUNT</span>
                    <strong>{session.user.email}</strong>
                  </div>
                  <button type="button" className="app-menu-wallet" onClick={() => { setShowAppMenu(false); navigateTo('wallet') }}>Wallet / Buy In</button>
                  <button type="button" className="app-menu-wallet" onClick={() => { setShowAppMenu(false); navigateTo('withdraw') }}>Withdraw</button>
                  {isWalletAdmin && <button type="button" className="app-menu-wallet" onClick={() => { setShowAppMenu(false); navigateTo('deposit-admin') }}>Deposit Admin</button>}
                  <button type="button" className="app-menu-logout" onClick={() => { setShowAppMenu(false); setShowLogoutConfirm(true) }}>Logout</button>
                </div>
              )}
            </div>
          </header>
          {view !== 'home' && (
            <div className="view-navigation">
              <button type="button" className="view-back-button" onClick={navigateBack} aria-label="Go back to previous page"><span aria-hidden="true">←</span> Back</button>
              <span className="view-navigation-title">{({ tickets: 'Crown 24', double: 'Twin Fortune', slot: 'Royal Reels', 'ruby-rush': 'Ruby Rush', bookings: 'My Bookings', results: 'Game Results', wallet: 'Wallet', withdraw: 'Withdraw', 'deposit-admin': 'Deposit Admin' })[view] || ''}</span>
            </div>
          )}

      {showLogoutConfirm && (
        <div className="logout-modal-backdrop">
          <section
            className="logout-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="logout-modal-title"
          >
            <div className="logout-modal-icon">👑</div>
            <h2 id="logout-modal-title">Logout Confirmation</h2>
            <p>
              Are you sure you want to log out? You will need to log in again
              to access your account and game history.
            </p>
            <div className="logout-modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setShowLogoutConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="submit-button"
                onClick={handleLogout}
              >
                OK, Logout
              </button>
            </div>
          </section>
        </div>
      )}

          {view === 'home' && <HomeDashboard onOpenGame={setView} onOpenBookings={() => navigateTo('bookings')} onOpenResults={(game) => { setResultsGame(game); navigateTo('results') }} onOpenWallet={() => navigateTo('wallet')} />}
          {view === 'tickets' && <TicketLobby onOpenBookings={() => { setBookingsGame('classic'); navigateTo('bookings') }} onOpenResults={() => { setResultsGame('classic'); navigateTo('results') }} />}
          {view === 'bookings' && <MyBookings initialGame={bookingsGame} />}
          {view === 'results' && <GameResults initialGame={resultsGame} />}
          {view === 'double' && <DoubleGame onOpenBookings={() => { setBookingsGame('double'); navigateTo('bookings') }} onOpenResults={() => { setResultsGame('double'); navigateTo('results') }} />}
          {view === 'ruby-rush' && <RubyRush />}
          {view === 'wallet' && <Wallet />}
          {view === 'withdraw' && <Withdraw />}
          {view === 'deposit-admin' && isWalletAdmin && <DepositAdmin />}

        </div>
      </main>
    )
  }

  if (session) {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <div className="brand">
            <img src="/targetora-wordmark.svg" alt="TARGETORSTAKE" style={{ width: "min(340px, 90vw)", maxWidth: "100%", display: "block", margin: "0 auto" }} />
            <p>Welcome back.</p>
          </div>

          <div className="success-panel">
            <div className="success-icon">✓</div>
            <h2>You're logged in</h2>
            <p>{session.user.email}</p>

            <button
              className="submit-button"
              type="button"
              onClick={() => navigateTo('home')}
            >
              Enter Lobby
            </button>

            <button
              className="secondary-button"
              type="button"
              onClick={() => setShowLogoutConfirm(true)}
            >
              Logout
            </button>
          </div>

          {message && (
            <div className="message" role="status">
              {message}
            </div>
          )}

        </div>
      </main>
    )
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="brand">
          <img src="/targetora-wordmark.svg" alt="TARGETORSTAKE" style={{ width: "min(340px, 90vw)", maxWidth: "100%", display: "block", margin: "0 auto" }} />
          <p>Numbers. Rounds. Play.</p>
        </div>

        <div className="tabs">
          <button
            type="button"
            className={mode === 'login' ? 'active' : ''}
            onClick={() => {
              setMode('login')
              setMessage('')
            }}
          >
            Login
          </button>

          <button
            type="button"
            className={mode === 'signup' ? 'active' : ''}
            onClick={() => {
              setMode('signup')
              setMessage('')
            }}
          >
            Create Account
          </button>
        </div>

        {showForgotPassword ? (
          <form onSubmit={handleForgotPassword}>
            <p>Enter your account email and we'll send you a password reset link.</p>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
            </label>
            <button className="submit-button" type="submit" disabled={loading}>
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>
            <button className="secondary-button" type="button" onClick={() => { setShowForgotPassword(false); setMessage('') }}>
              Back to Login
            </button>
          </form>
        ) : <form onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <label>
              Username
              <input
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Choose a username"
                minLength={3}
                maxLength={20}
                required
              />
            </label>
          )}

          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 6 characters"
              minLength={6}
              required
              autoComplete={
                mode === 'login' ? 'current-password' : 'new-password'
              }
            />
          </label>

          <button className="submit-button" type="submit" disabled={loading}>
            {loading
              ? 'Please wait...'
              : mode === 'login'
                ? 'Login'
                : 'Create Account'}
          </button>
        </form>}

        {mode === 'login' && !showForgotPassword && (
          <button type="button" className="secondary-button" onClick={() => { setShowForgotPassword(true); setMessage('') }}>
            Forgot Password?
          </button>
        )}

        {message && (
          <div className="message" role="status">
            {message}
          </div>
        )}

      </div>
    </main>
  )
}

export default App