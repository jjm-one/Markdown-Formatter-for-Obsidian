// SPDX-FileCopyrightText: 2026 jjm.one
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from "vitest";
import { describeBuild } from "../src/core";

describe("describeBuild", () => {
  it("names version, channel, short commit, and date", () => {
    expect(
      describeBuild({
        version: "1.2.3",
        channel: "release",
        commit: "0123456789ab",
        date: "2026-10-14T12:00:00+02:00",
      }),
    ).toBe("1.2.3 (release build, commit 0123456789ab, 2026-10-14)");
    expect(describeBuild()).toBe("development (development build)");
  });
});
