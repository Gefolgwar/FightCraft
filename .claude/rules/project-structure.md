# 📁 Rule: Strict Project Structure

## When to use
ALWAYS follow this rule when creating, moving, or modifying files in the repository.

## The Rule: NO Stray Files in the Project Root
The project root must remain completely clean. No temporary files, test scripts, patch files, or loose documentation are allowed in the root directory. Every file MUST be placed in its designated folder.

### Designated Folders

- **Tasks**: `docs/tasks/`
- **Reports/Analysis**: `docs/reports/`
- **Proposals/RFCs**: `docs/proposals/`
- **Patches/Fix Scripts**: `scripts/patches/`
- **Tests/Testing Scripts**: `scripts/tests/`

If you are about to create a file in the root directory (e.g., `test.js`, `patch.js`, `report.md`), **STOP**. Move it to the appropriate subdirectory listed above.
