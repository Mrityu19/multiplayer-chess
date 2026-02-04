// Stockfish Engine Wrapper
class ChessEngine {
    constructor() {
        this.stockfish = null;
        this.ready = false;
        this.callbacks = {};
        this.evalCallback = null;
        this.bestMoveCallback = null;
    }

    async init() {
        return new Promise((resolve) => {
            // Use Stockfish from CDN
            this.stockfish = new Worker('https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js');

            this.stockfish.onmessage = (event) => {
                const message = event.data;

                // Engine is ready
                if (message === 'uciok') {
                    this.ready = true;
                    resolve();
                }

                // Best move received
                if (message.startsWith('bestmove')) {
                    const match = message.match(/bestmove\s+([a-h][1-8][a-h][1-8][qrbn]?)/);
                    if (match && this.bestMoveCallback) {
                        const move = match[1];
                        this.bestMoveCallback({
                            from: move.substring(0, 2),
                            to: move.substring(2, 4),
                            promotion: move.length > 4 ? move[4] : undefined
                        });
                    }
                }

                // Evaluation info
                if (message.startsWith('info') && message.includes('score')) {
                    this.parseEvaluation(message);
                }
            };

            // Initialize UCI
            this.stockfish.postMessage('uci');
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

    getBestMove(fen, skillLevel = 20, callback) {
        if (!this.ready) return;

        this.bestMoveCallback = callback;

        // Set skill level (0-20, where 20 is strongest)
        this.stockfish.postMessage(`setoption name Skill Level value ${skillLevel}`);
        this.stockfish.postMessage(`position fen ${fen}`);
        this.stockfish.postMessage('go depth 15');
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
