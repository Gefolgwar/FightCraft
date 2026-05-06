# 🎭 Rule: Playwright MCP Usage & Screenshots

## When to use
Whenever an agent uses the Playwright (або локальні скрипти) to automate browser actions, navigate pages, or interact with web UI.

## Requirements
1. **Explicit Actions:** All actions using Playwright MUST be run explicitly.
2. **Visual Headful Mode:** Playwright scripts must ALWAYS be executed in VISUAL browser UI (headful mode, e.g., `headless: false`). The browser should NOT be closed after the task finishes (`await browser.close()` should be omitted or conditional) so the user can see the final state.
3. **Tab Re-use:** For subsequent tasks or browser checks, all actions should occur in the SAME browser tab. This ensures the agent sees the results of user interactions and vice versa.
4. **Mandatory Screenshots:** Every task and EVERY action per task MUST be accompanied by taking screenshots.
5. **Timestamped Filenames:** All screenshots MUST include the current date and time in their filenames (e.g., `docs/playwright-test-results/2026-05-06_14-30-00_initial_page.png`) to preserve a chronological history of the session.
6. **Traceability:** Screenshots must be taken to ensure the user can track exactly what the Agent did, read, and saw during the browser session.
7. **Reporting:** When reporting back, include references or display the screenshots taken so the user has full context of the test/execution flow.