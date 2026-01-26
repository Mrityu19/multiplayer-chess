const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Game State
let players = { white: null, black: null };
let currentTurn = 'w';
let timers = { w: 600, b: 600 };
let timerInterval = null;

io.on('connection', (socket) => {
    
    // 1. Assign Role
    if (!players.white) {
        players.white = socket.id;
        socket.emit('playerRole', 'w');
        socket.emit('timerUpdate', timers); 
    } else if (!players.black) {
        players.black = socket.id;
        socket.emit('playerRole', 'b');
        socket.emit('timerUpdate', timers);
    } else {
        socket.emit('playerRole', 'spectator');
    }

    // 2. Start Game
    socket.on('startGame', (minutes) => {
        // SAFETY: Only allow start if both players are present (Optional)
        // if (!players.white || !players.black) return; 

        timers = { w: minutes * 60, b: minutes * 60 };
        currentTurn = 'w';
        
        if (timerInterval) clearInterval(timerInterval);

        io.emit('timerUpdate', timers);

        timerInterval = setInterval(() => {
            timers[currentTurn]--; 
            io.emit('timerUpdate', timers);

            if (timers[currentTurn] <= 0) {
                clearInterval(timerInterval);
                let winner = currentTurn === 'w' ? 'Black' : 'White';
                io.emit('gameOver', winner + " wins on time!");
            }
        }, 1000);
    });

    // 3. Handle Move
    socket.on('move', (move) => {
        socket.broadcast.emit('move', move);
        currentTurn = currentTurn === 'w' ? 'b' : 'w';
    });

    // 4. NEW: Stop Timer on Checkmate/Draw 🛑
    socket.on('gameEnd', () => {
        if (timerInterval) clearInterval(timerInterval);
    });

    // 5. Handle Disconnect
    socket.on('disconnect', () => {
        if (players.white === socket.id) players.white = null;
        else if (players.black === socket.id) players.black = null;
        
        // Optional: Stop timer if a player leaves
        // if (timerInterval) clearInterval(timerInterval);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});