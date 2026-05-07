# 🔌 Rule: Free Claude Proxy — Sub-Agent Environment

## When to use
ALWAYS check and apply this rule before spawning any sub-agent via the `Agent` tool. Also apply when the user mentions "free-claude-proxy", "sub-agent 401", or "ANTHROPIC_AUTH_TOKEN".

## Context
We use `free-claude-proxy` (localhost) which routes through OpenRouter. We do NOT authenticate with Anthropic directly. The `ANTHROPIC_API_KEY` must NOT be set (unset it if present).

## Problem
Sub-agents run as separate processes and do NOT inherit environment variables from the parent session. When using `free-claude-proxy`, sub-agents fail with `401 Unauthorized` because they lack the auth token.

## Solution: Configure `.claude/settings.json`

Add ALL proxy variables to the `env` section in `.claude/settings.json`. Sub-agents spawned via `Agent` tool WILL inherit them.

### Required Environment Variables

These MUST be present in `settings.json` `env` section:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:8082",
    "ANTHROPIC_AUTH_TOKEN": "freecc",
    "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY": "1"
  }
}
```

### Critical: No ANTHROPIC_API_KEY

Ensure `ANTHROPIC_API_KEY` is NOT set anywhere. If sub-agents show:
```
⚠ Auth conflict: Both a token (ANTHROPIC_AUTH_TOKEN) and an API key (ANTHROPIC_API_KEY) are set.
```
Then `ANTHROPIC_API_KEY` is set somewhere. Unset it in the parent session before spawning.

## Procedure Before Spawning Sub-Agents

1. **Check** if `.claude/settings.json` has the `env` section with all three variables
2. **Check** that `ANTHROPIC_API_KEY` is NOT set (run `echo $ANTHROPIC_API_KEY` — should be empty)
3. **Spawn** sub-agent using `Agent` tool (NOT CLI command)
4. **Verify** the sub-agent can authenticate by checking proxy logs for `200 OK` instead of `401 Unauthorized`

## Verification
After spawning a sub-agent, check the proxy logs:
- ✅ `200 OK` — sub-agent authenticated successfully
- ❌ `401 Unauthorized` — env vars not passed, fix `settings.json`
- ❌ `Auth conflict` — `ANTHROPIC_API_KEY` is set, unset it

## What NOT to do
- ❌ Do NOT use CLI commands to spawn sub-agents — use `Agent` tool
- ❌ Do NOT rely on shell `export` before `Agent` tool — sub-agents don't inherit shell env
- ❌ Do NOT assume sub-agents use the parent's environment
- ❌ Do NOT spawn agents without checking `settings.json` first
- ❌ Do NOT leave `ANTHROPIC_API_KEY` set — unset it

## Integration with Multi-Agent Orchestration
This rule complements `.claude/rules/multi-agent-orchestrator.md`. Before Step 3 (Assign Roles / Spin Up Agents), ensure the proxy environment is configured in `settings.json`.
