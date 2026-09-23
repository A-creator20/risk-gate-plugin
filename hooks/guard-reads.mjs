#!/usr/bin/env node
/**
 * PreToolUse guard for Read.
 *
 * Blocks Claude from reading files that could contain secrets or credentials, so
 * their contents never enter the conversation (and can't later be echoed, logged,
 * or sent anywhere). This is narrower than guard-writes.mjs's protected-path list:
 * specs/*.json and generated.ts are fine to *read* (only hand-editing them is the
 * problem), so they're deliberately not repeated here.
 *
 * Contract: exit 0 allows the read. Exit 2 blocks it and returns stderr to Claude.
 * Anything unexpected fails OPEN — a broken guard must never wedge a session.
 */

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

const PROTECTED_READ_PATHS = [
  { re: /(^|\/)\.env(\.|$)/, why: 'environment file — may hold credentials' },
  { re: /(^|\/)\.npmrc$/, why: 'registry auth config' },
  { re: /(^|\/)\.yarnrc\.yml$/, why: 'carries the ARTIFACTORY_TOKEN reference' },
  { re: /\.(pem|p12|pfx|key|keystore)$/, why: 'private key material' },
  { re: /(^|\/)(id_rsa|id_ed25519)(\.|$)/, why: 'SSH private key' },
  { re: /credentials?(\.|$)/i, why: 'credential file' },
];

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) process.exit(0);

  const event = JSON.parse(raw);
  const filePath = event.tool_input?.file_path;
  if (!filePath) process.exit(0);

  const rel = toRelative(filePath, event.cwd);
  const hit = PROTECTED_READ_PATHS.find((entry) => entry.re.test(rel));

  if (hit) {
    block(
      `protected file (${hit.why})`,
      [`  ${rel}`, '', 'This file may hold secrets — read it yourself if you need its contents, not through an agent.'].join('\n'),
    );
  }

  process.exit(0);
}

main().catch(() => process.exit(0)); // fail open
