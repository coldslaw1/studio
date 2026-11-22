// Turns raw episode results into a difficulty report with flagged problems.
import { mean, median, quantile, wilson, round } from './stats.js';

export const DEFAULT_THRESHOLDS = {
  spike: 30,        // difficulty jump (points out of 100) from the level before
  dip: 30,          // difficulty drop from the level before
  trivialWin: 0.9,  // the random bot winning this often means no thinking is needed
  hazardRatio: 2.5, // endless games: a time slice this many times deadlier than the one before
  wallShare: 0.6,   // this share of the strongest bot's losses at one point of progress = a wall
};

const PENALTY = { impossible: 40, 'no-wins': 25, spike: 15, wall: 10, 'hazard-spike': 10, dip: 5, trivial: 5, 'first-move-trap': 0 };

function summarizeBot(results, adapter, maxSteps) {
  const n = results.length;
  const wins = results.filter((r) => r.outcome === 'won');
  const losses = results.filter((r) => r.outcome === 'lost');
  const timeouts = n - wins.length - losses.length;
  // In an endless game, reaching the step limit is the success.
  const successes = adapter.endless ? timeouts : wins.length;
  const ci = wilson(successes, n);
  const causes = {};
  for (const r of losses) {
    const c = r.cause || 'lost';
    causes[c] = (causes[c] || 0) + 1;
  }
  const scores = results.map((r) => r.score).filter((s) => typeof s === 'number');
  return {
    runs: n,
    won: wins.length,
    lost: losses.length,
    timeout: timeouts,
    successRate: round(n ? successes / n : 0),
    successLow: round(ci.low),
    successHigh: round(ci.high),
    medianSteps: median(results.map((r) => r.steps)),
    // Endless games: how much of the time limit a run lasts on average, 0..1.
    survival: adapter.endless ? round(mean(results.map((r) => Math.min(1, r.steps / maxSteps)))) : null,
    medianSeconds: adapter.secondsPerStep ? round(median(results.map((r) => r.steps)) * adapter.secondsPerStep, 1) : null,
    medianStepsToWin: median(wins.map((r) => r.steps)),
    medianStepsToLoss: median(losses.map((r) => r.steps)),
    meanProgress: adapter.progress ? round(mean(results.map((r) => r.progress))) : null,
    meanProgressAtLoss: adapter.progress && losses.length ? round(mean(losses.map((r) => r.progress))) : null,
    medianScore: scores.length ? median(scores) : null,
    p90Score: scores.length ? quantile(scores, 0.9) : null,
    causes,
  };
}

/** Deaths per time slice, as a share of the runs still alive when the slice began. */
function hazardCurve(results, maxSteps, buckets = 10) {
  const size = Math.max(1, Math.ceil(maxSteps / buckets));
  const deaths = new Array(buckets).fill(0);
  for (const r of results) {
    if (r.outcome !== 'lost') continue;
    deaths[Math.min(buckets - 1, Math.floor(Math.max(0, r.steps - 1) / size))] += 1;
  }
  let alive = results.length;
  return deaths.map((d, i) => {
    const slice = { fromStep: i * size, toStep: (i + 1) * size, alive, deaths: d, hazard: round(alive ? d / alive : 0) };
    alive -= d;
    return slice;
  });
}

/** Where on the progress scale (0..1, ten slices) the lost runs ended. */
function progressHistogram(results) {
  const bins = new Array(10).fill(0);
  for (const r of results) {
    if (r.outcome !== 'lost' || r.progress === null) continue;
    bins[Math.min(9, Math.floor(r.progress * 10))] += 1;
  }
  return bins;
}

/**
 * analyzeLevel(adapter, level, byBot, exact, maxSteps) -> level report
 *   byBot: { [botName]: result[] } in ladder order (weakest first).
 */
export function analyzeLevel(adapter, level, byBot, exact, maxSteps) {
  const bots = {};
  for (const [name, results] of Object.entries(byBot)) bots[name] = summarizeBot(results, adapter, maxSteps);
  // Level games: how often bots win. Endless games: how long they last.
  const rates = Object.values(bots).map((b) => (adapter.endless ? b.survival : b.successRate));
  const all = Object.values(byBot).flat();
  const report = {
    id: level.id,
    name: level.name,
    difficulty: Math.round(100 * (1 - mean(rates))),
    bots,
    exact: exact || null,
    flags: [],
  };
  const names = Object.keys(byBot);
  const strongest = byBot[names[names.length - 1]] || [];
  // Per bot: runs of one bot are alike, so a jump in its curve is the game, not the mix of players.
  if (adapter.endless) {
    report.hazard = Object.fromEntries(names.map((n) => [n, hazardCurve(byBot[n], maxSteps)]));
  }
  if (adapter.progress) report.lossProgress = progressHistogram(strongest);
  return report;
}

