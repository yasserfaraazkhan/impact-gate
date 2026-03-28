---
title: "QA Skill for Codex and Claude"
description: "Use the /qa skill as a natural-language front door to impact-gate-qa"
---

<div class="doc-intro">
  <div class="doc-chip">Agent workflow</div>
  <p class="doc-lead">
    The <code>/qa</code> skill gives Codex and Claude a natural-language front
    door into <code>impact-gate-qa</code>. Instead of memorizing flags, you can
    tell the agent what to test, where the app is running, and whether you want
    fixes or a pure report.
  </p>
</div>

<div class="docs-panel docs-panel--compact">
  <span class="docs-panel__eyebrow">Full story</span>
  <p class="docs-panel__copy">
    If you want the full product story from diff to browser exploration to
    generated and healed specs, start with the
    <a href="./browser-qa/">Autonomous Browser QA guide</a>.
  </p>
</div>

<div class="docs-grid">
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">Mental model</span>
    <h2 class="docs-panel__title">The skill wraps the autonomous QA agent, not a separate implementation</h2>
    <p class="docs-panel__copy">
      When you invoke <code>/qa</code>, the skill determines the mode, finds the
      app URL, chooses fix settings, and then runs <code>impact-gate-qa</code>
      underneath. The final report still comes from the same browser-driven QA
      pipeline.
    </p>
  </div>
  <div class="docs-panel docs-panel--terminal">
    <span class="docs-panel__eyebrow">Typical mapping</span>
    <h2 class="docs-panel__title">Natural language in, QA command out</h2>
    <div class="docs-terminal">
      <code>/qa test this app at http://localhost:3000</code>
      <code>→ impact-gate-qa pr --base-url http://localhost:3000</code>
      <code>/qa hunt "checkout flow" on https://staging.example.com</code>
      <code>→ impact-gate-qa hunt "checkout flow" --base-url https://staging.example.com</code>
    </div>
  </div>
</div>

## Install The Skill

<div class="docs-grid">
  <div class="docs-panel docs-panel--terminal">
    <span class="docs-panel__eyebrow">Codex</span>
    <h2 class="docs-panel__title">Install the repo skill into your Codex skills directory</h2>
    <div class="docs-terminal">
      <code>mkdir -p "$CODEX_HOME/skills/qa"</code>
      <code>cp skills/qa/SKILL.md "$CODEX_HOME/skills/qa/SKILL.md"</code>
    </div>
    <p class="docs-panel__copy">
      If you keep a shared agent workspace, symlinking the file works too.
    </p>
  </div>
  <div class="docs-panel docs-panel--terminal">
    <span class="docs-panel__eyebrow">Claude</span>
    <h2 class="docs-panel__title">Install the same skill into your Claude repo or user skill directory</h2>
    <div class="docs-terminal">
      <code>mkdir -p .claude/skills/qa</code>
      <code>cp skills/qa/SKILL.md .claude/skills/qa/SKILL.md</code>
    </div>
    <p class="docs-panel__copy">
      The same <code>SKILL.md</code> can be reused; the wrapper behavior stays
      consistent across both agents.
    </p>
  </div>
</div>

## What You Need First

<div class="docs-grid">
  <div class="docs-panel docs-panel--compact">
    <span class="docs-panel__eyebrow">Requirements</span>
    <h2 class="docs-panel__title">A reachable app plus the browser QA tooling</h2>
    <ul>
      <li>a running local, staging, or preview URL</li>
      <li><code>agent-browser</code> installed and on <code>PATH</code></li>
      <li><code>impact-gate-qa</code> available through <code>npx</code> or a global install</li>
      <li><code>ANTHROPIC_API_KEY</code> for the exploratory browser loop and fix workflow</li>
    </ul>
  </div>
</div>

## Use the QA skill in Codex

