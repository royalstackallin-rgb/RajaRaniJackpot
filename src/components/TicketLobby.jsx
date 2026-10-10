import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const ROWS = [
  { letter: 'A', price: 10, payout: 80 },
  { letter: 'B', price: 20, payout: 160 },
  { letter: 'C', price: 30, payout: 240 },
  { letter: 'D', price: 40, payout: 320 },
  { letter: 'E', price: 50, payout: 400 },
  { letter: 'F', price: 60, payout: 480 },
  { letter: 'G', price: 70, payout: 560 },
]

const NUMBERS = ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09']

const ROUND_NAMES = {
  '07:00': 'SUBHA',
  '08:00': 'SUNRISE',
  '09:00': 'GOLDEN HOUR',
  '10:00': 'ROYAL STAR',
  '11:00': 'LUCKY CROWN',
  '12:00': 'DUPUR',
  '13:00': 'GOLDEN PALACE',
  '14:00': 'DIAMOND',
  '15:00': 'SILVER MOON',
  '16:00': 'GODHULI',
  '17:00': 'ROYAL NIGHT',
  '18:00': 'SHAHI',
}

function getRoundName(round) {
  if (!round) return 'RAJARANI JACKPOT'
  const time = String(round.round_time).slice(0, 5)
  return ROUND_NAMES[time] || 'RAJARANI JACKPOT'
}


