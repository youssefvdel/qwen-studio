import { describe, it, expect } from "vitest";

// Test the compareVersions function logic
// Extracted from src/main/index.ts for unit testing
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

describe("Version Comparison", () => {
  it("should return -1 when a < b", () => {
    expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
    expect(compareVersions("1.2.3", "1.2.4")).toBe(-1);
  });

  it("should return 0 when versions are equal", () => {
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("2.1.0", "2.1.0")).toBe(0);
  });

  it("should return 1 when a > b", () => {
    expect(compareVersions("2.0.0", "1.0.0")).toBe(1);
    expect(compareVersions("1.2.4", "1.2.3")).toBe(1);
  });

  it("should handle missing version parts", () => {
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("1", "1.0.0")).toBe(0);
  });
});
