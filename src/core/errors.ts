// SPDX-License-Identifier: LGPL-3.0-only

/** Best-effort human-readable message for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) || String(error);
  } catch {
    return "Unknown error";
  }
}
