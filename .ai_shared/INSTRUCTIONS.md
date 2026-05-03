# FightCraft DOE Orchestration — INSTRUCTIONS

## Architecture: Directive → Orchestration → Execution (DOE)

### Layers

| Layer | Location | Purpose |
|-------|----------|---------|
| **Directives** | `directives/` | Natural-language SOPs defining *what* to do |
| **Orchestration** | This file (`INSTRUCTIONS.md`) | Command routing, role assignment, workflow ordering |
| **Execution** | `execution/` | Deterministic scripts that validate and enforce constraints |

### ACR Role System

Every implementation task is executed by three roles in sequence:

| Role | Responsibility | Deliverable |
|------|---------------|-------------|
| **Architect** | System design, data flow, listener topology | Technical spec with diagrams |
| **Coder** | Implementation following the spec | Working code + inline comments |
| **Reviewer** | Audit for correctness, performance, security | Signed-off review or change requests |

### Workflow

```
1. Identify directive → consult directives/_index.md
2. Architect plans → define connection points, cache strategy, security gates
3. Coder implements → write JS modules, update HTML, wire listeners
4. Reviewer audits → check for re-renders, cache wipes, rule gaps
5. Execution validates → run PowerShell scripts in execution/
```

### Environment

Sensitive data (API keys, Firebase credentials, signing passwords) lives in `.ai_shared/env/`.
- Never import directly into JS modules
- Use environment variables or build-time injection
- Firebase config in `firebase-service.js` is the CDN-key (public, acceptable)

### Self-Annealing Protocol

If a Firebase MCP operation returns an error:
1. Parse the error type (auth, permission, quota, network)
2. If retryable (network/quota): wait 2s, retry once
3. If permanent (auth/permission): surface to user, halt execution
4. Log all attempts to the operation console
