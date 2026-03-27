---
title: "Route Families"
description: "The knowledge model that connects code changes to features, flows, and tests"
---

A **route family** is the main unit of product understanding inside `impact-gate`.

It groups together the parts of your repository that belong to the same user-facing capability:

- URL routes
- frontend paths
- backend paths
- spec directories
- user flows
- priority

## Why Route Families Exist

Without a route-family manifest, a diff only tells you which files changed. It does not tell you:

- which product area is affected
- which E2E specs are relevant
- which flows are not covered yet

The manifest is what lets the tool answer those higher-level questions.

## Example

```json
{
  "id": "channels",
  "routes": ["/{team}/channels/{channel}"],
  "priority": "P0",
  "webappPaths": ["src/components/channel_header/**"],
  "serverPaths": ["server/channels/api4/channel*.go"],
  "specDirs": ["specs/functional/channels/"],
  "userFlows": ["Create channel", "Archive channel", "Search in channel"]
}
```

With that in place, a backend file change can still map cleanly to the right user flow and spec set.

## How Families Are Created

You have two main options.

### Scanner-Based Training

```bash
npx impact-gate train --no-enrich --path .
```

This is the offline path. It uses directory matching, name matching, test-derived discovery, and server-derived grouping to build the manifest.

### Knowledge-Graph Bootstrap

```bash
npx impact-gate bootstrap --path .
```

If you already have an Understand-Anything knowledge graph, bootstrap is often the fastest way to get a useful initial manifest.

## What Good Families Unlock

A strong manifest improves:

- impact analysis accuracy
- release-diff planning
- run-set precision
- gap detection quality
- AI generation grounding
- QA-agent scoping

In practice, the quality of `route-families.json` is one of the strongest predictors of whether the rest of the product will feel valuable.

## When To Refine The Manifest

Update route families when:

- changed files show up as unmapped
- confidence is repeatedly low
- generated plans miss obvious flows
- release diffs feel too broad
- new product areas or test directories appear

## Related Reading

- [How Impact Gate Works](./how-it-works/)
- [Impact Analysis](../guides/impact-analysis/)
- [Zero Config](../getting-started/zero-config/)
