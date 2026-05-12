# 🎭 Rule: Playwright MCP Usage

## When to use
Whenever an agent uses the Playwright (або локальні скрипти) to automate browser actions, navigate pages, or interact with web UI.

## Requirements
1. **Explicit Actions:** All actions using Playwright MUST be run explicitly.
2. **Visual Headful Mode:** Playwright scripts must ALWAYS be executed in VISUAL browser UI (headful mode, e.g., `headless: false`). The browser should NOT be closed after the task finishes (`await browser.close()` should be omitted or conditional) so the user can see the final state.
3. **Tab Re-use:** For subsequent tasks or browser checks, all actions should occur in the SAME browser tab. This ensures the agent sees the results of user interactions and vice versa.
