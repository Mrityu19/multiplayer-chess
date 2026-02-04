// Stockfish Engine Wrapper - Using CDN-hosted stockfish.js
class ChessEngine {
    constructor() {
        this.stockfish = null;
        this.ready = false;
        this.callbacks = {};
        this.evalCallback = null;
        this.pendingCallbacks = []; // Queue for callbacks
        this.isProcessing = false;
    }

    async init() {
        return new Promise((resolve, reject) => {
            try {
                // Use local stockfish
                this.stockfish = new Worker('lib/stockfish.js');

                this.stockfish.onmessage = (event) => {
                    const message = event.data;
                    console.log('Stockfish:', message);

                    // Engine is ready
                    if (message === 'uciok') {
                        this.ready = true;
                        resolve();
                    }

                    // Best move received
                    if (message.startsWith('bestmove')) {
                        const match = message.match(/bestmove\s+([a-h][1-8][a-h][1-8][qrbn]?)/);
                        if (match && this.pendingCallbacks.length > 0) {
                            const callback = this.pendingCallbacks.shift();
                            const move = match[1];
                            this.isProcessing = false;

                            if (callback) {
                                callback({
                                    from: move.substring(0, 2),
                                    to: move.substring(2, 4),
                                    promotion: move.length > 4 ? move[4] : undefined
                                });
                            }

                            // Process next in queue if any
                            this.processQueue();
                        }
                    }

                    // Evaluation info
                    if (message.startsWith('info') && message.includes('score')) {
                        this.parseEvaluation(message);
                    }
                };

                this.stockfish.onerror = (error) => {
                    console.error('Stockfish Worker Error:', error);
                    reject(error);
                };

                // Initialize UCI
                setTimeout(() => {
                    this.stockfish.postMessage('uci');
                }, 100);

                // Timeout after 10 seconds
                setTimeout(() => {
                    if (!this.ready) {
                        reject(new Error('Stockfish initialization timeout'));
                    }
                }, 10000);

            } catch (error) {
                console.error('Failed to create Stockfish worker:', error);
                reject(error);
            }
        });
    }

    parseEvaluation(info) {
        if (!this.evalCallback) return;

        // Parse score
        let score = 0;
        let mate = null;

        const cpMatch = info.match(/score cp (-?\d+)/);
        const mateMatch = info.match(/score mate (-?\d+)/);

        if (cpMatch) {
            score = parseInt(cpMatch[1]) / 100; // Convert centipawns to pawns
        } else if (mateMatch) {
            mate = parseInt(mateMatch[1]);
            score = mate > 0 ? 100 : -100; // Max advantage
        }

        // Parse depth and best line
        const depthMatch = info.match(/depth (\d+)/);
        const pvMatch = info.match(/pv (.+)/);

        const depth = depthMatch ? parseInt(depthMatch[1]) : 0;
        const bestLine = pvMatch ? pvMatch[1] : '';

        this.evalCallback({
            score: score,
            mate: mate,
            depth: depth,
            bestLine: bestLine
        });
    }

    setPosition(fen) {
        if (!this.ready) return;
        this.stockfish.postMessage(`position fen ${fen}`);
    }

    processQueue() {
        if (this.isProcessing || this.pendingCallbacks.length === 0) return;
        if (!this.queuedRequests || this.queuedRequests.length === 0) return;

        const request = this.queuedRequests.shift();
        this.isProcessing = true;

        this.stockfish.postMessage(`setoption name Skill Level value ${request.skillLevel}`);
        this.stockfish.postMessage(`position fen ${request.fen}`);
        this.stockfish.postMessage(`go depth ${request.depth || 10}`);
    }

    getBestMove(fen, skillLevel = 20, callback) {
        if (!this.ready) {
            console.error('Engine not ready');
            return;
        }

        console.log('Requesting best move for FEN:', fen);

        // Add callback to queue
        this.pendingCallbacks.push(callback);

        // If not currently processing, start immediately
        if (!this.isProcessing) {
            this.isProcessing = true;

            // Set skill level (0-20, where 20 is strongest)
            this.stockfish.postMessage(`setoption name Skill Level value ${skillLevel}`);
            this.stockfish.postMessage(`position fen ${fen}`);
            this.stockfish.postMessage('go depth 10'); // Reduced depth for faster response
        } else {
            // Queue the request
            if (!this.queuedRequests) this.queuedRequests = [];
            this.queuedRequests.push({ fen, skillLevel, depth: 10 });
        }
    }

    startAnalysis(fen, callback) {
        if (!this.ready) return;

        this.evalCallback = callback;
        this.stockfish.postMessage(`position fen ${fen}`);
        this.stockfish.postMessage('go infinite');
    }

    stopAnalysis() {
        if (!this.ready) return;
        this.stockfish.postMessage('stop');
        this.evalCallback = null;
    }

    destroy() {
        if (this.stockfish) {
            this.stockfish.terminate();
        }
    }
}