<div class="docs-grid">
  <div class="docs-panel docs-panel--feature">
    <span class="docs-panel__eyebrow">Codex examples</span>
    <h2 class="docs-panel__title">Ask for the outcome you want</h2>
    <div class="docs-terminal">
      <code>/qa test this app at http://localhost:3000</code>
      <code>/qa hunt "account settings" on http://127.0.0.1:5173</code>
      <code>/qa run a release regression on https://staging.example.com</code>
      <code>/qa smoke-test this branch but do not apply fixes</code>
    </div>
  </div>
</div>

Use the skill when you want Codex to:

- choose between <code>pr</code>, <code>hunt</code>, <code>release</code>, and <code>fix</code> modes for you
- translate natural-language scope into an <code>impact-gate-qa</code> invocation
- run the QA agent, then summarize the resulting health score, verdict, and top findings

## Use the QA skill in Claude

<div class="docs-grid">
  <div class="docs-panel docs-panel--feature">
    <span class="docs-panel__eyebrow">Claude examples</span>
    <h2 class="docs-panel__title">The same prompts work well in Claude flows</h2>
    <div class="docs-terminal">
      <code>/qa test the current branch against http://localhost:3000</code>
      <code>/qa hunt "checkout flow" on https://staging.example.com</code>
      <code>/qa run a full regression on the staging URL and compare to baseline</code>
      <code>/qa verify the healed tests only</code>
    </div>
  </div>
</div>

The useful mental model is the same: the skill is the ergonomic entry point,
and <code>impact-gate-qa</code> is the engine underneath it.

## Mode Mapping

| You ask for | The skill usually chooses |
|-------------|---------------------------|
| test the current branch | <code>pr</code> |
| hunt a specific feature or flow | <code>hunt</code> |
| run a full regression or release check | <code>release</code> |
| verify healed tests | <code>fix</code> |

If the request includes a specific area like “account settings” or “checkout
flow,” the skill typically maps that to <code>hunt</code>. If the request says
“release,” “regression,” or “full test,” it typically maps that to
<code>release</code>.

## A Good First Run

<div class="docs-grid">
  <div class="docs-panel docs-panel--terminal docs-panel--feature">
    <span class="docs-panel__eyebrow">Safest first run</span>
    <h2 class="docs-panel__title">Start with a report-only pass before you let the loop fix anything</h2>
    <div class="docs-terminal">
      <code>/qa test this app at http://localhost:3000 but do not apply fixes</code>
      <code>→ impact-gate-qa pr --base-url http://localhost:3000 --no-fix</code>
    </div>
  </div>
</div>

That gives you:

- a health score
- a GO / NO-GO / CONDITIONAL verdict
- categorized findings
- screenshots and before/after evidence
- a structured QA report in <code>.e2e-ai-agents/</code>

## Artifacts the skill produces

<div class="docs-grid">
  <div class="docs-panel docs-panel--dense">
    <span class="docs-panel__eyebrow">Summary</span>
    <h3 class="docs-panel__title">Human-readable summary</h3>
    <div class="docs-terminal">
      <code>.e2e-ai-agents/qa-summary.md</code>
    </div>
    <p class="docs-panel__copy">Human-readable verdict, health score, and top issues.</p>
  </div>
  <div class="docs-panel docs-panel--dense">
    <span class="docs-panel__eyebrow">Structured report</span>
    <h3 class="docs-panel__title">Machine-readable report</h3>
    <div class="docs-terminal">
      <code>.e2e-ai-agents/qa-report.json</code>
    </div>
    <p class="docs-panel__copy">Machine-readable findings, categories, regression deltas, and fix results.</p>
  </div>
</div>

## When to use the skill instead of the CLI

<div class="docs-panel">
  <span class="docs-panel__eyebrow">Best fit</span>
  <h2 class="docs-panel__title">Use the skill when you want the agent to translate intent into the right QA run</h2>
  <ul>
    <li>you are already working inside Codex or Claude</li>
    <li>you want natural-language QA requests instead of hand-building flags</li>
    <li>you want the final QA report summarized back into the same agent conversation</li>
  </ul>
</div>

If you already know the exact mode and flags you want, running
<code>impact-gate-qa</code> directly is still perfectly fine. The skill exists
to make the workflow easier to invoke and easier to explain to teams.
