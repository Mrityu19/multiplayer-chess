const socket = io();
var game = new Chess();
var playerRole = null;

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

    // Send move to server
    socket.emit('move', { from: source, to: target, promotion: 'q' });
    checkStatus();
}

function onSnapEnd() {
    board.position(game.fen());
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
        // Ask server to start game with X minutes
        socket.emit('startGame', button.dataset.time);
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
    game.move(msg);
    board.position(game.fen());
    checkStatus();
});

// --- NEW: Handle Timer Updates ---
socket.on('timerUpdate', function (timers) {
    // Helper to format seconds into MM:SS
    function formatTime(seconds) {
        let m = Math.floor(seconds / 60);
        let s = seconds % 60;
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    }

    // Update Text
    document.getElementById('timer-white').innerText = "White: " + formatTime(timers.w);
    document.getElementById('timer-black').innerText = "Black: " + formatTime(timers.b);

    // Highlight active timer visually
    if (game.turn() === 'w') {
        document.getElementById('timer-white').classList.add('active-timer');
        document.getElementById('timer-black').classList.remove('active-timer');
    } else {
        document.getElementById('timer-black').classList.add('active-timer');
        document.getElementById('timer-white').classList.remove('active-timer');
    }
});

// --- NEW: Handle Time Out ---
socket.on('gameOver', function (msg) {
    alert(msg);
});

function checkStatus() {
    if (game.in_checkmate()) {
        let winner = game.turn() === 'w' ? 'Black' : 'White';
        alert(`Game Over! ${winner} Wins by Checkmate!`);
    } else if (game.in_draw()) {
        alert("Game Over! Draw.");
    }
}
function checkStatus() {
    if (game.in_checkmate()) {
        let winner = game.turn() === 'w' ? 'Black' : 'White';
        alert(`Game Over! ${winner} Wins by Checkmate!`);
        
        // Tell server to stop the clock! 🛑
        socket.emit('gameEnd'); 
        
    } else if (game.in_draw()) {
        alert("Game Over! Draw.");
        
        // Tell server to stop the clock! 🛑
        socket.emit('gameEnd');
    }
}