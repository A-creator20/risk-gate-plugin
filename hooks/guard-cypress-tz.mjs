#!/usr/bin/env node
/**
 * PreToolUse guard for Bash.
 *
 * CLAUDE.md: `TZ=UTC` is required for Cypress tests — mock data uses UTC timestamps
 * and assertions compare against fixed local-time strings. Without it, tests can fail
 * (or pass) purely because of the machine's local timezone, not because of a real bug.
 *
 * Blocks any integration-tests / open-cypress command that doesn't carry `TZ=UTC`
 * somewhere in the command line, and suggests the fix.
 *
 * Contract: exit 0 allows the command. Exit 2 blocks it and returns stderr to Claude.
 * Anything unexpected fails OPEN — a broken guard must never wedge a session.
 */

const CYPRESS_COMMAND_PATTERN = /\b(integration-tests|open-cypress)\b/;
const TZ_UTC_PATTERN = /\bTZ=UTC\b/;

function block(title, detail) {
  process.stderr.write(`BLOCKED — ${title}\n\n${detail}\n`);
  process.exit(2);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) process.exit(0);

  const event = JSON.parse(raw);
  const command = event.tool_input?.command;
  if (!command) process.exit(0);

  if (CYPRESS_COMMAND_PATTERN.test(command) && !TZ_UTC_PATTERN.test(command)) {
    block(
      'Cypress command missing TZ=UTC',
      [
        `  ${command}`,
        '',
        'CLAUDE.md: TZ=UTC is required for Cypress tests — mock data uses UTC timestamps and',
        'assertions compare against fixed local-time strings. Without it, tests can fail (or',
        'pass) purely because of the machine\'s local timezone, not a real bug.',
        '',
        'Do instead:',
        `  TZ=UTC ${command}`,
      ].join('\n'),
    );
  }

  process.exit(0);
}

main().catch(() => process.exit(0)); // fail open
