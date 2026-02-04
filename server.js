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
const games = {};
let waitingPlayer = null;

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // --- JOIN GAME LOGIC ---
    socket.on('joinGame', ({ type, roomId, timeLimit = 600 }) => {

        // OPTION 1: Play Online (Random Matchmaking)
        if (type === 'online') {
            if (waitingPlayer && waitingPlayer.id !== socket.id) {
                // Found a match!
                const matchRoom = `online-${waitingPlayer.id}-${socket.id}`;
                const opponent = waitingPlayer.id;
                const opponentTime = waitingPlayer.timeLimit;
                waitingPlayer = null;

                // Create Game Room
                games[matchRoom] = {
                    white: opponent,
                    black: socket.id,
                    timers: { w: opponentTime, b: timeLimit },
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
                waitingPlayer = { id: socket.id, timeLimit: timeLimit };
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
                    timers: { w: timeLimit, b: timeLimit },
                    timerInterval: null,
                    turn: 'w'
                };
                socket.emit('status', 'Waiting for friend to join...');
            } else {
                // Second player joins
                if (!games[roomId].black) {
                    games[roomId].black = socket.id;

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
            delete games[roomId];
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);

        // Remove from waiting queue
        if (waitingPlayer?.id === socket.id) {
            waitingPlayer = null;
        }

        // Find and cleanup games
        for (const [roomId, game] of Object.entries(games)) {
            if (game.white === socket.id || game.black === socket.id) {
                // Notify opponent
                const opponent = game.white === socket.id ? game.black : game.white;
                io.to(opponent).emit('gameOver', 'Opponent disconnected. You win!');

                // Cleanup
                if (game.timerInterval) clearInterval(game.timerInterval);
                delete games[roomId];
            }
        }
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
            delete games[roomId];
        }
    }, 1000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});