const socket = io();
var game = new Chess();
var board = null;
var playerRole = null;
var currentRoomId = null;
var selectedTime = 600; // Default 10 minutes
var gameMode = null; // 'online', 'friend', or 'computer'
var engine = null;
var computerLevel = 5; // Default difficulty (1-20)

// --- 1. HANDLE MENU & ROOMS ---
const urlParams = new URLSearchParams(window.location.search);
const roomParam = urlParams.get('room');

if (roomParam) {
    // If URL has ?room=xyz, join that friend room automatically
    document.getElementById('startMenu').style.display = 'none';
    document.getElementById('gameContainer').style.display = 'none';
    currentRoomId = roomParam;
    socket.emit('joinGame', { type: 'friend', roomId: currentRoomId, timeLimit: selectedTime });
} else {
    // Show menu, hide game
    document.getElementById('startMenu').style.display = 'flex';
    document.getElementById('gameContainer').style.display = 'none';
}

// Timer Button Selection
document.querySelectorAll('.timer-button').forEach(btn => {
    btn.addEventListener('click', function () {
        selectedTime = parseInt(this.getAttribute('data-time')) * 60;
        // Highlight selected button
        document.querySelectorAll('.timer-button').forEach(b => b.classList.remove('selected'));
        this.classList.add('selected');
    });
});

// Custom Time Button
document.getElementById('customTimeBtn').addEventListener('click', () => {
    const customMin = parseInt(document.getElementById('customTimeInput').value);
    if (customMin && customMin > 0 && customMin <= 60) {
        selectedTime = customMin * 60;
        document.querySelectorAll('.timer-button').forEach(b => b.classList.remove('selected'));
    }
});

// Button: Play Online
document.getElementById('btnOnline').addEventListener('click', () => {
    gameMode = 'online';
    document.getElementById('statusText').innerText = "Searching for opponent...";
    socket.emit('joinGame', { type: 'online', timeLimit: selectedTime });
});

// Button: Play with Friend
document.getElementById('btnFriend').addEventListener('click', () => {
    gameMode = 'friend';
    // Generate random Room ID and redirect
    const randomId = Math.random().toString(36).substring(2, 8);
    window.location.href = `?room=${randomId}`;
});

// Button: Play vs Computer
document.getElementById('btnComputer').addEventListener('click', async () => {
    gameMode = 'computer';

    // Ask for difficulty
    const difficulty = prompt('Choose difficulty (1-10):\\n1 = Beginner\\n5 = Intermediate\\n10 = Expert', '5');
    if (!difficulty) return; // User cancelled

    computerLevel = Math.min(20, Math.max(1, parseInt(difficulty) * 2)); // Convert to Stockfish scale

    document.getElementById('startMenu').style.display = 'none';
    document.getElementById('gameContainer').style.display = 'block';

    // Initialize engine
    try {
        if (!engine) {
            engine = new ChessEngine();
            showCoachMessage('🔄 Loading AI Engine...');
            await engine.init();
            showCoachMessage('✅ Engine loaded successfully!');
        }

        // Start game
        playerRole = 'w'; // Player is always white vs computer
        initializeBoard('w');
        showCoachMessage('🎯 Good luck! I\'ll be analyzing your moves.');
    } catch (error) {
        console.error('Engine initialization failed:', error);
        showCoachMessage('❌ Failed to load AI engine. Please refresh and try again.');
        alert('Failed to load chess engine. This might be due to:\n- Slow internet connection\n- Browser blocking web workers\n\nPlease try:\n1. Refresh the page\n2. Use a different browser (Chrome/Firefox recommended)');

        // Go back to menu
        document.getElementById('startMenu').style.display = 'flex';
        document.getElementById('gameContainer').style.display = 'none';
    }
});

// Helper: Copy Link
window.copyLink = function () {
    const copyText = document.getElementById("gameLink");
    copyText.select();
    document.execCommand("copy");
    alert("Link copied! Send it to your friend.");
}

// New Game Button
document.getElementById('newGameBtn').addEventListener('click', () => {
    window.location.href = window.location.pathname; // Reload to start menu
});

// --- 2. SOCKET EVENTS ---

socket.on('status', (msg) => {
    document.getElementById('startMenu').style.display = 'flex';
    document.getElementById('gameContainer').style.display = 'none';
    document.getElementById('statusText').innerText = msg;

    // If waiting for friend, show the link
    if (msg.includes('Waiting for friend')) {
        document.getElementById('linkBox').style.display = 'block';
        document.getElementById('gameLink').value = window.location.href;
    } else {
        document.getElementById('linkBox').style.display = 'none';
    }
});

socket.on('gameStart', ({ color, roomId }) => {
    document.getElementById('startMenu').style.display = 'none';
    document.getElementById('gameContainer').style.display = 'block';
    currentRoomId = roomId;
    playerRole = color;

    // Initialize Board
    initializeBoard(color);
    alert("Game Started! You are " + (color === 'w' ? "White" : "Black"));
});

socket.on('move', (msg) => {
    game.move(msg);
    board.position(game.fen());
    updateMoveHistory();
    checkGameOver();
});

