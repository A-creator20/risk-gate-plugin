// Runs the pre-PR checks in sequence and prints one combined report:
// risk score, both guardrails, and suggested reviewers.
const { execSync } = require('child_process');
const path = require('path');

const CHECKS = [
  { title: 'Risk score', file: 'change-risk-score.js', gating: false },
  { title: 'Guardrail: console.error usage', file: 'guardrail-console-error.js', gating: true },
  { title: 'Guardrail: generated files', file: 'guardrail-generated-files.js', gating: true },
  { title: 'Suggested reviewers', file: 'suggest-reviewer.js', gating: false },
];

function runCheck(file, ref) {
  const scriptPath = path.join(__dirname, file);

  try {
    const output = execSync(`node ${scriptPath} ${ref}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { passed: true, output };
  } catch (error) {
    return { passed: false, output: [error.stdout, error.stderr].filter(Boolean).join('\n') };
  }
}

const HELP_TEXT = `Usage: node scripts/risk-gate.js [ref]

Runs, in sequence, and prints one combined report for:
  - change-risk-score.js       (informational)
  - guardrail-console-error.js (gating)
  - guardrail-generated-files.js (gating)
  - suggest-reviewer.js        (informational)

Exits non-zero if either guardrail fails.

Arguments:
  ref   Branch or commit to diff against (default: HEAD, i.e. uncommitted changes)
`;

if (require.main === module) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  const ref = process.argv[2] || 'HEAD';

  if (!/^[\w./-]+$/.test(ref)) {
    console.error(`Invalid ref: ${ref}`);
    process.exit(1);
  }

  const results = CHECKS.map((check) => ({ ...check, ...runCheck(check.file, ref) }));

  results.forEach(({ title, output, passed, gating }) => {
    console.log(`\n=== ${title} ${gating ? (passed ? '[PASS]' : '[FAIL]') : ''} ===`);
    console.log(output.trim());
  });

  const failedGatingChecks = results.filter((result) => result.gating && !result.passed);

  console.log('\n=== Summary ===');
  results.forEach(({ title, gating, passed }) => {
    if (gating) {
      console.log(`${passed ? 'PASS' : 'FAIL'} - ${title}`);
    }
  });

  if (failedGatingChecks.length > 0) {
    console.log(`\n${failedGatingChecks.length} guardrail(s) failed.`);
    process.exit(1);
  }

  console.log('\nAll guardrails passed.');
}

module.exports = { runCheck, CHECKS };
