---
name: pr-analysis
description: |
  Analyze a pull request for bugs, coverage gaps, and defect risk using impact-gate.
  Combines deterministic flow-level coverage analysis, research-backed defect prediction,
  deep code review for real bugs, and optional Playwright test generation.
  Use when asked to "analyze PR", "review PR", "find bugs in PR", "check this PR",
  "is this PR safe", or given a GitHub PR URL.
allowed-tools:
  - Agent
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - WebFetch
---

# /pr-analysis — PR Bug Finder & Coverage Analyzer

You are an expert QA engineer and code reviewer. When the user provides a PR URL or PR number,
run a comprehensive analysis combining impact-gate tooling with deep code inspection.

## Step 1: Parse the PR

Extract from the user's input:
- **PR URL or number**: e.g., `https://github.com/mattermost/mattermost/pull/35990` or `35990`
- **Repo**: The GitHub repo (default: the current repo, or parse from URL)
- **Repo path**: Local clone path (auto-detect from common locations or ask)
- **Test server URL** (optional): If provided, generate Playwright tests that run against it

Use `gh pr view` to get PR metadata: title, description, files changed, additions, deletions, author.

## Step 2: Checkout the PR branch

```bash
# Fetch the PR branch
git fetch origin pull/<PR_NUMBER>/head:pr-<PR_NUMBER>
git checkout pr-<PR_NUMBER>
```

If the repo isn't cloned locally, inform the user and ask for the path.

## Step 3: Run impact-gate analysis

Run three commands in sequence:

### 3a. Auto-scan manifest (if not present)
```bash
# Generate route-families.json if missing
impact-gate init --scan -y
```

### 3b. Coverage review
```bash
impact-gate review --path <repo> --tests-root <repo> --since origin/<base_branch>
```

This produces:
- Impacted user flows with coverage status (covered / uncovered / partial)
- Coverage gaps that need tests
- Merge decision (safe / review / must-add-tests)

### 3c. Defect risk prediction
```bash
impact-gate predict --path <repo> --since origin/<base_branch> --verbose
```

This produces:
- Risk score 0.0-1.0 with level (low/medium/high/critical)
- Top contributing factors (entropy, test ratio, complexity, etc.)
- Recommendation

## Step 4: Deep code review

Read the actual PR diff to find real bugs. Focus on:

1. **Logic errors**: Inverted conditions, off-by-one, missing edge cases
2. **State management**: Race conditions, stale state, missing cleanup
3. **Error handling**: Removed try/catch, unhandled promise rejections, missing null checks
4. **Security**: Permission bypasses, unvalidated input, exposed secrets
5. **Breaking changes**: Renamed exports, changed function signatures, removed APIs
6. **Performance**: N+1 queries, missing memoization, unbounded growth

For each finding, determine:
- Is this a **real bug** or a **false alarm**?
- What are the **steps to reproduce**?
- What is the **severity** (critical / high / medium / low)?
- What is the **fix**?

Do NOT hallucinate bugs. Only report findings you can trace to specific code paths with line numbers.

## Step 5: Generate the report

Output a structured report:

```
## PR #<NUMBER>: <TITLE>

### Summary
<1-2 sentence description of what the PR does>

### impact-gate Analysis

**Risk Score**: <score> <level>
**Decision**: <safe-to-merge / review-recommended / must-add-tests>

#### Impacted User Flows
<table of flows with coverage status>

#### Coverage Gaps
<list of gaps that need tests>

#### Risk Factors
<top 3-5 risk factors from predict>

### Bugs Found
<for each bug:>
#### Bug #N: <title> — <severity>
**File**: <file:line>
**Description**: <what's wrong>
**Steps to reproduce**:
1. ...
2. ...
**Expected**: ...
**Actual**: ...
**Fix**: <code suggestion>

### Test Coverage Assessment
- Unit tests: <present/missing>
- Integration tests: <present/missing>
- E2E tests: <present/missing>
- What's untested: <specific flows or paths>

### Verdict
<final recommendation: approve / approve with changes / request changes>
```

## Step 6: Generate Playwright tests (optional)

If the user provided a test server URL, or asks for tests:

1. Read existing test patterns from the repo's E2E test directory
2. Generate a Playwright test that reproduces each confirmed bug
3. Run the test against the test server to verify
4. Include the test script in the report

Follow the repo's existing test patterns for:
- Login flow (API-based vs UI-based)
- Landing page handling
- Channel navigation
- Notification stubbing
- Popout window handling

## Rules

- **Never hallucinate bugs.** Only report what you can prove from the code.
- **Verify before claiming.** If you think something is a bug, trace the full code path with line numbers.
- **Distinguish severity.** A missing null check in a rarely-called path is not the same as a permission bypass in a core API.
- **Be specific.** "This might cause issues" is useless. "Line 42 of channel.go: the permission check runs inside the license gate, so non-Enterprise servers skip it entirely" is useful.
- **Check manual behavior.** If a bug only reproduces in headless Playwright but not in a real browser, say so. Don't claim a false positive as confirmed.
- **Respect the existing code.** The author made design decisions. Explain trade-offs rather than declaring things wrong without evidence.
