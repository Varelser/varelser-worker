// varelser-worker: HTTP-triggered job receiver for Render Free.
// Zero dependencies (Node built-in http only).
// Endpoints:
//   GET  /        -> plain info
//   GET  /health  -> JSON health (no auth)
//   GET  /runs    -> last run records (auth required)
//   POST /run     -> run one job cycle (auth required)
//   GET  /run     -> same as POST (for simple cron pingers), auth required
// Auth: RUN_TOKEN env var, sent as header "x-run-token", "Authorization: Bearer <token>", or ?token=
// Job: placeholder cycle for now. Replace runJob() with a real bot lane later.
// State is in-memory only (Render Free filesystem/memory is ephemeral by design).

const http = require('http');
const crypto = require('crypto');
const { runMuseum } = require('./museum');

const PORT = process.env.PORT || 10000;
const RUN_TOKEN = process.env.RUN_TOKEN || '';
const SERVICE = 'varelser-worker';
const startedAt = new Date();

const runs = []; // newest first, max 20
const postedIds = new Set(); // per-process dedupe for lanes that post
let running = false;

function tokenOk(req, url) {
  if (!RUN_TOKEN) return false;
  const header = req.headers['x-run-token'] || '';
  const auth = req.headers['authorization'] || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const query = url.searchParams.get('token') || '';
  const given = header || bearer || query;
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(RUN_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function runJob(trigger, lane, opts = {}) {
  // Lane dispatch. "museum" is the first real lane (see museum.js).
  // Unknown lanes fall back to a recorded no-op cycle.
  if (lane === 'museum') {
    const excludeIds = Array.isArray(opts.excludeIds)
      ? opts.excludeIds.filter((x) => typeof x === 'string').slice(0, 5000)
      : [];
    const result = await runMuseum(postedIds, excludeIds);
    return { ...result, trigger, excludeIdsReceived: excludeIds.length };
  }
  const t0 = Date.now();
  return {
    job: 'placeholder',
    note: `unknown lane "${lane}"; cycle recorded only`,
    trigger,
    durationMs: Date.now() - t0,
  };
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size <= 65536) chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;

  if (path === '/health') {
    return sendJson(res, 200, {
      ok: true,
      service: SERVICE,
      now: new Date().toISOString(),
      startedAt: startedAt.toISOString(),
      uptimeSec: Math.floor((Date.now() - startedAt.getTime()) / 1000),
      runCount: runs.length,
      running,
      tokenConfigured: Boolean(RUN_TOKEN),
    });
  }

  if (path === '/') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end(
      `${SERVICE}\n` +
      `GET /health  - health check (no auth)\n` +
      `POST /run    - run one job cycle (needs RUN_TOKEN); lane via ?lane=museum (default) or JSON {"lane":"museum"}\n` +
      `GET /runs    - last runs (needs RUN_TOKEN)\n`
    );
  }

  if (path === '/runs') {
    if (!RUN_TOKEN) return sendJson(res, 503, { ok: false, error: 'RUN_TOKEN is not configured' });
    if (!tokenOk(req, url)) return sendJson(res, 401, { ok: false, error: 'invalid or missing token' });
    return sendJson(res, 200, { ok: true, runs });
  }

  if (path === '/run' && (req.method === 'POST' || req.method === 'GET')) {
    if (!RUN_TOKEN) return sendJson(res, 503, { ok: false, error: 'RUN_TOKEN is not configured' });
    if (!tokenOk(req, url)) return sendJson(res, 401, { ok: false, error: 'invalid or missing token' });
    if (running) return sendJson(res, 409, { ok: false, error: 'a run is already in progress' });
    running = true;
    const body = req.method === 'POST' ? await readBody(req) : {};
    const lane = url.searchParams.get('lane') || body.lane || 'museum';
    const record = {
      id: runs.length ? runs[0].id + 1 : 1,
      startedAt: new Date().toISOString(),
      status: 'running',
      lane,
    };
    runs.unshift(record);
    if (runs.length > 20) runs.length = 20;
    try {
      const result = await runJob(req.method, lane, body);
      record.status = 'ok';
      record.finishedAt = new Date().toISOString();
      record.result = result;
      return sendJson(res, 200, { ok: true, run: record });
    } catch (err) {
      record.status = 'error';
      record.finishedAt = new Date().toISOString();
      record.error = String(err && err.message ? err.message : err);
      return sendJson(res, 500, { ok: false, run: record });
    } finally {
      running = false;
    }
  }

  return sendJson(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`${SERVICE} listening on ${PORT}`);
});
