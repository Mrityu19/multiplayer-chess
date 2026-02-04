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

// --- STATE MANAGEMENT ---
// Store all active games here: { roomId: { white: 'socketId', black: 'socketId', fen: '...', ... } }
const games = {}; 
let waitingPlayer = null; // For 'Play Online' matchmaking

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // --- JOIN GAME LOGIC ---
    socket.on('joinGame', ({ type, roomId }) => {
        
        // OPTION 1: Play Online (Random Matchmaking)
        if (type === 'online') {
            if (waitingPlayer && waitingPlayer !== socket.id) {
                // Found a match!
                const matchRoom = `online-${waitingPlayer}-${socket.id}`;
                const opponent = waitingPlayer;
                waitingPlayer = null;

                // Create Game Room
                games[matchRoom] = {
                    white: opponent,
                    black: socket.id,
                    timers: { w: 600, b: 600 }, // Default 10 min
                    timerInterval: null,
                    turn: 'w'
                };

                // Join both players
                socket.join(matchRoom);
                io.sockets.sockets.get(opponent)?.join(matchRoom);

                // Notify players
                io.to(opponent).emit('gameStart', { color: 'w', roomId: matchRoom });
                socket.emit('gameStart', { color: 'b', roomId: matchRoom });
                
                startGameTimer(matchRoom);

            } else {
                // No one waiting, add to queue
                waitingPlayer = socket.id;
                socket.emit('status', 'Searching for an opponent...');
            }
        } 

        // OPTION 2: Play with Friend (Specific Room)
        else if (type === 'friend' && roomId) {
            socket.join(roomId);
            
            // Check if room exists or create it
            if (!games[roomId]) {
                games[roomId] = { 
                    white: socket.id, 
                    black: null,
                    timers: { w: 600, b: 600 },
                    timerInterval: null,
                    turn: 'w'
                };
                socket.emit('status', 'Waiting for friend to join...');
                socket.emit('playerRole', 'w'); // First joiner is white
            } else {
                // Second player joins
                if (!games[roomId].black) {
                    games[roomId].black = socket.id;
                    socket.emit('playerRole', 'b');
                    
                    // Start the game!
                    io.to(games[roomId].white).emit('gameStart', { color: 'w', roomId });
                    socket.emit('gameStart', { color: 'b', roomId });
                    startGameTimer(roomId);
                } else {
                    socket.emit('status', 'Room is full (Spectator mode)');
                }
            }
        }
    });

    // --- GAME MOVE LOGIC ---
    socket.on('move', ({ roomId, move }) => {
        const game = games[roomId];
        if (game) {
            socket.to(roomId).emit('move', move);
            game.turn = game.turn === 'w' ? 'b' : 'w';
        }
    });

    // --- GAME END LOGIC ---
    socket.on('gameEnd', (roomId) => {
        if (games[roomId]?.timerInterval) {
            clearInterval(games[roomId].timerInterval);
        }
    });

    socket.on('disconnect', () => {
        if (waitingPlayer === socket.id) waitingPlayer = null;
        // Cleanup games logic could be added here
    });
});

function startGameTimer(roomId) {
    if (games[roomId].timerInterval) clearInterval(games[roomId].timerInterval);
    
    games[roomId].timerInterval = setInterval(() => {
        const game = games[roomId];
        if (!game) return;

        game.timers[game.turn]--;
        io.to(roomId).emit('timerUpdate', game.timers);

        if (game.timers[game.turn] <= 0) {
            clearInterval(game.timerInterval);
            let winner = game.turn === 'w' ? 'Black' : 'White';
            io.to(roomId).emit('gameOver', winner + " wins on time!");
        }
    }, 1000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});