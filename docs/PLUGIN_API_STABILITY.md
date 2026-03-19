# Plugin API Stability

This document defines the API stability guarantees for `@yasserkhanorg/e2e-agents` plugin authors. It covers the `CrewContext` interface, the `AgentPlugin` contract, and the versioning rules that govern breaking changes.

## API Stability Guarantees

The `CrewContext` interface (defined in `src/crew/context.ts`) is the **stable public API** that plugins interact with during crew workflow execution. Every agent — built-in or plugin — receives a mutable `CrewContext` and reads or writes fields as the workflow progresses.

The following rules apply:

- **Field additions are NON-BREAKING.** New fields may appear in any minor release. Plugins should handle unknown fields gracefully and must not fail if `CrewContext` contains properties they do not recognize.
- **Field removals or type changes are BREAKING.** Removing a field, renaming it, or changing its TypeScript type constitutes a breaking change and requires a major version bump (e.g., v1.x to v2.0).
- **All fields present in v1.9.0 are guaranteed stable through v2.x.** Plugin authors can depend on the fields listed below without risk of removal until the next major version.

If you are writing a plugin today, depend only on the fields documented as STABLE. Fields marked EXPERIMENTAL may change shape or be removed in a minor release.

## Stable Fields

### Input (populated during preprocess)

| Field | Type | Stability |
|-------|------|-----------|
| `changedFiles` | `string[]` | STABLE |
| `routeFamilies` | `RouteFamily[]` | STABLE |
| `manifest` | `RouteFamilyManifest \| null` | STABLE |
| `apiSurface` | `ApiSurfaceCatalog` | STABLE |
| `specIndex` | `SpecIndex` | STABLE |
| `context` | `LoadedContext` | STABLE |
| `familyGroups` | `FamilyGroup[]` | STABLE |
| `preprocessResult` | `PreprocessResult \| null` | STABLE |

### Agent Outputs (accumulated during workflow)

| Field | Type | Stability |
|-------|------|-----------|
| `impactedFlows` | `FlowDecision[]` | STABLE |
| `strategyEntries` | `StrategyEntry[]` | STABLE |
| `testDesigns` | `TestDesign[]` | STABLE |
| `crossImpacts` | `CrossImpact[]` | STABLE |
| `regressionRisks` | `RegressionRisk[]` | STABLE |
| `findings` | `Finding[]` | STABLE |
| `generatedSpecs` | `GeneratedSpec[]` | STABLE |

### Metadata

| Field | Type | Stability |
|-------|------|-----------|
| `usage` | `ProviderUsageStats` | STABLE |
| `agentUsage` | `AgentUsageEntry[]` | STABLE |
| `messages` | `AgentMessage[]` | STABLE |
| `warnings` | `string[]` | STABLE |

### Configuration

| Field | Type | Stability |
|-------|------|-----------|
| `appPath` | `string` | STABLE |
| `testsRoot` | `string` | STABLE |
| `gitSince` | `string` | STABLE |
| `providerOverride` | `string \| undefined` | EXPERIMENTAL |
| `budgetUSD` | `number \| undefined` | EXPERIMENTAL |
| `modelRoutingProviderType` | `string \| undefined` | EXPERIMENTAL |
| `modelRoutingOverrides` | `Record<string, string> \| undefined` | EXPERIMENTAL |
| `budgetLedger` | `BudgetLedger \| undefined` | INTERNAL |

EXPERIMENTAL fields support evolving multi-provider routing and budget controls. Their names, types, or semantics may change in minor releases. Do not depend on them for core plugin logic.

INTERNAL fields are implementation details. `budgetLedger` is the shared cost tracker used by `BaseProvider` for pre-reservation budget enforcement. Plugins must not read from or write to it directly — use `getCrewProvider()` with the `budgetLedger` option instead, which wires it automatically.

## Plugin Phase Injection (v1.9.3)

When plugins are loaded, the orchestrator reads their `phase` and `runAfter` fields and injects them into the workflow:

- **No `runAfter`** — plugin is appended to the phase's parallel agent list
- **With `runAfter`** — plugin is appended to the phase's sequential list (the phase is converted to sequential if it was parallel, to respect dependency ordering)
- **Unknown phase** — plugin is skipped with a warning
- **Built-in phase (e.g., `preprocess`)** — plugin is skipped (not supported)
- **Unresolved `runAfter` deps** — plugin is injected anyway with a warning

## AgentPlugin Interface

The `AgentPlugin` interface (defined in `src/crew/protocol.ts`) extends `Agent` with scheduling metadata:

```typescript
interface AgentPlugin extends Agent {
    phase: string;
    runAfter?: AgentRole[];
}
```

| Property | Type | Description |
|----------|------|-------------|
| `role` | `AgentRole` (string union) | Unique agent identifier. Must not collide with built-in roles. |
| `phase` | `string` | Workflow phase to run in (e.g., `'strategize'`, `'understand'`, `'design'`). |
| `runAfter` | `AgentRole[]` (optional) | Dependency ordering. The orchestrator waits for these agents to complete before invoking this plugin. |
| `execute(task, ctx)` | `(AgentTask, CrewContext) => Promise<AgentResult>` | Main execution method. Receives the task assignment and the shared context. Must return an `AgentResult` with status, output, and any warnings. |
| `onMessage(msg)` | `(AgentMessage) => Promise<void>` (optional) | Handler for inter-agent messages (broadcast or direct). |

The `AgentResult` returned from `execute` must include:
- `role` — the agent's own role
- `status` — `'success'`, `'partial'`, or `'failed'`
- `output` — arbitrary payload (typed as `unknown`)
- `warnings` — array of human-readable warning strings
- `usage` (optional) — LLM token usage for cost tracking

## Versioning Rules

Plugins should declare a version requirement so the orchestrator can detect incompatibilities at load time:

```typescript
// In your plugin metadata or config
requiredVersion?: string; // semver range, e.g., ">=1.9.0 <3.0.0"
```

The `CrewOrchestrator` will emit a warning if the installed `@yasserkhanorg/e2e-agents` version does not satisfy the plugin's `requiredVersion` range. This is advisory — the plugin still runs — but it signals that untested combinations are in use.

**Summary of versioning semantics:**

| Change | Version Bump | Example |
|--------|-------------|---------|
| New field on `CrewContext` | Minor (1.9 to 1.10) | Adding `debugTrace: string[]` |
| New optional property on `AgentPlugin` | Minor | Adding `timeout?: number` |
| Remove or rename a STABLE field | Major (1.x to 2.0) | Renaming `testDesigns` to `designs` |
| Change type of a STABLE field | Major | `warnings: string[]` to `warnings: Warning[]` |
| Change to EXPERIMENTAL fields | Minor | Renaming `providerOverride` |

When in doubt, pin your plugin to a specific minor range (e.g., `">=1.9.0 <2.0.0"`) and test against new releases before widening the range.
