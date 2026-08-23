# TRIO.md — How this project is run

Three parties collaborate on ArkHelper. This file defines the protocol.
Keep it under one page. If reality diverges from this file, fix the file.

## Roles
- OWNER (the human): sets priorities, makes all judgment calls, is the
  only party who commits. Nothing ships without Owner acceptance.
- ARCHITECT (Claude, chat): research on external systems/APIs/licensing,
  competitive scans, architecture decisions, writes task briefs, reviews
  completion reports. Communicates only through Owner.
- BUILDER (Cursor agent): implements exactly one brief per session,
  in a fresh session, honoring .cursor/rules/ at all times.

## The loop
1. Architect writes a self-contained brief (assumes no chat context).
2. Owner pastes it into a fresh Builder session.
3. Builder reads PROJECT_STATUS.md + ARCHITECTURE.md, then implements.
4. Builder produces a COMPLETION REPORT (format below). Owner relays it
   to Architect. Architect verdicts: accept / fix-list.
5. Owner commits only after acceptance. PROJECT_STATUS.md updated
   (last-updated date, test count, in-flight line) in the same commit.

## Builder completion report — required format, nothing else
- TESTS: <total passed> (<previous> existing + <n> new)
- BUILT: 3-6 bullet summary of what exists now, by route/module
- DECISIONS: anything done that the brief did not specify, one line each
- BLOCKED/UNCERTAIN: anything skipped or assumed, one line each
- COMMIT: a ready-to-use conventional commit message for this brief —
  one imperative subject line under 72 chars, then a short body
  (wrapped, plain text) naming what changed and the new test count.
- STATUS: PROJECT_STATUS.md updated — <N> tests, <YYYY-MM-DD>
  Fill this line only after PROJECT_STATUS.md is actually updated.
  A report missing this line is incomplete and will be rejected by
  the Architect's verdict.
Keep the whole report under ~250 words. No code dumps unless asked.

## Hard rules for Builder
- One brief per session. Nothing outside the brief's scope.
- A brief's NON-GOALS list is binding. When a brief conflicts with
  .cursor/rules/, stop and report instead of choosing.
- Never mark PROJECT_STATUS.md items complete before tests pass.

## Hard rules for Architect
- Verify external systems live before speccing against them.
- Briefs must be self-contained and include NON-GOALS and DONE MEANS.