socket.on('timerUpdate', (timers) => {
    const format = (t) => {
        let m = Math.floor(t / 60);
        let s = t % 60;
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    // Update timers
    document.getElementById('timer-white').innerText = "White: " + format(timers.w);
    document.getElementById('timer-black').innerText = "Black: " + format(timers.b);

    // Highlight active timer
    if (game.turn() === 'w') {
        document.getElementById('timer-white').classList.add('active-timer');
        document.getElementById('timer-black').classList.remove('active-timer');
    } else {
        document.getElementById('timer-black').classList.add('active-timer');
        document.getElementById('timer-white').classList.remove('active-timer');
    }
});

socket.on('gameOver', (message) => {
    document.getElementById('gameOverText').innerText = message;
    document.getElementById('gameOverlay').style.display = 'flex';
});

// --- 3. GAME LOGIC ---
function initializeBoard(color) {
    game = new Chess();

    if (board) board.destroy();
    board = Chessboard('myBoard', {
        draggable: true,
        position: 'start',
        orientation: color === 'w' ? 'white' : 'black',
        onDragStart: onDragStart,
        onDrop: onDrop,
        onSnapEnd: onSnapEnd,
        pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png'
    });

    updateMoveHistory();
}

function onDragStart(source, piece) {
    if (game.game_over() || !playerRole || game.turn() !== playerRole) return false;
    if ((playerRole === 'w' && piece.search(/^b/) !== -1) ||
        (playerRole === 'b' && piece.search(/^w/) !== -1)) return false;
}

function onDrop(source, target) {
    const prevScore = evaluatePosition();
    const move = game.move({ from: source, to: target, promotion: 'q' });
    if (move === null) return 'snapback';

    // Send move to server if multiplayer
    if (gameMode !== 'computer' && currentRoomId) {
        socket.emit('move', { roomId: currentRoomId, move: { from: source, to: target, promotion: 'q' } });
    }

    updateMoveHistory();

    // AI Coach Feedback (async)
    if (gameMode === 'computer' && engine) {
        analyzeMove(prevScore, move);
    }

    checkGameOver();

    // Computer's turn
    if (gameMode === 'computer' && game.turn() === 'b' && !game.game_over()) {
        setTimeout(makeComputerMove, 500);
    }
}

function onSnapEnd() {
    board.position(game.fen());
}

function makeComputerMove() {
    if (!engine || game.game_over()) return;

    engine.getBestMove(game.fen(), computerLevel, (move) => {
        if (move && !game.game_over()) {
            game.move(move);
            board.position(game.fen());
            updateMoveHistory();
            checkGameOver();
        }
    });
}

// Simple position evaluation for coach
function evaluatePosition() {
    const pieces = {
        'p': 1, 'n': 3, 'b': 3, 'r': 5, 'q': 9, 'k': 0
    };

    const boardState = game.board();
    let score = 0;

    for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
            const piece = boardState[i][j];
            if (piece) {
                const value = pieces[piece.type] || 0;
                score += piece.color === 'w' ? value : -value;
            }
        }
    }

    return score;
}

// AI Coach Analysis
function analyzeMove(prevScore, move) {
    if (!engine) return;

    const currentScore = evaluatePosition();
    const scoreDiff = (playerRole === 'w' ? currentScore - prevScore : prevScore - currentScore);

    // Wait a moment then analyze
    setTimeout(() => {
        engine.getBestMove(game.fen(), 20, (bestMove) => {
            const playerMove = move.from + move.to;
            const engineMove = bestMove.from + bestMove.to;

            let feedback = '';

            if (scoreDiff < -2) {
                feedback = `⚠️ Blunder! You lost material. Consider defending better.`;
            } else if (scoreDiff < -1) {
                feedback = `❌ Mistake. That move wasn't optimal.`;
            } else if (playerMove === engineMove) {
                feedback = `✅ Excellent! Best move found!`;
            } else if (scoreDiff > 1) {
                feedback = `💎 Great move! You gained advantage.`;
            } else {
                feedback = `👍 Good move.`;
            }

            showCoachMessage(feedback);
        });
    }, 1000);
}

function showCoachMessage(message) {
    const historyDiv = document.getElementById('moveHistory');
    const coachDiv = document.createElement('div');
    coachDiv.className = 'coach-message';
    coachDiv.innerHTML = `<strong>🤖 Coach:</strong> ${message}`;
    historyDiv.appendChild(coachDiv);
    historyDiv.scrollTop = historyDiv.scrollHeight;
}

function updateMoveHistory() {
    const history = game.history();
    const list = document.getElementById('moveHistory');
    let html = '<h3>Move History</h3>';
    for (let i = 0; i < history.length; i += 2) {
        html += `<div class="history-row">
            <span class="move-number">${(i / 2) + 1}.</span>
            <span class="move-white">${history[i]}</span>
            <span class="move-black">${history[i + 1] || ''}</span>
        </div>`;
    }
    list.innerHTML = html;
    list.scrollTop = list.scrollHeight;
}

function checkGameOver() {
    if (game.game_over()) {
        let message = '';
        if (game.in_checkmate()) {
            message = (game.turn() === 'w' ? 'Black' : 'White') + ' wins by checkmate!';
        } else if (game.in_draw()) {
            message = 'Game drawn!';
        } else if (game.in_stalemate()) {
            message = 'Stalemate!';
        } else if (game.in_threefold_repetition()) {
            message = 'Draw by threefold repetition!';
        } else if (game.insufficient_material()) {
            message = 'Draw by insufficient material!';
        }

        if (gameMode !== 'computer' && currentRoomId) {
            socket.emit('gameEnd', currentRoomId);
        }

        setTimeout(() => {
            document.getElementById('gameOverText').innerText = message;
            document.getElementById('gameOverlay').style.display = 'flex';
        }, 500);
    }
}