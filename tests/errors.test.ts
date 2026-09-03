// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from "vitest";
import { errorMessage } from "../src/core";

describe("errorMessage", () => {
  it("unwraps Error, passes strings through, and stringifies other values", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage({ code: "ENOENT" })).toBe('{"code":"ENOENT"}');
  });

  it("falls back to a fixed message when a value cannot be stringified", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(errorMessage(circular)).toBe("Unknown error");
  });
});
