"""
Intuition Game Server - 2-player Mastermind-style guessing game.
All state in-memory. WebSocket-based real-time communication.
Also serves the React frontend static files for single-port deployment.
"""

import asyncio
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional
from uuid import uuid4

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("intuition")

app = FastAPI(title="Intuition Game")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── In-Memory State ──────────────────────────────────────────────

DIFFICULTY_DIGITS = {"easy": 4, "medium": 6, "hard": 8}

class Player:
    def __init__(self, ws: WebSocket, name: str):
        self.ws = ws
        self.name = name
        self.id = str(uuid4())[:8]

class Game:
    def __init__(self, p1: Player, p2: Player, difficulty: str):
        self.id = str(uuid4())[:8]
        self.p1 = p1
        self.p2 = p2
        self.difficulty = difficulty
        self.digits = DIFFICULTY_DIGITS[difficulty]
        self.p1_number: str = ""
        self.p2_number: str = ""
        self.current_turn: str = ""  # "p1" or "p2"
        self.guesses: list[dict] = []  # all guesses stored here
        self.p1_correct_in_position = 0
        self.p2_correct_in_position = 0
        self.start_time: Optional[datetime] = None
        self.timer_task: Optional[asyncio.Task] = None

waiting_players: dict[str, list[Player]] = {"easy": [], "medium": [], "hard": []}
active_games: dict[str, Game] = {}  # websocket_id -> Game ref for quick lookup
games_by_id: dict[str, Game] = {}

# ── Helpers ──────────────────────────────────────────────────────

async def send(ws: WebSocket, msg_type: str, **kwargs):
    """Send a typed message to a WebSocket."""
    payload = {"type": msg_type, **kwargs}
    try:
        await ws.send_json(payload)
    except Exception:
        pass

async def check_matchmaking(difficulty: str):
    """If two players are waiting for the same difficulty, start a game."""
    queue = waiting_players[difficulty]
    if len(queue) >= 2:
        p1 = queue.pop(0)
        p2 = queue.pop(0)
        game = Game(p1, p2, difficulty)
        games_by_id[game.id] = game
        active_games[p1.id] = game
        active_games[p2.id] = game

        await send(p1.ws, "match_found", game_id=game.id, opponent=p2.name,
                   difficulty=difficulty, digits=game.digits, you_are="p1")
        await send(p2.ws, "match_found", game_id=game.id, opponent=p1.name,
                   difficulty=difficulty, digits=game.digits, you_are="p2")
        logger.info(f"Game {game.id} started: {p1.name} vs {p2.name} [{difficulty}]")

async def end_game(game: Game, reason: str = "timeout"):
    """End the game and send results to both players."""
    p1_name = game.p1.name
    p2_name = game.p2.name

    if game.p1_correct_in_position > game.p2_correct_in_position:
        winner = p1_name
    elif game.p2_correct_in_position > game.p1_correct_in_position:
        winner = p2_name
    else:
        winner = "tie"

    results = {
        "p1": {"name": p1_name, "correct_in_position": game.p1_correct_in_position},
        "p2": {"name": p2_name, "correct_in_position": game.p2_correct_in_position},
        "winner": winner,
        "reason": reason,
        "guesses": game.guesses,
    }

    await send(game.p1.ws, "game_over", **results)
    await send(game.p2.ws, "game_over", **results)

    # Cleanup
    active_games.pop(game.p1.id, None)
    active_games.pop(game.p2.id, None)
    games_by_id.pop(game.id, None)
    if game.timer_task:
        game.timer_task.cancel()
    logger.info(f"Game {game.id} ended: winner={winner} reason={reason}")

async def start_timer(game: Game):
    """2-minute countdown timer. Auto-ends game when time is up."""
    try:
        await asyncio.sleep(120)
        await end_game(game, "timeout")
    except asyncio.CancelledError:
        pass

