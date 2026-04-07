const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const db = require('./db');
const { tallyIRV } = require('./irv');

const app = express();
const PORT = process.env.PORT || 3000;
const BCRYPT_ROUNDS = 10;

function shuffleArray(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Delay per wrong recovery attempt (seconds), doubles each time up to max
const ATTEMPT_BASE_DELAY_MS = 2000;
const ATTEMPT_MAX_DELAY_MS = 30000;
const ATTEMPT_WINDOW_S = 600; // 10 min window for counting attempts

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helpers ────────────────────────────────────────────────────────────────

function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}

async function recentAttempts(pollId, ip) {
  const since = Math.floor(Date.now() / 1000) - ATTEMPT_WINDOW_S;
  const row = await db.get(
    `SELECT COUNT(*) as n FROM recovery_attempts WHERE poll_id=? AND ip=? AND attempted_at> ?`,
    [pollId, ip, since]
  );
  return row ? Number(row.n) : 0;
}

async function recordAttempt(pollId, ip) {
  await db.run(`INSERT INTO recovery_attempts (poll_id, ip) VALUES (?,?)`, [pollId, ip]);
}

function delayForAttempts(n) {
  if (n === 0) return 0;
  const delay = Math.min(ATTEMPT_BASE_DELAY_MS * Math.pow(2, n - 1), ATTEMPT_MAX_DELAY_MS);
  return delay;
}

// ─── Ballot routes ────────────────────────────────────────────────────────────

// GET /api/polls/:pollId/tally — public tally (no admin key needed, post-vote only)
app.get('/api/polls/:pollId/tally', async (req, res) => {
  const poll = await db.get(`SELECT options FROM polls WHERE id=?`, [req.params.pollId]);
  if (!poll) return res.status(404).json({ error: 'Poll not found.' });

  const options = JSON.parse(poll.options);
  const ballots = await db.all(`SELECT ranking FROM ballots WHERE poll_id=?`, [req.params.pollId]);
  const parsed = ballots.map(b => JSON.parse(b.ranking));
  const tally = tallyIRV(parsed, options);

  res.json({ tally, ballotCount: ballots.length });
});

// GET /api/polls/:pollId/ballot/:alias — fetch existing ballot for an alias
app.get('/api/polls/:pollId/ballot/:alias', async (req, res) => {
  const { pollId, alias } = req.params;
  const ballot = await db.get(`SELECT ranking FROM ballots WHERE poll_id=? AND LOWER(alias)=LOWER(?)`, [pollId, alias]);
  if (!ballot) return res.json({ ranking: null });
  res.json({ ranking: JSON.parse(ballot.ranking) });
});

// POST /api/polls/:pollId/vote
app.post('/api/polls/:pollId/vote', async (req, res) => {
  const { pollId } = req.params;
  const { alias, ranking } = req.body;

  const poll = await db.get(`SELECT * FROM polls WHERE id=?`, [pollId]);
  if (!poll) return res.status(404).json({ error: 'Poll not found.' });
  if (poll.status === 'closed') return res.status(403).json({ error: 'This poll is closed.' });

  if (!alias || !alias.trim()) return res.status(400).json({ error: 'Alias is required.' });
  if (!Array.isArray(ranking) || ranking.length < 1)
    return res.status(400).json({ error: 'Ranking must be a non-empty array.' });

  const options = JSON.parse(poll.options);
  const validOptions = ranking.every(o => options.includes(o));
  if (!validOptions) return res.status(400).json({ error: 'Invalid options in ranking.' });
  const unique = new Set(ranking).size === ranking.length;
  if (!unique) return res.status(400).json({ error: 'Duplicate options in ranking.' });

  // Upsert: update if alias already voted (case-insensitive), insert otherwise
  const trimmedAlias = alias.trim();
  const existing = await db.get(`SELECT alias FROM ballots WHERE poll_id=? AND LOWER(alias)=LOWER(?)`, [pollId, trimmedAlias]);
  if (existing) {
    await db.run(`UPDATE ballots SET ranking=?, submitted_at=${db.nowExpr} WHERE poll_id=? AND alias=?`, [JSON.stringify(ranking), pollId, existing.alias]);
  } else {
    await db.run(`INSERT INTO ballots (poll_id, alias, ranking, submitted_at) VALUES (?, ?, ?, ${db.nowExpr})`, [pollId, trimmedAlias, JSON.stringify(ranking)]);
  }

  res.json({ ok: true });
});

// ─── Poll routes ─────────────────────────────────────────────────────────────

