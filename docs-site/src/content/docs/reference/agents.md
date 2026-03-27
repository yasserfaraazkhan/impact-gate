---
title: "Agents"
description: "All 10 crew agents, their roles, and when they run"
---

The Crew system consists of 10 specialized agents organized into phases. Each agent receives a task and shared context, performs its work, and contributes results back to the context for downstream agents.

## Agent Overview

| Agent | Phase | LLM Required |
|-------|-------|-------------|
| Impact Analyst | understand | No |
| Cross-Impact | understand | Yes |
| Regression Advisor | understand | No |
| Strategist | strategize | Yes |
| Test Designer | design | Yes |
| Coverage Evaluator | design | Yes |
| Generator | generate | Yes |
| Executor | execute | No |
| Healer | heal | Yes |
| Explorer | explore | Yes |

## Understand Phase

### Impact Analyst

Maps changed files to impacted route families using the knowledge layer, dependency graphs, and traceability data. Purely deterministic -- no LLM calls. Produces the foundation that all other agents build on.

### Cross-Impact

Detects ripple effects across route families. When a change to "channels" also affects "messaging" through shared components or APIs, this agent identifies those cross-family links.

### Regression Advisor

Scores regression risk using flaky test history, calibration data, and file-pattern heuristics. Flags areas where past instability suggests extra test attention.

## Strategize Phase

### Strategist

Decides the approach for each impacted flow: **full-test** (comprehensive coverage), **smoke-test** (basic verification), or **skip** (low risk, no action needed). Assigns priority levels and provides rationale for each decision.

## Design Phase

### Test Designer

Produces structured `TestCase[]` objects with type classification, preconditions, step-by-step instructions, expected outcomes, and rationale. Covers 9 test categories: happy-path, edge-case, boundary, negative, state-transition, race-condition, permission, accessibility, and performance.

### Coverage Evaluator

Reviews the test designs against the impact results and identifies remaining coverage gaps. Ensures the design phase produces adequate coverage before moving to generation.

## Generate Phase

### Generator

Converts test designs into Playwright spec code. Uses the discovered API surface (page objects, custom helpers) to generate specs that use real project methods rather than hallucinated ones.

## Execute Phase

### Executor

Runs the generated specs and collects pass/fail results, error messages, and screenshots. Provides execution data to the healer for failure analysis.

## Heal Phase

### Healer

Analyzes test failures from the executor, diagnoses root causes (selector changes, timing issues, API mismatches), and patches the broken specs. Can iterate multiple times to resolve cascading issues.

## Explore Phase

### Explorer

Autonomous browser agent that navigates the application, tries edge cases, and records findings. Used by the `impact-gate-qa` for browser-based exploratory testing.
