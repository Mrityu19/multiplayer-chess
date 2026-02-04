const socket = io();
var game = new Chess();
var playerRole = null;

// --- AUDIO ---
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
    lastMoveSource = source;
    lastMoveTarget = target;
    $board.find('.square-' + source).addClass('highlight-move');
    $board.find('.square-' + target).addClass('highlight-move');
}

// --- NEW: UPDATE MOVE HISTORY SIDEBAR ---
function updateMoveHistory() {
    const history = game.history();
    const historyElement = document.getElementById('moveHistory');
    historyElement.innerHTML = ''; // Clear old history

    // Loop through moves in pairs (White, Black)
    for (let i = 0; i < history.length; i += 2) {
        const moveNumber = (i / 2) + 1;
        const whiteMove = history[i];
        const blackMove = history[i + 1] || ''; // Might be empty if it's white's turn

        const row = document.createElement('div');
        row.className = 'history-row';
        row.innerHTML = `
            <span class="move-number">${moveNumber}.</span>
            <span class="move-white">${whiteMove}</span>
            <span class="move-black">${blackMove}</span>
        `;
        historyElement.appendChild(row);
    }
    
    // Auto-scroll to bottom
    historyElement.scrollTop = historyElement.scrollHeight;
}

// --- BOARD CONFIG ---
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

    // Sound & Visuals
    if (move.captured) captureSound.play();
    else moveSound.play();
    highlightMove(source, target);
    updateMoveHistory(); // Update the sidebar list

    socket.emit('move', { from: source, to: target, promotion: 'q' });
    checkStatus();
}

function onSnapEnd() {
    board.position(game.fen());
    if (lastMoveSource && lastMoveTarget) highlightMove(lastMoveSource, lastMoveTarget);
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

// --- BUTTON LISTENERS ---
document.querySelectorAll('.timer-button').forEach(button => {
    button.addEventListener('click', () => {
        if(button.id !== 'customTimeBtn') socket.emit('startGame', button.dataset.time);
    });
});

document.getElementById('customTimeBtn').addEventListener('click', () => {
    const customTime = document.getElementById('customTimeInput').value;
    if (customTime && customTime > 0) socket.emit('startGame', customTime);
});

// --- SOCKET LISTENERS ---
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
    updateMoveHistory(); // Update list when opponent moves
    checkStatus();
    
    if (move) {
        if (move.captured) captureSound.play();
        else notifySound.play();
        highlightMove(move.from, move.to);
    }
});

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