function TicketLobby() {
  const [tickets, setTickets] = useState({})
  const [bookedRows, setBookedRows] = useState({})
  const [bookingRow, setBookingRow] = useState(null)
  const [message, setMessage] = useState('')
  const [rowMessages, setRowMessages] = useState({})
  const [balance, setBalance] = useState(null)
  const [currentRound, setCurrentRound] = useState(null)
  const [now, setNow] = useState(new Date())
  const [drawResults, setDrawResults] = useState({})
  const [drawPhase, setDrawPhase] = useState(false)
  const [rollingResults, setRollingResults] = useState({})

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date())
    }, 1000)

    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const loadRound = async () => {
      const now = new Date()

      const localDate =
        `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

      const localTime =
        `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`

      const { data, error } = await supabase
        .from('game_rounds')
        .select('id, round_code, game_date, round_time, status')
        .gte('game_date', localDate)
        .or('status.eq.open,status.eq.drawn,status.eq.settled')
        .order('round_time', { ascending: true })

      if (error) return

      const currentTime = now.getTime()
      const liveWindowStart = currentTime - 5 * 60 * 1000

      const liveRound = data.find((round) => {
        if (round.status !== 'drawn' && round.status !== 'settled') return false

        const roundTime = new Date(
          `${round.game_date}T${round.round_time.slice(0, 8)}`,
        ).getTime()

        return (
          roundTime <= currentTime &&
          roundTime >= liveWindowStart
        )
      })

      const nextOpenRound = [...data].sort((a, b) => {
        const aTime = new Date(`${a.game_date}T${a.round_time.slice(0, 8)}`).getTime()
        const bTime = new Date(`${b.game_date}T${b.round_time.slice(0, 8)}`).getTime()
        return aTime - bTime
      }).find((round) => {
        if (round.status !== 'open') return false

        const roundTime = new Date(
          `${round.game_date}T${round.round_time.slice(0, 8)}`,
        ).getTime()

        return roundTime >= currentTime
      })

      setCurrentRound(liveRound || nextOpenRound || null)
    }

    const loadBalance = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) return

      const { data, error } = await supabase
        .from('wallets')
        .select('balance')
        .eq('user_id', user.id)
        .single()

      if (!error) {
        setBalance(data.balance)
      }
    }

    loadRound()
    loadBalance()

    const roundTimer = setInterval(loadRound, 5000)

    return () => clearInterval(roundTimer)
  }, [])

  useEffect(() => {
    if (!currentRound) return

    const loadResults = async () => {
      const { data, error } = await supabase
        .from('game_round_results')
        .select('ticket_row, winning_number')
        .eq('round_id', currentRound.id)
        .order('ticket_row')

      if (error) return

      const results = {}

      data.forEach((item) => {
        results[item.ticket_row] = item.winning_number
      })

      const hasResults = Object.keys(results).length > 0

      setDrawResults((current) => {
        if (JSON.stringify(current) === JSON.stringify(results)) {
          return current
        }

        return results
      })

      setDrawPhase(hasResults)
    }

    loadResults()

    const resultTimer = setInterval(loadResults, 3000)

    return () => clearInterval(resultTimer)
  }, [currentRound])

  // Apply or clear the round theme before the browser paints, preventing a stale
  // royal-crown palette from flashing when returning to the Lobby.
  useLayoutEffect(() => {
    const roundTime = currentRound?.round_time
      ? String(currentRound.round_time).slice(0, 5)
      : ''

    if (roundTime) {
      document.body.dataset.roundTheme = roundTime
    } else {
      delete document.body.dataset.roundTheme
    }
  }, [currentRound?.round_time])

  const startDrawAnimation = (results) => {
    const entries = Object.entries(results)

    entries.forEach(([row, winningNumber], index) => {
      const delay = index * 700

      setTimeout(() => {
        let step = 0

        const timer = setInterval(() => {
          step += 1

          const randomNumber =
            NUMBERS[Math.floor(Math.random() * NUMBERS.length)]

          setRollingResults((current) => ({
            ...current,
            [row]: randomNumber,
          }))

          if (step >= 12) {
            clearInterval(timer)

            setRollingResults((current) => ({
              ...current,
              [row]: winningNumber,
            }))
          }
        }, 80)
      }, delay)
    })
  }

  useEffect(() => {
    if (Object.keys(drawResults).length === 0) return

    setRollingResults({})
    startDrawAnimation(drawResults)
  }, [JSON.stringify(drawResults)])

  const updateTickets = (row, number, value) => {
    const key = `${row}-${number}`

    if (value === '') {
      setTickets((current) => ({
        ...current,
        [key]: 0,
      }))
      setMessage('')
      return
    }

    const quantity = Math.max(0, Number.parseInt(value, 10) || 0)

    setTickets((current) => ({
      ...current,
      [key]: quantity,
    }))

    setMessage('')
  }

  const rowTotals = useMemo(() => {
    return ROWS.reduce((result, row) => {
      const ticketCount = NUMBERS.reduce(
        (total, number) =>
          total + (tickets[`${row.letter}-${number}`] || 0),
        0,
      )

      result[row.letter] = {
        tickets: ticketCount,
        amount: ticketCount * row.price,
      }

      return result
    }, {})
  }, [tickets])

  const bookRow = async (row) => {
    const total = rowTotals[row.letter]

    if (!total || total.tickets === 0) {
      return
    }

    if (balance !== null && total.amount > balance) {
      setTickets((current) => {
        const updated = { ...current }
        NUMBERS.forEach((number) => {
          delete updated[`${row.letter}-${number}`]
        })
        return updated
      })
      setMessage('')
      setRowMessages((current) => ({
        ...current,
        [row.letter]: 'Insufficient coins — no tickets booked.',
      }))
      return
    }

    setBookingRow(row.letter)
    setMessage('')

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        throw new Error('Please log in again.')
      }

      if (!currentRound || currentRound.status !== 'open') {
        throw new Error('This round is no longer open for booking.')
      }

      const round = currentRound

      const entries = NUMBERS
        .map((number) => ({
          number,
          quantity: tickets[`${row.letter}-${number}`] || 0,
        }))
        .filter((entry) => entry.quantity > 0)

      const { data, error } = await supabase.rpc(
        'book_ticket_row',
        {
          p_round_id: round.id,
          p_ticket_row: row.letter,
          p_entries: entries,
        },
      )

      if (error) {
        throw error
      }

      setBookedRows((current) => ({
        ...current,
        [row.letter]: true,
      }))

      setBalance(data.balance)
      setMessage('')
      setRowMessages((current) => ({
        ...current,
        [row.letter]: 'Tickets booked successfully!',
      }))
      setTickets((current) => {
        const updated = { ...current }
        NUMBERS.forEach((number) => {
          delete updated[`${row.letter}-${number}`]
        })
        return updated
      })
    } catch (error) {
      setTickets((current) => {
        const updated = { ...current }
        NUMBERS.forEach((number) => {
          delete updated[`${row.letter}-${number}`]
        })
        return updated
      })
      setMessage('')
      setRowMessages((current) => ({
        ...current,
        [row.letter]: error.message || 'Booking failed — no tickets booked.',
      }))
    } finally {
      setBookingRow(null)
    }
  }

  const roundDateTime = currentRound
    ? new Date(
        `${currentRound.game_date}T${currentRound.round_time}`,
      )
    : null

  const cutoffDateTime = roundDateTime
    ? new Date(roundDateTime.getTime() - 5 * 60 * 1000)
    : null

  const bookingOpen =
    roundDateTime &&
    now < cutoffDateTime &&
    now >= new Date(roundDateTime.getTime() - 60 * 60 * 1000)

  const bookingClosed =
    roundDateTime &&
    now >= cutoffDateTime &&
    now < roundDateTime

  const secondsUntilCutoff = cutoffDateTime
    ? Math.max(0, Math.floor((cutoffDateTime - now) / 1000))
    : 0

  const minutes = Math.floor(secondsUntilCutoff / 60)
  const seconds = secondsUntilCutoff % 60

  const bookingStart = roundDateTime ? new Date(roundDateTime.getTime() - 60 * 60 * 1000) : null
  const secondsUntilOpen = bookingStart && now < bookingStart ? Math.max(0, Math.floor((bookingStart - now) / 1000)) : 0
  const openHours = Math.floor(secondsUntilOpen / 3600)
  const openMinutes = Math.floor((secondsUntilOpen % 3600) / 60)
  const openSeconds = secondsUntilOpen % 60
  const openingCountdown = String(openHours).padStart(2, "0") + ":" + String(openMinutes).padStart(2, "0") + ":" + String(openSeconds).padStart(2, "0")


  return (
    <section className="ticket-lobby">
      <div className="ticket-header">
        <div>
          <span className="eyebrow">{getRoundName(currentRound)}</span>
          <h2>00–09</h2>
          <p>Enter number of tickets for each number</p>
        </div>

        <div className="ticket-header-right">
          <div className="wallet-balance">
            <span>BALANCE</span>
            <strong>
              {balance === null ? '—' : `₹${balance.toLocaleString('en-IN')}`}
            </strong>
          </div>

          <div className="ticket-round">
            <span>ROUND</span>

            <strong>
              {currentRound
                ? new Date(
                    `1970-01-01T${currentRound.round_time}`,
                  ).toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit',
                  })
                : '—'}
            </strong>

            {bookingOpen && (
              <small>
                BOOKING OPEN · {minutes}:{String(seconds).padStart(2, '0')}
              </small>
            )}

            {bookingClosed && (
              <small className="booking-closed">
                🔴 BOOKING CLOSED · LIVE GAME
              </small>
            )}
            {!bookingOpen && !bookingClosed && currentRound && bookingStart && now < bookingStart && (
              <small>BOOKING OPENS IN · {openingCountdown}</small>
            )}
          </div>
        </div>
      </div>

      {message && (
        <div className="ticket-message" role="status">
          {message}
        </div>
      )}

      {drawPhase && (
        <div className="live-draw-panel">
          <div className="live-draw-header">
            <div>
              <span className="eyebrow">LIVE DRAW</span>
              <h3>Today's Results</h3>
            </div>
            <span className="live-badge">● LIVE</span>
          </div>

          <div className="live-draw-grid">
            {ROWS.map((row) => (
              <div className="live-draw-card" key={row.letter}>
                <span className="live-draw-row">{row.letter}</span>
                <strong>
                  {rollingResults[row.letter] || '--'}
                </strong>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="ticket-board">
        {ROWS.map((row) => {
          const total = rowTotals[row.letter]
          const isBooked = bookedRows[row.letter]
          const isBooking = bookingRow === row.letter

          return (
            <div className="ticket-row" key={row.letter}>
              <div className="row-top">
                <div className="row-title">
                  <span className="row-letter">{row.letter}</span>

                  <strong>₹{row.price} / ticket</strong>
                </div>

                <div className="row-payout">
                  Payout: ₹{row.payout} / winning ticket
                </div>
              </div>

              <div className="number-input-grid">
                {NUMBERS.map((number) => {
                  const key = `${row.letter}-${number}`
                  const quantity = tickets[key] || 0
                  const potentialPayout = quantity * row.payout

                  return (
                    <div className="number-input-column" key={number}>
                      <div className="number-label">{number}</div>

                      <input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        value={quantity || ''}
                        disabled={isBooked || !bookingOpen}
                        onChange={(event) =>
                          updateTickets(
                            row.letter,
                            number,
                            event.target.value,
                          )
                        }
                        aria-label={`${row.letter} ${number} tickets`}
                      />

                    </div>
                  )
                })}
              </div>

              {total.tickets > 0 && (
                <div className="potential-payouts">
                  <div className="potential-payout-title">
                    Potential payout
                  </div>

                  <div className="potential-payout-list">
                    {NUMBERS.map((number) => {
                      const quantity = tickets[`${row.letter}-${number}`] || 0

                      if (quantity === 0) return null

                      return (
                        <span
                          className="potential-payout-item"
                          key={number}
                        >
                          {number} → ₹{(quantity * row.payout).toLocaleString('en-IN')}
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="row-summary">
                <span>{total.tickets} tickets</span>
                <strong>₹{total.amount.toLocaleString('en-IN')}</strong>
              </div>

              <button
                type="button"
                className={`row-book-button ${
                  isBooked ? 'booked' : ''
                }`}
                disabled={
                  total.tickets === 0 ||
                  isBooking ||
                  isBooked ||
                  !bookingOpen
                }
                onClick={() => bookRow(row)}
              >
                {isBooking
                  ? 'BOOKING...'
                  : isBooked
                    ? 'BOOKED'
                    : `BOOK ${row.letter} TICKETS`}
              </button>

              {rowMessages[row.letter] && (
                <div className="ticket-message" role="status">
                  {rowMessages[row.letter]}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

export default TicketLobby
