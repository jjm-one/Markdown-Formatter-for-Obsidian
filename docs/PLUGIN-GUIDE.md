# Obsidian plugin guide

A step-by-step guide to installing, setting up, and using **Markdown Formatter** in Obsidian. No prior experience with formatters, linters, or config files is assumed.

If you just want a quick start: install the plugin, open a note, and run the command **Markdown Formatter: Format current Markdown file**. Everything else on this page is optional.

---

## Contents

- [Obsidian plugin guide](#obsidian-plugin-guide)
  - [Contents](#contents)
  - [What the plugin does](#what-the-plugin-does)
  - [Before you install](#before-you-install)
  - [Installing the plugin](#installing-the-plugin)
    - [Option A — BRAT (recommended)](#option-a--brat-recommended)
    - [Option B — Manual install](#option-b--manual-install)
    - [Option C — Latest development build](#option-c--latest-development-build)
  - [Your first format](#your-first-format)
  - [Ways to run the formatter](#ways-to-run-the-formatter)
  - [Automatic formatting](#automatic-formatting)
  - [The settings tab, explained](#the-settings-tab-explained)
    - [Project configuration](#project-configuration)
    - [Formatting triggers](#formatting-triggers)
    - [Formatter](#formatter)
    - [Note properties](#note-properties)
    - [Markdown structure formatting](#markdown-structure-formatting)
    - [Link formatting](#link-formatting)
    - [Obsidian compatibility](#obsidian-compatibility)
    - [Markdownlint](#markdownlint)
  - [Commands reference](#commands-reference)
  - [Excluding notes from formatting](#excluding-notes-from-formatting)
  - [Sharing one set of rules with other people](#sharing-one-set-of-rules-with-other-people)
  - [What happens when something is misconfigured](#what-happens-when-something-is-misconfigured)
  - [Troubleshooting](#troubleshooting)
  - [FAQ](#faq)

---

## What the plugin does

It tidies up the Markdown **text** of your notes so they follow one consistent style: even table columns, consistent list bullets, normalized spacing, a single blank line between sections, and so on. It uses two well-known tools under the hood — [Prettier](https://prettier.io/) and [markdownlint](https://github.com/DavidAnson/markdownlint) — plus a protective layer that leaves Obsidian-specific syntax alone.

Example. Before (raw text of a note):

```text
#My note
|Name|Role|
|-|-|
|Ada|Engineer|

*   first
*   second
```

After formatting:

```text
# My note

| Name | Role     |
| ---- | -------- |
| Ada  | Engineer |

- first
- second
```

Your note still renders exactly the same in Obsidian — only the raw text changed.

**It does not** touch how notes look in reading view, rename files, move notes, change your vault structure, or edit anything inside `[[wikilinks]]`, callouts, math, tags, or other Obsidian features (those are protected by default).

---

## Before you install

- **Desktop only.** This plugin needs Node.js features that Obsidian only provides on Windows, macOS, and Linux. It will not appear or run on Obsidian mobile. This is intentional.
- **Obsidian 1.13.7 or newer.** Check **Settings → About → Current version**. Update Obsidian if it is older.
- **Back up your vault** (or use version control) before running the formatter on many notes for the first time. Formatting rewrites file contents. It is designed to be safe and only writes when something actually changes, but a backup is always wise.
- **No warranty.** The plugin is free software provided "as is", with no warranty and no liability for data loss or other consequences — see the [Disclaimer](../README.md#disclaimer). Your backup is your safety net.

---

## Installing the plugin

> **Early release (0.x).** This plugin is **not** in Obsidian's Community Plugins browser yet — install it with **BRAT** (Option A) or **manually** (Option B). Keep a backup.

### Option A — BRAT (recommended)

[BRAT](https://github.com/TfTHacker/obsidian42-brat) is a community plugin that installs and auto-updates plugins straight from GitHub.

1. Install **Obsidian42 - BRAT** from the Community Plugins browser and enable it.
2. Open the command palette (`Ctrl/Cmd + P`) and run **BRAT: Add a beta plugin for testing**.
3. Paste the repository URL:
   `https://github.com/jjm-one/Markdown-Formatter-for-Obsidian`
4. Confirm. BRAT downloads the latest release and keeps it updated.
5. Go to **Settings → Community plugins** and make sure **Markdown Formatter** is enabled.

### Option B — Manual install

1. Open the project's **[Releases](https://github.com/jjm-one/Markdown-Formatter-for-Obsidian/releases)** page.
2. Under the latest release, download **`markdown-formatter-X.Y.Z.zip`**.
3. Find your vault's plugins folder:
   - In Obsidian: **Settings → Community plugins → Installed plugins**, click the small folder icon, **or**
   - open your vault folder in your file manager and go to `.obsidian/plugins/`
     (the `.obsidian` folder may be hidden — enable "show hidden files").
4. Extract the ZIP directly into `.obsidian/plugins/`. You should end up with:
   ```text
   <YourVault>/.obsidian/plugins/markdown-formatter/main.js
   <YourVault>/.obsidian/plugins/markdown-formatter/manifest.json
   <YourVault>/.obsidian/plugins/markdown-formatter/styles.css
   ```
5. Back in Obsidian: **Settings → Community plugins**, click the reload icon (or restart Obsidian), then enable **Markdown Formatter**.

To update later, download the newer ZIP and replace the folder contents.

### Option C — Latest development build

Every successful CI run on `main` publishes a rolling **`main-latest`** prerelease. It is intentionally mutable and meant for testing the newest code, not for stable use. Manually extract `markdown-formatter-main.zip` from that prerelease into the plugin folder as in Option B:

```text
https://github.com/jjm-one/Markdown-Formatter-for-Obsidian/releases/download/main-latest/markdown-formatter-main.zip
```

Its manifest version is stamped `0.1.0.main.<run>.<sha>`, and the archived `build-info.json` records the exact source commit.

---

## Your first format

1. Open any Markdown note.
2. Open the command palette: `Ctrl + P` (Windows/Linux) or `Cmd + P` (macOS).
3. Run **Markdown Formatter: Format current Markdown file**.

You will see a small notice in the corner:

- **"Formatted <note>."** — the note was tidied up.
- **"<note> is already formatted."** — nothing needed changing.
- **"<note> is excluded from formatting."** — the note matches an ignore rule (see [Excluding notes](#excluding-notes-from-formatting)).

Nothing is formatted automatically until you turn on one of the automatic modes below.

---

## Ways to run the formatter

All of these do the same thing to the **currently active note**:

| Method          | How                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------- |
| Command palette | `Ctrl/Cmd + P` → _Format current Markdown file_                                                     |
| Ribbon button   | Click the **wand** icon in the left sidebar                                                         |
| Hotkey          | **Settings → Hotkeys**, search "Markdown Formatter", assign a key to _Format current Markdown file_ |

The ribbon button can be hidden — see [Formatting triggers → Show ribbon button](#formatting-triggers).

---

## Automatic formatting

By default the plugin only runs when you ask it to. You can also let it run on its own. Turn these on in **Settings → Markdown Formatter → Formatting triggers**.

| Mode                                         | What it does                                                                 | Good for                                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Continuous formatting** (`formatOnModify`) | Formats a note a short time after you stop editing it and Obsidian saves it. | People who want notes always tidy without thinking about it.  |
| **Format on file open** (`formatOnOpen`)     | Formats a note the moment you open it.                                       | Cleaning up notes as you revisit them.                        |
| **Format on file close** (`formatOnClose`)   | Formats a note when you close its last open tab.                             | Tidying on the way out, with less interruption while writing. |

**Continuous formatting** waits for a pause (the **Debounce** setting, 900 ms by default) so it is not reformatting on every keystroke. If you find it disruptive while writing, increase the debounce (e.g. 3000 ms) or use _Format on file close_ instead.

Recommendation for a first-time setup: leave all three **off**, use the manual command for a while, and turn on _Format on file close_ once you trust the output.

---

## The settings tab, explained

Open **Settings → Markdown Formatter**. The settings pane is searchable — type a word to jump to a setting.

Most settings are one of two kinds:

- **Normalize / Prettier** — let the formatter rewrite this to a consistent style.
- **Preserve** — leave this exactly as you typed it.

The safe defaults preserve everything that is specific to Obsidian and normalize only "plain" Markdown.

### Project configuration

**Where your settings live.** If your vault has a `.markdown-formatter.json` file (and _Use vault project configuration_ is on), that file **is** your settings: the tab shows its values, and every change you make in the tab is written straight back to it. If there is no such file, the tab edits the plugin's own settings instead. A file always wins over the plugin settings.

This means the file and the settings tab can never drift apart. Edit the file in another app, or sync it from another device, and the tab updates automatically. Change something in the tab, and the file updates. Use **Create config** to turn your current settings into a file you can commit; after that, editing happens in the file.

| Setting                                                 | Meaning                                                                                                                                                                                   |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Use vault project configuration**                     | On by default. When on and a `.markdown-formatter.json` exists, that file is the settings store (read and written). Turn off to always use the plugin's own settings and ignore any file. |
| **Project configuration file**                          | Where that file lives, relative to the vault root. The default is fine for almost everyone.                                                                                               |
| **Create config** button                                | Writes `.markdown-formatter.json` into your vault, seeded with your current settings, so you can commit and share it. From then on the tab edits that file.                               |
| **Reload config** button                                | Forces a re-read. It already reloads on its own when the file changes; this is just a manual override.                                                                                    |
| **Create ignore file** / **Reload ignore file** buttons | Same idea for the `.markdown-formatter-ignore` file that lists notes to skip.                                                                                                             |

See [Sharing one set of rules with other people](#sharing-one-set-of-rules-with-other-people).

### Formatting triggers

| Setting                   | Default | Meaning                                                                                         |
| ------------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| **Continuous formatting** | Off     | Format after you edit and Obsidian saves.                                                       |
| **Format on file open**   | Off     | Format when a note is opened.                                                                   |
| **Format on file close**  | Off     | Format when a note's last tab is closed.                                                        |
| **Show ribbon button**    | On      | Show the wand button in the left sidebar.                                                       |
| **Debounce**              | 900 ms  | How long to wait after your last edit before _continuous formatting_ runs. Range 250–600000 ms. |

### Formatter

| Setting                                            | Default  | Meaning                                                                                                                                                                                                                                     |
| -------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Use project Prettier and EditorConfig settings** | On       | Also read any `.editorconfig` or Prettier config file that applies to the note (for indent size, line endings, etc.). If you have no such files, this does nothing. Turn off only if a config file is producing output you don't want.      |
| **Prose wrapping**                                 | Preserve | What to do with long paragraphs of text. **Preserve**: leave your line breaks exactly as they are (recommended). **Always wrap**: hard-wrap paragraphs at the configured width. **Never wrap**: join wrapped paragraphs into one long line. |

### Note properties

| Setting                               | Default   | Meaning                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Refresh the updated-date property** | Off       | Sets an "updated" frontmatter property to today's date whenever you edit an open note — even if it was already clean and nothing was reformatted — using the date format from Obsidian's **Settings → General → Date format**. The property is only touched if it is **already present**; it is never added, and notes without it are left alone. |
| **Updated-date property name**        | `updated` | Which frontmatter key to refresh, e.g. `updated`, `modified`, or `Last Update`. 1–64 letters, digits, spaces, hyphens, or underscores.                                                                                                                                                                                                            |

### Markdown structure formatting

Each of these can **Normalize with Prettier** or **Preserve source syntax**.

| Setting                | Default      | "Normalize" does this                                                   | Preserve when…                                                                                                                         |
| ---------------------- | ------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Tables**             | Normalize    | Aligns columns and pads cells: `\|a\|b\|` → `\| a \| b \|`              | You hand-format tables a specific way, or use plugin table syntax.                                                                     |
| **Lists**              | Normalize    | Consistent bullets (`-`), consistent numbering, consistent indentation. | You rely on exact list markers or spacing.                                                                                             |
| **Fenced code blocks** | **Preserve** | Re-indents / reformats the code inside ` ``` ` fences by language.      | Almost always keep **Preserve** — it protects Mermaid diagrams, Dataview queries, and other plugin code blocks from being "corrected". |
| **Blockquotes**        | Normalize    | Consistent `>` spacing and blank lines around quotes.                   | You have carefully laid-out nested quotes.                                                                                             |
| **Horizontal rules**   | Normalize    | Makes every `***` / `---` / `___` divider use one consistent style.     | You use different rule styles on purpose.                                                                                              |

### Link formatting

| Setting                           | Default   | Meaning                                                                                       |
| --------------------------------- | --------- | --------------------------------------------------------------------------------------------- |
| **Markdown links**                | Normalize | Standard `[text](url)` links get consistent spacing.                                          |
| **Reference definitions**         | Preserve  | Lines like `[docs]: https://example.com` are left as-is.                                      |
| **Obsidian wikilinks and embeds** | Preserve  | `[[Note]]`, `[[Note\|Alias]]`, `![[image.png]]` are never touched. Keep this on **Preserve**. |
| **Autolinks**                     | Preserve  | `<https://example.com>` style links are left as-is.                                           |

### Obsidian compatibility

These protect syntax that means something special in Obsidian. Each can **Preserve for Obsidian** (default, recommended) or **Allow formatter**.

If you switch one of these to _Allow formatter_, a generic Markdown formatter may reshape it — for example turning a display-math block `$$ ... $$` into inline math, or "fixing" a `#tag` into a heading. Keep them on **Preserve** unless you have a specific reason.

| Setting                        | Protects                                    | Example that a generic formatter could break                          |
| ------------------------------ | ------------------------------------------- | --------------------------------------------------------------------- |
| **Properties and frontmatter** | The YAML block at the top of a note.        | Reordering or reflowing your `tags:` / `aliases:` list.               |
| **Callouts**                   | `> [!note]`, fold markers `+`/`-`, nesting. | Collapsing `> [!warning]-` spacing so Obsidian stops recognizing it.  |
| **Block IDs**                  | `^block-id` anchors used by block links.    | Removing or moving the `^id`.                                         |
| **Comments**                   | `%% hidden text %%`.                        | Rewrapping or deleting comment spacing.                               |
| **MathJax**                    | `$inline$` and `$$display$$` math.          | Changing spacing inside formulas, or merging `$$` into `$`.           |
| **Tags**                       | `#tag` and `#nested/tag`.                   | Turning `#roadmap` at the start of a line into a `# roadmap` heading. |
| **Inline footnotes**           | `^[footnote text]`.                         | Splitting the footnote across lines.                                  |
| **Highlights**                 | `==highlighted==`.                          | Adding spaces that stop the highlight from rendering.                 |

### Markdownlint

| Setting                        | Default              | Meaning                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Apply markdownlint fixes**   | On                   | After Prettier runs, also apply safe automatic fixes from markdownlint rules (things Prettier doesn't handle). Turn off to let Prettier be the only formatter.                                                                                                                                                                               |
| **Markdownlint configuration** | (a small JSON block) | Advanced: which markdownlint rules are on/off. You rarely need to touch this. The defaults are chosen to work well with Obsidian; see [Configuration → markdownlint](CONFIGURATION.md#markdownlint) for exactly which rules are disabled and why. If you edit the JSON and it is invalid, the plugin ignores it and keeps the safe defaults. |

---

## Commands reference

Open the command palette (`Ctrl/Cmd + P`) and type "Markdown Formatter".

| Command                               | What it does                                                                                                                                                                                             |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Format current Markdown file**      | Formats the active note. Safe to assign a hotkey.                                                                                                                                                        |
| **Create project configuration file** | Writes `.markdown-formatter.json` into your vault, seeded with your current settings, so you can commit it. From then on the settings tab reads and writes that file. Does nothing if it already exists. |
| **Reload project configuration**      | Re-reads that file. Usually automatic — use this only to force it.                                                                                                                                       |
| **Create formatting ignore file**     | Creates a starter `.markdown-formatter-ignore` file with commented examples.                                                                                                                             |
| **Reload formatting ignore file**     | Re-reads the ignore file. Usually automatic — use this only to force it.                                                                                                                                 |
| **Reload plugin settings**            | Re-reads the plugin's own settings from disk (after an external edit or a sync from another device).                                                                                                     |

Every configuration source (project config, ignore file, plugin settings, `.editorconfig`, Prettier config) is re-read automatically when it changes — on file change, on window focus, or when you open the settings tab. The commands above are just a manual override; you never need to restart Obsidian.

---

## Excluding notes from formatting

Create a file named **`.markdown-formatter-ignore`** in your vault's root folder (or use the **Create formatting ignore file** command). List one pattern per line. Matching notes are never formatted — not by the manual command, the ribbon, a hotkey, or any automatic mode.

```gitignore
# Lines starting with # are comments.

# Skip everything under a Templates folder
Templates/**

# Skip any note whose name ends with .generated.md, anywhere
*.generated.md

# Skip Markdown anywhere under Archive, including sub-folders
Archive/**/*.md

# ...but still format this one specific note
!important.generated.md
```

Pattern rules (same style as `.gitignore`):

| Syntax     | Meaning                                                |
| ---------- | ------------------------------------------------------ |
| `*`        | Any characters within **one** folder/name segment      |
| `**`       | Crosses folder boundaries (any depth)                  |
| `?`        | Exactly one character                                  |
| `!pattern` | Re-include something an earlier line excluded          |
| `/name.md` | Anchored to the vault root (won't match `Sub/name.md`) |
| `folder/`  | The folder and everything in it                        |
| `# text`   | Comment                                                |

The ignore file reloads automatically when it changes; **Reload formatting ignore file** forces it.

---

## Sharing one set of rules with other people

If several people use the same vault (via git, Syncthing, a shared drive, etc.), put the rules in a file so everyone gets the same behavior.

1. Run the command **Create project configuration file**. This writes `.markdown-formatter.json` to the vault root, seeded with your current settings.
2. Adjust it — either in the settings tab (changes are saved straight to the file) or in a text editor (the tab picks the change up automatically). **Every field is optional**; delete the ones you don't care about and they fall back to the built-in defaults.
3. Commit the file to version control.

A minimal example that only changes two things:

```json
{
  "$schema": "https://raw.githubusercontent.com/jjm-one/Markdown-Formatter-for-Obsidian/main/.markdown-formatter.schema.json",
  "formatOnClose": true,
  "proseWrap": "preserve"
}
```

The `$schema` line lets editors like VS Code autocomplete and validate the file. The same file is read by the [command-line tool](CLI-GUIDE.md), so a CI check matches what Obsidian does.

Full field reference and precedence: [Configuration](CONFIGURATION.md). What each Obsidian construct's "preserve" means: [Obsidian compatibility](OBSIDIAN-COMPATIBILITY.md).

---

## What happens when something is misconfigured

The plugin is deliberately cautious. If it cannot trust its configuration, it **stops formatting** rather than guessing:

- A `.markdown-formatter.json` that is not valid JSON, or that contains an unknown option → formatting is disabled until you fix the file and reload it. You get a notice explaining what's wrong.
- A `.markdown-formatter-ignore` file that exists but cannot be read → same: formatting is paused until it loads cleanly (so a note isn't formatted just because its "skip" rule failed to load).
- Corrupted saved plugin settings → the plugin silently falls back to safe defaults and tells you.

Just fix and save the file — the plugin reloads it automatically and formatting resumes. The **Reload** commands and buttons are there if you want to force it.

---

## Troubleshooting

**The plugin doesn't show up in the plugin list.**
It is desktop-only — it will not appear on mobile. On desktop, make sure the folder is `.obsidian/plugins/markdown-formatter/` and contains `main.js` and `manifest.json`, then reload plugins.

**"Failed to load plugin" on startup.**
Your Obsidian is likely older than 1.13.7. Update Obsidian (**Settings → About**).

**Nothing happens when I run the format command.**
Check the note is a `.md` file and is the active tab. If you see "excluded from formatting", it matches a line in your ignore file. If you see a message about invalid configuration, fix `.markdown-formatter.json` and reload it.

**Continuous formatting interrupts my writing.**
Increase **Debounce** (e.g. to 3000 ms), or turn off _Continuous formatting_ and use _Format on file close_.

**A code block / Mermaid diagram / Dataview query got reformatted.**
Set **Markdown structure formatting → Fenced code blocks** to **Preserve source syntax** (that is the default — check it wasn't changed).

**My tables/lists changed and I didn't want that.**
Set the matching option under **Markdown structure formatting** to **Preserve source syntax**.

**A note keeps getting reformatted every time it saves.**
That should not happen — formatting is stable (running it twice produces the same result). If you can reproduce it with a specific note, please open an issue with a minimal example.

**I want to undo a format.**
Use Obsidian's undo (`Ctrl/Cmd + Z`) right after, or restore the file from your backup / version control. There is no built-in "revert formatting" command.

---

## FAQ

**Does this change how my notes look in reading view?**
No. It only rewrites the raw Markdown into an equivalent form. Rendered output is unchanged.

**Will it touch my `[[links]]`, tags, callouts, or math?**
No, not with the default settings — those are all preserved. You would have to explicitly switch a setting under _Obsidian compatibility_ or _Link formatting_ to `Allow formatter` / `Normalize`.

**Does it work on mobile?**
No. It relies on desktop-only capabilities. This is a permanent design decision, not a missing feature.

**Can it format my whole vault at once?**
The plugin formats one note at a time. To format many files in bulk, use the [command-line tool](CLI-GUIDE.md), which scans a whole folder.

**Where are my settings stored?**
Personal settings: in your vault's `.obsidian/plugins/markdown-formatter/data.json`. Shared settings (optional): in `.markdown-formatter.json` at the vault root.

**Is it safe to run on hundreds of notes?**
Yes, but take a backup first. It only writes a file when the formatted result differs from the current content, and running it again on an already-formatted note does nothing.
