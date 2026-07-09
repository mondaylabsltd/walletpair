# WalletPair — Project Takeover Documentation

Living documentation for maintaining, operating, and shipping WalletPair. Written during the 2026-07-09 takeover audit (baseline commit `8fafb89`).

| Doc | Purpose |
|-----|---------|
| [01-system-overview.md](01-system-overview.md) | Goals, architecture, modules, tech stack, key data flows |
| [02-local-development.md](02-local-development.md) | From-zero setup, env vars, commands per package |
| [03-core-flows.md](03-core-flows.md) | Core user flows, code entry points, key business rules |
| [04-production-readiness.md](04-production-readiness.md) | Audit results, issue severities, what was fixed, residual risk |
| [05-deployment-runbook.md](05-deployment-runbook.md) | Pre-deploy checks, release steps, migration, smoke, rollback |
| [06-operations-runbook.md](06-operations-runbook.md) | Logs, metrics, alerts, common failures, triage |
| [07-maintenance-guide.md](07-maintenance-guide.md) | How to safely change core modules, test strategy, high-risk zones |
| [08-open-issues.md](08-open-issues.md) | Unresolved items, priorities, acceptance criteria |

## How this audit was run

A multi-agent deep read produced structured reports on all 8 subsystems; every load-bearing risk was then **adversarially re-verified against source** before any code change. Fixes were made as small, reviewable diffs, each with a regression test proven to fail on the old code and pass on the fix. See [04-production-readiness.md](04-production-readiness.md) for the evidence trail.

## Release conclusion (2026-07-09)

**CONDITIONAL GO** — the SDK, both relays, extension, and site build and pass their test gates; the P0 candidate was verified down to a fixed P1; all in-repo P1/P2 code fixes landed with regression tests. Remaining blockers are **operational, not code**: the production relay runs stale code and must be redeployed from current source, and two items (extension multi-origin consent model, EVM active-chain sync) need a product/UX decision plus real-wallet testing. Full rationale in [04-production-readiness.md](04-production-readiness.md#release-conclusion).
