import { useState } from 'react'
import { supabase } from './lib/supabase'
import './App.css'

function App() {
  const [step, setStep] = useState('phone')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [username, setUsername] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const sendOtp = async (event) => {
    event.preventDefault()
    setMessage('')
    setLoading(true)

    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone,
      })

      if (error) throw error

      setStep('otp')
      setMessage('OTP sent to your phone.')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setLoading(false)
    }
  }

  const verifyOtp = async (event) => {
    event.preventDefault()
    setMessage('')
    setLoading(true)

    try {
      const { data, error } = await supabase.auth.verifyOtp({
        phone,
        token: otp,
        type: 'sms',
      })

      if (error) throw error

      if (data.user) {
        setStep('username')
        setMessage('Phone verified successfully.')
      }
    } catch (error) {
      setMessage(error.message)
    } finally {
      setLoading(false)
    }
  }

  const saveUsername = async (event) => {
    event.preventDefault()
    setMessage('')
    setLoading(true)

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        throw new Error('Your session has expired. Please start again.')
      }

      const { error } = await supabase
        .from('profiles')
        .update({ username })
        .eq('id', user.id)

      if (error) throw error

      setStep('success')
      setMessage('Account setup complete!')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="brand">
          <div className="brand-mark">RJ</div>
          <h1>RajaRaniJackpot</h1>
          <p>Numbers. Rounds. Play.</p>
        </div>

        {step === 'phone' && (
          <>
            <div className="section-heading">
              <h2>Welcome</h2>
              <p>Enter your phone number to continue.</p>
            </div>

            <form onSubmit={sendOtp}>
              <label>
                Phone number
                <input
                  type="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+91 9876543210"
                  required
                  autoComplete="tel"
                />
              </label>

              <button
                className="submit-button"
                type="submit"
                disabled={loading}
              >
                {loading ? 'Sending OTP...' : 'Send OTP'}
              </button>
            </form>
          </>
        )}

        {step === 'otp' && (
          <>
            <div className="section-heading">
              <h2>Verify your phone</h2>
              <p>Enter the OTP sent to {phone}.</p>
            </div>

            <form onSubmit={verifyOtp}>
              <label>
                OTP
                <input
                  type="text"
                  value={otp}
                  onChange={(event) => setOtp(event.target.value)}
                  placeholder="Enter OTP"
                  inputMode="numeric"
                  maxLength={6}
                  required
                />
              </label>

              <button
                className="submit-button"
                type="submit"
                disabled={loading}
              >
                {loading ? 'Verifying...' : 'Verify OTP'}
              </button>

              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setStep('phone')
                  setOtp('')
                  setMessage('')
                }}
              >
                Change phone number
              </button>
            </form>
          </>
        )}

        {step === 'username' && (
          <>
            <div className="section-heading">
              <h2>Create your player name</h2>
              <p>This name will be shown in the game.</p>
            </div>

            <form onSubmit={saveUsername}>
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

              <button
                className="submit-button"
                type="submit"
                disabled={loading}
              >
                {loading ? 'Saving...' : 'Continue'}
              </button>
            </form>
          </>
        )}

        {step === 'success' && (
          <div className="success-panel">
            <div className="success-icon">✓</div>
            <h2>You're ready!</h2>
            <p>Your player account has been created.</p>
            <button
              className="submit-button"
              type="button"
              onClick={() => setMessage('Lobby coming next.')}
            >
              Enter Lobby
            </button>
          </div>
        )}

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