// SPDX-License-Identifier: LGPL-3.0-only
import { afterEach, vi } from "vitest";

// The plugin uses `window.setTimeout`/`clearTimeout`; alias `window` to globalThis
// so those calls work under the Node test environment.
Object.defineProperty(globalThis, "window", {
  value: globalThis,
  configurable: true,
  writable: true,
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
