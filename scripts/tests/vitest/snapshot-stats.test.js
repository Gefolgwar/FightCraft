/**
 * TDD Tests for computeSnapshotStats()
 *
 * Issue #13: Snapshot Stats Optimization & Right Sidebar Rendering
 * AC1: Generating a snapshot saves pre-calculated object counts
 */
import { describe, it, expect } from "vitest";
import { computeSnapshotStats } from "../../../www/gameplay/snapshot-stats.js";

// ─── Slice 1: Empty array → zero counts ───
describe("computeSnapshotStats", () => {
  it("returns zero counts and neutral levels for empty array", () => {
    const result = computeSnapshotStats([]);

    expect(result.counts.monster).toBe(0);
    expect(result.counts.shop).toBe(0);
    expect(result.counts.vault).toBe(0);
    expect(result.counts.castle).toBe(0);
    expect(result.counts.citadel).toBe(0);
    expect(result.counts.other).toBe(0);
    expect(result.counts.total).toBe(0);
    expect(result.levels.min).toBe(0);
    expect(result.levels.max).toBe(0);
    expect(result.levels.avg).toBe(0);
  });

  // ─── Slice 2: Single-type objects → correct count ───
  it("counts monsters correctly", () => {
    const objects = [
      { type: "monster", level: 5 },
      { type: "monster", level: 10 },
      { type: "monster", level: 3 },
    ];
    const result = computeSnapshotStats(objects);

    expect(result.counts.monster).toBe(3);
    expect(result.counts.total).toBe(3);
  });

  // ─── Slice 3: Mixed types → correct per-type counts ───
  it("counts mixed entity types correctly", () => {
    const objects = [
      { type: "monster", level: 5 },
      { type: "shop", level: 1 },
      { type: "vault", level: 3 },
      { type: "castle", level: 8 },
      { type: "monster", level: 12 },
      { type: "shop", level: 2 },
    ];
    const result = computeSnapshotStats(objects);

    expect(result.counts.monster).toBe(2);
    expect(result.counts.shop).toBe(2);
    expect(result.counts.vault).toBe(1);
    expect(result.counts.castle).toBe(1);
    expect(result.counts.citadel).toBe(0);
    expect(result.counts.total).toBe(6);
  });

  // ─── Slice 4: Citadel detection (icon, name, templateId) ───
  it("detects citadels by icon", () => {
    const objects = [{ type: "castle", icon: "🏯", level: 10 }];
    const result = computeSnapshotStats(objects);

    expect(result.counts.citadel).toBe(1);
    expect(result.counts.castle).toBe(0);
  });

  it('detects citadels by name containing "Citadel"', () => {
    const objects = [{ type: "castle", name: "Berlin Citadel", level: 15 }];
    const result = computeSnapshotStats(objects);

    expect(result.counts.citadel).toBe(1);
    expect(result.counts.castle).toBe(0);
  });

  it('detects citadels by templateId containing "citadel"', () => {
    const objects = [
      { type: "castle", templateId: "citadel_berlin_01", level: 20 },
    ];
    const result = computeSnapshotStats(objects);

    expect(result.counts.citadel).toBe(1);
    expect(result.counts.castle).toBe(0);
  });

  // ─── Slice 5: Level stats ───
  it("computes level stats (min, max, avg)", () => {
    const objects = [
      { type: "monster", level: 2 },
      { type: "monster", level: 8 },
      { type: "shop", level: 5 },
    ];
    const result = computeSnapshotStats(objects);

    expect(result.levels.min).toBe(2);
    expect(result.levels.max).toBe(8);
    expect(result.levels.avg).toBe(5);
  });

  it("defaults level to 1 when object has no level field", () => {
    const objects = [{ type: "monster" }, { type: "monster", level: 5 }];
    const result = computeSnapshotStats(objects);

    expect(result.levels.min).toBe(1);
    expect(result.levels.max).toBe(5);
    expect(result.levels.avg).toBe(3);
  });

  // ─── Slice 6: Unknown types go to "other" ───
  it("counts unknown types as other", () => {
    const objects = [
      { type: "treasure", level: 1 },
      { type: "npc", level: 3 },
    ];
    const result = computeSnapshotStats(objects);

    expect(result.counts.other).toBe(2);
    expect(result.counts.total).toBe(2);
  });
});
