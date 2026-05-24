import { useState, useEffect, useRef, useCallback } from "react";
import "./App.css";

// Smart WS URL: localhost for dev, env var for prod, same-host fallback
const isDev = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const WS_URL = isDev
  ? "ws://localhost:8765/ws"
  : (import.meta.env.VITE_WS_URL || `wss://${window.location.hostname}/ws`);

const DIFFICULTIES = { easy: 4, medium: 6, hard: 8 };
const DIFFICULTY_LABELS = { easy: "Easy (4 digits)", medium: "Medium (6 digits)", hard: "Hard (8 digits)" };

export default function App() {
  const [screen, setScreen] = useState("login"); // login | difficulty | waiting | set_number | playing | results
  const [name, setName] = useState("");
  const [difficulty, setDifficulty] = useState("medium");
  const [playerId, setPlayerId] = useState("");
  const [opponent, setOpponent] = useState("");
  const [youAre, setYouAre] = useState("");
  const [gameId, setGameId] = useState("");
  const [digits, setDigits] = useState(6);
  const [yourNumber, setYourNumber] = useState("");
  const [currentTurn, setCurrentTurn] = useState("");
  const [guess, setGuess] = useState("");
  const [feedback, setFeedback] = useState([]);
  const [guesses, setGuesses] = useState([]);
  const [results, setResults] = useState(null);
  const [timeLeft, setTimeLeft] = useState(120);
  const [correctSoFar, setCorrectSoFar] = useState(0);
  const [error, setError] = useState("");
  const [opponentGuess, setOpponentGuess] = useState(null);
  const wsRef = useRef(null);
  const timerRef = useRef(null);
  const pendingMessages = useRef([]);  // queue messages sent before WS opens
  const youAreRef = useRef("");         // always-current value for WS handler
  const [connected, setConnected] = useState(false);
  const [showOpponentAction, setShowOpponentAction] = useState(false);

  // Connect WebSocket ONCE per session — never close on screen changes
  const hasConnected = useRef(false);
  useEffect(() => {
    if (screen === "login") {
      hasConnected.current = false;
      setConnected(false);
      return;
    }
    if (hasConnected.current) return;
    hasConnected.current = true;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("WS connected");
      setConnected(true);
      ws.send(JSON.stringify({ type: "join", name }));
      // Flush any queued messages (e.g., find_match that was clicked early)
      for (const msg of pendingMessages.current) {
        ws.send(msg);
      }
      pendingMessages.current = [];
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      handleMessage(msg);
    };

    ws.onclose = () => setError("Connection lost. Refresh to reconnect.");

    // NO cleanup here — WebSocket stays alive across all screens
  }, [name, screen]);

  // Close WebSocket only when component unmounts
  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  // Timer countdown
  useEffect(() => {
    if (screen === "playing" && timeLeft > 0) {
      timerRef.current = setInterval(() => {
        setTimeLeft((t) => {
          if (t <= 1) {
            clearInterval(timerRef.current);
            return 0;
          }
          return t - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [screen, timeLeft]);

  // Keep youAreRef in sync for the WebSocket handler (avoid stale closure)
  useEffect(() => {
    youAreRef.current = youAre;
  }, [youAre]);

  const handleMessage = useCallback((msg) => {
    switch (msg.type) {
      case "joined":
        setPlayerId(msg.player_id);
        break;
      case "match_found":
        setOpponent(msg.opponent);
        setYouAre(msg.you_are);
        setGameId(msg.game_id);
        setDigits(msg.digits);
        setScreen("set_number");
        break;
      case "waiting":
        setScreen("waiting");
        break;
      case "number_set":
        setYourNumber(msg.your_number);
        break;
      case "game_started":
        setYourNumber(msg.your_number);
        setCurrentTurn(msg.current_turn);
        setScreen("playing");
        break;
      case "guess_result":
        setFeedback(msg.feedback || []);
        setCorrectSoFar(msg.total_correct_so_far);
        break;
      case "opponent_guessed":
        setOpponentGuess(msg.guesser_name);
        setShowOpponentAction(true);
        setTimeout(() => setShowOpponentAction(false), 1500);
        break;
      case "turn_change":
        setCurrentTurn(msg.your_turn ? youAreRef.current : "");
        break;
      case "game_over":
        setResults(msg);
        setScreen("results");
        clearInterval(timerRef.current);
        break;
      case "opponent_left":
        setError("Your opponent left the game.");
        setScreen("login");
        break;
      case "error":
        setError(msg.message);
        setTimeout(() => setError(""), 3000);
        break;
      case "match_cancelled":
        setScreen("difficulty");
        break;
      default:
        break;
    }
  }, []);

  const send = (type, data = {}) => {
    const msg = JSON.stringify({ type, ...data });
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(msg);
    } else {
      // Queue for when the connection opens
      pendingMessages.current.push(msg);
    }
  };

  const handleLogin = (e) => {
    e.preventDefault();
    if (name.trim().length < 2) return;
    setScreen("difficulty");
  };

  const handleFindMatch = () => {
    send("find_match", { difficulty });
  };

  const handleSetNumber = (e) => {
    e.preventDefault();
    if (guess.length !== digits || !/^\d+$/.test(guess)) {
      setError(`Enter exactly ${digits} digits`);
      return;
    }
    send("set_number", { number: guess });
    setGuess("");
  };

  const handleGuess = (e) => {
    e.preventDefault();
    if (guess.length !== digits || !/^\d+$/.test(guess)) {
      setError(`Enter exactly ${digits} digits`);
      return;
    }
    send("guess", { guess });
    setGuess("");
  };

  const formatTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  // ── SCREENS ─────────────────────────────────────────────────────

  if (screen === "login") {
    return (
      <div className="container">
        <div className="card">
          <h1>🧠 Intuition</h1>
          <p className="subtitle">Can you read your opponent's mind?</p>
          <form onSubmit={handleLogin}>
            <input
              className="input"
              placeholder="Enter your name..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              autoFocus
            />
            <button className="btn primary" type="submit" disabled={name.trim().length < 2}>
              Enter Game
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (screen === "difficulty") {
    return (
      <div className="container">
        <div className="card">
          <h2>Choose Difficulty</h2>
          <div className="diff-buttons">
            {Object.entries(DIFFICULTY_LABELS).map(([key, label]) => (
              <button
                key={key}
                className={`btn diff ${difficulty === key ? "selected" : ""}`}
                onClick={() => setDifficulty(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            className={`btn primary ${!connected ? "connecting" : ""}`}
            onClick={handleFindMatch}
            disabled={!connected}
          >
            {connected ? "Find Opponent" : "Connecting..."}
          </button>
          {error && <p className="error">{error}</p>}
        </div>
      </div>
    );
  }

  if (screen === "waiting") {
    return (
      <div className="container">
        <div className="card">
          <h2>🔍 Looking for an opponent...</h2>
          <p className="subtitle">Difficulty: {DIFFICULTY_LABELS[difficulty]}</p>
          <div className="spinner" />
          <button className="btn secondary" onClick={() => send("cancel_match", { difficulty })}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (screen === "set_number") {
    return (
      <div className="container">
        <div className="card">
          <h2>🎮 Match Found!</h2>
          <p>
            Playing against <strong>{opponent}</strong>
          </p>
          <p className="subtitle">Set your secret {digits}-digit number</p>
          <form onSubmit={handleSetNumber}>
            <input
              className="input number-input"
              placeholder={`Enter ${digits} digits...`}
              value={guess}
              onChange={(e) => setGuess(e.target.value)}
              maxLength={digits}
              autoFocus
            />
            <button className="btn primary" type="submit" disabled={guess.length !== digits}>
              Lock In 🔒
            </button>
          </form>
          {error && <p className="error">{error}</p>}
        </div>
      </div>
    );
  }

  if (screen === "playing") {
    const isMyTurn = currentTurn === youAre;
    return (
      <div className="game-container">
        <div className="game-header">
          <div className="your-number-box">
            <span className="label">Your Number</span>
            <span className="secret-number">{yourNumber}</span>
          </div>
          <div className="game-info">
            <div className={`timer ${timeLeft <= 30 ? "urgent" : ""}`}>⏱ {formatTime(timeLeft)}</div>
            <div className="turn-indicator">{isMyTurn ? "🎯 Your Turn!" : "⏳ Waiting..."}</div>
            <div className="score">✅ {correctSoFar}/{digits}</div>
          </div>
          <div className="opponent-info">
            <span className="label">Opponent</span>
            <span className="opponent-name">{opponent}</span>
          </div>
        </div>

        {showOpponentAction && (
          <div className="opponent-action-toast">{opponentGuess} made a guess!</div>
        )}

        <div className="guess-area">
          {isMyTurn ? (
            <form onSubmit={handleGuess} className="guess-form">
              <div className="guess-boxes">
                {Array.from({ length: digits }).map((_, i) => {
                  const fb = feedback.find((f) => f.position === i);
                  return (
                    <input
                      key={i}
                      className={`digit-box ${fb?.status || ""}`}
                      value={guess[i] || ""}
                      readOnly={false}
                      maxLength={1}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (/^\d?$/.test(val)) {
                          const arr = guess.split("");
                          arr[i] = val;
                          const newGuess = arr.join("").padEnd(digits, "");
                          setGuess(newGuess.slice(0, digits));
                          // Focus next
                          if (val && i < digits - 1) {
                            const next = document.getElementById(`digit-${i + 1}`);
                            next?.focus();
                          }
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Backspace" && !guess[i] && i > 0) {
                          document.getElementById(`digit-${i - 1}`)?.focus();
                        }
                      }}
                      id={`digit-${i}`}
                    />
                  );
                })}
              </div>
              <button className="btn primary" type="submit" disabled={guess.replace(/\s/g, "").length !== digits}>
                Submit Guess
              </button>
            </form>
          ) : (
            <div className="waiting-area">
              <div className="spinner" />
              <p>{opponent} is thinking...</p>
            </div>
          )}
        </div>

        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  if (screen === "results" && results) {
    return (
      <div className="container">
        <div className="card results-card">
          <h1>🏆 Game Over!</h1>
          <p className="subtitle">{results.reason === "timeout" ? "⏰ Time's up!" : "🧩 Solved!"}</p>

          <div className="results-box">
            <div className={`result-player ${results.winner === results.p1.name ? "winner" : ""}`}>
              <h3>{results.p1.name} {results.winner === results.p1.name ? "👑" : ""}</h3>
              <p>Correct: {results.p1.correct_in_position}/{digits}</p>
            </div>
            <div className="vs">VS</div>
            <div className={`result-player ${results.winner === results.p2.name ? "winner" : ""}`}>
              <h3>{results.p2.name} {results.winner === results.p2.name ? "👑" : ""}</h3>
              <p>Correct: {results.p2.correct_in_position}/{digits}</p>
            </div>
          </div>

          {results.winner === "tie" && <h2 className="tie">🤝 It's a Tie!</h2>}

          {results.guesses.length > 0 && (
            <div className="guess-history">
              <h3>Guess History</h3>
              <div className="history-list">
                {results.guesses.map((g, i) => (
                  <div key={i} className="history-item">
                    <span className="guesser">{g.guesser}:</span>
                    <span className="guess-digits">
                      {g.guess.split("").map((d, j) => (
                        <span key={j} className={g.feedback[j]?.status || "wrong"}>
                          {d}
                        </span>
                      ))}
                    </span>
                    <span className="correct-count">✅ {g.correct_in_position}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button className="btn primary" onClick={() => window.location.reload()}>
            Play Again
          </button>
        </div>
      </div>
    );
  }

  return null;
}
