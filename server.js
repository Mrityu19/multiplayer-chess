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

// ===== TELEGRAM BOT INTEGRATION =====
const TelegramBot = require('node-telegram-bot-api');

// Load environment variables (for local development)
require('dotenv').config();

// Get configuration from environment variables
const token = process.env.BOT_TOKEN || '8230610124:AAGlFXAYNmKZdvbq97Ej1C28BALFlzE2lyM';
const APP_URL = process.env.APP_URL || 'http://localhost:3000'; // Your deployed URL
const botAppShortName = process.env.BOT_APP_SHORTNAME || 'chess';

// Create a bot that uses 'polling' to fetch new updates
let bot = null;
let botUsername = 'GameFactoryBot'; // Default, will update on init

if (token && token !== 'YOUR_BOT_TOKEN_HERE') {
    try {
        bot = new TelegramBot(token, { polling: true });
        console.log('🤖 Telegram Bot started!');

        // Get Bot Username for Deep Linking
        bot.getMe().then((me) => {
            botUsername = me.username;
            console.log(`🤖 Bot Username: @${botUsername}`);
        }).catch(e => console.error('Error fetching bot info:', e.message));

        // Handle Polling Errors
        bot.on('polling_error', (error) => {
            console.error('Telegram Polling Error:', error.code, error.message);
        });

        // Handle /start (Welcome Message & Deep Linking)
        bot.onText(/\/start(.*)/, (msg, match) => {
            const chatId = msg.chat.id;
            const firstName = msg.from.first_name || 'Player';
            const startPayload = match[1] ? match[1].trim() : '';

            console.log(`Received /start from ${firstName} with payload: "${startPayload}"`);

            // Use deployed URL or local URL
            let gameUrl = APP_URL;

            // If payload exists (e.g., room_123), append it
            if (startPayload.startsWith('room_')) {
                const roomId = startPayload.replace('room_', '');
                gameUrl += `?room=${roomId}`;
            }

            bot.sendMessage(chatId, `♟️ *GameFactory Chess*\n\nWelcome, ${firstName}!\n${startPayload ? 'You were invited to a game!' : 'Ready to play?'}`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: "🎮 Play Now", web_app: { url: gameUrl } }
                    ]]
                }
            }).catch(e => console.error('Error sending /start:', e.message));
        });

        // Handle /friend (Play with Friend Link)
        bot.onText(/\/friend/, (msg) => {
            const chatId = msg.chat.id;
            bot.sendMessage(chatId, "🔗 *Play with a Friend*\nUse the button below to share a game invite into any chat!", {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: "📨 Share Game Invite", switch_inline_query: "play" }
                    ]]
                }
            }).catch(e => console.error('Error sending /friend:', e.message));
        });

        // Handle Inline Queries (Sharing the game)
        bot.on('inline_query', (query) => {
            // Use deployed URL
            const gameUrl = APP_URL;
            const roomId = 'room_' + Date.now();

            // DIRECT MINI APP LINK (GameFactory Style)
            // This is the link that renders the big "LAUNCH" card
            const directLink = `https://t.me/${botUsername}/${botAppShortName}?startapp=${roomId}`;

            const results = [{
                type: 'article',
                id: 'share_game_' + Date.now(),
                title: '♞ Send Game Invite',
                description: 'Send a playable "Launch" card to your friend',
                thumb_url: 'https://cdn-icons-png.flaticon.com/512/3002/3002598.png',
                input_message_content: {
                    // Sending the link directly causes Telegram to render the App Card
                    message_text: directLink,
                    disable_web_page_preview: false
                }
            }];

            bot.answerInlineQuery(query.id, results).catch(e => console.error('Error answering inline query:', e.message));
        });

    } catch (e) {
        console.error('Telegram Bot Init Error:', e);
    }
} else {
    console.log('⚠️ Telegram Bot Token missing.');
}

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