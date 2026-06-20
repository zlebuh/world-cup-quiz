#!/usr/bin/env node
/**
 * Starts the quiz server + ngrok tunnel, then opens the host panel in the browser.
 * Uses the ngrok CLI already installed on your system.
 *
 * Usage:  npm run start:public
 */

require('dotenv').config();

const { spawn }  = require('child_process');
const http       = require('http');
const path       = require('path');
const open       = require('open');

const PORT = process.env.PORT || 3000;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function getNgrokUrl(retries = 20) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const poll = () => {
      http.get('http://127.0.0.1:4040/api/tunnels', (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => {
          try {
            const tunnels = JSON.parse(body).tunnels;
            const https = tunnels.find((t) => t.proto === 'https');
            if (https) return resolve(https.public_url);
          } catch (_) {}
          retry();
        });
      }).on('error', retry);
    };
    const retry = () => {
      if (++attempts >= retries) return reject(new Error('ngrok did not start in time'));
      setTimeout(poll, 500);
    };
    poll();
  });
}

async function main() {
  console.log('Starting ngrok tunnel...');

  const ngrokProc = spawn('ngrok', ['http', String(PORT)], { stdio: 'pipe' });

  ngrokProc.stderr.on('data', (d) => {
    const msg = d.toString().trim();
    if (msg) console.error('[ngrok]', msg);
  });

  ngrokProc.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`ngrok exited with code ${code}`);
      process.exit(1);
    }
  });

  let publicUrl;
  try {
    publicUrl = await getNgrokUrl();
  } catch (err) {
    console.error('\nFailed to get ngrok URL:', err.message);
    console.error('Make sure ngrok is installed and authenticated.');
    ngrokProc.kill();
    process.exit(1);
  }

  console.log(`Tunnel ready: ${publicUrl}`);
  console.log('Starting quiz server...\n');

  const serverProc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PUBLIC_URL: publicUrl, PORT: String(PORT) },
    stdio: 'inherit',
  });

  setTimeout(() => open(`http://localhost:${PORT}/host`), 1200);

  function shutdown() {
    console.log('\nShutting down...');
    serverProc.kill('SIGINT');
    ngrokProc.kill();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  serverProc.on('exit', () => { ngrokProc.kill(); process.exit(0); });
}

main();
