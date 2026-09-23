// Fails if a changed apps/** file uses raw console.error instead of
// sendError/sendContextualError from @maxsight/error-handling.
const { execSync } = require('child_process');
const fs = require('fs');

const SOURCE_FILE_PATTERN = /\.(tsx?|jsx?)$/;
const TEST_FILE_PATTERN = /\.(test|spec|cy)\.[jt]sx?$/;
const CONSOLE_ERROR_PATTERN = /console\.error\s*\(/;

function isCommentLine(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function findConsoleErrorUsages(file) {
  if (!fs.existsSync(file)) {
    return [];
  }

  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => CONSOLE_ERROR_PATTERN.test(line) && !isCommentLine(line));
}

const HELP_TEXT = `Usage: node scripts/guardrail-console-error.js [ref]

Fails if any changed file under apps/** uses raw console.error. MFE code must
call sendError / sendContextualError from @maxsight/error-handling instead,
so the host can forward it to Datadog with MFE context.

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

  const changedFiles = execSync(`git diff --name-only ${ref} -- apps`)
    .toString()
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter((file) => SOURCE_FILE_PATTERN.test(file) && !TEST_FILE_PATTERN.test(file));

  const violations = changedFiles.flatMap((file) => findConsoleErrorUsages(file).map((usage) => ({ file, ...usage })));

  if (violations.length === 0) {
    console.log('No raw console.error usage found in changed apps/** files.');
    process.exit(0);
  }

  console.error('Found raw console.error usage — use sendError/sendContextualError from @maxsight/error-handling instead:\n');
  violations.forEach(({ file, number, line }) => console.error(`  ${file}:${number}: ${line.trim()}`));
  process.exit(1);
}

module.exports = { findConsoleErrorUsages, isCommentLine };
