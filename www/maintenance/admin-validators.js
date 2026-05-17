/**
 * Validates citadel configuration entries to ensure no two manual citadels
 * are placed in the same H3 resolution 7 cell.
 *
 * @param {Array} configEntries - The array of working configuration entries.
 * @param {Object} h3Provider - An object providing the latLngToH3(lat, lng, res) method.
 * @returns {Array<string>} An array of conflicting templateIds. Empty if no collisions.
 */
export function validateCitadelCollisions(configEntries, h3Provider) {
  if (!configEntries || !Array.isArray(configEntries)) return [];
  if (!h3Provider || typeof h3Provider.latLngToH3 !== "function") return [];

  const manualCitadels = configEntries.filter(
    (entry) =>
      entry.type === "manual" &&
      entry.count > 0 &&
      typeof entry.lat === "number" &&
      typeof entry.lng === "number"
  );

  const cellMap = new Map();
  const conflictingTemplateIds = new Set();

  for (const entry of manualCitadels) {
    const cellId = h3Provider.latLngToH3(entry.lat, entry.lng, 7);

    if (cellMap.has(cellId)) {
      // Collision detected! Add both the current and the previously stored templateId.
      conflictingTemplateIds.add(entry.templateId);
      conflictingTemplateIds.add(cellMap.get(cellId));
    } else {
      cellMap.set(cellId, entry.templateId);
    }
  }

  return Array.from(conflictingTemplateIds);
}
