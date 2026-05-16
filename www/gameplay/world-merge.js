/**
 * Seed + Overrides: Merge procedural world with manual admin overrides.
 *
 * @param {Array} proceduralArr - Procedurally generated world objects
 * @param {Array} manualArr     - Manually placed objects from spawned_objects (isManual: true)
 * @returns {Array} Merged array where manual objects override procedural by id
 */
export function mergeProceduralAndManual(proceduralArr, manualArr) {
  const procedural = Array.isArray(proceduralArr) ? proceduralArr : [];
  const manual = Array.isArray(manualArr) ? manualArr : [];

  if (manual.length === 0) return [...procedural];
  if (procedural.length === 0) return [...manual];

  // Index manual IDs for O(1) lookup
  const manualById = new Map();
  for (const obj of manual) {
    if (obj.id) manualById.set(obj.id, obj);
  }

  // Keep procedural items that aren't overridden
  const merged = [];
  for (const obj of procedural) {
    if (obj.id && manualById.has(obj.id)) {
      // Manual override replaces this procedural object
      merged.push(manualById.get(obj.id));
      manualById.delete(obj.id); // consumed
    } else {
      merged.push(obj);
    }
  }

  // Append remaining manual items (new placements, not overrides)
  for (const obj of manual) {
    if (obj.id && manualById.has(obj.id)) {
      merged.push(obj);
    } else if (!obj.id) {
      merged.push(obj);
    }
  }

  return merged;
}
