// Domain-level checks that don't need a browser: SSL cert expiry, whether the
// www. variant resolves, and whether http:// redirects to https://.
const dns = require('dns').promises;
const tls = require('tls');
const http = require('http');

function sslDaysLeft(host) {
  return new Promise(resolve => {
    const socket = tls.connect({ host, port: 443, servername: host, timeout: 15000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      if (!cert || !cert.valid_to) return resolve(null);
      resolve(Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86400000));
    });
    socket.on('error', () => resolve(null));
    socket.on('timeout', () => { socket.destroy(); resolve(null); });
  });
}

function httpRedirect(host) {
  return new Promise(resolve => {
    const req = http.get({ host, path: '/', timeout: 15000 }, res => {
      const loc = res.headers.location || '';
      resolve({ status: res.statusCode, toHttps: /^https:/i.test(loc), location: loc });
      res.resume();
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function resolves(host) {
  try { await dns.lookup(host); return true; } catch { return false; }
}

// urlHost e.g. "keyahomes.in" -> checks www.keyahomes.in, ssl + http redirect on apex
async function domainHealth(urlHost) {
  const apex = urlHost.replace(/^www\./, '');
  const [wwwOk, sslDays, redirect] = await Promise.all([
    resolves('www.' + apex),
    sslDaysLeft(apex),
    httpRedirect(apex),
  ]);
  return { apex, wwwOk, sslDays, redirect };
}

module.exports = { domainHealth };
