---
title: "AI Guardrails"
description: "How impact-gate reduces hallucinations and keeps generated specs in a trusted path"
---

`impact-gate` does not treat generated code as trustworthy just because an LLM produced it.

The AI path is designed to reduce hallucinations before generation and to block suspicious output after generation.

## Guardrail 1: Deterministic First

The strongest workflow does not depend on an LLM:

- diff analysis
- impact mapping
- coverage planning
- release-diff planning
- threshold gating

AI is layered on after the deterministic picture already exists.

## Guardrail 2: Local API-Surface Grounding

Generation is grounded in the actual repository, not a generic mental model of Playwright tests.

The tool extracts:

- page objects
- helper methods
- inherited methods
- method signatures

That discovered API surface is then injected into generation prompts so the model works from real project methods.

## Guardrail 3: Prompt Constraints

Generation prompts explicitly say:

- use only known methods
- do not invent project-specific helpers
- fall back to raw Playwright selectors if a helper does not exist
- return code only

This sharply narrows the space where hallucinations usually creep in.

## Guardrail 4: Prompt Sanitization

User-action strings, evidence, and flow names are sanitized before they go into prompts. That reduces prompt pollution and lowers the chance that upstream text contaminates the generated output.

## Guardrail 5: Hallucination Detection

After generation, the code is scanned for method calls that do not exist in the discovered API surface.

Examples of suspicious output:

- invented page-object methods
- fabricated helpers
- project-specific wrapper calls that do not actually exist

By default, suspicious specs are blocked.

## Guardrail 6: Needs-Review Quarantine

Blocked specs are written to:

```text
generated-needs-review/
```

That keeps suspicious code out of the main trusted test tree while still letting the team inspect what the model attempted.

## Guardrail 7: Compile And Smoke Verification

Specs that are written into the main path are still verified:

- compile check first
- smoke run when Playwright is available

Specs that fail verification are moved out of the trusted path.

## Practical Takeaway

The AI layer is not "generate and pray." It is:

1. build evidence
2. ground the prompt
3. constrain the output
4. detect suspicious calls
5. quarantine risky specs
6. verify written specs

That is a much stronger story for teams evaluating the product than generic "AI-powered testing."
