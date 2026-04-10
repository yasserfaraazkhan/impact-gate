---
title: "Knowledge Graph Integration"
description: "Function-level impact analysis using code knowledge graphs"
---

<div class="doc-intro">
  <div class="doc-chip">Function-level accuracy</div>
  <p class="doc-lead">
    Generate a code knowledge graph to upgrade impact-gate from file-level
    to function-level analysis. Trace changed functions to their callers,
    identify which specific functions lack test coverage, and get precise
    impact reports.
  </p>
</div>

## Why Use a Knowledge Graph

Without a knowledge graph, impact-gate works at **file level**: "post.go changed" maps to the "post" family. With a knowledge graph, it works at **function level**:

```
SetChannelManagedCategory (channel_category.go:288)
  → called by: patchChannel (channel.go:455)
  → tested by: managed_categories.spec.ts

ClearChannelManagedCategory (channel_category.go:319)
  → called by: patchChannel (channel.go:468)
  → tested by: (none)  ← coverage gap!
```

This eliminates false positives (claiming a flow is untested when the test covers a different function in the same file) and false negatives (missing a coverage gap because a test file exists but doesn't exercise the changed function).

## Supported Tools

impact-gate auto-detects knowledge graphs from two tools:

### Graphify (recommended for most repos)

[Graphify](https://github.com/safishamsi/graphify) uses tree-sitter for deterministic AST extraction across 20 languages. No LLM required for the code analysis pass.

```bash
pip install graphifyy
cd your-repo
graphify .
```

Output: `.graphify/graph.json` — auto-detected by impact-gate.

**Languages:** TypeScript, JavaScript, Go, Python, Rust, Java, C, C++, Ruby, C#, Kotlin, Scala, PHP, Swift, and more.

### Understand-Anything (for Claude Code users)

[Understand-Anything](https://github.com/Lum1104/Understand-Anything) generates a knowledge graph using AI agents. Requires a Claude Code or similar AI runtime.

Output: `.understand-anything/knowledge-graph.json` — auto-detected by impact-gate.

## Using KG with impact-gate

Once you have a knowledge graph, impact-gate automatically uses it:

```bash
# Generate the KG (one-time, or after major refactors)
graphify .

# Run review — KG auto-detected, function-level output enabled
impact-gate review --path . --since origin/main
```

The review output will include:

```
Untested Functions (need coverage):
  ❌ ClearChannelManagedCategory (channel_category.go) -- called by: patchChannel
  ❌ handleManagedCategoryWebSocket (websocket_actions.ts)

Tested Functions:
  ✅ SetChannelManagedCategory -- tested by: managed_categories.spec.ts
  ✅ patchChannel -- tested by: channel_test.go
```

## Accuracy Levels

| Level | What | How |
|-------|------|-----|
| **File-level** (~65%) | "post.go changed → post family" | `init --scan` (default, zero cost) |
| **KG-level** (~80%) | "patchChannel changed → traces callers → finds untested paths" | `graphify .` then `review` |
| **Runtime-level** (~90%) | "this test run covered lines 430-470 but not 455-472" | `traceability-capture` with coverage data |

## How It Works

1. **KG Loading**: impact-gate checks for `.graphify/graph.json` or `.understand-anything/knowledge-graph.json`
2. **Node Matching**: Changed files are matched to KG nodes (functions, classes, components)
3. **Call Chain Traversal**: BFS walks up the call graph to find all callers (up to depth 3)
4. **Test Coverage Mapping**: For each affected function, finds test nodes connected via `tests` edges
5. **Gap Detection**: Functions with no test coverage are flagged in the review output

## Regenerating the KG

Regenerate after:
- Major refactors that change function signatures or call chains
- Adding new modules or entry points
- Before a release review

```bash
# Graphify caches by SHA — only reprocesses changed files
graphify .
```
