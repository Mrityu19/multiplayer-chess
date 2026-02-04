const socket = io();
var game = new Chess();
var board = null;
var playerRole = null;
var currentRoomId = null;
var selectedTime = 300; // Default 5 minutes
var selectedIncrement = 0; // Default no increment
var gameMode = null; // 'online', 'friend', or 'computer'
var engine = null;
var computerLevel = 10; // Stockfish skill level (1-20)
var computerTimerInterval = null;
var computerTimers = { w: 600, b: 600 };

// Store game history for analysis
var gameHistory = [];
var analysisBoard = null;
var analysisIndex = 0;

// ELO Range mappings
const ELO_RANGES = {
    1: { label: 'Beginner', elo: '~800', level: 1 },
    2: { label: 'Novice', elo: '~1000', level: 3 },
    3: { label: 'Casual', elo: '~1200', level: 5 },
    4: { label: 'Club Player', elo: '~1300', level: 7 },
    5: { label: 'Intermediate', elo: '~1400', level: 10 },
    6: { label: 'Strong', elo: '~1500', level: 12 },
    7: { label: 'Advanced', elo: '~1700', level: 14 },
    8: { label: 'Expert', elo: '~1900', level: 16 },
    9: { label: 'Master', elo: '~2100', level: 18 },
    10: { label: 'Grandmaster', elo: '~2300+', level: 20 }
};

// --- 1. HANDLE MENU & ROOMS ---
const urlParams = new URLSearchParams(window.location.search);
const roomParam = urlParams.get('room');

// --- NEW DEFINITIONS ---
var pendingPremove = null; // {source, target, promotion}
var maxUnlockedLevel = parseInt(localStorage.getItem('chess_max_level')) || 1;

// 20 Levels Definition
const LEVELS = [];
for (let i = 1; i <= 20; i++) {
    // Linear progression from 250 to 2700 approx
    // 250 + (i-1) * 130  -> Level 1=250, Level 20=2720
    const elo = 250 + (i - 1) * 130;
    LEVELS.push({ level: i, elo: elo, desc: `Level ${i}` });
}

// Map selected level to engine settings
function getEngineSettings(levelIndex) {
    // levelIndex is 0-19
    const levelData = LEVELS[levelIndex];

    // For lower levels, use UCI_Elo to limit strength effectively
    // For higher levels (e.g., 18-20), let Stockfish run free or high skill

    if (levelIndex < 18) {
        return { elo: levelData.elo };
    } else {
        // High levels: Use legacy Skill Level or max
        return { skillLevel: 20 };
    }
}

if (roomParam) {
    // If URL has ?room=xyz, show time setup for friend
    document.getElementById('startMenu').style.display = 'none';
    document.getElementById('timeSetup').style.display = 'flex';
    gameMode = 'friend';
    currentRoomId = roomParam;
} else {
    // Show menu, hide game
    document.getElementById('startMenu').style.display = 'flex';
    document.getElementById('gameContainer').style.display = 'none';
}

// --- TIME CONTROL PRESET BUTTONS ---
document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', function () {
        // Remove selected from all
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('selected'));
        this.classList.add('selected');

        // Get time and increment
        selectedTime = parseInt(this.getAttribute('data-time')) * 60;
        selectedIncrement = parseInt(this.getAttribute('data-inc'));

        // Update display
        updateTimeDisplay();
    });
});

// Apply Custom Time
document.getElementById('applyCustomTime').addEventListener('click', () => {
    const minutes = parseInt(document.getElementById('customMinutes').value) || 10;
    const increment = parseInt(document.getElementById('customIncrement').value) || 0;

    selectedTime = minutes * 60;
    selectedIncrement = increment;

    // Remove preset selection
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('selected'));

    updateTimeDisplay();
});

function updateTimeDisplay() {
    const mins = Math.floor(selectedTime / 60);
    const category = getTimeCategory(mins);
    document.getElementById('selectedTimeDisplay').textContent =
        `${mins}+${selectedIncrement} ${category}`;
}

function getTimeCategory(minutes) {
    if (minutes <= 2) return 'Bullet';
    if (minutes <= 5) return 'Blitz';
    if (minutes <= 15) return 'Rapid';
    return 'Classical';
}

// Button: Play Online - Show time setup first
document.getElementById('btnOnline').addEventListener('click', () => {
    gameMode = 'online';
    document.getElementById('startMenu').style.display = 'none';
    document.getElementById('timeSetup').style.display = 'flex';
});

// Button: Play with Friend - Show time setup first
document.getElementById('btnFriend').addEventListener('click', () => {
    gameMode = 'friend';
    const randomId = Math.random().toString(36).substring(2, 8);
    currentRoomId = randomId;
    document.getElementById('startMenu').style.display = 'none';
    document.getElementById('timeSetup').style.display = 'flex';
});

// Confirm Time and Start Game
document.getElementById('confirmTimeBtn').addEventListener('click', () => {
    document.getElementById('timeSetup').style.display = 'none';

    if (gameMode === 'online') {
        document.getElementById('startMenu').style.display = 'flex';
        document.getElementById('statusText').innerText = "Searching for opponent...";
        socket.emit('joinGame', {
            type: 'online',
            timeLimit: selectedTime,
            increment: selectedIncrement
        });
    } else if (gameMode === 'friend') {
        // Check if we came from a link (roomParam exists) or are creating new
        if (roomParam) {
            // Joining existing room via link
            socket.emit('joinGame', {
                type: 'friend',
                roomId: currentRoomId,
                timeLimit: selectedTime,
                increment: selectedIncrement
            });
        } else {
            // Creating new room - redirect with room id
            window.location.href = `?room=${currentRoomId}`;
        }
    }
});

