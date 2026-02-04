const socket = io();
var game = new Chess();
var playerRole = null;

// --- AUDIO SOUNDS ---
const moveSound = new Audio('https://images.chesscomfiles.com/chess-themes/sounds/_common/default/move-self.mp3');
const captureSound = new Audio('https://images.chesscomfiles.com/chess-themes/sounds/_common/default/capture.mp3');
const notifySound = new Audio('https://images.chesscomfiles.com/chess-themes/sounds/_common/default/notify.mp3');

// --- HIGHLIGHT HELPERS ---
var $board = $('#myBoard');
var lastMoveSource = null;
var lastMoveTarget = null;

function removeHighlights() {
    $board.find('.square-55d63').removeClass('highlight-move');
}

function highlightMove(source, target) {
    removeHighlights();
    // Save state so we can re-apply if board redraws
    lastMoveSource = source;
    lastMoveTarget = target;
    
    // Apply CSS class
    $board.find('.square-' + source).addClass('highlight-move');
    $board.find('.square-' + target).addClass('highlight-move');
}

// --- 1. Board Config ---
function onDragStart(source, piece, position, orientation) {
    if (game.game_over()) return false;
    if (!playerRole || game.turn() !== playerRole) return false;
    if ((playerRole === 'w' && piece.search(/^b/) !== -1) ||
        (playerRole === 'b' && piece.search(/^w/) !== -1)) {
        return false;
    }
}

function onDrop(source, target) {
    var move = game.move({
        from: source,
        to: target,
        promotion: 'q'
    });

    if (move === null) return 'snapback';

    // 1. Play Sound (Self)
    if (move.captured) captureSound.play();
    else moveSound.play();

    // 2. Highlight Move
    highlightMove(source, target);

    // 3. Send to Server
    socket.emit('move', { from: source, to: target, promotion: 'q' });
    checkStatus();
}

function onSnapEnd() {
    board.position(game.fen());
    // Re-apply highlight because board.position() clears it
    if (lastMoveSource && lastMoveTarget) {
        highlightMove(lastMoveSource, lastMoveTarget);
    }
}

var config = {
    draggable: true,
    position: 'start',
    onDragStart: onDragStart,
    onDrop: onDrop,
    onSnapEnd: onSnapEnd,
    pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png'
};

var board = Chessboard('myBoard', config);

// --- 2. Button Logic (Start Timer) ---
document.querySelectorAll('.timer-button').forEach(button => {
    button.addEventListener('click', () => {
        // Only allow click if no ID (prevent duplicates) or handle strictly
        if(button.id !== 'customTimeBtn') {
             socket.emit('startGame', button.dataset.time);
        }
    });
});

// Custom time button
document.getElementById('customTimeBtn').addEventListener('click', () => {
    const customTime = document.getElementById('customTimeInput').value;
    if (customTime && customTime > 0) {
        socket.emit('startGame', customTime);
    }
});

// --- 3. Socket Listeners ---

socket.on('playerRole', function(role) {
    playerRole = role;
    if (role === 'b') {
        board.orientation('black');
        alert("You are playing as BLACK");
    } else if (role === 'w') {
        board.orientation('white');
        alert("You are playing as WHITE");
    }
});

socket.on('move', function (msg) {
    var move = game.move(msg);
    board.position(game.fen());
    checkStatus();
    
    // Play Sound & Highlight (Opponent)
    if (move) {
        if (move.captured) captureSound.play();
        else notifySound.play(); // Different sound for opponent
        
        highlightMove(move.from, move.to);
    }
});

// --- Handle Timer Updates ---
socket.on('timerUpdate', function (timers) {
    function formatTime(seconds) {
        let m = Math.floor(seconds / 60);
        let s = seconds % 60;
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    }

    document.getElementById('timer-white').innerText = "White: " + formatTime(timers.w);
    document.getElementById('timer-black').innerText = "Black: " + formatTime(timers.b);

    if (game.turn() === 'w') {
        document.getElementById('timer-white').classList.add('active-timer');
        document.getElementById('timer-black').classList.remove('active-timer');
    } else {
        document.getElementById('timer-black').classList.add('active-timer');
        document.getElementById('timer-white').classList.remove('active-timer');
    }
});

// --- Handle Game Over ---
socket.on('gameOver', function (msg) {
    alert(msg);
});

function checkStatus() {
    if (game.in_checkmate()) {
        let winner = game.turn() === 'w' ? 'Black' : 'White';
        alert(`Game Over! ${winner} Wins by Checkmate!`);
        socket.emit('gameEnd'); 
    } else if (game.in_draw()) {
        alert("Game Over! Draw.");
        socket.emit('gameEnd');
    }
}