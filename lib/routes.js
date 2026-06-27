const express = require('express');
const path = require('path');
const QRCode = require('qrcode');
const { getPublicUrl } = require('./network');

function registerRoutes(app, { theme, port, publicUrl }) {
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/host', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'host.html')));

  app.get('/custom.css', (req, res) => {
    res.type('text/css').sendFile(path.join(__dirname, '..', 'config', 'custom.css'));
  });

  app.get('/api/theme', (req, res) => res.json({
    title: theme.title,
    subtitle: theme.subtitle,
  }));

  app.get('/qr', async (req, res) => {
    const svg = await QRCode.toString(getPublicUrl(port, publicUrl), { type: 'svg' });
    res.type('image/svg+xml').send(svg);
  });

  app.get('/api/join-url', (req, res) => res.json({ url: getPublicUrl(port, publicUrl) }));
}

module.exports = { registerRoutes };