// POST /api/polls — create a new poll
app.post('/api/polls', async (req, res) => {
  const { title, description, options, passphrase } = req.body;

  if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required.' });
  if (!Array.isArray(options) || options.filter(o => o.trim()).length < 2)
    return res.status(400).json({ error: 'At least 2 options are required.' });
  if (!passphrase || passphrase.trim().length < 4)
    return res.status(400).json({ error: 'Recovery passphrase must be at least 4 characters.' });

  const cleanOptions = options.map(o => o.trim()).filter(Boolean);
  const pollId = uuidv4().slice(0, 8);
  const adminKey = uuidv4().replace(/-/g, '');
  const recoveryHash = await bcrypt.hash(passphrase.trim(), BCRYPT_ROUNDS);

  await db.run(`
    INSERT INTO polls (id, admin_key, title, description, options, recovery_hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [pollId, adminKey, title.trim(), (description || '').trim(), JSON.stringify(cleanOptions), recoveryHash]);

  res.json({ pollId, adminKey, adminUrl: `/admin/${pollId}/${adminKey}` });
});

// GET /api/polls/:pollId — public poll info (for voting page)
app.get('/api/polls/:pollId', async (req, res) => {
  const poll = await db.get(`SELECT id, title, description, options, status FROM polls WHERE id=?`, [req.params.pollId]);
  if (!poll) return res.status(404).json({ error: 'Poll not found.' });
  poll.options = shuffleArray(JSON.parse(poll.options));
  res.json(poll);
});

// GET /api/polls/:pollId/:adminKey — admin poll info
app.get('/api/polls/:pollId/:adminKey', async (req, res) => {
  const { pollId, adminKey } = req.params;
  const poll = await db.get(`SELECT * FROM polls WHERE id=? AND admin_key=?`, [pollId, adminKey]);
  if (!poll) return res.status(403).json({ error: 'Invalid poll ID or admin key.' });

  const ballots = await db.all(`SELECT alias, ranking FROM ballots WHERE poll_id=?`, [pollId]);
  const options = JSON.parse(poll.options);

  const parsedBallots = ballots.map(b => JSON.parse(b.ranking));
  const tally = tallyIRV(parsedBallots, options);

  res.json({
    id: poll.id,
    title: poll.title,
    description: poll.description,
    options,
    status: poll.status,
    adminKey: poll.admin_key,
    ballotCount: ballots.length,
    voters: ballots.map(b => b.alias),
    tally,
  });
});

// DELETE /api/polls/:pollId/:adminKey/ballot/:alias — delete a ballot
app.delete('/api/polls/:pollId/:adminKey/ballot/:alias', async (req, res) => {
  const { pollId, adminKey, alias } = req.params;
  const poll = await db.get(`SELECT id FROM polls WHERE id=? AND admin_key=?`, [pollId, adminKey]);
  if (!poll) return res.status(403).json({ error: 'Invalid poll or admin key.' });

  await db.run(`DELETE FROM ballots WHERE poll_id=? AND alias=?`, [pollId, alias]);
  res.json({ ok: true });
});

// PATCH /api/polls/:pollId/:adminKey — update poll (title, description, options, status)
app.patch('/api/polls/:pollId/:adminKey', async (req, res) => {
  const { pollId, adminKey } = req.params;
  const poll = await db.get(`SELECT * FROM polls WHERE id=? AND admin_key=?`, [pollId, adminKey]);
  if (!poll) return res.status(403).json({ error: 'Invalid poll ID or admin key.' });

  const { title, description, options, status } = req.body;
  const updates = [];
  const values = [];

  if (title !== undefined) { updates.push('title=?'); values.push(title.trim()); }
  if (description !== undefined) { updates.push('description=?'); values.push(description.trim()); }
  if (options !== undefined) {
    const clean = options.map(o => o.trim()).filter(Boolean);
    if (clean.length < 2) return res.status(400).json({ error: 'At least 2 options required.' });
    updates.push('options=?'); values.push(JSON.stringify(clean));
  }
  if (status !== undefined) {
    if (!['open', 'closed'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
    updates.push('status=?'); values.push(status);
  }

  if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });
  values.push(pollId, adminKey);
  await db.run(`UPDATE polls SET ${updates.join(',')} WHERE id=? AND admin_key=?`, values);
  res.json({ ok: true });
});

// ─── Recovery route ───────────────────────────────────────────────────────────

// POST /api/recover
app.post('/api/recover', async (req, res) => {
  const { pollId, passphrase } = req.body;
  const ip = getClientIp(req);

  if (!pollId || !passphrase)
    return res.status(400).json({ error: 'Poll ID and passphrase are required.' });

  const attempts = await recentAttempts(pollId, ip);
  const delay = delayForAttempts(attempts);
  if (delay > 0) await new Promise(r => setTimeout(r, delay));

  const poll = await db.get(`SELECT admin_key, recovery_hash FROM polls WHERE id=?`, [pollId]);
  if (!poll) {
    await recordAttempt(pollId, ip);
    return res.status(404).json({ error: 'Poll not found.' });
  }
  if (!poll.recovery_hash) {
    return res.status(400).json({ error: 'No recovery passphrase was set for this poll.' });
  }

  const match = await bcrypt.compare(passphrase.trim(), poll.recovery_hash);
  if (!match) {
    await recordAttempt(pollId, ip);
    const newAttempts = attempts + 1;
    const nextDelay = delayForAttempts(newAttempts);
    return res.status(401).json({
      error: 'Incorrect passphrase.',
      retryAfterMs: nextDelay,
    });
  }

  res.json({ adminUrl: `/admin/${pollId}/${poll.admin_key}` });
});

// ─── SPA fallback ─────────────────────────────────────────────────────────────
app.get('/admin/*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/vote/*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'vote.html')));
app.get('/recover', (req, res) => res.sendFile(path.join(__dirname, 'public', 'recover.html')));

db.init().then(() => {
  app.listen(PORT, () => console.log(`Ranked-vote server running on http://localhost:${PORT}`));
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});