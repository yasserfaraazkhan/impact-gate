---
name: qa
description: |
  Systematically QA test a running web application and fix bugs found.
  Runs autonomous browser exploration, computes health scores, fixes bugs with
  atomic commits, and produces structured reports with before/after evidence.
  Use when asked to "qa", "QA", "test this", "find bugs", "test and fix",
  "does this work?", or "check for regressions".
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
---

# /qa — Test, Fix, Verify

You are a QA engineer. When the user invokes /qa, run the impact-gate QA agent
to systematically test the application, find bugs, fix them, and produce a report.

## Step 1: Determine parameters

Parse the user's request for:
- **URL**: The base URL to test. Prefer the app URL the user provided or the
  currently running local/staging app URL you can discover. If no app URL is
  available, ask for it instead of assuming a hard-coded local port.
- **Mode**: `pr` (feature branch, default), `hunt` (specific area), `release` (full regression), `fix` (verify healed tests)
- **Fix tier**: `quick` (critical+high), `standard` (default, +medium), `exhaustive` (+low)
- **Regression**: Whether to compare against a previous baseline

Auto-detect mode:
- On a feature branch with an app URL → `pr` mode
- User mentions a specific area (e.g., "test channel settings") → `hunt` mode
- User says "release", "regression", "full test" → `release` mode

Accept any reachable application URL, for example:
- `http://localhost:3000`
- `http://127.0.0.1:5173`
- `https://staging.example.com`

## Step 2: Check prerequisites

```bash
# Verify agent-browser is available
agent-browser --version 2>/dev/null || echo "NEEDS_INSTALL"

# Verify impact-gate-qa is available
npx impact-gate-qa --help 2>/dev/null | head -1 || echo "NEEDS_INSTALL"
```

If either is missing, tell the user what to install:
- `npm install -g agent-browser` for browser automation
- `npm install -g @yasserkhanorg/impact-gate` for the QA agent

## Step 3: Run the QA agent

Build the command based on parameters:

```bash
npx impact-gate-qa <mode> \
  --base-url <url> \
  --fix-tier <tier> \
  [--no-fix] \
  [--regression] \
  [--time <minutes>] \
  [--budget <usd>]
```

Examples:
```bash
# Default: test current branch changes
npx impact-gate-qa pr --base-url <app-url>

# Hunt mode for a specific area
npx impact-gate-qa hunt "account settings" --base-url <app-url>

# Release readiness with regression comparison
npx impact-gate-qa release --base-url <app-url> --regression --time 30

# Quick smoke test, no fixes
npx impact-gate-qa pr --base-url <app-url> --fix-tier quick --no-fix
```

## Step 4: Read and display the report

After the command completes, read the output files:

```bash
# Read the markdown summary
cat .e2e-ai-agents/qa-summary.md

# Read the JSON report for structured data
cat .e2e-ai-agents/qa-report.json
```

Display the key sections to the user:
1. **Health score** (overall and per-category breakdown)
2. **Verdict** (GO / NO-GO / CONDITIONAL with reason)
3. **Top issues** (highest severity findings)
4. **Fixes applied** (if fix loop ran: verified/reverted/skipped counts)
5. **Regression comparison** (if --regression: score delta, new/fixed issues)

## Finding Categories

The QA agent classifies findings into 7 categories:

| Category | What it covers |
|----------|---------------|
| **visual** | Layout breaks, broken images, z-index, alignment, animation glitches |
| **functional** | Broken links, dead buttons, form validation, redirects, race conditions |
| **ux** | Confusing nav, missing loading indicators, slow interactions, unclear errors |
| **content** | Typos, placeholder text left in, truncated text, wrong labels |
| **performance** | Slow loads (>3s), layout shifts, excessive network requests |
| **console** | JS exceptions, failed API calls (4xx/5xx), CORS errors |
| **accessibility** | Missing alt text, broken keyboard nav, focus traps, low contrast |

## Health Score

Weighted 0-100 across 8 dimensions:

| Category | Weight |
|----------|--------|
| Functional | 20% |
| Console | 15% |
| UX | 15% |
| Accessibility | 15% |
| Visual | 10% |
| Links | 10% |
| Performance | 10% |
| Content | 5% |

Deductions per finding: critical -25, high -15, medium -8, low -3.

## Fix Tiers

| Tier | Fixes |
|------|-------|
| **quick** | Critical + high severity only |
| **standard** | + medium severity (default) |
| **exhaustive** | + low severity |

The fix loop creates one atomic commit per fix (`fix(qa): ISSUE-{id} — description`).
Self-regulation stops the loop if too many fixes are reverted (WTF heuristic > 20%).
