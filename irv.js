/**
 * Instant-Runoff Voting (IRV) tally — Australian style.
 *
 * @param {string[][]} ballots  Array of ballots; each ballot is an ordered
 *                              array of option labels (first = most preferred).
 * @param {string[]}   options  Full list of option labels.
 * @returns {{ rounds: Round[], winner: string|null }}
 *
 * Round: { counts: {[label]: number}, eliminated: string|null, winner: string|null }
 */
function tallyIRV(ballots, options) {
  if (!ballots.length) return { rounds: [], winner: null };

  const rounds = [];
  let remaining = [...options];
  // Deep-copy ballots so we can filter eliminated candidates
  let activeBallots = ballots.map(b => [...b]);

  while (true) {
    // Count first-preference votes for each remaining candidate
    const counts = {};
    remaining.forEach(o => (counts[o] = 0));

    for (const ballot of activeBallots) {
      // First valid preference still in the running
      const top = ballot.find(o => remaining.includes(o));
      if (top) counts[top]++;
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total === 0) {
      rounds.push({ counts, eliminated: null, winner: null });
      break;
    }

    // Check for majority
    const winner = remaining.find(o => counts[o] / total > 0.5);
    if (winner) {
      rounds.push({ counts, eliminated: null, winner });
      return { rounds, winner };
    }

    // If only one candidate left, they win by default
    if (remaining.length === 1) {
      rounds.push({ counts, eliminated: null, winner: remaining[0] });
      return { rounds, winner: remaining[0] };
    }

    // Eliminate candidate with fewest votes (tie-break: alphabetical)
    const minVotes = Math.min(...remaining.map(o => counts[o]));
    const losers = remaining.filter(o => counts[o] === minVotes).sort();
    const eliminated = losers[0];

    rounds.push({ counts, eliminated, winner: null });
    remaining = remaining.filter(o => o !== eliminated);
  }

  return { rounds, winner: null };
}

/**
 * Borda Count tally.
 *
 * @param {string[][]} ballots  Array of ballots; each ballot is an ordered
 *                              array of option labels (first = most preferred).
 * @param {string[]}   options  Full list of option labels.
 * @returns {{ scores: {[label]: number}, ranking: string[] }}
 */
function tallyBorda(ballots, options) {
  const scores = {};
  options.forEach(o => (scores[o] = 0));

  const n = options.length;
  for (const ballot of ballots) {
    // Map ballot positions to points (first gets n-1, second n-2, etc.)
    const ballotMap = {};
    ballot.forEach((option, index) => {
      if (options.includes(option)) {
        ballotMap[option] = n - 1 - index;
      }
    });

    // Add points for each option in this ballot
    options.forEach(option => {
      scores[option] += ballotMap[option] || 0;
    });
  }

  // Sort options by score descending (highest first)
  const ranking = options.sort((a, b) => scores[b] - scores[a]);

  return { scores, ranking };
}

module.exports = { tallyIRV, tallyBorda };