# ── WebSocket Endpoint ───────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    player: Optional[Player] = None
    game: Optional[Game] = None

    try:
        while True:
            data = await ws.receive_json()
            msg_type = data.get("type", "")

            # ── JOIN ──────────────────────────────────────────
            if msg_type == "join":
                name = data.get("name", "Anonymous")
                player = Player(ws, name)
                await send(ws, "joined", player_id=player.id, name=player.name)

            # ── FIND MATCH ────────────────────────────────────
            elif msg_type == "find_match":
                difficulty = data.get("difficulty", "medium")
                if difficulty not in DIFFICULTY_DIGITS:
                    await send(ws, "error", message="Invalid difficulty")
                    continue
                waiting_players[difficulty].append(player)
                await send(ws, "waiting", difficulty=difficulty)
                await check_matchmaking(difficulty)

            # ── SET NUMBER ─────────────────────────────────────
            elif msg_type == "set_number":
                number = str(data.get("number", ""))
                game = active_games.get(player.id)
                if not game:
                    await send(ws, "error", message="Not in a game")
                    continue
                if len(number) != game.digits or not number.isdigit():
                    await send(ws, "error", message=f"Must be exactly {game.digits} digits")
                    continue

                if game.p1.id == player.id:
                    game.p1_number = number
                else:
                    game.p2_number = number

                await send(ws, "number_set", your_number=number)

                # When both players have set their number, start the game
                if game.p1_number and game.p2_number:
                    game.current_turn = "p1"
                    game.start_time = datetime.now()
                    game.timer_task = asyncio.create_task(start_timer(game))

                    await send(game.p1.ws, "game_started",
                               your_number=game.p1_number, current_turn="p1",
                               opponent=game.p2.name)
                    await send(game.p2.ws, "game_started",
                               your_number=game.p2_number, current_turn="p1",
                               opponent=game.p1.name)
                    logger.info(f"Game {game.id}: both numbers set, game started")

            # ── GUESS ──────────────────────────────────────────
            elif msg_type == "guess":
                guess = str(data.get("guess", ""))
                game = active_games.get(player.id)
                if not game:
                    await send(ws, "error", message="Not in a game")
                    continue
                if game.current_turn != ("p1" if game.p1.id == player.id else "p2"):
                    await send(ws, "error", message="Not your turn")
                    continue
                if len(guess) != game.digits or not guess.isdigit():
                    await send(ws, "error", message=f"Must be exactly {game.digits} digits")
                    continue

                # Determine whose number is being guessed
                if game.current_turn == "p1":
                    target_number = game.p2_number
                    guesser = game.p1
                    opponent = game.p2
                    next_turn = "p2"
                else:
                    target_number = game.p1_number
                    guesser = game.p2
                    opponent = game.p1
                    next_turn = "p1"

                # Compare digit by digit
                feedback = []
                correct_in_position = 0
                for i, digit in enumerate(guess):
                    if i < len(target_number) and digit == target_number[i]:
                        feedback.append({"position": i, "digit": digit, "status": "correct"})
                        correct_in_position += 1
                    elif digit in target_number:
                        feedback.append({"position": i, "digit": digit, "status": "wrong_position"})
                    else:
                        feedback.append({"position": i, "digit": digit, "status": "wrong"})

                # Update score
                if game.current_turn == "p1":
                    game.p1_correct_in_position = max(game.p1_correct_in_position, correct_in_position)
                else:
                    game.p2_correct_in_position = max(game.p2_correct_in_position, correct_in_position)

                # Store the guess
                guess_entry = {
                    "guesser": guesser.name,
                    "guess": guess,
                    "correct_in_position": correct_in_position,
                    "feedback": feedback,
                    "turn": game.current_turn,
                }
                game.guesses.append(guess_entry)

                # Send feedback to guesser
                await send(guesser.ws, "guess_result",
                           guess=guess, correct_in_position=correct_in_position,
                           feedback=feedback, your_turn=False,
                           total_correct_so_far=(game.p1_correct_in_position if guesser.id == game.p1.id else game.p2_correct_in_position))

                # Tell opponent a guess was made (but not the details)
                await send(opponent.ws, "opponent_guessed",
                           guesser_name=guesser.name)

                # Check win condition: all digits correct
                if correct_in_position == game.digits:
                    game.timer_task.cancel()
                    await end_game(game, "solved")
                    continue

                # Switch turn
                game.current_turn = next_turn
                await send(guesser.ws, "turn_change", your_turn=False)
                await send(opponent.ws, "turn_change", your_turn=True)

            # ── LEAVE / CANCEL MATCHMAKING ─────────────────────
            elif msg_type == "cancel_match":
                difficulty = data.get("difficulty", "")
                if difficulty in waiting_players:
                    queue = waiting_players[difficulty]
                    for i, p in enumerate(queue):
                        if p.id == player.id:
                            queue.pop(i)
                            await send(ws, "match_cancelled")
                            break

    except WebSocketDisconnect:
        logger.info(f"Player {player.name if player else '?'} disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        # Cleanup on disconnect
        if player:
            game = active_games.pop(player.id, None)
            if game:
                other = game.p2 if game.p1.id == player.id else game.p1
                await send(other.ws, "opponent_left")
                active_games.pop(other.id, None)
                games_by_id.pop(game.id, None)
                if game.timer_task:
                    game.timer_task.cancel()
            # Remove from waiting queues
            for q in waiting_players.values():
                for i, p in enumerate(q):
                    if p.id == player.id:
                        q.pop(i)
                        break

# ── Serve React Frontend (production mode) ────────────────────

FRONTEND_DIR = Path(__file__).parent.parent / "frontend" / "dist"
logger.info(f"Frontend dir: {FRONTEND_DIR} (exists={FRONTEND_DIR.exists()})")

@app.get("/")
async def root():
    """Explicit root route for the SPA."""
    index = FRONTEND_DIR / "index.html"
    if index.exists():
        return FileResponse(str(index))
    return FileResponse(str(FRONTEND_DIR / "index.html"))

if FRONTEND_DIR.exists():
    assets_dir = FRONTEND_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        """Serve React SPA — all non-API routes go to index.html."""
        if full_path.startswith(("ws", "docs", "openapi")):
            from fastapi.responses import JSONResponse
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        
        file_path = FRONTEND_DIR / full_path
        if file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(FRONTEND_DIR / "index.html"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)
