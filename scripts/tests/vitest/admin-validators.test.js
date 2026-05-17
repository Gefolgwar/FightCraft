import { describe, it, expect } from "vitest";
import { validateCitadelCollisions } from "../../../www/maintenance/admin-validators.js";

describe("validateCitadelCollisions", () => {
  // A mock H3 provider that simply concatenates lat/lng to simulate grid bucketing
  const mockH3Provider = {
    latLngToH3: (lat, lng, resolution) => {
      // For testing, just truncate to 1 decimal place to simulate a "cell"
      const rLat = Math.round(lat * 10) / 10;
      const rLng = Math.round(lng * 10) / 10;
      return `${rLat},${rLng},${resolution}`;
    },
  };

  it("should return an empty array if no manual citadels exist", () => {
    const config = [
      { templateId: "t1", type: "generated", count: 1, lat: 10.0, lng: 20.0 },
      { templateId: "t2", type: "manual", count: 0, lat: 10.0, lng: 20.0 },
    ];
    const result = validateCitadelCollisions(config, mockH3Provider);
    expect(result).toEqual([]);
  });

  it("should return an empty array if manual citadels are in different cells", () => {
    const config = [
      { templateId: "t1", type: "manual", count: 1, lat: 10.1, lng: 20.1 },
      { templateId: "t2", type: "manual", count: 1, lat: 50.5, lng: 60.6 },
    ];
    const result = validateCitadelCollisions(config, mockH3Provider);
    expect(result).toEqual([]);
  });

  it("should return colliding templateIds when two manual citadels share the same cell", () => {
    const config = [
      { templateId: "t1", type: "manual", count: 1, lat: 10.11, lng: 20.11 }, // Math.round makes it 10.1, 20.1
      { templateId: "t2", type: "manual", count: 1, lat: 10.14, lng: 20.14 }, // Math.round makes it 10.1, 20.1
      { templateId: "t3", type: "manual", count: 1, lat: 50.5, lng: 60.6 },
    ];
    const result = validateCitadelCollisions(config, mockH3Provider);
    expect(result).toContain("t1");
    expect(result).toContain("t2");
    expect(result).not.toContain("t3");
    expect(result.length).toBe(2);
  });

  it("should ignore citadels missing coordinates", () => {
    const config = [
      { templateId: "t1", type: "manual", count: 1 }, // No lat/lng
      { templateId: "t2", type: "manual", count: 1, lat: 10.1, lng: 20.1 },
    ];
    const result = validateCitadelCollisions(config, mockH3Provider);
    expect(result).toEqual([]);
  });

  it("should handle graceful fallback if config is empty or invalid", () => {
    expect(validateCitadelCollisions([], mockH3Provider)).toEqual([]);
    expect(validateCitadelCollisions(null, mockH3Provider)).toEqual([]);
  });
});
