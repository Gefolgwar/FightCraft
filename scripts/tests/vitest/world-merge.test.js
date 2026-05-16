import { describe, it, expect } from "vitest";
import { mergeProceduralAndManual } from "../../../www/gameplay/world-merge.js";

// ── Cycle 1: Tracer Bullet — empty inputs ──────────────────────────
describe("mergeProceduralAndManual", () => {
  it("returns empty array when both inputs are empty", () => {
    const result = mergeProceduralAndManual([], []);
    expect(result).toEqual([]);
  });

  it("handles null/undefined inputs gracefully", () => {
    expect(mergeProceduralAndManual(null, undefined)).toEqual([]);
    expect(mergeProceduralAndManual(undefined, [])).toEqual([]);
  });

  // ── Cycle 2: Only procedural ───────────────────────────────────
  it("returns all procedural items when no manual overrides", () => {
    const procedural = [
      { id: "m1", type: "monster", name: "Goblin", lat: 52.5, lng: 13.4 },
      { id: "m2", type: "monster", name: "Orc", lat: 52.6, lng: 13.5 },
    ];
    const result = mergeProceduralAndManual(procedural, []);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("Goblin");
    expect(result[1].name).toBe("Orc");
  });

  it("does not mutate the original procedural array", () => {
    const procedural = [{ id: "m1", name: "Goblin" }];
    const result = mergeProceduralAndManual(procedural, []);
    expect(result).not.toBe(procedural);
  });

  // ── Cycle 3: Only manual ───────────────────────────────────────
  it("returns all manual items when no procedural base", () => {
    const manual = [
      { id: "boss1", type: "monster", name: "Dragon", isManual: true },
    ];
    const result = mergeProceduralAndManual([], manual);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Dragon");
    expect(result[0].isManual).toBe(true);
  });

  // ── Cycle 4: Manual appends (no ID conflict) ──────────────────
  it("appends manual items that have no matching procedural id", () => {
    const procedural = [
      { id: "m1", type: "monster", name: "Goblin" },
    ];
    const manual = [
      { id: "boss1", type: "monster", name: "Admin Boss", isManual: true },
    ];
    const result = mergeProceduralAndManual(procedural, manual);
    expect(result).toHaveLength(2);
    expect(result.find((o) => o.id === "m1")).toBeTruthy();
    expect(result.find((o) => o.id === "boss1")).toBeTruthy();
  });

  // ── Cycle 5: Manual replaces by ID ────────────────────────────
  it("replaces procedural object when manual has same id", () => {
    const procedural = [
      { id: "m1", type: "monster", name: "Goblin", hp: 50 },
      { id: "m2", type: "monster", name: "Orc", hp: 80 },
    ];
    const manual = [
      { id: "m1", type: "monster", name: "Elite Goblin", hp: 200, isManual: true },
    ];
    const result = mergeProceduralAndManual(procedural, manual);
    expect(result).toHaveLength(2);

    const replaced = result.find((o) => o.id === "m1");
    expect(replaced.name).toBe("Elite Goblin");
    expect(replaced.hp).toBe(200);
    expect(replaced.isManual).toBe(true);

    const kept = result.find((o) => o.id === "m2");
    expect(kept.name).toBe("Orc");
  });

  // ── Cycle 6: Count correctness ────────────────────────────────
  it("total = procedural (minus replaced) + all manual", () => {
    const procedural = [
      { id: "m1", type: "monster", name: "A" },
      { id: "m2", type: "monster", name: "B" },
      { id: "m3", type: "monster", name: "C" },
    ];
    const manual = [
      { id: "m2", type: "monster", name: "B-override", isManual: true },
      { id: "shop1", type: "shop", name: "Admin Shop", isManual: true },
    ];
    const result = mergeProceduralAndManual(procedural, manual);

    // 3 procedural - 1 replaced + 2 manual = 4
    expect(result).toHaveLength(4);
    expect(result.filter((o) => o.isManual).length).toBe(2);

    // m2 is the override version
    expect(result.find((o) => o.id === "m2").name).toBe("B-override");
  });
});
