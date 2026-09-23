---
name: risk-gate
description: Use before opening a PR, or when asked to run pre-PR checks / risk-score a diff. Runs the bundled risk-gate script (risk score, console.error and generated-files guardrails, reviewer suggestions). If the risk score comes back HIGH, additionally invokes the find-jira-ticket and find-ownership-doc skills to enrich the reviewer suggestion with who actually owns the affected area.
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/risk-gate.js*) Skill(find-jira-ticket) Skill(find-ownership-doc)
---

# RiskGate

Run this plugin's combined pre-PR report and, only when the risk score is HIGH, enrich the
reviewer suggestion with who actually owns the affected area — beyond what CODEOWNERS/git history
alone can tell you.

## Process

1. **Run the check.**

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/risk-gate.js
   ```

   Pass a ref as the first argument (e.g. `master`) if the user named one. The script reads an
   optional `risk-gate.config.json` from the current repo's root for sensitive-path overrides (see
   `risk-gate.config.example.json` in this plugin) — if the consuming repo hasn't added one, it
   falls back to the Maxsight defaults baked into the script.

2. **Report the combined output as a markdown table**, not prose — one row per fact, so it scans at
   a glance:

   | Field | Value |
   | --- | --- |
   | Risk score | 🔴 HIGH / 🟡 MEDIUM / 🟢 LOW |
   | Reason | (from the script output) |
   | Guardrail: console.error | ✅ PASS / ❌ FAIL (+ files, if failed) |
   | Guardrail: generated files | ✅ PASS / ❌ FAIL (+ files, if failed) |
   | Reviewer — team (CODEOWNERS) | (value or "none") |
   | Reviewer — individual (top contributors) | (value or "none") |

   Keep the guardrail failure detail (which files, why) below the table if either failed — a table
   cell should stay short.

3. **If either guardrail failed, stop here** and surface that first — a HIGH risk score doesn't
   matter if the PR can't pass its guardrails yet.

4. **If the risk score is HIGH, gather ownership context** before finalizing the reviewer
   suggestion — invoke these two skills in order:

   a. **`find-jira-ticket`** — finds the linked Jira ticket (from the branch name or recent commits)
      and looks up its team/component. Pass it the `ref` you used above. If it reports no ticket
      found, skip straight to step 5 — don't guess one yourself.

   b. **`find-ownership-doc`** — only if step 4a found a ticket or you otherwise know the affected
      area (e.g. the MFE/lib directory from the risk score's file list) — searches Confluence for a
      module-ownership doc and reports the owning team, page title, and link.

   Both skills only read Jira/Confluence; report whatever they return (including "not found") rather
   than omitting the step silently — an absent finding is still useful signal.

5. **Present the final reviewer suggestion as a second markdown table**, adding a row per source
   found:

   | Source | Suggested owner |
   | --- | --- |
   | CODEOWNERS | (team handle, or "no match") |
   | Git history (top contributors) | (names, or "none") |
   | Jira ticket component (HIGH only) | (team/component, or "not found") |
   | Confluence ownership doc (HIGH only) | (team + page title/link, or "not found") |

   Omit the last two rows entirely when the risk score isn't HIGH. Below the table, call out plainly
   when sources agree vs. disagree (e.g. CODEOWNERS says one team, the Jira component says another) —
   that mismatch itself is useful information for the author to reconcile before requesting review.

## Notes

- Step 4 requires the Atlassian MCP server. If either sub-skill reports it's unavailable, say so and
  present the baseline reviewer suggestion only — don't block on it.
- Don't invoke the sub-skills when the risk score is MEDIUM or LOW — they cost extra tool calls for a
  case where CODEOWNERS/git history is already sufficient.
- This skill (and its sub-skills) only reads Jira/Confluence; it never files, edits, links, or
  comments on either.
