// Renders a report as Markdown (for people) and as a few short lines (for logs).

const pct = (x) => (x === null || x === undefined ? '-' : `${Math.round(x * 100)}%`);
const num = (x) => (x === null || x === undefined ? '-' : String(Math.round(x * 10) / 10));
const MARK = { error: 'PROBLEM', warn: 'WARNING', info: 'NOTE' };

/** summaryLines(report) -> string[] : the short version for a terminal or a card log. */
export function summaryLines(report) {
  const lines = [
    `${report.game}: balance score ${report.balanceScore}/100 from ${report.totalRuns} runs ` +
    `(${report.runsPerBot} per bot per level, seed ${report.seed}, ${(report.elapsedMs / 1000).toFixed(1)} s)`,
  ];
  for (const level of report.levels) {
    const rates = Object.entries(level.bots).map(([n, b]) => (report.kind === 'endless'
      ? `${n} lasts ${b.medianSeconds !== null ? `${num(b.medianSeconds)} s` : `${num(b.medianSteps)} steps`}`
      : `${n} ${pct(b.successRate)}`)).join(', ');
    lines.push(`  ${level.name}: difficulty ${level.difficulty}/100 (${rates})`);
  }
  if (report.flags.length === 0) lines.push('  No difficulty problems found.');
  for (const f of report.flags) lines.push(`  ${MARK[f.severity]}: ${f.message}`);
  return lines;
}

/** toMarkdown(report) -> string */
export function toMarkdown(report) {
  const success = report.kind === 'endless' ? 'Survived' : 'Won';
  const out = [];
  out.push(`# Bot play-test: ${report.game}`, '');
  out.push(`**Balance score: ${report.balanceScore}/100.** ${report.totalRuns} runs ` +
    `(${report.runsPerBot} per bot per level), seed ${report.seed}, step limit ${report.maxSteps}.`, '');
  out.push('## Findings', '');
  if (report.flags.length === 0) out.push('No difficulty problems found.');
  for (const f of report.flags) out.push(`- **${MARK[f.severity]}** (${f.type}): ${f.message}`);
  out.push('', '## Difficulty by level', '');
  const botNames = report.bots.map((b) => b.name);
  out.push(`| Level | Difficulty | ${botNames.map((n) => `${success}: ${n}`).join(' | ')} | Shortest win | Doomed positions |`);
  out.push(`|---|---|${botNames.map(() => '---').join('|')}|---|---|`);
  for (const level of report.levels) {
    const e = level.exact;
    out.push(`| ${level.name} | ${level.difficulty} | ` +
      `${botNames.map((n) => pct(level.bots[n].successRate)).join(' | ')} | ` +
      `${e && e.shortestWin !== null ? e.shortestWin : '-'} | ` +
      `${e && e.deadEndShare !== null ? pct(e.deadEndShare) : '-'} |`);
  }
  out.push('', (report.kind === 'endless'
    ? `Difficulty is 100 minus the average share of the ${report.secondsPerStep ? `${num(report.maxSteps * report.secondsPerStep)} s` : `${report.maxSteps} steps`} limit the bots last. `
    : 'Difficulty is 100 minus the average success rate of the bots. ') +
    '"Doomed positions" is the share of positions where the level can no longer be won although the game goes on.', '');

  for (const level of report.levels) {
    out.push(`## ${level.name}`, '');
    out.push(`| Bot | ${success} | 95% range | ${report.secondsPerStep ? 'Median seconds' : 'Median steps'} | Median steps to loss | Mean progress | Median score |`);
    out.push('|---|---|---|---|---|---|---|');
    for (const [name, b] of Object.entries(level.bots)) {
      out.push(`| ${name} | ${pct(b.successRate)} | ${pct(b.successLow)}-${pct(b.successHigh)} | ${num(report.secondsPerStep ? b.medianSeconds : b.medianSteps)} | ` +
        `${num(b.medianStepsToLoss)} | ${pct(b.meanProgress)} | ${num(b.medianScore)} |`);
    }
    const causes = {};
    for (const b of Object.values(level.bots)) {
      for (const [c, n] of Object.entries(b.causes)) causes[c] = (causes[c] || 0) + n;
    }
    const top = Object.entries(causes).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (top.length) out.push('', `Losses by cause: ${top.map(([c, n]) => `${c} (${n})`).join(', ')}.`);
    if (level.hazard) {
      const names = Object.keys(level.hazard);
      out.push('', 'Share of the runs still alive that end in each time slice:', '');
      out.push(`| Time slice | ${names.join(' | ')} |`, `|---|${names.map(() => '---').join('|')}|`);
      level.hazard[names[0]].forEach((s, k) => {
        const label = report.secondsPerStep
          ? `${num(s.fromStep * report.secondsPerStep)}-${num(s.toStep * report.secondsPerStep)} s`
          : `steps ${s.fromStep}-${s.toStep}`;
        out.push(`| ${label} | ${names.map((n) => {
          const c = level.hazard[n][k];
          return c.alive ? `${pct(c.hazard)} (${c.deaths} of ${c.alive})` : '-';
        }).join(' | ')} |`);
      });
    }
    if (level.exact) {
      const e = level.exact;
      out.push('', e.complete
        ? `Exact check: ${e.states} positions, ${e.solvable ? `winnable in ${e.shortestWin} moves` : 'NOT winnable'}, ` +
          `${e.deadEnds} doomed positions (${pct(e.deadEndShare)}), ${pct(e.trapShare)} of moves from a good position are traps.`
        : `Exact check stopped at ${e.states} positions${e.solvable ? `; a win in ${e.shortestWin} moves exists` : '; no win found yet'}.`);
    }
    out.push('');
  }
  return out.join('\n');
}
