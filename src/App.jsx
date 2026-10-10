import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import TicketLobby from './components/TicketLobby'
import MyBookings from './components/MyBookings'
import GameResults from './components/GameResults'
import './App.css'

function App() {
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [session, setSession] = useState(null)
  const [view, setView] = useState('home')
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)

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

  const handleSubmit = async (event) => {
    event.preventDefault()
    setMessage('')
    setLoading(true)

    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              username,
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
      setMessage(error.message)
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
    setMessage('')
  }

  if (session && ['tickets', 'bookings', 'results'].includes(view)) {
    return (
      <main className="app-page">
        <div className="app-shell">
          <header className="app-header">
            <div className="app-brand">👑 Targetora</div>
          </header>

          <nav className="main-menu" aria-label="Main menu">
            <button
              type="button"
              className={view === 'tickets' ? 'active' : ''}
              onClick={() => setView('tickets')}
            >
              Lobby
            </button>
            <button
              type="button"
              className={view === 'bookings' ? 'active' : ''}
              onClick={() => setView('bookings')}
            >
              My Bookings
            </button>
            <button
              type="button"
              className={view === 'results' ? 'active' : ''}
              onClick={() => setView('results')}
            >
              Game Results
            </button>
            <button
              type="button"
              onClick={() => setShowLogoutConfirm(true)}
            >
              Logout
            </button>
          </nav>

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

          {view === 'tickets' && <TicketLobby />}
          {view === 'bookings' && <MyBookings />}
          {view === 'results' && <GameResults />}

          <p className="footer-note">
            Virtual credits only. No cash value.
          </p>
        </div>
      </main>
    )
  }

  if (session) {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <div className="brand">
            <div className="brand-mark">T</div>
            <h1>Targetora</h1>
            <p>Welcome back.</p>
          </div>

          <div className="success-panel">
            <div className="success-icon">✓</div>
            <h2>You're logged in</h2>
            <p>{session.user.email}</p>

            <button
              className="submit-button"
              type="button"
              onClick={() => setView('tickets')}
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

          <p className="footer-note">
            Virtual credits only. No cash value.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="brand">
          <div className="brand-mark">T</div>
          <h1>Targetora</h1>
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

        <form onSubmit={handleSubmit}>
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
        </form>

        {message && (
          <div className="message" role="status">
            {message}
          </div>
        )}

        <p className="footer-note">
          Virtual credits only. No cash value.
        </p>
      </div>
    </main>
  )
}

export default App