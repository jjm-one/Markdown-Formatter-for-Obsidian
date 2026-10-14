# Security Policy

## Supported versions

Security fixes land on `main` and ship in the next release. Only the most recent release is supported; older 0.x releases are not. Once `1.0.0` is released, this will move to a per-release-line policy.

| Version        | Supported |
| -------------- | --------- |
| 0.2.1          | Yes       |
| Older releases | No        |

## Reporting a vulnerability

Prefer GitHub's private vulnerability reporting / Security Advisory flow for this repository when it is available:

`https://github.com/jjm-one/Markdown-Formatter-for-Obsidian/security`

Do not include private vault content, secrets, personal notes, or credentials in a public issue. If a public issue is the only available route, report only the existence and impact of the problem and use synthetic Markdown examples.

Useful reports include the affected plugin version, Obsidian version, operating system, reproduction steps using non-sensitive content, and the expected impact.

## Security model

Formatting never runs code from the folder being formatted unless you opt in. Prettier configuration that can execute code — JavaScript/TypeScript config files, a config that names a shared-config package, and Prettier `plugins` — is refused or ignored by default. Opt in per device with the plugin's **Trust Prettier configuration** setting, or per run with the CLI's `--trust-prettier-config`, and only for vaults or repositories you trust. The opt-in is never read from the vault or from `.markdown-formatter.json`. Details: [Configuration → EditorConfig and Prettier](docs/CONFIGURATION.md#editorconfig-and-prettier).
