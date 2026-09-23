#!/usr/bin/env node
/**
 * PreToolUse guard for Write / Edit / MultiEdit / NotebookEdit.
 *
 * Enforces the repository ground rules that are *deterministic* — decidable from the
 * path and the incoming text alone, with no model judgement. Rules that need judgement
 * belong in a skill; rules decidable from one file's AST belong in ESLint. This file is
 * only for the middle: rules CLAUDE.md already states but nothing enforced.
 *
 * Guards:
 *   A. Non-English translation files are the Content Team's. Deletions are allowed
 *      (CLAUDE.md requires removing a key from all six locales), additions are not.
 *   B. Secrets, credentials and generated artefacts are not hand-edited.
 *
 * Contract: exit 0 allows the write. Exit 2 blocks it and returns stderr to Claude.
 * Anything unexpected fails OPEN — a broken guard must never wedge a session.
 */

const NON_EN_LOCALES = ['de', 'es', 'fr', 'it', 'ja'];

/** Read the whole of stdin. Returns '' if nothing is piped. */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function block(title, detail) {
  process.stderr.write(`BLOCKED — ${title}\n\n${detail}\n`);
  process.exit(2);
}

/** Project-relative, forward-slashed path. */
function toRelative(filePath, cwd) {
  const normalised = filePath.replace(/\\/g, '/');
  const root = (process.env.CLAUDE_PROJECT_DIR || cwd || process.cwd()).replace(/\\/g, '/');
  return normalised.startsWith(root) ? normalised.slice(root.length).replace(/^\/+/, '') : normalised;
}

/**
 * Every JSON object key named anywhere in a blob of text. Deliberately lexical rather
 * than a real parse: an Edit gives us a fragment, which is rarely valid JSON on its own.
 */
function keysIn(text) {
  return new Set([...String(text ?? '').matchAll(/"((?:[^"\\]|\\.)+)"\s*:/g)].map((m) => m[1]));
}

// ---------------------------------------------------------------------------
// Guard A — non-English translation files
// ---------------------------------------------------------------------------

function localeOf(rel) {
  const mfe = rel.match(/^apps\/[^/]+\/src\/translations\/([a-z]{2})\.json$/);
  if (mfe) return { locale: mfe[1], kind: 'MFE' };

  const common = rel.match(/^libs\/l10n\/src\/translation\/content\/common-([a-z]{2})\.json$/);
  if (common) return { locale: common[1], kind: 'common' };

  return null;
}

function guardTranslations(rel, added, removed) {
  const hit = localeOf(rel);
  if (!hit || !NON_EN_LOCALES.includes(hit.locale)) return;

  // A pure deletion or reordering introduces no key the text did not already carry.
  // CLAUDE.md requires key removal to touch all six locales, so this must stay possible.
  const introduced = [...keysIn(added)].filter((key) => !keysIn(removed).has(key));
  if (introduced.length === 0) return;

  block(
    `${hit.kind} translation file for "${hit.locale}" is owned by the Content Team`,
    [
      `  ${rel}`,
      '',
      `Keys this write would add: ${introduced.slice(0, 5).join(', ')}${introduced.length > 5 ? ` (+${introduced.length - 5} more)` : ''}`,
      '',
      'CLAUDE.md: only en.json / common-en.json are authored by developers. The other',
      'five locales arrive via the Content Team\'s Lokalise PR into this feature branch.',
      '',
      'Do instead:',
      `  - author the key in ${hit.kind === 'common' ? 'common-en.json' : 'en.json'} only`,
      '  - leave translation_check red — that red is the signal the work is not shippable,',
      '    not a check to satisfy. Never fill these with English, placeholders or MT.',
      '',
      'Deleting a key IS allowed here: removals must land in all six locales.',
    ].join('\n'),
  );
}

// ---------------------------------------------------------------------------
// Guard B — secrets, credentials, generated artefacts
// ---------------------------------------------------------------------------

const PROTECTED_PATHS = [
  { re: /(^|\/)\.env(\.|$)/, why: 'environment file — may hold credentials' },
  { re: /(^|\/)\.npmrc$/, why: 'registry auth config' },
  { re: /(^|\/)\.yarnrc\.yml$/, why: 'carries the ARTIFACTORY_TOKEN reference' },
  { re: /\.(pem|p12|pfx|key|keystore)$/, why: 'private key material' },
  { re: /(^|\/)(id_rsa|id_ed25519)(\.|$)/, why: 'SSH private key' },
  { re: /credentials?(\.|$)/i, why: 'credential file' },
  { re: /^specs\/.*\.json$/, why: 'downloaded OpenAPI spec — CLAUDE.md: not reviewed or hand-edited' },
  { re: /^libs\/shared-types\/src\/v5.*\/generated\.ts$/, why: 'Orval output — regenerate with `yarn generate:types`' },
];

/**
 * High-confidence secret assignments only. A named-but-unset variable (as in CLAUDE.md
 * or a README) must not trip this, so a real value is required.
 */
const SECRET_PATTERNS = [
  { re: /\b(ARTIFACTORY_TOKEN|NPM_TOKEN|GITHUB_TOKEN|AWS_SECRET_ACCESS_KEY|DATADOG_API_KEY)\s*[:=]\s*['"]?[^\s'"<${]{8,}/, label: 'token assignment' },
  { re: /\bghp_[A-Za-z0-9]{20,}/, label: 'GitHub personal access token' },
  { re: /\bAKIA[0-9A-Z]{16}\b/, label: 'AWS access key id' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'private key block' },
];

function guardSensitive(rel, added) {
  const hit = PROTECTED_PATHS.find((entry) => entry.re.test(rel));
  if (hit) {
    block(`protected file (${hit.why})`, [`  ${rel}`, '', 'If this genuinely needs to change, edit it yourself — not through an agent.'].join('\n'));
  }

  // Prose legitimately names these variables; only scan files that would execute or ship.
  if (/\.(md|mdx|txt)$/.test(rel)) return;

  const secret = SECRET_PATTERNS.find((entry) => entry.re.test(added));
  if (secret) {
    block(
      `possible ${secret.label} in the content being written`,
      [`  ${rel}`, '', 'Secrets belong in the environment, never in a tracked file.', 'If this is a placeholder, make it obviously so (<TOKEN>, $TOKEN, your-token-here).'].join('\n'),
    );
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) process.exit(0);

  const event = JSON.parse(raw);
  const input = event.tool_input ?? {};
  const filePath = input.file_path ?? input.notebook_path;
  if (!filePath) process.exit(0);

  const rel = toRelative(filePath, event.cwd);

  // `added` is everything this call would introduce; `removed` is what it replaces.
  // Both tool shapes collapse into that pair so every guard sees the same thing.
  const edits = Array.isArray(input.edits) ? input.edits : [];
  const added = [input.content, input.new_string, input.new_source, ...edits.map((e) => e?.new_string)].filter(Boolean).join('\n');
  const removed = [input.old_string, ...edits.map((e) => e?.old_string)].filter(Boolean).join('\n');

  guardSensitive(rel, added);
  guardTranslations(rel, added, removed);

  process.exit(0);
}

main().catch(() => process.exit(0)); // fail open
