// SPDX-License-Identifier: LGPL-3.0-only

// jazzer.js fuzz target: throw arbitrary bytes at the whole `formatMarkdown()`
// pipeline (regex-heavy tokenization, Prettier, markdownlint, restore passes).
// `core.cjs` is an esbuild bundle of `src/core` — run `npm run build:fuzz`.

const { formatMarkdown, effectiveSettingsFromProject } = require("./core.cjs");

const settings = effectiveSettingsFromProject(null);

module.exports.fuzz = async function (data) {
  const markdown = data.toString("utf-8");

  try {
    await formatMarkdown(markdown, "/fuzz/note.md", settings);
  } catch (error) {
    // `Could not format ...` is the core rejecting pathological input — expected.
    // Anything else is a real defect.
    if (!(error instanceof Error) || !error.message.startsWith("Could not format")) {
      throw error;
    }
  }
};
