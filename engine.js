class ChessEngine {
    constructor() {
        this.stockfish = null;
        this.ready = false;
        this.callbacks = {}; // not effectively used, but kept for legacy
        this.evalCallback = null;
        this.pendingCallbacks = []; // Queue for "bestmove" callbacks
        this.queuedRequests = []; // Queue for analysis/move requests if engine busy
        this.isProcessing = false;
    }

    async init() {
        return new Promise((resolve, reject) => {
            try {
                // Use local stockfish
                this.stockfish = new Worker('lib/stockfish.js');

                this.stockfish.onmessage = (event) => {
                    const message = event.data;
                    // console.log('Stockfish:', message); // Uncomment for debugging

                    // Engine is ready
                    if (message === 'uciok') {
                        this.ready = true;
                        resolve();
                    }

                    // Best move received
                    if (message.startsWith('bestmove')) {
                        const match = message.match(/bestmove\s+([a-h][1-8][a-h][1-8][qrbn]?)/);
                        this.isProcessing = false; // Mark as free immediately

                        if (match && this.pendingCallbacks.length > 0) {
                            const callback = this.pendingCallbacks.shift();
                            const move = match[1];

                            if (callback) {
                                callback({
                                    from: move.substring(0, 2),
                                    to: move.substring(2, 4),
                                    promotion: move.length > 4 ? move[4] : undefined
                                });
                            }
                        }

                        // Process next in queue if any
                        this.processQueue();
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

    processQueue() {
        if (this.isProcessing || this.queuedRequests.length === 0) return;

        const request = this.queuedRequests.shift();
        this.isProcessing = true;
        this.pendingCallbacks.push(request.callback);

        // Reset options first to clear previous limits
        // this.stockfish.postMessage('setoption name UCI_LimitStrength value false'); 

        // Set difficulty based on request type
        if (request.features && request.features.elo) {
            this.stockfish.postMessage('setoption name UCI_LimitStrength value true');
            this.stockfish.postMessage(`setoption name UCI_Elo value ${request.features.elo}`);
        } else if (request.features && request.features.skillLevel !== undefined) {
            this.stockfish.postMessage('setoption name UCI_LimitStrength value false');
            this.stockfish.postMessage(`setoption name Skill Level value ${request.features.skillLevel}`);
        }

        this.stockfish.postMessage(`position fen ${request.fen}`);
        this.stockfish.postMessage(`go depth ${request.depth || 10}`);
    }

    getBestMove(fen, difficultySettings, callback) {
        if (!this.ready) {
            console.error('Engine not ready');
            return;
        }

        // Difficulty Settings can be an object { elo: 1500 } or just a number (legacy skill level)
        let features = {};
        let depth = 10; // Default depth

        if (typeof difficultySettings === 'number') {
            features.skillLevel = difficultySettings; // Legacy support
            depth = Math.max(3, Math.min(15, difficultySettings));
        } else {
            features = difficultySettings;
            // Calculate depth based on ELO - lower ELO = shallower search
            if (features.elo) {
                if (features.elo <= 400) depth = 2;
                else if (features.elo <= 600) depth = 3;
                else if (features.elo <= 800) depth = 4;
                else if (features.elo <= 1000) depth = 5;
                else if (features.elo <= 1200) depth = 6;
                else if (features.elo <= 1500) depth = 8;
                else if (features.elo <= 1800) depth = 10;
                else if (features.elo <= 2000) depth = 12;
                else depth = 15;
            }
        }

        const request = { fen, features, depth, callback };

        // If not currently processing, start immediately (via queue to standardize)
        this.queuedRequests.push(request);
        this.processQueue();
    }

    startAnalysis(fen, callback) {
        if (!this.ready) return;

        this.evalCallback = callback;
        // Analysis should ideally run at max strength
        this.stockfish.postMessage('setoption name UCI_LimitStrength value false');
        this.stockfish.postMessage('setoption name Skill Level value 20');

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

