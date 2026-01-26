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

// Game State Variables
let players = { white: null, black: null };
let currentTurn = 'w'; // 'w' starts
let timers = { w: 600, b: 600 }; // Default 10 minutes (in seconds)
let timerInterval = null;

io.on('connection', (socket) => {
    
    // 1. Assign Role
    if (!players.white) {
        players.white = socket.id;
        socket.emit('playerRole', 'w');
        
        // If Black is already here, tell White the current time
        socket.emit('timerUpdate', timers); 
    } else if (!players.black) {
        players.black = socket.id;
        socket.emit('playerRole', 'b');
        socket.emit('timerUpdate', timers);
    } else {
        socket.emit('playerRole', 'spectator');
    }

    // 2. Start Game (Reset Timer)
    socket.on('startGame', (minutes) => {
        timers = { w: minutes * 60, b: minutes * 60 };
        currentTurn = 'w';
        
        // Clear old interval if exists
        if (timerInterval) clearInterval(timerInterval);

        // Notify everyone
        io.emit('timerUpdate', timers);

        // Start the countdown loop
        timerInterval = setInterval(() => {
            timers[currentTurn]--; // Decrement active player's time
            
            // Send new time to clients
            io.emit('timerUpdate', timers);

            // Check for Time Out
            if (timers[currentTurn] <= 0) {
                clearInterval(timerInterval);
                let winner = currentTurn === 'w' ? 'Black' : 'White';
                io.emit('gameOver', winner + " wins on time!");
            }
        }, 1000);
    });

    // 3. Handle Move
    socket.on('move', (move) => {
        // Send move to opponent
        socket.broadcast.emit('move', move);
        
        // Switch turn logic for timer
        currentTurn = currentTurn === 'w' ? 'b' : 'w';
    });

    // 4. Handle Disconnect
    socket.on('disconnect', () => {
        if (players.white === socket.id) players.white = null;
        else if (players.black === socket.id) players.black = null;
    });
});

// Use the port the cloud gives us, OR use 3000 if we are local
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
