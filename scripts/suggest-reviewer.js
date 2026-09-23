// Suggests reviewers for the changed files: matches them against
// .github/CODEOWNERS for team ownership, and separately reports the
// changed files' top git contributors by commit count, so a specific
// person is always suggested alongside (or instead of) a team handle.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const CODEOWNERS_PATH = path.join(REPO_ROOT, '.github', 'CODEOWNERS');

function existsAsDirectory(relativePath) {
  try {
    return fs.statSync(path.join(REPO_ROOT, relativePath)).isDirectory();
  } catch {
    return false;
  }
}

// CODEOWNERS uses gitignore-style patterns: a leading `/` (or any `/` other
// than a trailing one) anchors the pattern to the repo root; otherwise it
// matches the basename anywhere. `**` matches any number of path segments,
// `*` matches within a single segment. A pattern with no trailing slash that
// happens to be a real directory (e.g. `/kubernetes`) still owns everything
// under it, same as a trailing-slash pattern would. Later rules win over
// earlier ones, same as gitignore.
function patternToRegex(pattern) {
  let body = pattern;
  const anchored = body.startsWith('/') || body.slice(0, -1).includes('/');

  if (body.startsWith('/')) {
    body = body.slice(1);
  }

  let isDir = body.endsWith('/');
  if (isDir) {
    body = body.slice(0, -1);
  } else if (!/[*?]/.test(body) && existsAsDirectory(body)) {
    isDir = true;
  }

  const segmentToRegex = (segment) => {
    if (segment === '**') {
      return '.*';
    }
    return segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
  };

  let regexBody = body.split('/').map(segmentToRegex).join('/');

  if (isDir) {
    regexBody += '(/.*)?';
  }

  return anchored ? new RegExp(`^${regexBody}$`) : new RegExp(`(^|/)${regexBody}$`);
}

function parseCodeowners(content) {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const [pattern, ...owners] = line.split(/\s+/);
      return { pattern, regex: patternToRegex(pattern), owners };
    });
}

function getOwnersFor(file, rules) {
  // Last matching rule wins, same as gitignore/CODEOWNERS semantics.
  const matched = [...rules].reverse().find((rule) => rule.regex.test(file));
  return matched ? matched.owners : null;
}

function matchCodeowners(changedFiles) {
  if (!fs.existsSync(CODEOWNERS_PATH)) {
    return changedFiles.map((file) => ({ file, owners: null }));
  }

  const rules = parseCodeowners(fs.readFileSync(CODEOWNERS_PATH, 'utf8'));
  return changedFiles.map((file) => ({ file, owners: getOwnersFor(file, rules) }));
}

function getTopContributors(files, excludeAuthor, limit = 3) {
  if (files.length === 0) {
    return [];
  }

  const escapedFiles = files.map((file) => `"${file}"`).join(' ');
  const authors = execSync(`git log --format=%an -- ${escapedFiles}`).toString().trim().split('\n').filter(Boolean);

  const counts = new Map();
  authors.forEach((author) => {
    if (author === excludeAuthor) {
      return;
    }
    counts.set(author, (counts.get(author) || 0) + 1);
  });

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([author]) => author);
}

const HELP_TEXT = `Usage: node scripts/suggest-reviewer.js [ref]

Suggests reviewers for the changed files:
  - Matches each file against .github/CODEOWNERS (last matching rule wins) for
    team-level ownership.
  - Separately reports the changed files' top individual contributors (by
    commit count via \`git log --format=%an\`), excluding the current git
    user, so a specific person is suggested alongside any team match.

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

  const changedFiles = execSync(`git diff --name-only ${ref}`).toString().trim().split('\n').filter(Boolean);

  if (changedFiles.length === 0) {
    console.log('No changes found');
  } else {
    const matches = matchCodeowners(changedFiles);
    const currentAuthor = execSync('git config user.name').toString().trim();
    const topContributors = getTopContributors(changedFiles, currentAuthor);

    matches.forEach(({ file, owners }) => console.log(owners ? `${file} -> ${owners.join(', ')}` : `${file} -> (no CODEOWNERS match)`));

    const codeownersOwners = [...new Set(matches.flatMap((match) => match.owners || []))];

    console.log('\nSuggested reviewers:');
    if (codeownersOwners.length > 0) {
      console.log(`  Team (CODEOWNERS): ${codeownersOwners.join(', ')}`);
    }
    if (topContributors.length > 0) {
      console.log(`  Individual (most commits on these files): ${topContributors.join(', ')}`);
    }
    if (codeownersOwners.length === 0 && topContributors.length === 0) {
      console.log('  No suggestions found.');
    }
  }
}

module.exports = { patternToRegex, parseCodeowners, getOwnersFor, matchCodeowners, getTopContributors };