function flag(report, level, type, severity, message) {
  const f = { level: level ? level.id : null, levelName: level ? level.name : null, type, severity, message };
  if (level) level.flags.push(f);
  report.flags.push(f);
}

/**
 * analyze({ adapter, levels, thresholds }) -> finishes the report in place:
 * adds flags (per level and overall) and the 0-100 balance score.
 *   levels: level reports from analyzeLevel, in play order.
 */
export function analyze({ adapter, levels, thresholds = {} }) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const report = { levels, flags: [], balanceScore: 100 };
  const pct = (x) => `${Math.round(x * 100)}%`;

  levels.forEach((level, i) => {
    const names = Object.keys(level.bots);
    const first = level.bots[names[0]];
    const anySuccess = names.some((n) => level.bots[n].successRate > 0);

    if (level.exact && level.exact.solvable === false) {
      flag(report, level, 'impossible', 'error',
        `"${level.name}" cannot be won: all ${level.exact.states} reachable positions were checked.`);
    } else if (adapter.endless) {
      // No win exists, so "nobody reached the time limit" is not a bug by itself.
    } else if (!anySuccess && !(level.exact && level.exact.solvable)) {
      flag(report, level, 'no-wins', 'error',
        `No bot ever won "${level.name}" in ${first.runs} runs each. It may be impossible.`);
    } else if (!anySuccess) {
      flag(report, level, 'no-wins', 'warn',
        `"${level.name}" can be won (shortest win: ${level.exact.shortestWin} moves) but no bot found it in ${first.runs} runs each. Expect players to struggle.`);
    }

    if (!adapter.endless && i > 0 && names.length > 0 && first.successRate >= t.trivialWin) {
      flag(report, level, 'trivial', 'info',
        `"${level.name}" is won ${pct(first.successRate)} of the time by pressing random buttons.`);
    }

    if (level.exact && level.exact.solvable && level.exact.startTraps > 0) {
      flag(report, level, 'first-move-trap', 'info',
        `In "${level.name}" ${level.exact.startTraps} of the ${level.exact.startMoves} possible first moves already make the level unwinnable.`);
    }

    if (i > 0) {
      const before = levels[i - 1];
      const jump = level.difficulty - before.difficulty;
      if (jump >= t.spike) {
        flag(report, level, 'spike', 'warn',
          `Difficulty spike: "${level.name}" scores ${level.difficulty} after "${before.name}" at ${before.difficulty} (+${jump}).`);
      } else if (-jump >= t.dip) {
        flag(report, level, 'dip', 'info',
          `Difficulty dip: "${level.name}" scores ${level.difficulty} after "${before.name}" at ${before.difficulty} (${jump}). The harder level may belong later.`);
      }
    }

    if (level.hazard) {
      const seen = new Set();
      // Strongest bot first, so a spike is reported for the best player that hits it.
      for (const name of [...names].reverse()) {
        const curve = level.hazard[name];
        curve.forEach((slice, k) => {
          if (seen.has(k) || slice.alive < 30 || slice.deaths < 20 || slice.hazard < 0.15) return;
          let base;
          if (k > 0) base = curve[k - 1].hazard;
          else {
            const rest = curve.slice(1).filter((s) => s.alive >= 30);
            if (rest.length === 0) return;
            base = mean(rest.map((s) => s.hazard));
          }
          if (slice.hazard < t.hazardRatio * Math.max(base, 0.01)) return;
          seen.add(k);
          const where = adapter.secondsPerStep
            ? `${round(slice.fromStep * adapter.secondsPerStep, 1)}-${round(slice.toStep * adapter.secondsPerStep, 1)} s`
            : `steps ${slice.fromStep}-${slice.toStep}`;
          flag(report, level, 'hazard-spike', 'warn',
            `Difficulty spike at ${where} in "${level.name}": ${pct(slice.hazard)} of the "${name}" bot's runs still alive end there, ` +
            `against ${pct(base)} ${k > 0 ? 'in the slice before' : 'in the later slices'}.`);
        });
      }
    }

    if (level.lossProgress && !adapter.endless) {
      const total = level.lossProgress.reduce((a, b) => a + b, 0);
      const top = Math.max(...level.lossProgress);
      const at = level.lossProgress.indexOf(top);
      const best = level.bots[names[names.length - 1]];
      // A wall: even the strongest bot mostly fails, and its failures pile up at one point.
      if (total >= 30 && best.successRate < 0.5 && top / total >= t.wallShare) {
        flag(report, level, 'wall', 'warn',
          `The strongest bot ("${names[names.length - 1]}") wins "${level.name}" only ${pct(best.successRate)} of the time, and ` +
          `${pct(top / total)} of its lost runs end at ${at * 10}-${at * 10 + 10}% progress. Something there stops most players.`);
      }
    }
  });

  let score = 100;
  for (const f of report.flags) score -= PENALTY[f.type] || 0;
  report.balanceScore = Math.max(0, score);
  return report;
}
