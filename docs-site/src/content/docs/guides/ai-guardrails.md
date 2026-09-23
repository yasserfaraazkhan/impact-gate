---
title: "AI Guardrails"
description: "Generation evidence, quarantine, and the limits of local-source verification"
---

AI generation is experimental. Static `review` and `gate` work without a provider, and their spec associations remain candidates rather than measured source coverage.

## Ground proposals in the repository

The generation paths use available page objects, helper methods, and API-surface information when constructing prompts. Some paths also flag method calls absent from that catalog. These checks reduce avoidable mistakes; they do not establish correct business behavior or complete coverage.

Provide acceptance criteria, test fixtures, a representative existing spec, and the expected observable result. Review assumptions before running generated code. The [quick start](../../getting-started/quick-start/) walks through exporting and inspecting a scenario plan first.

## What acceptance requires

For `review --generate` and the agentic generation path, acceptance requires:

1. A clean Playwright execution with actual passing test results.
2. An assertion failure when a supported changed-line mutation is applied to directly imported local source in a disposable copy.
3. A passing execution after restoring the source, with the checked source and test bytes preserved.

The supported mutation operators invert a condition, replace a return with null, or comment a statement. A syntax error, failed process, timeout, missing report, or skipped test is not proof that a test detected a behavioral regression.

This mechanism currently supports direct imports of changed local source. Remote applications, browser-served applications, prebuilt bundles, missing repository/base context, unsupported mutations, and additions to existing specs remain unverified. It does not certify general browser E2E coverage or release readiness.

## Read the result, not just the generated file

| Status | Interpretation |
| --- | --- |
| `passed` | Accepted under the local-source conditions above |
| `failed` | A required step such as generation failed |
| `skipped` | Execution was skipped, including a dry run |
| `unverified` | The proposal lacks the required acceptance evidence |

Unaccepted proposals from this path are saved below the test root as:

```text
.e2e-ai-agents/unverified/*.ts.unverified
```

The suffix keeps proposals out of normal Playwright spec discovery. Inspect the generation summary for the actual path, reason, and evidence. `--dry-run` still calls the provider and writes a proposal, but does not execute it or establish a pass.

Some legacy pipeline checks also use `generated-needs-review/`. That directory is not a universal acceptance signal. Compilation, method-name checks, file existence, and a successful process exit alone cannot establish verification.

## Evidence to date

The recorded local verifier tests used deterministic provider fixtures and real Playwright execution. They demonstrated clean/mutated/restored runs and rejection of an empty test. They did not establish live-model quality, general application coverage, or Mattermost browser behavior. See the [retained verification evidence](https://github.com/yasserfaraazkhan/impact-gate/blob/master/gates/w1.txt).

Healing changes test code and can change what a test asserts. Review those changes and rerun the necessary checks; a repaired test must retain the intended behavior assertion.
