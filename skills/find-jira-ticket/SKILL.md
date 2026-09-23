---
name: find-jira-ticket
description: Finds the Jira ticket linked to the current branch/diff (from branch name or recent commit messages) and looks up its team/component. Used by risk-gate on HIGH risk, but reusable standalone whenever you need "which ticket is this branch for, and who owns it".
allowed-tools: Bash(git branch --show-current) Bash(git log *) mcp__atlassian__getAccessibleAtlassianResources mcp__atlassian__getJiraIssue mcp__atlassian__searchJiraIssuesUsingJql
---

# Find Jira Ticket

Identify the Jira ticket a branch/diff belongs to, and report its owning team/component. Never
guess a ticket — an absent match is a valid, useful result.

## Process

1. **Find a ticket ID.** Repos following the `initials/JIRA-ID/what-is-this-about` branch
   convention carry it in the branch name; merge commits are supposed to carry one in the title
   too. Try, in order, until one matches `/[A-Z][A-Z0-9]+-\d+/`:
   - `git branch --show-current`
   - `git log <ref>..HEAD --format=%s` (pass the caller's `ref`, default `HEAD`'s upstream or
     `master` if none given)

   If nothing matches either source, **stop and report "no ticket found"** — do not guess one from
   context, file names, or prior conversation.

2. **Look up the ticket.** Use `mcp__atlassian__getJiraIssue` for the matched key, fields
   `["components", "project", "labels"]` at minimum. Some projects track owning team as a
   component, others via the project prefix itself (a codebase's tickets commonly span multiple
   prefixes, e.g. `UID`, `MB`, `MCS`, `M3PDS`, `MPD` — don't assume a single project). Note every
   component/team name found.

3. **Report the result** as: ticket key, where it was found (branch name vs. commit message),
   and the team/component(s), or explicitly "no ticket found in branch name or commits" if step 1
   came up empty.

## Notes

- Requires the Atlassian MCP server. If unavailable, say so plainly and stop — don't fall back to
  guessing.
- Read-only: never files, edits, links, transitions, or comments on the ticket.
