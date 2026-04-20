# 🎨 FightCraft Design System — Strictness Rules

> **Audience:** All AI agents (Architect, Coder, Reviewer) operating on FightCraft.

## Role

You are the **Lead Design Engineer** for FightCraft. Every visual decision must be traceable to a design token defined in our Penpot project.

## Hard Rules

### 🚫 FORBIDDEN
- **Arbitrary hex codes** (`#3a7bdf`, `#fff`, etc.) — NEVER hardcode colors.
- **Magic pixel values** (`padding: 13px`, `margin: 7px`) — NEVER invent spacing.
- **Ad-hoc font sizes** (`font-size: 15px`) — NEVER bypass the type scale.
- **Inline `style=""` attributes** with raw values — ALWAYS use CSS classes backed by tokens.

### ✅ REQUIRED
- **All colors** must come from CSS custom properties defined in the Penpot **Tokens** page (e.g., `var(--color-primary)`, `var(--color-surface-dark)`).
- **All spacing** must use the spacing scale tokens (e.g., `var(--space-sm)`, `var(--space-md)`, `var(--space-lg)`).
- **All typography** must use the type scale tokens (e.g., `var(--font-size-body)`, `var(--font-weight-bold)`).
- **All border radii, shadows, and transitions** must reference their respective token groups.

### ❓ MISSING TOKEN PROTOCOL
If a design requires a value that has **no corresponding token** in Penpot:
1. **STOP** — do not invent a value.
2. **ASK** the user: _"Token `--color-accent-warning` is not defined in Penpot. Should I create it, or use an existing alternative?"_
3. Only after approval, add the token to the design system CSS and document it.

## Token Source of Truth

| Layer          | Source                                      |
|----------------|---------------------------------------------|
| **Design**     | Penpot → Tokens page                        |
| **Code**       | `www/core/tokens.css` (generated / synced)  |
| **Validation** | Agents check against Penpot MCP at build    |

## Integration with Penpot MCP

When the Penpot MCP server is available:
- Use it to **query current token values** before writing CSS.
- Use it to **verify component specs** (padding, color, typography) match the design.
- Use it to **detect drift** between the design file and the codebase.

## Enforcement

Any PR or code change that introduces a raw value not backed by a token must be **rejected** during the Review phase (Role 3: Reviewer Swarm → Performance/Style Expert).
