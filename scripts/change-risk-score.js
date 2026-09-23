// Scores the risk of a git diff (see computeRiskScore below).
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Default categories of file whose changes carry outsized blast radius and always
// push the score to HIGH, regardless of file/line count. Each is a set of patterns
// plus the label used when reporting why a file matched. These defaults are
// Maxsight-shaped; a consuming repo can override them via risk-gate.config.json
// (see loadSensitiveCategories/loadGeneratedFilePattern below) without editing this file.
const DEFAULT_HIGH_RISK_CATEGORIES = [
  {
    label: 'build/lint/CI config',
    patterns: [/module-federation\.config\.ts$/, /(^|\/)webpack-config\//, /eslint\.config\.mjs$/, /package\.json$/, /(^|\/)\.circleci\//],
  },
  {
    label: 'API contract',
    patterns: [
      /(^|\/)specs\/.*\.json$/,
      /(^|\/)libs\/shared-types\/src\/v5.*\/generated\.ts$/,
      /orval(\.unstable)?\.config\.ts$/,
      /(^|\/)libs\/data\//,
      /(^|\/)apps\/[^/]+\/.*\/api\//,
    ],
  },
  {
    label: 'shared/global state',
    patterns: [/(^|\/)libs\/util\/shared-query-client\//, /(^|\/)libs\/util\/shared-pusher-client\//],
  },
  {
    label: 'shared UI/layout',
    patterns: [/(^|\/)libs\/ui\/layout\//, /(^|\/)libs\/ui\/application-layout\//, /(^|\/)libs\/ui\/shared-providers\//],
  },
  {
    label: 'error handling infra',
    patterns: [/(^|\/)libs\/util\/error-handling\//],
  },
  {
    label: 'feature flag logic',
    patterns: [/(^|\/)libs\/util\/shared-harness-fme-client\//, /(^|\/)libs\/util\/hooks\/.*useFmeTreatment/],
  },
  {
    label: 'auth/permissions',
    patterns: [/(^|\/)libs\/data\/authz\//, /(^|\/)libs\/ui\/authz-hooks\//, /(^|\/)libs\/util\/reporting-permissions\//],
  },
];

// Generated files are never meant to be hand-edited (see CLAUDE.md) — any
// diff touching them is either a regen (should be reviewed for drift) or a
// manual edit (should not have happened), so it's always worth flagging.
const DEFAULT_GENERATED_FILE_PATTERN = /(^|\/)libs\/shared-types\/src\/v5.*\/generated\.ts$/;

/**
 * Optional per-repo overrides, read once at startup from risk-gate.config.json in the
 * caller's cwd. Absent or unparsable config silently falls back to the Maxsight defaults
 * above — this file must keep working standalone in this repo either way.
 */
function loadConfig() {
  const configPath = path.join(process.cwd(), 'risk-gate.config.json');
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
}

function loadSensitiveCategories(config) {
  if (!config?.sensitiveCategories) return DEFAULT_HIGH_RISK_CATEGORIES;
  return config.sensitiveCategories.map((category) => ({
    label: category.label,
    patterns: category.patterns.map((pattern) => new RegExp(pattern)),
  }));
}

function loadGeneratedFilePattern(config) {
  return config?.generatedFilePattern ? new RegExp(config.generatedFilePattern) : DEFAULT_GENERATED_FILE_PATTERN;
}

const config = loadConfig();
const HIGH_RISK_CATEGORIES = loadSensitiveCategories(config);
const GENERATED_FILE_PATTERN = loadGeneratedFilePattern(config);

function matchedCategories(file) {
  return HIGH_RISK_CATEGORIES.filter((category) => category.patterns.some((pattern) => pattern.test(file))).map((category) => category.label);
}

function isRisky(file) {
  return matchedCategories(file).length > 0;
}

function isApiChange(file) {
  return matchedCategories(file).includes('API contract');
}

function isGeneratedFile(file) {
  return GENERATED_FILE_PATTERN.test(file);
}

function getSensitiveFiles(changedFiles) {
  return changedFiles.filter(isRisky);
}

function getApiFiles(changedFiles) {
  return changedFiles.filter(isApiChange);
}

function getGeneratedFiles(changedFiles) {
  return changedFiles.filter(isGeneratedFile);
}

// Large deletions (e.g. a bulk removal or accidental overwrite) deserve the
// same scrutiny as a large change, even if the diff is "mostly gone lines".
const LARGE_DELETION_THRESHOLD = 200;

function isLargeDeletion(deletions) {
  return deletions > LARGE_DELETION_THRESHOLD;
}

// Signals that bump an otherwise-LOW score up to MEDIUM. Softer than the
// HIGH categories above — each is a plausible-but-not-certain risk, so they
// only matter when nothing else already pushed the score higher.
const MFE_DIR_PATTERN = /(^|\/)apps\/([^/]+)\//;
const TEST_FILE_PATTERN = /\.(test|spec|cy)\.[jt]sx?$/;
const NEW_CODE_FILE_PATTERN = /\.(tsx?|jsx?)$/;

function getTouchedMfes(changedFiles) {
  const mfes = new Set();
  changedFiles.forEach((file) => {
    const match = file.match(MFE_DIR_PATTERN);
    if (match) {
      mfes.add(match[2]);
    }
  });
  return [...mfes];
}

function isMultiMfeChange(changedFiles) {
  return getTouchedMfes(changedFiles).length > 1;
}

function isTestFile(file) {
  return TEST_FILE_PATTERN.test(file);
}

function getSourceFilesMissingTests(changedFiles) {
  const changedTestBaseNames = new Set(changedFiles.filter(isTestFile).map((file) => file.replace(TEST_FILE_PATTERN, '')));

  return changedFiles.filter((file) => NEW_CODE_FILE_PATTERN.test(file) && !isTestFile(file) && !changedTestBaseNames.has(file.replace(/\.[jt]sx?$/, '')));
}

function getNewFiles(ref) {
  return execSync(`git diff --name-status --diff-filter=A ${ref}`)
    .toString()
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t')[1]);
}

function isFeatureAddition(newFiles) {
  return newFiles.some((file) => NEW_CODE_FILE_PATTERN.test(file) && !isTestFile(file));
}

// Categories where, if EVERY changed file matches, the diff is inherently
// lower risk than its size suggests — no application logic changed. Checked
// in order; the first fully-matching category wins.
const STYLING_FILE_PATTERN = /\.(css|scss|less)$/i;
const STYLE_MODULE_PATTERN = /(theme|styles?)\.[jt]sx?$/i;
const TRANSLATION_FILE_PATTERN = /(^|\/)translations\/.*\.json$/;
const L10N_CONTENT_PATTERN = /(^|\/)libs\/l10n\/src\/translation\/content\/.*\.json$/;
const DOCS_FILE_PATTERN = /(^|\/)docs\//;
const MARKDOWN_FILE_PATTERN = /\.md$/i;

const LOW_RISK_ONLY_CATEGORIES = [
  { label: 'translation-only', test: (file) => TRANSLATION_FILE_PATTERN.test(file) || L10N_CONTENT_PATTERN.test(file) },
  { label: 'docs-only', test: (file) => DOCS_FILE_PATTERN.test(file) || MARKDOWN_FILE_PATTERN.test(file) },
  { label: 'test-only', test: (file) => isTestFile(file) },
  { label: 'styling-only', test: (file) => STYLING_FILE_PATTERN.test(file) || STYLE_MODULE_PATTERN.test(file) },
];

function isStylingOnly(changedFiles) {
  return changedFiles.length > 0 && changedFiles.every((file) => STYLING_FILE_PATTERN.test(file) || STYLE_MODULE_PATTERN.test(file));
}

function getLowRiskOnlyLabel(changedFiles) {
  if (changedFiles.length === 0) {
    return null;
  }

  const matched = LOW_RISK_ONLY_CATEGORIES.find((category) => changedFiles.every(category.test));
  return matched ? matched.label : null;
}

function getMediumRiskSignals({ changedFiles, newFiles }) {
  const signals = [];

  const touchedMfes = getTouchedMfes(changedFiles);
  if (touchedMfes.length > 1) {
    signals.push(`multiple MFEs touched: ${touchedMfes.join(', ')}`);
  }

  if (isFeatureAddition(newFiles)) {
    signals.push('new component/feature added');
  }

  const untestedFiles = getSourceFilesMissingTests(changedFiles);
  if (untestedFiles.length > 0) {
    signals.push(`source changed without matching test files: ${untestedFiles.join(', ')}`);
  }

  return signals;
}

const RISK_COLORS = {
  LOW: '\x1b[32m',
  MEDIUM: '\x1b[33m',
  HIGH: '\x1b[31m',
};

function colorizeRiskScore(riskScore) {
  return `${RISK_COLORS[riskScore]}${riskScore}\x1b[0m`;
}

function computeRiskScore({ fileCount, lineCount, sensitiveTouched, deletions = 0, lowRiskOnly = null, mediumSignals = [] }) {
  // Categorical HIGH signals (sensitive files, a large deletion) always win —
  // they're independent of size and a low-risk-only diff can't trigger them
  // anyway, since none of the HIGH categories overlap with translations,
  // docs, tests, or styling.
  if (sensitiveTouched || isLargeDeletion(deletions)) {
    return 'HIGH';
  }

  // A diff that's entirely translations/docs/tests/styling caps at LOW even
  // if the size thresholds below would otherwise call it MEDIUM/HIGH — no
  // application logic changed, so it's lower risk than its size suggests.
  if (lowRiskOnly) {
    return 'LOW';
  }

  if (lineCount > 300 || fileCount > 10) {
    return 'HIGH';
  }

  if ((lineCount >= 50 && lineCount <= 300) || mediumSignals.length > 0) {
    return 'MEDIUM';
  }

  return 'LOW';
}

function getRiskReason({ fileCount, lineCount, sensitiveFiles, deletions = 0, lowRiskOnly = null, mediumSignals = [] }) {
  if (sensitiveFiles.length > 0) {
    // Group by category so the reason reads like "package.json (build/lint/CI config)"
    // instead of a flat, uncategorized file list.
    const withCategories = sensitiveFiles.map((file) => `${file} (${matchedCategories(file).join(', ')})`);
    return `Reason: ${withCategories.join('; ')}`;
  }

  if (isLargeDeletion(deletions)) {
    return `Reason: large deletion — ${deletions} lines removed`;
  }

  if (lowRiskOnly) {
    return `Reason: ${lowRiskOnly} change, no application logic touched`;
  }

  if (lineCount > 300 || fileCount > 10) {
    return `Reason: ${lineCount} lines changed across ${fileCount} files`;
  }

  if (lineCount >= 50) {
    return `Reason: ${lineCount} lines changed across ${fileCount} files`;
  }

  if (mediumSignals.length > 0) {
    return `Reason: ${mediumSignals.join('; ')}`;
  }

  return `Reason: only ${lineCount} lines changed across ${fileCount} files`;
}

const HELP_TEXT = `Usage: yarn risk-score [ref]

Scores the risk of the current changes by looking at how many files and
lines changed, and always scores HIGH if any of the following are touched
or true:
  - build/lint/CI config (module-federation.config.ts, webpack-config/,
    eslint.config.mjs, package.json, .circleci/)
  - API contract files (specs/*.json, orval config, generated v5 types,
    libs/data/, an MFE's api/ folder)
  - shared/global state (shared-query-client, shared-pusher-client)
  - shared UI/layout libs (libs/ui/layout, application-layout, shared-providers)
  - error handling infra (libs/util/error-handling)
  - feature flag logic (shared-harness-fme-client, useFmeTreatment)
  - auth/permissions (libs/data/authz, authz-hooks, reporting-permissions)
  - a large deletion (more than ${LARGE_DELETION_THRESHOLD} lines removed)

Scores MEDIUM instead of LOW if none of the above apply but any of these are
true: multiple MFEs touched in one diff, a new component/feature file was
added, or a source file changed with no matching test file changed.

A diff where every changed file falls into a single low-risk category is
capped at LOW regardless of size: translation files (translations/*.json,
common-*.json), docs (docs/, *.md), tests only, or styling only
(*.css/*.scss/*.less, or a theme/styles module).

Arguments:
  ref   Branch or commit to diff against (default: HEAD, i.e. uncommitted changes)

Examples:
  yarn risk-score           Score uncommitted changes
  yarn risk-score master    Score the diff against master
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
    changedFiles.forEach((file) => console.log(isRisky(file) ? `${file} (${matchedCategories(file).join(', ')})` : file));

    const shortstat = execSync(`git diff --shortstat ${ref}`).toString().trim();
    console.log(shortstat);

    const sensitiveFiles = getSensitiveFiles(changedFiles);
    if (sensitiveFiles.length > 0) {
      console.log('Sensitive files touched:');
      sensitiveFiles.forEach((file) => console.log(`  ${file} (${matchedCategories(file).join(', ')})`));
    }

    const generatedFiles = getGeneratedFiles(changedFiles);
    if (generatedFiles.length > 0) {
      console.log('Generated files touched (should not be hand-edited):');
      generatedFiles.forEach((file) => console.log(`  ${file}`));
    }

    const insertions = Number((shortstat.match(/(\d+) insertion/) || [])[1] || 0);
    const deletions = Number((shortstat.match(/(\d+) deletion/) || [])[1] || 0);
    const lineCount = insertions + deletions;

    const newFiles = getNewFiles(ref);
    const lowRiskOnly = getLowRiskOnlyLabel(changedFiles);
    const mediumSignals = getMediumRiskSignals({ changedFiles, newFiles });

    const scoreInput = {
      fileCount: changedFiles.length,
      lineCount,
      sensitiveTouched: sensitiveFiles.length > 0,
      deletions,
      lowRiskOnly,
      mediumSignals,
    };
    const riskScore = computeRiskScore(scoreInput);

    console.log(`\nFiles changed: ${changedFiles.length}`);
    console.log(`Lines changed: ${lineCount} (+${insertions} / -${deletions})`);
    console.log(sensitiveFiles.length > 0 ? `Sensitive files: ${sensitiveFiles.join(', ')}` : 'Sensitive files: none');
    console.log(isLargeDeletion(deletions) ? `Large deletion: yes (${deletions} lines removed)` : 'Large deletion: no');
    console.log(lowRiskOnly ? `Low-risk-only: yes (${lowRiskOnly})` : 'Low-risk-only: no');
    console.log(mediumSignals.length > 0 ? `Medium-risk signals: ${mediumSignals.join('; ')}` : 'Medium-risk signals: none');
    console.log(`Risk score: ${colorizeRiskScore(riskScore)}`);
    console.log(getRiskReason({ ...scoreInput, sensitiveFiles }));
  }
}

module.exports = {
  computeRiskScore,
  getRiskReason,
  isRisky,
  isApiChange,
  isGeneratedFile,
  isLargeDeletion,
  matchedCategories,
  getTouchedMfes,
  isMultiMfeChange,
  isTestFile,
  getSourceFilesMissingTests,
  isFeatureAddition,
  isStylingOnly,
  getLowRiskOnlyLabel,
  getMediumRiskSignals,
};
