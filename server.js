const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware
app.use(express.static(__dirname));
app.use(express.json());

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ===== GEMINI AI CHAT PROXY =====
// This endpoint proxies requests to Google Gemini API
app.post('/api/chat', async (req, res) => {
    const { apiKey, context, question } = req.body;

    if (!apiKey) {
        return res.status(400).json({ error: 'API key is required. Get one free at aistudio.google.com' });
    }

    if (!question) {
        return res.status(400).json({ error: 'Question is required' });
    }

    try {
        // Build the chess expert prompt
        const systemPrompt = `You are an expert chess coach with the teaching style of Jeremy Silman (author of "How to Reassess Your Chess"). You speak directly to the student, explaining concepts clearly with specific references to the position.

CURRENT POSITION CONTEXT:
${context}

INSTRUCTIONS:
- Answer the student's question about this specific position
- Reference specific squares, pieces, and files by name (e.g., "your rook on a1", "the open d-file")
- Explain the strategic reasoning (imbalances, plans, threats)
- Keep responses concise but educational (2-4 sentences usually)
- Use chess concepts: open files, outposts, piece activity, pawn structure, king safety
- If they ask about a specific move, explain why it's good or bad based on the position`;

        const userPrompt = `Student's question: ${question}`;

        // Call Gemini API
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: systemPrompt + '\n\n' + userPrompt }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 300
                }
            })
        });

        const data = await response.json();

        if (data.error) {
            return res.status(400).json({ error: data.error.message || 'Gemini API error' });
        }

        const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || 'I could not generate a response.';
        res.json({ response: aiResponse });

    } catch (error) {
        console.error('Gemini API Error:', error);
        res.status(500).json({ error: 'Failed to connect to AI service. Check your API key.' });
    }
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

    // --- CHAT LOGIC ---
    socket.on('chat', ({ roomId, message, sender }) => {
        // Broadcast to room (including sender if needed, but usually we handle sender locally)
        // Let's broadcast to everyone in room including sender to keep it simple, or exclude sender?
        // Usually sender adds their own msg immediately.
        socket.to(roomId).emit('chat', { message, sender });
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