// Back from Time Setup
document.getElementById('backFromTimeBtn').addEventListener('click', () => {
    document.getElementById('timeSetup').style.display = 'none';
    if (roomParam) {
        window.location.href = window.location.pathname;
    } else {
        document.getElementById('startMenu').style.display = 'flex';
    }
    currentRoomId = null;
});

// Button: Play vs Computer - Show setup panel (no popup!)
document.getElementById('btnComputer').addEventListener('click', () => {
    document.getElementById('startMenu').style.display = 'none';
    document.getElementById('computerSetup').style.display = 'flex';
    renderLevelGrid(); // Render or Refresh Grid
});

// Back to Menu button
document.getElementById('backToMenu').addEventListener('click', () => {
    document.getElementById('computerSetup').style.display = 'none';
    document.getElementById('startMenu').style.display = 'flex';
});

// --- NEW: RENDER LEVEL GRID ---
function renderLevelGrid() {
    const container = document.getElementById('levelGridContainer');
    if (!container) return; // Need to create this in HTML
    container.innerHTML = '';

    LEVELS.forEach((lvl, index) => {
        const btn = document.createElement('div');
        btn.className = 'level-btn';
        if (lvl.level <= maxUnlockedLevel) {
            btn.classList.add('unlocked');
            if (lvl.level === computerLevel) btn.classList.add('selected');

            btn.innerHTML = `<span class="lvl-num">${lvl.level}</span><span class="lvl-elo">${lvl.elo}</span>`;

            btn.onclick = () => {
                document.querySelectorAll('.level-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                computerLevel = lvl.level;

                document.getElementById('difficultyLabel').textContent = `Level ${lvl.level}`;
                document.getElementById('eloRange').textContent = `(${lvl.elo} ELO)`;
            };
        } else {
            btn.classList.add('locked');
            btn.innerHTML = `🔒<br><span class="lvl-elo">${lvl.elo}</span>`;
        }

        container.appendChild(btn);
    });
}
// --------------------------------

// Computer Timer Selection
document.querySelectorAll('#computerSetup .timer-btn').forEach(btn => {
    btn.addEventListener('click', function () {
        document.querySelectorAll('#computerSetup .timer-btn').forEach(b => b.classList.remove('selected'));
        this.classList.add('selected');
        const time = parseInt(this.getAttribute('data-time'));
        selectedTime = time * 60; // 0 means no timer
    });
});

// Start Computer Game Button
document.getElementById('startComputerGame').addEventListener('click', async () => {
    gameMode = 'computer';

    document.getElementById('computerSetup').style.display = 'none';
    document.getElementById('gameContainer').style.display = 'block';
    document.getElementById('buttonParent').style.display = 'none';

    // Set up timers
    computerTimers = { w: selectedTime, b: selectedTime };

    // Reset game history
    gameHistory = [];
    pendingPremove = null;

    // Initialize engine
    try {
        if (!engine) {
            engine = new ChessEngine();
            showCoachMessage('🔄 Loading AI Engine...');
            await engine.init();
            showCoachMessage('✅ Engine ready! Good luck!');
        }

        playerRole = 'w';
        initializeBoard('w');

        // Start timer if enabled
        if (selectedTime > 0) {
            updateTimerDisplay();
            startComputerTimer();
        } else {
            document.getElementById('timer-white').innerText = 'White: ∞';
            document.getElementById('timer-black').innerText = 'Black: ∞';
        }

        showStatusMessage(`Playing vs Level ${computerLevel} (${LEVELS[computerLevel - 1].elo} ELO)`, 'success');

    } catch (error) {
        console.error('Engine initialization failed:', error);
        showCoachMessage('❌ Failed to load AI engine. Please refresh.');
        showStatusMessage('Engine failed to load. Try refreshing the page.', 'error');

        document.getElementById('startMenu').style.display = 'flex';
        document.getElementById('gameContainer').style.display = 'none';
    }
});

// Helper: Copy Link
window.copyLink = function () {
    const copyText = document.getElementById("gameLink");
    copyText.select();
    document.execCommand("copy");
    showStatusMessage('Link copied! Send it to your friend.', 'success');
}

// New Game Button
document.getElementById('newGameBtn').addEventListener('click', () => {
    stopComputerTimer();
    window.location.href = window.location.pathname;
});

// Analyze Game Button
document.getElementById('analyzeGameBtn').addEventListener('click', () => {
    document.getElementById('gameOverlay').style.display = 'none';
    startGameAnalysis();
});

// Resign Button
document.getElementById('resignBtn').addEventListener('click', () => {
    if (!game || game.game_over()) return;

    const confirmResign = confirm('Are you sure you want to resign?');
    if (confirmResign) {
        stopComputerTimer();
        const winner = playerRole === 'w' ? 'Black' : 'White';
        document.getElementById('gameOverText').innerText = winner + ' wins by resignation!';
        document.getElementById('gameOverlay').style.display = 'flex';

        if (gameMode !== 'computer' && currentRoomId) {
            socket.emit('gameEnd', currentRoomId);
        }
    }
});

// --- STATUS MESSAGE (replaces alerts) ---
function showStatusMessage(message, type = 'info') {
    // Remove existing message
    const existing = document.querySelector('.status-message');
    if (existing) existing.remove();

    const msgEl = document.createElement('div');
    msgEl.className = `status-message ${type}`;
    msgEl.textContent = message;
    document.body.appendChild(msgEl);

    setTimeout(() => msgEl.remove(), 3000);
}

// --- 2. SOCKET EVENTS ---

socket.on('status', (msg) => {
    document.getElementById('startMenu').style.display = 'flex';
    document.getElementById('gameContainer').style.display = 'none';
    document.getElementById('buttonParent').style.display = 'flex';
    document.getElementById('statusText').innerText = msg;

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
    document.getElementById('buttonParent').style.display = 'none';
    currentRoomId = roomId;
    playerRole = color;
    gameHistory = [];
    pendingPremove = null;

    initializeBoard(color);
    showStatusMessage("Game started! You are " + (color === 'w' ? "White" : "Black"), 'success');
});

socket.on('move', (msg) => {
    executeMove(msg, false); // false = not my move

    // Check for premove
    handlePremove();
});

socket.on('timerUpdate', (timers) => {
    const format = (t) => {
        let m = Math.floor(t / 60);
        let s = t % 60;
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    document.getElementById('timer-white').innerText = "White: " + format(timers.w);
    document.getElementById('timer-black').innerText = "Black: " + format(timers.b);

    if (game.turn() === 'w') {
        document.getElementById('timer-white').classList.add('active-timer');
        document.getElementById('timer-black').classList.remove('active-timer');
    } else {
        document.getElementById('timer-black').classList.add('active-timer');
        document.getElementById('timer-white').classList.remove('active-timer');
    }
});

socket.on('gameOver', (message) => {
    stopComputerTimer();
    document.getElementById('gameOverText').innerText = message;
    document.getElementById('gameOverlay').style.display = 'flex';
});

// --- 3. COMPUTER TIMER ---
function startComputerTimer() {
    stopComputerTimer();

    if (selectedTime === 0) return; // No timer mode

    computerTimerInterval = setInterval(() => {
        const turn = game.turn();
        computerTimers[turn]--;
        updateTimerDisplay();

        if (computerTimers[turn] <= 0) {
            stopComputerTimer();
            const winner = turn === 'w' ? 'Black' : 'White';
            document.getElementById('gameOverText').innerText = winner + " wins on time!";
            document.getElementById('gameOverlay').style.display = 'flex';
        }
    }, 1000);
}

function stopComputerTimer() {
    if (computerTimerInterval) {
        clearInterval(computerTimerInterval);
        computerTimerInterval = null;
    }
}

function updateTimerDisplay() {
    const format = (t) => {
        if (t === 0 && selectedTime === 0) return '∞';
        let m = Math.floor(t / 60);
        let s = t % 60;
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    document.getElementById('timer-white').innerText = "White: " + format(computerTimers.w);
    document.getElementById('timer-black').innerText = "Black: " + format(computerTimers.b);

    if (game.turn() === 'w') {
        document.getElementById('timer-white').classList.add('active-timer');
        document.getElementById('timer-black').classList.remove('active-timer');
    } else {
        document.getElementById('timer-black').classList.add('active-timer');
        document.getElementById('timer-white').classList.remove('active-timer');
    }
}

// --- 4. GAME LOGIC ---
function initializeBoard(color) {
    game = new Chess();

    // Store starting position
    gameHistory = [{
        fen: game.fen(),
        move: null,
        san: null
    }];

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
    if (game.game_over()) return false;

    // PREMOVE LOGIC
    // If it's NOT my turn, but I'm trying to move, check if I own the piece
    if (game.turn() !== playerRole) {
        if ((playerRole === 'w' && piece.search(/^w/) !== -1) ||
            (playerRole === 'b' && piece.search(/^b/) !== -1)) {

            // Allow drag to set premove (return true), but we need to handle "onDrop" specially
            // However, chessboard.js onDrop only fires if the move is "legal" compared to current board?
            // Actually, chessboard.js doesn't validate rules, only "onDrop" logic does.
            // visual feedback for premove will happen in onDrop
            return true;
        }
        return false;
    }

    // Normal move validation
    if (!playerRole || game.turn() !== playerRole) return false;
    if ((playerRole === 'w' && piece.search(/^b/) !== -1) ||
        (playerRole === 'b' && piece.search(/^w/) !== -1)) return false;
}

function onDrop(source, target) {
    // IS PREMOVE?
    if (game.turn() !== playerRole) {
        // Attempting to premove
        const moves = game.moves({ verbose: true });
        // We can't validate move legallity strictly yet because the board state isn't right
        // We just store it. Logic: if source != target, assume intent to move.
        if (source === target) return;

        // Visual feedback for premove
        pendingPremove = { from: source, to: target, promotion: 'q' };

        // Highlight square to show premove is set (Custom CSS needed)
        // For now, we just rely on visual snapback (board will snap piece back, but we stored intent)
        // To make it look "stuck", we'd need to manipulate the board state or add markers.
        // Simple 1st iteration: Snapback but store move.
        showStatusMessage('Premove set!', 'info');
        return 'snapback';
    }

    // NORMAL MOVE
    const prevScore = evaluatePosition();
    const move = game.move({ from: source, to: target, promotion: 'q' });
    if (move === null) return 'snapback';

    // Clear any premove if I made a manual move
    pendingPremove = null;

    executeMyMove(source, target, move, prevScore);
}

function handlePremove() {
    if (pendingPremove && game.turn() === playerRole) {
        // Clear highlights
        $('.board-b72b1 .square-55d63').removeClass('premove-highlight');

        // Try to execute premove
        const move = game.move(pendingPremove);
        if (move) {
            // Legal move!
            board.position(game.fen());
            executeMyMove(pendingPremove.from, pendingPremove.to, move, evaluatePosition());
            showStatusMessage('Premove executed!', 'success');
        } else {
            showStatusMessage('Premove invalid.', 'error');
        }
        pendingPremove = null;
    }
}

function executeMyMove(source, target, move, prevScore) {
    // Store in history
    gameHistory.push({
        fen: game.fen(),
        move: { from: source, to: target, promotion: 'q' },
        san: move.san
    });

    // Send move to server if multiplayer
    if (gameMode !== 'computer' && currentRoomId) {
        socket.emit('move', { roomId: currentRoomId, move: { from: source, to: target, promotion: 'q' } });
    }

    updateMoveHistory();

    // Simple coach feedback
    if (gameMode === 'computer') {
        showSimpleCoachFeedback(prevScore, move);
    }

    checkGameOver();

    // Computer's turn
    if (gameMode === 'computer' && game.turn() === 'b' && !game.game_over()) {
        showCoachMessage('🤔 Computer is thinking...');
        // Remove setTimeout and rely on engine callback
        makeComputerMove();
    }
}

function executeMove(msg, isMyMove) {
    const move = game.move(msg);
    board.position(game.fen());

    // Store history
    gameHistory.push({
        fen: game.fen(),
        move: msg,
        san: game.history().slice(-1)[0]
    });

    updateMoveHistory();
    checkGameOver();
}

function onSnapEnd() {
    board.position(game.fen());
}

function makeComputerMove() {
    if (!engine || !engine.ready || game.game_over()) {
        console.log('Engine not ready or game over');
        return;
    }

    const levelSettings = getEngineSettings(computerLevel - 1); // 0-indexed
    console.log('Computer thinking at level:', computerLevel, 'Settings:', levelSettings);

    engine.getBestMove(game.fen(), levelSettings, (move) => {
        console.log('Computer move received:', move);

        // Add a tiny random delay to feel human if it's too fast? 
        // Or just execute immediately. Let's do a minimal 200ms visual delay.
        setTimeout(() => {
            if (move && !game.game_over()) {
                const result = game.move(move);

                if (result) {
                    // Store in history
                    gameHistory.push({
                        fen: game.fen(),
                        move: move,
                        san: result.san
                    });

                    board.position(game.fen());
                    updateMoveHistory();

                    checkGameOver();

                    // Trigger Premove Check
                    handlePremove();
                }
            }
        }, 300);
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

// ===== JEREMY SILMAN STYLE POSITIONAL TEACHING =====
// Based on "How to Reassess Your Chess" concepts

function showSimpleCoachFeedback(prevScore, move) {
    const currentScore = evaluatePosition();
    const scoreDiff = currentScore - prevScore;

    // Analyze position using Silman's imbalances
    const analysis = analyzePositionalConcepts(move);

    // Build teaching message
    let feedback = '';

    // Material evaluation first
    if (scoreDiff < -2) {
        feedback = `<span class="concept-tag">BLUNDER</span> ⚠️ You lost significant material! ${analysis.tactical}`;
    } else if (scoreDiff < -1) {
        feedback = `<span class="concept-tag">MISTAKE</span> ❌ That cost you material. ${analysis.suggestion}`;
    } else if (scoreDiff > 2) {
        feedback = `<span class="concept-tag">BRILLIANT</span> 💎 Excellent capture! ${analysis.praise}`;
    } else if (scoreDiff > 0) {
        feedback = `<span class="concept-tag">GOOD</span> ✨ Nice material gain! ${analysis.followup}`;
    } else {
        // No material change - give positional advice
        feedback = analysis.positional;
    }

    showSilmanCoachMessage(feedback);
}

function analyzePositionalConcepts(move) {
    const fen = game.fen();
    const boardState = game.board();
    const moveCount = game.history().length;
    const phase = getGamePhase(moveCount, boardState);

    // Silman's 7 Imbalances Analysis
    const analysis = {
        tactical: '',
        suggestion: '',
        praise: '',
        followup: '',
        positional: ''
    };

    // Detect which piece moved
    const piece = move.piece;
    const san = move.san;
    const from = move.from;
    const to = move.to;

    // === OPENING PHASE ===
    if (phase === 'opening') {
        analysis.positional = getOpeningAdvice(move, boardState, san);
    }
    // === MIDDLEGAME PHASE ===
    else if (phase === 'middlegame') {
        analysis.positional = getMiddlegameAdvice(move, boardState, san);
    }
    // === ENDGAME PHASE ===
    else {
        analysis.positional = getEndgameAdvice(move, boardState, san);
    }

    // Add tactical notes
    analysis.tactical = getTacticalNote(san);
    analysis.suggestion = getSuggestion(phase);
    analysis.praise = getPraise();
    analysis.followup = getFollowup(phase);

    return analysis;
}

function getGamePhase(moveCount, boardState) {
    // Count major pieces
    let queens = 0, rooks = 0, minors = 0;
    for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
            const piece = boardState[i][j];
            if (piece) {
                if (piece.type === 'q') queens++;
                else if (piece.type === 'r') rooks++;
                else if (piece.type === 'b' || piece.type === 'n') minors++;
            }
        }
    }

    if (moveCount < 10) return 'opening';
    if (queens === 0 || (queens <= 1 && minors <= 2)) return 'endgame';
    return 'middlegame';
}

function getOpeningAdvice(move, boardState, san) {
    const openingPrinciples = [
        {
            condition: () => san.match(/^[NQRB]/),
            message: `<span class="concept-tag">DEVELOPMENT</span> 👍 Good piece development! "In the opening, bring your pieces to active squares. Each move should contribute to development or center control."`,
            quote: `"A piece has to be developed to a square where it can be useful."`
        },
        {
            condition: () => san === 'e4' || san === 'd4' || san === 'c4',
            message: `<span class="concept-tag">CENTER</span> ♟️ Excellent center control! "The player who controls the center controls the game."`,
            quote: `"Central pawns give your pieces more mobility and cramp your opponent's position."`
        },
        {
            condition: () => san === 'O-O' || san === 'O-O-O',
            message: `<span class="concept-tag">KING SAFETY</span> 🏰 Smart castling! "Get your king to safety early. A king in the center is a target."`,
            quote: `"Castle early and often – but not too often!"`
        },
        {
            condition: () => san.match(/^N[a-h][36]$/),
            message: `<span class="concept-tag">KNIGHT PLAY</span> ♞ Knights belong on outposts! "Knights love to sit on squares where enemy pawns can't attack them."`,
            quote: `"A knight on the rim is dim, but a knight in the center is a winner!"`
        },
        {
            condition: () => san.match(/^Q/),
            message: `<span class="concept-tag">CAUTION</span> ⚠️ Early queen moves can be risky! "Develop minor pieces first. The queen can be harassed and you'll lose tempo."`,
            quote: `"The queen is powerful but vulnerable in the opening."`
        },
        {
            condition: () => true,
            message: `<span class="concept-tag">OPENING</span> 📖 Focus on: 1) Control the center 2) Develop pieces 3) Castle early 4) Connect your rooks`,
            quote: ``
        }
    ];

    for (const principle of openingPrinciples) {
        if (principle.condition()) {
            return principle.message + (principle.quote ? `<span class="quote">${principle.quote}</span>` : '');
        }
    }
    return openingPrinciples[openingPrinciples.length - 1].message;
}

function getMiddlegameAdvice(move, boardState, san) {
    const middlegameConcepts = [
        {
            condition: () => san.match(/^R[a-h][18]/),
            message: `<span class="concept-tag">ROOK LIFT</span> ♜ Rooks belong on open files! "Look for files without pawns. Control them with your rooks!"`,
            quote: `"An open file is like a highway for your rooks."`
        },
        {
            condition: () => san.match(/^R.*[de][1-8]/),
            message: `<span class="concept-tag">CENTRALIZATION</span> ♜ Rooks are powerful on central files! Consider doubling your rooks on this file.`,
            quote: `"Two rooks on an open file create a battery of power."`
        },
        {
            condition: () => san.match(/^B/),
            message: `<span class="concept-tag">BISHOP PLAY</span> ♝ Bishops need open diagonals! "A bishop is only as good as the diagonal it controls."`,
            quote: `"The two bishops working together are a formidable force."`
        },
        {
            condition: () => san.match(/^N[a-h][4-5]/),
            message: `<span class="concept-tag">OUTPOST</span> ♞ Knights thrive on outposts! "A knight on an outpost protected by a pawn is worth almost as much as a rook."`,
            quote: `"Outposts are the key to middlegame domination."`
        },
        {
            condition: () => san.includes('+'),
            message: `<span class="concept-tag">ATTACK</span> ⚔️ Check! "Every check is forcing. Use checks to gain tempo or create threats."`,
            quote: `"A check is the most forcing move in chess."`
        },
        {
            condition: () => san.includes('x'),
            message: `<span class="concept-tag">EXCHANGE</span> 🔄 Exchanges change the position! "Trade pieces when ahead or to simplify for an advantage."`,
            quote: `"When ahead in material, trade pieces, not pawns."`
        },
        {
            condition: () => true,
            message: `<span class="concept-tag">PLAN</span> 🎯 Consider the imbalances: Minor pieces, pawn structure, space, files, king safety, piece activity.`,
            quote: `"Find the imbalances, then create a plan based on them."`
        }
    ];

    for (const concept of middlegameConcepts) {
        if (concept.condition()) {
            return concept.message + (concept.quote ? `<span class="quote">${concept.quote}</span>` : '');
        }
    }
    return middlegameConcepts[middlegameConcepts.length - 1].message;
}

function getEndgameAdvice(move, boardState, san) {
    const endgameConcepts = [
        {
            condition: () => san.match(/^K/),
            message: `<span class="concept-tag">KING ACTIVITY</span> 👑 Activate your king! "In the endgame, the king becomes a fighting piece. Bring it to the center!"`,
            quote: `"The king is a strong piece – use it!"`
        },
        {
            condition: () => san.match(/^[a-h][78]=Q/),
            message: `<span class="concept-tag">PROMOTION</span> 👸 Promotion! "Passed pawns must be pushed. They're the key to winning endgames."`,
            quote: `"A passed pawn is a criminal that must be kept under lock and key."`
        },
        {
            condition: () => san.match(/^R/),
            message: `<span class="concept-tag">ROOK ENDGAME</span> ♜ Rooks belong behind passed pawns! "Whether yours or your opponent's, rooks are more active behind the pawn."`,
            quote: `"Rooks behind passed pawns can both push and stop."`
        },
        {
            condition: () => san.match(/^[a-h][5-7]/),
            message: `<span class="concept-tag">PASSED PAWN</span> ♟️ Push those pawns! "In the endgame, pawns become queens. Advance them safely!"`,
            quote: `"Passed pawns are born to become queens."`
        },
        {
            condition: () => true,
            message: `<span class="concept-tag">ENDGAME</span> 🏁 Key endgame principles: Activate king, create passed pawns, centralize rooks, improve piece activity.`,
            quote: `"The endgame is where games are won and lost."`
        }
    ];

    for (const concept of endgameConcepts) {
        if (concept.condition()) {
            return concept.message + (concept.quote ? `<span class="quote">${concept.quote}</span>` : '');
        }
    }
    return endgameConcepts[endgameConcepts.length - 1].message;
}

function getTacticalNote(san) {
    if (san.includes('#')) return 'Checkmate! The ultimate tactical blow!';
    if (san.includes('+')) return 'Check forces your opponent to respond.';
    if (san.includes('x')) return 'Captures change the material balance.';
    return 'Look for tactical opportunities.';
}

function getSuggestion(phase) {
    const suggestions = {
        opening: 'Focus on completing development and castling for safety.',
        middlegame: 'Look for piece activity and open files for your rooks.',
        endgame: 'Activate your king and create passed pawns.'
    };
    return suggestions[phase];
}

function getPraise() {
    const praises = [
        'You found the winning move!',
        'Sharp tactical vision!',
        'That\'s how masters play!',
        'Excellent calculation!'
    ];
    return praises[Math.floor(Math.random() * praises.length)];
}

function getFollowup(phase) {
    const followups = {
        opening: 'Now complete your development!',
        middlegame: 'Press your advantage with active pieces!',
        endgame: 'Convert your advantage methodically!'
    };
    return followups[phase];
}

function showSilmanCoachMessage(message) {
    const historyDiv = document.getElementById('moveHistory');
    const coachDiv = document.createElement('div');
    coachDiv.className = 'coach-message silman';
    coachDiv.innerHTML = `<strong>📚 Coach Silman:</strong> ${message}`;
    historyDiv.appendChild(coachDiv);
    historyDiv.scrollTop = historyDiv.scrollHeight;
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
        stopComputerTimer();

        let message = '';
        let winner = null;

        if (game.in_checkmate()) {
            winner = (game.turn() === 'w' ? 'Black' : 'White');
            message = winner + ' wins by checkmate!';

            // UNLOCK LEVEL
            if (gameMode === 'computer' && winner === 'White') {
                checkLevelUnlock();
            }

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

// --- CHECK LEVEL UNLOCK ---
function checkLevelUnlock() {
    // Only unlock if we beat the max unlocked level, and we aren't at max yet
    if (computerLevel === maxUnlockedLevel && maxUnlockedLevel < 20) {
        maxUnlockedLevel++;
        localStorage.setItem('chess_max_level', maxUnlockedLevel);
        renderLevelGrid(); // Refresh UI if open? (Unlikely, but good practice)
        showStatusMessage(`🎉 LEVEL ${maxUnlockedLevel} UNLOCKED!`, 'success');
    }
}

// --- 5. GAME ANALYSIS ---
function startGameAnalysis() {
    if (gameHistory.length < 2) {
        showStatusMessage('No moves to analyze!', 'error');
        return;
    }

    document.getElementById('analysisOverlay').style.display = 'flex';
    analysisIndex = 0;

    // Initialize analysis board
    if (analysisBoard) analysisBoard.destroy();
    analysisBoard = Chessboard('analysisBoard', {
        draggable: false,
        position: gameHistory[0].fen,
        pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png'
    });

    updateAnalysisDisplay();

    // Initialize engine for analysis if needed
    if (!engine) {
        engine = new ChessEngine();
        engine.init().then(() => {
            analyzeCurrentPosition();
        });
    } else {
        analyzeCurrentPosition();
    }
}

// Navigation buttons
document.getElementById('firstMove').addEventListener('click', () => {
    analysisIndex = 0;
    updateAnalysisDisplay();
    analyzeCurrentPosition();
});

document.getElementById('prevMove').addEventListener('click', () => {
    if (analysisIndex > 0) {
        analysisIndex--;
        updateAnalysisDisplay();
        analyzeCurrentPosition();
    }
});

document.getElementById('nextMove').addEventListener('click', () => {
    if (analysisIndex < gameHistory.length - 1) {
        analysisIndex++;
        updateAnalysisDisplay();
        analyzeCurrentPosition();
    }
});

document.getElementById('lastMove').addEventListener('click', () => {
    analysisIndex = gameHistory.length - 1;
    updateAnalysisDisplay();
    analyzeCurrentPosition();
});

document.getElementById('closeAnalysis').addEventListener('click', () => {
    document.getElementById('analysisOverlay').style.display = 'none';
    if (engine) engine.stopAnalysis();
});

function updateAnalysisDisplay() {
    const pos = gameHistory[analysisIndex];
    analysisBoard.position(pos.fen);

    if (analysisIndex === 0) {
        document.getElementById('currentMoveNum').textContent = 'Start';
    } else {
        const moveNum = Math.ceil(analysisIndex / 2);
        const color = analysisIndex % 2 === 1 ? 'White' : 'Black';
        document.getElementById('currentMoveNum').textContent = `${moveNum}. ${pos.san || ''}`;
    }
}

function analyzeCurrentPosition() {
    const pos = gameHistory[analysisIndex];
    const prevPos = analysisIndex > 0 ? gameHistory[analysisIndex - 1] : null;

    if (!engine || !engine.ready) {
        document.getElementById('aiExplanation').innerHTML = `
            <h3>🤖 AI Analysis</h3>
            <p>Loading engine...</p>
        `;
        return;
    }

    // Show loading
    document.getElementById('aiExplanation').innerHTML = `
        <h3>🤖 AI Analysis</h3>
        <p>Analyzing position...</p>
    `;

    // Clear previous arrows
    clearAnalysisArrows();

    // Get evaluation for current position
    engine.getBestMove(pos.fen, 20, (bestMove) => {
        // Create a temp game to analyze
        const tempGame = new Chess(pos.fen);
        const turn = tempGame.turn();

        // Calculate simple material score
        const score = evaluatePositionFromFen(pos.fen);

        // Update eval bar
        updateEvalBar(score);

        // Draw arrow for best move
        if (bestMove && bestMove.from && bestMove.to) {
            drawAnalysisArrow(bestMove.from, bestMove.to, 'good');
        }

        // Generate explanation
        let explanation = '';

        if (analysisIndex === 0) {
            explanation = `<div class="move-quality">📍 Starting Position</div>
                <p>The game begins with all pieces in their starting squares. White has the first move advantage.</p>`;
        } else {
            const playedMove = pos.san;
            const prevFen = prevPos.fen;
            const prevScore = evaluatePositionFromFen(prevFen);
            const scoreDiff = score - prevScore;

            // Determine who made this move
            const mover = analysisIndex % 2 === 1 ? 'White' : 'Black';
            const moverSign = mover === 'White' ? 1 : -1;
            const adjustedDiff = scoreDiff * moverSign;

            let quality = '';
            let qualityEmoji = '';
            let qualityExplanation = '';

            // Get Silman-style teaching for this position
            const silmanTeaching = getSilmanTeachingForAnalysis(pos, prevPos, tempGame);

            if (adjustedDiff < -2) {
                quality = 'Blunder';
                qualityEmoji = '⚠️';
                qualityExplanation = `${silmanTeaching.blunder}`;
            } else if (adjustedDiff < -1) {
                quality = 'Mistake';
                qualityEmoji = '❌';
                qualityExplanation = `${silmanTeaching.mistake}`;
            } else if (adjustedDiff < -0.5) {
                quality = 'Inaccuracy';
                qualityEmoji = '⚡';
                qualityExplanation = `${silmanTeaching.inaccuracy}`;
            } else if (adjustedDiff > 2) {
                quality = 'Brilliant';
                qualityEmoji = '💎';
                qualityExplanation = `${silmanTeaching.brilliant}`;
            } else if (adjustedDiff > 1) {
                quality = 'Great Move';
                qualityEmoji = '✨';
                qualityExplanation = `${silmanTeaching.great}`;
            } else {
                quality = 'Good';
                qualityEmoji = '👍';
                qualityExplanation = `${silmanTeaching.good}`;
            }

            // Best move suggestion with arrow indicator
            let bestMoveStr = '';
            if (bestMove && bestMove.from && bestMove.to) {
                bestMoveStr = `<div class="best-move">💡 Best move: <strong>${bestMove.from} → ${bestMove.to}</strong> (shown with arrow)</div>`;
            }

            explanation = `
                <div class="move-quality">${qualityEmoji} ${quality}: ${playedMove}</div>
                <p>${qualityExplanation}</p>
                ${bestMoveStr}
                <p class="silman-tip"><em>"${silmanTeaching.quote}"</em></p>
            `;
        }

        document.getElementById('aiExplanation').innerHTML = `
            <h3>📚 Coach Silman's Analysis</h3>
            ${explanation}
        `;
    });
}

// Silman-style teaching for analysis mode
function getSilmanTeachingForAnalysis(pos, prevPos, tempGame) {
    const moveCount = gameHistory.indexOf(pos);
    const phase = getGamePhase(moveCount, tempGame.board());

    const teachings = {
        opening: {
            blunder: "In the opening, losing material often comes from moving the same piece twice or neglecting development. Remember: 'Every move must contribute to development or center control.'",
            mistake: "You gave away your opening advantage. The key is to develop pieces to active squares while maintaining center control.",
            inaccuracy: "A small slip. In the opening, even small inaccuracies can give your opponent a slight edge. Stay focused on the fundamentals.",
            brilliant: "Excellent opening play! You found a way to punish your opponent's mistake. This is how masters capitalize on errors.",
            great: "Strong opening technique! You're following the principles: control the center, develop pieces, and prepare to castle.",
            good: "Solid opening move. Continue developing your pieces and don't forget to castle!",
            quote: "The opening is the foundation of the game. Build it well, and the middlegame will take care of itself."
        },
        middlegame: {
            blunder: "Middlegame blunders often come from missing tactics. Always ask: 'What is my opponent threatening?' before making your move.",
            mistake: "You overlooked a better option. In the middlegame, look for piece activity, open files for rooks, and outposts for knights.",
            inaccuracy: "The imbalances favor a different approach. Consider: Who has better minor pieces? More space? Better pawn structure?",
            brilliant: "You demonstrated deep understanding of the position! Finding such moves requires calculating variations and understanding positional themes.",
            great: "Excellent middlegame play! You improved your piece activity while creating problems for your opponent.",
            good: "A reasonable move. Keep looking for ways to improve your worst-placed piece.",
            quote: "In the middlegame, every piece must have a purpose. A piece without a job is a piece misplaced."
        },
        endgame: {
            blunder: "Endgame precision is critical! Every tempo counts. Remember: 'In the endgame, the king is a fighting piece.'",
            mistake: "Endgames require accuracy. Focus on: King activity, pawn promotion, and piece coordination.",
            inaccuracy: "A small slip in the endgame can be decisive. Always calculate the consequences of pawn moves - they cannot go back.",
            brilliant: "Masterful endgame technique! You found the winning path through precise calculation.",
            great: "Excellent endgame understanding! King activity and passed pawns are the keys to victory.",
            good: "Solid endgame move. Keep your king active and look for ways to create passed pawns.",
            quote: "The endgame is where games are won and lost. Technical precision separates masters from amateurs."
        }
    };

    return teachings[phase] || teachings.middlegame;
}

// Arrow drawing functions for analysis board
function clearAnalysisArrows() {
    const svg = document.querySelector('#analysisOverlay .arrow-overlay');
    if (svg) {
        svg.innerHTML = `
            <defs>
                <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                    <polygon points="0 0, 10 3.5, 0 7" fill="#4CAF50" />
                </marker>
                <marker id="arrowhead-red" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                    <polygon points="0 0, 10 3.5, 0 7" fill="#ff6b6b" />
                </marker>
            </defs>
        `;
    }
}

function drawAnalysisArrow(from, to, type = 'good') {
    const boardEl = document.getElementById('analysisBoard');
    if (!boardEl) return;

    const boardRect = boardEl.getBoundingClientRect();
    const squareSize = boardRect.width / 8;

    // Convert algebraic notation to coordinates
    const fromCoords = squareToCoords(from, squareSize);
    const toCoords = squareToCoords(to, squareSize);

    // Create or get SVG overlay for analysis board
    let svg = document.querySelector('#analysisOverlay .analysis-board-wrapper .arrow-overlay');
    if (!svg) {
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'arrow-overlay');
        svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:100;';
        const wrapper = document.querySelector('#analysisOverlay .analysis-board-wrapper');
        if (wrapper) {
            wrapper.style.position = 'relative';
            wrapper.appendChild(svg);
        }
    }

    // Add arrow definition if not present
    if (!svg.querySelector('defs')) {
        svg.innerHTML = `
            <defs>
                <marker id="arrowhead-analysis" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                    <polygon points="0 0, 10 3.5, 0 7" fill="#4CAF50" />
                </marker>
            </defs>
        `;
    }

    // Create arrow line
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', fromCoords.x);
    line.setAttribute('y1', fromCoords.y);
    line.setAttribute('x2', toCoords.x);
    line.setAttribute('y2', toCoords.y);
    line.setAttribute('stroke', type === 'blunder' ? '#ff6b6b' : '#4CAF50');
    line.setAttribute('stroke-width', '8');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('marker-end', 'url(#arrowhead-analysis)');
    line.setAttribute('opacity', '0.8');

    svg.appendChild(line);
}

function squareToCoords(square, squareSize) {
    const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
    const rank = parseInt(square[1]) - 1;

    // For white's perspective (flip for black if needed)
    return {
        x: (file + 0.5) * squareSize,
        y: ((7 - rank) + 0.5) * squareSize
    };
}

function evaluatePositionFromFen(fen) {
    const tempGame = new Chess(fen);
    const pieces = {
        'p': 1, 'n': 3, 'b': 3, 'r': 5, 'q': 9, 'k': 0
    };

    const boardState = tempGame.board();
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

function updateEvalBar(score) {
    // Clamp score to reasonable range (-10 to +10)
    const clampedScore = Math.max(-10, Math.min(10, score));

    // Convert to percentage (50% = equal, 100% = white winning, 0% = black winning)
    const percentage = 50 + (clampedScore * 5);

    document.getElementById('evalFill').style.width = percentage + '%';

    const displayScore = score >= 0 ? '+' + score.toFixed(1) : score.toFixed(1);
    document.getElementById('evalScore').textContent = displayScore;
}

// ===== AI CHAT COACH (Gemini Integration) =====

// Send chat message
document.getElementById('sendChatBtn').addEventListener('click', sendChatMessage);
document.getElementById('chatInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
});

async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const question = input.value.trim();
    const apiKey = document.getElementById('geminiApiKey').value.trim();

    if (!question) return;

    if (!apiKey) {
        addChatMessage('bot', '⚠️ Please paste your Gemini API key first. Click "Get Free Key" to get one!');
        return;
    }

    // Clear input
    input.value = '';

    // Add user message to chat
    addChatMessage('user', question);

    // Show loading
    const loadingId = addChatMessage('bot', '🤔 Thinking...', 'loading');

    // Build rich context
    const context = buildPositionContext();

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey, context, question })
        });

        const data = await response.json();

        // Remove loading message
        document.getElementById(loadingId)?.remove();

        if (data.error) {
            addChatMessage('bot', '❌ ' + data.error);
        } else {
            addChatMessage('bot', '🎓 ' + data.response);
        }
    } catch (error) {
        document.getElementById(loadingId)?.remove();
        addChatMessage('bot', '❌ Network error. Please try again.');
    }
}

