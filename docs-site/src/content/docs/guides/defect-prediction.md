---
title: "Defect Prediction"
description: "Research-backed defect risk scoring for any git diff"
---

<div class="doc-intro">
  <div class="doc-chip">Zero config, zero LLM cost</div>
  <p class="doc-lead">
    Score any PR or branch diff for defect risk using research-backed metrics.
    Works on any repo, out of the box, with no training data required.
  </p>
</div>

## Quick Start

```bash
# Score a PR against main
npx impact-gate predict --path . --since origin/main

# Verbose output with full metrics breakdown
npx impact-gate predict --path . --since origin/main --verbose

# CI gate: exit 1 if risk exceeds threshold
npx impact-gate predict --path . --since origin/main --predict-threshold 0.7
```

## How It Works

The prediction engine combines three research-backed layers:

### Layer 1: Change Metrics (Kamei et al. 2013)

14 metrics extracted from the git diff, covering size, diffusion, purpose, history, and developer experience. These capture the empirically proven signals: large scattered changes are riskier, files touched by many developers are riskier, and inexperienced developers make more defects.

### Layer 2: Code Complexity (Hassan 2009)

Complexity signals from the diff hunks: cognitive complexity delta (nesting and branching), coupling delta (new imports), and test ratio (test lines vs source lines changed).

### Layer 3: LLM Semantic Analysis (optional, ~$0.02/PR)

When `--deep` is passed, the engine sends the diff to an LLM to identify risky patterns that deterministic metrics miss: removed error handling, weakened validation, concurrency risks, auth/security changes, and resource leaks.

```bash
npx impact-gate predict --path . --since origin/main --deep
```

Requires an LLM provider (Anthropic, OpenAI, or Ollama). Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or use `--llm-provider ollama`.

## Understanding the Output

```
DEFECT RISK: 0.72 (HIGH)

Risk Factors:
  ■■■■■■■■■ entropy (+1.40) - changes spread across 12 files in 5 directories
  ■■■■■■■■  ndev (+0.30) - these files modified by 8 developers
  ■■        test_ratio (-1.27) - only 12% of changes are in test files
  ■■        cognitive_delta (+0.15) - complexity increased

Recommendation: High defect risk. Thorough review required.
  Add tests for modified source files.
  Consider splitting into smaller, focused PRs.
```

**Score ranges:**

| Score | Level | Meaning |
|-------|-------|---------|
| 0.0 - 0.3 | LOW | Standard review process is sufficient |
| 0.3 - 0.6 | MEDIUM | Review recommended before merging |
| 0.6 - 0.8 | HIGH | Thorough review required |
| 0.8 - 1.0 | CRITICAL | Very likely contains a defect |

## Calibration

The default model uses pre-trained weights from the ApacheJIT dataset (~65% accuracy on any repo). Accuracy improves with project-specific feedback:

```bash
# 1. Run predictions (automatically recorded)
npx impact-gate predict --path . --since origin/main

# 2. After a PR ships, record the outcome
npx impact-gate predict-feedback --outcome clean --ref abc123
npx impact-gate predict-feedback --outcome defect --ref def456

# 3. After 50+ labeled samples, retrain
npx impact-gate predict --train

# 4. Check calibration status
npx impact-gate predict --calibration-status
```

**Accuracy progression:**
- 0 samples: ~65% (pre-trained cross-project weights)
- 50+ samples: ~75% (first calibration)
- 200+ samples: ~80%+ (fully calibrated to your codebase)

Calibration data is stored in `.e2e-ai-agents/prediction-calibration.json`.

## CI Integration

Add to your GitHub Actions workflow:

```yaml
- name: Defect risk check
  run: npx impact-gate predict --path . --since origin/${{ github.base_ref }} --predict-threshold 0.8
```

Combine with the existing impact-gate workflow:

```yaml
- name: Impact analysis + defect prediction
  run: |
    npx impact-gate predict --path . --since origin/${{ github.base_ref }} --predict-threshold 0.8
    npx impact-gate impact --path . --since origin/${{ github.base_ref }}
    npx impact-gate plan --path . --since origin/${{ github.base_ref }}
    npx impact-gate gate --threshold 80 --path .
```

## Research References

1. Kamei et al. 2013 -- "A Large-Scale Empirical Study of Just-in-Time Quality Assurance" (IEEE TSE)
2. Hassan 2009 -- "Predicting Faults Using the Complexity of Code Changes" (ICSE)
3. Pornprasit et al. 2021 -- "JITLine: A Simpler, Better, Faster, Finer-Grained JIT Defect Prediction"
4. Zeng et al. 2021 -- "LAPredict: Logistic Regression for Simple, Accurate, and Efficient JIT Defect Prediction"
5. ApacheJIT dataset -- 100K+ labeled commits from Apache projects
