// Fails if the diff hand-edits a generated file. Per CLAUDE.md, files under
// libs/shared-types/src/v5*/**/generated.ts and specs/*.json are produced by
// `yarn generate:types` / a spec download and are never reviewed or hand-edited.
const { execSync } = require('child_process');

const GENERATED_PATTERNS = [/(^|\/)libs\/shared-types\/src\/v5.*\/generated\.ts$/, /(^|\/)specs\/.*\.json$/];

function isGeneratedFile(file) {
  return GENERATED_PATTERNS.some((pattern) => pattern.test(file));
}

const HELP_TEXT = `Usage: node scripts/guardrail-generated-files.js [ref]

Fails if the diff touches a generated file:
  - libs/shared-types/src/v5*/**/generated.ts (Orval output)
  - specs/*.json (downloaded OpenAPI spec)

These are regenerated via \`yarn generate:types\`, not hand-edited.

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
  const generatedFiles = changedFiles.filter(isGeneratedFile);

  if (generatedFiles.length === 0) {
    console.log('No generated files were touched.');
    process.exit(0);
  }

  console.error('Found changes to generated files — regenerate with `yarn generate:types` instead of hand-editing:\n');
  generatedFiles.forEach((file) => console.error(`  ${file}`));
  process.exit(1);
}

module.exports = { isGeneratedFile };
