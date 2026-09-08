import { describe, expect, it } from "vitest";

describe("smoke", () => {
  it("vitest 环境可用", () => {
    expect(1 + 1).toBe(2);
  });
});
