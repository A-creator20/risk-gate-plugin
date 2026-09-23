# RiskGate

A pre-PR workflow plugin: scores a diff's risk, runs guardrails, and suggests a reviewer.

## What's included

- **Skill `risk-gate`** — the main orchestrator. Run `/risk-gate` before opening a PR.
- **Skill `find-jira-ticket`** — locates the branch's Jira ticket and its owning team/component.
  Used automatically by `risk-gate` on HIGH risk; also usable standalone.
- **Skill `find-ownership-doc`** — searches Confluence for module-ownership docs. Same deal.
- **`scripts/`** — the deterministic Node checks: risk scoring, two guardrails
  (console.error usage, hand-edited generated files), and reviewer suggestion
  (CODEOWNERS + git history top contributors).
- **`hooks/`** — three `PreToolUse` guards, wired via `hooks/hooks.json`:
  - `guard-writes.mjs` — blocks adding keys to non-English translation files, and blocks
    hand-editing secrets/credentials/generated artefacts.
  - `guard-reads.mjs` — blocks Claude from *reading* files that may hold secrets (`.env*`,
    `.npmrc`, private keys, etc.).
  - `guard-cypress-tz.mjs` — blocks Cypress commands missing `TZ=UTC`.

## Making it work in a repo that isn't Maxsight

`scripts/change-risk-score.js` ships with Maxsight-specific defaults (sensitive file categories,
generated-file pattern) baked in, so it works standalone here with zero setup. To override them for
a different repo, copy `risk-gate.config.example.json` to `risk-gate.config.json` at that repo's
root and edit the patterns.

`hooks/guard-writes.mjs`'s protected-path list (translations, generated files, secrets) is also
Maxsight-shaped today — edit it directly if you adapt this plugin elsewhere. Making it
config-driven too is a reasonable next step, not yet done.

## Install

Point your Claude Code plugin config at this folder (or a git repo built from it once published).
Once installed, `/risk-gate`, `/find-jira-ticket`, and `/find-ownership-doc` become available, and
the three hooks activate automatically — no separate setup step.
