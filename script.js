const socket = io();
var game = new Chess();
var board = null;
var playerRole = null;
var currentRoomId = null;

// --- 1. HANDLE MENU & ROOMS ---
const urlParams = new URLSearchParams(window.location.search);
const roomParam = urlParams.get('room');

if (roomParam) {
    // If URL has ?room=xyz, join that friend room automatically
    document.getElementById('startMenu').style.display = 'none'; // Hide menu temporarily
    currentRoomId = roomParam;
    socket.emit('joinGame', { type: 'friend', roomId: currentRoomId });
}

// Button: Play Online
document.getElementById('btnOnline').addEventListener('click', () => {
    document.getElementById('statusText').innerText = "Searching for opponent...";
    socket.emit('joinGame', { type: 'online' });
});

// Button: Play with Friend
document.getElementById('btnFriend').addEventListener('click', () => {
    // Generate random Room ID and redirect
    const randomId = Math.random().toString(36).substring(2, 8);
    window.location.href = `?room=${randomId}`;
});

// Helper: Copy Link
window.copyLink = function() {
    const copyText = document.getElementById("gameLink");
    copyText.select();
    document.execCommand("copy");
    alert("Link copied! Send it to your friend.");
}

// --- 2. SOCKET EVENTS ---

socket.on('status', (msg) => {
    document.getElementById('startMenu').style.display = 'flex'; // Show menu
    document.getElementById('statusText').innerText = msg;
    
    // If waiting for friend, show the link
    if(msg.includes('Waiting for friend')) {
        document.getElementById('linkBox').style.display = 'block';
        document.getElementById('gameLink').value = window.location.href;
    }
});

socket.on('gameStart', ({ color, roomId }) => {
    document.getElementById('startMenu').style.display = 'none'; // Hide menu
    currentRoomId = roomId;
    playerRole = color;
    
    // Initialize Board
    if(board) board.destroy();
    board = Chessboard('myBoard', {
        draggable: true,
        position: 'start',
        orientation: color === 'w' ? 'white' : 'black',
        onDragStart: onDragStart,
        onDrop: onDrop,
        onSnapEnd: onSnapEnd,
        pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png'
    });

    alert("Game Started! You are " + (color === 'w' ? "White" : "Black"));
});

socket.on('move', (msg) => {
    game.move(msg);
    board.position(game.fen());
    updateMoveHistory();
    // Play sounds here...
});

socket.on('timerUpdate', (timers) => {
    // Update Timer UI (same as before)
    const format = (t) => {
        let m = Math.floor(t / 60);
        let s = t % 60;
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };
    document.getElementById('timer-white').innerText = "White: " + format(timers.w);
    document.getElementById('timer-black').innerText = "Black: " + format(timers.b);
});

// --- 3. GAME LOGIC (Standard) ---
function onDragStart(source, piece) {
    if (game.game_over() || !playerRole || game.turn() !== playerRole) return false;
    if ((playerRole === 'w' && piece.search(/^b/) !== -1) || 
        (playerRole === 'b' && piece.search(/^w/) !== -1)) return false;
}

function onDrop(source, target) {
    const move = game.move({ from: source, to: target, promotion: 'q' });
    if (move === null) return 'snapback';

    socket.emit('move', { roomId: currentRoomId, move: { from: source, to: target, promotion: 'q' } });
    updateMoveHistory();
}

function onSnapEnd() { board.position(game.fen()); }

function updateMoveHistory() {
    // Same history code as before...
    const history = game.history();
    const list = document.getElementById('moveHistory');
    let html = '';
    for(let i=0; i<history.length; i+=2) {
        html += `<div class="history-row">
            <span class="move-number">${(i/2)+1}.</span>
            <span class="move-white">${history[i]}</span>
            <span class="move-black">${history[i+1]||''}</span>
        </div>`;
    }
    list.innerHTML = html;
    list.scrollTop = list.scrollHeight;
}