# Prefr

A lightweight ranked-choice voting app using Instant-Runoff Voting (IRV) and Borda Count — the Australian system and points-based ranking.

## Features

- Create polls with drag-to-rank voting
- IRV and Borda tally computed on demand (round-by-round breakdown for IRV, scores for Borda)
- Admin link = identity (no login required)
- Recovery passphrase to retrieve a lost admin link
- Open/close polls manually
- Voters can update their ballot until poll closes
- Alias deduplication (last submission wins)

## Tech stack

- **Node.js + Express** — backend
- **better-sqlite3** — single-file database, zero config
- **bcrypt** — recovery passphrase hashing
- **Plain HTML/CSS/JS** — no frontend framework

---

## Local development

```bash
npm install
npm run dev       # uses node --watch (Node 18+)
```

Server runs at http://localhost:3000

---

## Deploy on Render (free tier)

1. Push this folder to a GitHub repo.
2. Go to https://render.com → **New Web Service** → connect your repo.
3. Set:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Environment:** Node
4. Add an environment variable if you want a custom port (Render sets `PORT` automatically).
5. Deploy.

> **Note on SQLite on Render free tier:** Render's free tier has an ephemeral filesystem — the SQLite file (`votes.db`) will be lost on each deploy or restart. For a persistent setup, either:
> - Upgrade to a paid Render instance with a persistent disk, **or**
> - Swap `better-sqlite3` for a free hosted Postgres instance (e.g. Neon.tech or Supabase) and update `db.js` accordingly.
>
> For personal/small-group use with infrequent deploys, the ephemeral filesystem is usually fine.

---

## Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Create poll page |
| `GET` | `/vote/:pollId` | Voting page |
| `GET` | `/admin/:pollId/:adminKey` | Admin page |
| `GET` | `/recover` | Recover admin link |
| `POST` | `/api/polls` | Create poll |
| `GET` | `/api/polls/:pollId` | Public poll info |
| `GET` | `/api/polls/:pollId/:adminKey` | Admin poll info + tally |
| `PATCH` | `/api/polls/:pollId/:adminKey` | Edit poll / toggle status |
| `POST` | `/api/polls/:pollId/vote` | Submit/update ballot |
| `GET` | `/api/polls/:pollId/ballot/:alias` | Fetch existing ballot |
| `POST` | `/api/recover` | Recover admin link |

---

## IRV algorithm

1. Count first-preference votes for each candidate.
2. If any candidate has >50% of votes, they win.
3. Otherwise, eliminate the candidate with the fewest votes.
4. Redistribute eliminated candidate's ballots to each voter's next valid preference.
5. Repeat until a winner is found.

Tie-breaking on elimination: alphabetical order (deterministic).

---

## Security notes

- The `adminKey` is a 32-char UUID hex — unguessable by brute force.
- The recovery passphrase is stored as a bcrypt hash (cost 10) — never in plaintext.
- Wrong recovery attempts trigger exponential backoff per IP (2s → 4s → 8s… up to 30s), tracked per poll within a 10-minute window.
- No authentication beyond possession of the admin link.
# prefr
