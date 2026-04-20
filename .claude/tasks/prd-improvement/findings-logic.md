# Logic Findings vs PRD

## New Mechanics & Features (Missing from PRD)
1. **Arena Mechanics:** 
   - Code: Combat automatically generates a 50m radius "Arena" on the map centered on the initiating player. If a player physically leaves this boundary during combat, they suffer an `arenaDefeat` (auto-defeat).
   - PRD update needed: Add Arena boundary logic and auto-defeat consequences to the PvE and PvP combat sections.
2. **PvP Flee Penalty:**
   - Code: Fleeing a PvP combat incurs a 5-minute cooldown/penalty.
   - PRD update needed: Document the 5-minute PvP flee penalty (currently only the 1-hour PvE monster flee penalty is documented).
3. **Unified Group Combat & Proximity:**
   - Code: Group combat utilizes a "Unified Combat" structure (Team A vs Team B) synced via RTDB. A strict `checkGroupProximity` function ensures that *all* group members must be within their `interactionRadius` (default 50m) of the target to initiate the fight.
   - PRD update needed: Clarify the group combat initiation requirements (proximity check) and the Team vs Team architecture.
4. **Group Visual Identification (Team Colors):**
   - Code: Groups assign a color (e.g., `#22c55e`) to distinguish group members on the UI/Map.
   - PRD update needed: Mention team color assignments in the Group System section.

## Contradictions / Missing Implementations
1. **Leaderboard Types:**
   - PRD specifies: `Street, Couch, 2v2, 3v3, FFA`.
   - Code implements: Only `street` (most wins), `couch` (most losses), and a level-based leaderboard. `2v2`, `3v3`, and `FFA` are not implemented.
   - PRD update needed: Update the PRD to reflect the currently implemented leaderboards or mark the team/FFA modes as planned/future features.