function addChatMessage(type, text, className = '') {
    const container = document.getElementById('chatMessages');
    const msgDiv = document.createElement('div');
    const msgId = 'msg-' + Date.now();
    msgDiv.id = msgId;
    msgDiv.className = `chat-message ${type} ${className}`;
    msgDiv.innerHTML = text;
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
    return msgId;
}

function buildPositionContext() {
    // Get current position from analysis
    const pos = gameHistory[analysisIndex];
    if (!pos) return 'No position available.';

    const tempGame = new Chess(pos.fen);
    const boardState = tempGame.board();
    const moveCount = analysisIndex;
    const phase = getGamePhase(moveCount, boardState);
    const score = evaluatePositionFromFen(pos.fen);

    // Build detailed piece locations
    let whitePieces = [];
    let blackPieces = [];

    for (let rank = 0; rank < 8; rank++) {
        for (let file = 0; file < 8; file++) {
            const piece = boardState[rank][file];
            if (piece) {
                const square = String.fromCharCode('a'.charCodeAt(0) + file) + (8 - rank);
                const pieceName = getPieceName(piece.type);
                if (piece.color === 'w') {
                    whitePieces.push(`${pieceName} on ${square}`);
                } else {
                    blackPieces.push(`${pieceName} on ${square}`);
                }
            }
        }
    }

    // Build move history summary
    const recentMoves = gameHistory.slice(Math.max(0, analysisIndex - 6), analysisIndex + 1)
        .filter(h => h.san)
        .map(h => h.san)
        .join(' ');

    // Get engine's best move if available
    let bestMoveNote = '';

    // Build the context string
    return `
POSITION (FEN): ${pos.fen}
GAME PHASE: ${phase}
MATERIAL EVALUATION: ${score >= 0 ? 'White +' + score.toFixed(1) : 'Black +' + Math.abs(score).toFixed(1)}
WHOSE TURN: ${tempGame.turn() === 'w' ? 'White' : 'Black'}

WHITE PIECES: ${whitePieces.join(', ')}
BLACK PIECES: ${blackPieces.join(', ')}

RECENT MOVES: ${recentMoves || 'Game just started'}
${pos.san ? `LAST MOVE: ${pos.san}` : ''}

POSITION NOTES:
- ${tempGame.in_check() ? 'King is in CHECK!' : 'Not in check'}
- ${tempGame.in_checkmate() ? 'CHECKMATE!' : ''}
- ${tempGame.in_stalemate() ? 'Stalemate' : ''}
- ${tempGame.in_draw() ? 'Position is drawn' : ''}
    `.trim();
}

function getPieceName(type) {
    const names = {
        'k': 'King', 'q': 'Queen', 'r': 'Rook',
        'b': 'Bishop', 'n': 'Knight', 'p': 'Pawn'
    };
    return names[type] || type;
}