const os = require('os');

function getLocalIp() {
  const preferred = [/^192\.168\./, /^10\./];
  const fallback  = [/^172\.(1[6-9]|2\d|3[01])\./];
  const all = Object.values(os.networkInterfaces()).flat().filter((i) => i.family === 'IPv4' && !i.internal);
  return (
    all.find((i) => preferred.some((r) => r.test(i.address)))?.address ||
    all.find((i) => fallback.some((r) => r.test(i.address)))?.address ||
    '127.0.0.1'
  );
}

function getPublicUrl(port, publicUrl) {
  return publicUrl || `http://${getLocalIp()}:${port}`;
}

module.exports = { getLocalIp, getPublicUrl };
