const crypto = require('crypto');
const http = require('http');
const net = require('net');
const { URL } = require('url');
const express = require('express');

const router = express.Router();
const target = new URL(process.env.PRISMA_STUDIO_TARGET_URL || 'http://127.0.0.1:5555');
const authUser = process.env.PRISMA_STUDIO_USER || 'admin';
const authPassword = process.env.PRISMA_STUDIO_PASSWORD || '';
const realm = 'Prisma Studio';

function isEnabled() {
  return true;
}

function signStudioToken(userId) {
  const payload = Buffer.from(JSON.stringify({ userId: Number(userId), expiresAt: Date.now() + 5 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', process.env.JWT_SECRET || 'minha_chave_super_secreta').update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyStudioToken(token) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) return false;
  const expected = crypto.createHmac('sha256', process.env.JWT_SECRET || 'minha_chave_super_secreta').update(payload).digest('base64url');
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Boolean(decoded.userId && decoded.expiresAt > Date.now());
  } catch {
    return false;
  }
}

function isAuthorized(req) {
  const cookies = Object.fromEntries(String(req.headers.cookie || '').split(';').map((item) => item.trim().split('=').map(decodeURIComponent)).filter((item) => item.length === 2));
  if (verifyStudioToken(cookies.prisma_studio_session)) return true;
  if (!authPassword) return false;
  const header = String(req.headers.authorization || '');
  const expected = Buffer.from(`${authUser}:${authPassword}`).toString('base64');
  const received = Buffer.from(header);
  const wanted = Buffer.from(`Basic ${expected}`);
  return received.length === wanted.length && crypto.timingSafeEqual(received, wanted);
}

function rejectUnauthorized(res) {
  res.set('WWW-Authenticate', `Basic realm="${realm}", charset="UTF-8"`);
  return res.status(401).send('Authentication required');
}

function isStudioRequest(req) {
  const url = req.originalUrl || req.url || '';
  return url.startsWith('/prisma-studio') || url.startsWith('/assets/') || url.startsWith('/http/') || url.startsWith('/prisma/') || url.startsWith('/api/') || ['/index.css', '/favicon.svg', '/icon-1024.png', '/vendor.js', '/schema.prisma'].includes(url.split('?')[0]);
}

function targetPath(originalUrl) {
  if (originalUrl.startsWith('/prisma-studio')) return originalUrl.replace(/^\/prisma-studio\/?/, '/') || '/';
  return originalUrl || '/';
}

function proxyHeaders(headers) {
  const copied = { ...headers };
  delete copied.host;
  delete copied.connection;
  delete copied['proxy-connection'];
  delete copied['content-length'];
  return copied;
}

router.get('/prisma-studio/auth', (req, res) => {
  if (!verifyStudioToken(req.query.token)) return res.status(403).send('Acesso expirado ou inválido');
  const secure = req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https');
  res.cookie('prisma_studio_session', req.query.token, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 5 * 60 * 1000 });
  return res.redirect(302, '/prisma-studio/');
});

router.use((req, res, next) => {
  if (!isStudioRequest(req)) return next();
  if (!isEnabled()) return res.status(404).send('Prisma Studio is not configured');
  if (!isAuthorized(req)) return rejectUnauthorized(res);
  if (req.originalUrl === '/prisma-studio') return res.redirect(308, '/prisma-studio/');

  const proxyReq = http.request({
    hostname: target.hostname,
    port: target.port || 80,
    path: targetPath(req.originalUrl),
    method: req.method,
    headers: { ...proxyHeaders(req.headers), host: target.host }
  }, (proxyRes) => {
    res.status(proxyRes.statusCode || 502);
    Object.entries(proxyRes.headers).forEach(([key, value]) => {
      if (value !== undefined) res.setHeader(key, value);
    });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', () => res.status(502).send('Prisma Studio is unavailable'));
  req.pipe(proxyReq);
});

function attachPrismaStudioUpgrade(server) {
  server.on('upgrade', (req, socket, head) => {
    if (!req.url || !isStudioRequest(req)) return;
    if (!isAuthorized(req)) {
      socket.write(`HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="${realm}"\r\nConnection: close\r\n\r\n`);
      socket.destroy();
      return;
    }
    const upstream = net.connect(Number(target.port || 80), target.hostname, () => {
      const headers = Object.entries({ ...proxyHeaders(req.headers), host: target.host }).map(([key, value]) => `${key}: ${value}`).join('\r\n');
      upstream.write(`${req.method} ${targetPath(req.url)} HTTP/${req.httpVersion}\r\n${headers}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
  });
}

module.exports = { prismaStudioRoute: router, attachPrismaStudioUpgrade, signStudioToken };
