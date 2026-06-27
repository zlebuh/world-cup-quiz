# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install        # install dependencies
npm start          # start server (local network only) → http://localhost:3000/host
npm run start:public  # start server + ngrok tunnel (requires ngrok auth)
```

No build step, no tests. This is a plain Node.js app — edit files and restart.

## Architecture

Real-time trivia quiz: one host browser tab controls game flow; players join from their phones.

- **`server.js`** — thin bootstrap: loads config/quiz, builds game state, registers routes and socket handlers, starts listening.
- **`lib/game-state.js`** — owns all game state in a single in-memory `state` object (`phase`, `sectionIndex`, `questionIndex`, timer) plus `players`/`disconnected` maps and derived helpers (scoring, snapshots, review data). Only one host socket is tracked (`state.hostSocketId`); all host events are gated against it.
- **`lib/socket-handlers.js`** — all Socket.IO event handlers (join/rejoin, host controls, answer submission, disconnect).
- **`lib/routes.js`** — HTTP routes (`/host`, `/api/theme`, `/qr`, `/api/join-url`, static files).
- **`lib/network.js`** — local IP / public URL resolution.
- **`lib/quiz-loader.js`** — parses `config/quiz.md` into `[{ title, questions: [{text, answer}] }]`.
- **`public/shared.js`** — audio cues, timer-ring rendering, and HTML escaping shared by both client scripts.
- **`public/host.js`** — host-side socket client; drives the host UI through game phases.
- **`public/player.js`** — player-side socket client; handles join, answer submission, rejoin on disconnect.
- **`scripts/start.js`** — launches server + ngrok, updates `PUBLIC_URL` env var, opens browser.

### Game phases (state.phase)
`lobby` → `question` → `timer` → `question` (loop) → `review` → `standings` → (next section or `done`)

### Customization
- Questions: edit `config/quiz.md` — sections start with `# Section N: Title`, questions are numbered with indented `Answer:` lines.
- Title/subtitle: edit `config/config.json` — served as JSON via `/api/theme`.
- Extra CSS: `config/custom.css` is served at `/custom.css` and linked from both HTML files.

Restart the server after editing any config file.
