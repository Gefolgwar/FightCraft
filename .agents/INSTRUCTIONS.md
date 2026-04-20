# 🧠 FightCraft — DOE Orchestration Kernel

> **This file is the agent's brain.** It does NOT describe the project (that's in `CLAUDE.md`).
> It defines HOW the agent makes decisions and routes tasks.

---

## DOE Architecture (Directive → Orchestration → Execution)

```
┌─────────────────────────────────────────────────┐
│  LAYER 1: DIRECTIVES  (.agents/directives/)     │
│  Natural language. SOP: "what" and "why".       │
│  Explain the process, but do NOT execute work.  │
├─────────────────────────────────────────────────┤
│  LAYER 2: ORCHESTRATION  (this file)            │
│  AI reads directives, decides which to apply,   │
│  routes tasks. NEVER guesses the workflow.      │
├─────────────────────────────────────────────────┤
│  LAYER 3: EXECUTION  (.agents/execution/)       │
│  Deterministic PowerShell scripts & MCP tools.  │
│  API calls, validation, data processing.        │
└─────────────────────────────────────────────────┘
```

---

## Command Routing Algorithm

When the user issues a command, the agent MUST execute this algorithm:

```
1. PARSE: Understand the user's intent
2. LOOKUP: Open directives/_index.md → find the matching directive
3. BRANCH:
   ├── Directive FOUND → READ it fully → execute step-by-step
   ├── Directive NOT found, but task is simple → execute directly
   └── Directive NOT found, task is complex →
       ├── CREATE a new directive in directives/
       ├── CREATE a script in execution/ (if a tool is needed)
       └── EXECUTE the new directive
4. ON ERROR: Apply the Self-Annealing protocol (protocols/self-annealing.md)
5. REPORT: Summary of changes to the user
```

> ⚠️ **FORBIDDEN:** Guessing the workflow. If there is no directive — create one BEFORE executing.

---

## Roles (ACR System)

For any new feature or complex change, the agent works in three roles sequentially.
Details: `.agents/rules/a-c-r.md` (always-on rule)

| Phase | Role | Rule |
|-------|------|------|
| 1. Analysis | 📐 Architect | Create a plan. **STOP** — wait for "OK" from the user |
| 2. Implementation | 💻 Coder | Write code according to the Architect's plan |
| 3. Review | 🔍 Reviewer Swarm | Security + Logic + Performance in parallel |

---

## Resource Registry

### Directives (`directives/`)
| File | Trigger |
|------|---------|
| `_index.md` | Every command — first thing to check |
| `deploy-firebase.md` | "deploy", "release", "publish" |
| `security-audit.md` | "security", "audit rules" |
| `game-balance-audit.md` | "balance", changes in `data.js` |
| `capacitor-build.md` | "Android build", "capacitor", "APK" |
| `multiplayer-sync-check.md` | "multiplayer", "sync", "PvP check" |
| `new-feature.md` | Any new feature or system |
| `hotfix.md` | "hotfix", "urgent", critical bug |
| `add-execution-script.md` | When a new tool is needed |

### Execution Scripts (`execution/`)
| Script | Purpose |
|--------|---------|
| `validate-rules.ps1` | Syntax validation of 3 Firebase rules files |
| `drift-check.ps1` | Compare local rules against production |
| `pre-deploy-gate.ps1` | Full pre-deployment check (fail-fast) |
| `balance-snapshot.ps1` | Dump balance data from data.js |
| `rtdb-health.ps1` | Check RTDB for orphaned records |

### Protocols (`protocols/`)
| Protocol | When |
|----------|------|
| `self-annealing.md` | A script or MCP tool returned an error |
| `parallel-review.md` | After completing feature coding |

### Skills (`skills/`)
13 skills are available via SKILL.md files. Directives reference them.
Full list: `skills-lock.json`

### MCP Tools
Firebase MCP Server is available. Key tools:

| Tool | Action |
|------|--------|
| `firebase_validate_security_rules` | Validate rules |
| `firebase_get_security_rules` | Get production rules |
| `firestore_query_collection` | Query Firestore |
| `realtimedatabase_get_data` | Read RTDB |
| `firestore_list_documents` | List documents |

---

## Sensitive Data

Sensitive data (API keys, passwords) is ALWAYS isolated in `.agents/env/`.
Scripts in `execution/` read variables from the `.env` file, NEVER hardcode them.

---

## Rules

1. **Directive first** — check `directives/_index.md` before any action
2. **Bidirectional link** — every script in `execution/` has a corresponding directive
3. **Self-Annealing** — error → fix the code + update the directive, do NOT re-prompt
4. **Don't touch CLAUDE.md** — project context lives separately from orchestration
5. **Language** — all files in English
6. **Firebase Rules = Server** — validation ONLY in rules, not in the client
7. **STOP before coding** — Architect waits for "OK" on new features
