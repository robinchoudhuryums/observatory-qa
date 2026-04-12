Do not make any changes to any files yet. This session verifies that
command files reference the current Cycle Workflow Config in CLAUDE.md.

Read CLAUDE.md under "## Cycle Workflow Config" and extract:
1. The subsystem list (names and file lists)
2. The health dimensions
3. The invariant library (all INV-XX entries)
4. The policy configuration

Then read each command file in .claude/commands/ and check:

For each command that references subsystem names:
- Does the available subsystems list match CLAUDE.md?
- Are file lists in the command consistent with CLAUDE.md, or does
  the command correctly point to CLAUDE.md instead of inlining files?

For each command that references health dimensions:
- Does the dimension list match CLAUDE.md?

For each command that references invariants:
- Does it point to the Invariant Library in CLAUDE.md?

Produce a specific list of any drift found:
- [Command file] — [what's inconsistent] — [suggested fix]

If no drift found, state "All commands reference current Cycle Workflow Config."
