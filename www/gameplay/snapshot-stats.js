/**
 * Snapshot Stats — Pure computation module
 *
 * Computes entity statistics from a world objects array.
 * Used at save-time (to embed stats in Firestore snapshot documents)
 * and at render-time (as a fallback when pre-computed stats are missing).
 *
 * @module snapshot-stats
 */

/**
 * Compute entity statistics from a world objects array.
 *
 * @param {Array<Object>} objects — array of world objects (monsters, shops, etc.)
 * @returns {{ counts: { monster: number, shop: number, vault: number, castle: number, citadel: number, other: number, total: number }, levels: { min: number, max: number, avg: number } }}
 */
export function computeSnapshotStats(objects) {
  const arr = objects || [];
  const counts = {
    monster: 0,
    shop: 0,
    vault: 0,
    castle: 0,
    citadel: 0,
    other: 0,
    total: 0,
  };
  let levelMin = Infinity;
  let levelMax = 0;
  let levelSum = 0;

  for (const o of arr) {
    // Citadel detection: icon, name, or templateId
    const isCitadel =
      o.icon === "\ud83c\udfef" ||
      (o.name && o.name.includes("Citadel")) ||
      (o.templateId && o.templateId.includes("citadel"));

    if (isCitadel) counts.citadel++;
    else if (o.type === "monster") counts.monster++;
    else if (o.type === "shop") counts.shop++;
    else if (o.type === "vault") counts.vault++;
    else if (o.type === "castle") counts.castle++;
    else counts.other++;

    const lvl = o.level || 1;
    if (lvl < levelMin) levelMin = lvl;
    if (lvl > levelMax) levelMax = lvl;
    levelSum += lvl;
  }

  counts.total = arr.length;

  return {
    counts,
    levels: {
      min: arr.length ? levelMin : 0,
      max: arr.length ? levelMax : 0,
      avg: arr.length ? Math.round((levelSum / arr.length) * 10) / 10 : 0,
    },
  };
}
