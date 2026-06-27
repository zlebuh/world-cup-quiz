const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { loadQuiz } = require('./quiz-loader');
const { createState } = require('./lib/game-state');
const { registerRoutes } = require('./lib/routes');
const { registerSocketHandlers } = require('./lib/socket-handlers');
const { getPublicUrl } = require('./lib/network');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const PUBLIC_URL = process.env.PUBLIC_URL || null;
const SESSION_ID = require('crypto').randomUUID();

const theme = require('./config/config.json');
const quiz  = loadQuiz(path.join(__dirname, 'config', 'quiz.md'));

const game = createState(quiz);
game.sessionId = SESSION_ID;

registerRoutes(app, { theme, port: PORT, publicUrl: PUBLIC_URL });
registerSocketHandlers(io, game);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Quiz server ready`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Host:    http://localhost:${PORT}/host`);
  if (PUBLIC_URL) console.log(`  Public:  ${PUBLIC_URL}`);
  else console.log(`  Network: ${getPublicUrl(PORT, PUBLIC_URL)}`);
  console.log('\n  Press Ctrl+C to stop.\n');
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  game.stopTimer();
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500);
});
