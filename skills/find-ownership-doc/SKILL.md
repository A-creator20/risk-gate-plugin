---
name: find-ownership-doc
description: Searches Confluence for a module/area's ownership documentation and reports the named owning team, page title, and link. Used by risk-gate on HIGH risk, but reusable standalone whenever you need "who actually owns this part of the codebase, per our docs".
allowed-tools: mcp__atlassian__search mcp__atlassian__searchConfluenceUsingCql mcp__atlassian__getConfluencePage
---

# Find Ownership Doc

Find documented ownership for a codebase area (an MFE, a lib, a module) and report who Confluence
says owns it. An absent doc is a valid, useful result — never guess an owner.

## Process

1. **Identify the area to search for.** The caller should pass you the affected directory/MFE name
   (e.g. from a diff's changed-file list). If they didn't, ask rather than guessing from the ticket
   title alone.

2. **Search Confluence.** Try `mcp__atlassian__search` (Rovo) first, with a query combining the
   area name and "ownership" / "owner" / "team". If that returns nothing, fall back to
   `mcp__atlassian__searchConfluenceUsingCql` with `text ~ "<area>" AND text ~ "ownership"` — use
   `text ~`, never `content` (CQL field, not free text).

3. **Fetch and confirm.** Pull the top matching page with `mcp__atlassian__getConfluencePage` and
   read enough of it to confirm it actually names an owning team for this area (a page merely
   mentioning the area in passing doesn't count).

4. **Report the result**: owning team name, page title, and a link/ID so the finding is checkable —
   or explicitly "no ownership doc found for `<area>`" if nothing confirmed an owner.

## Notes

- Requires the Atlassian MCP server. If unavailable, say so plainly and stop.
- Read-only: never edits, comments on, or creates a Confluence page.
