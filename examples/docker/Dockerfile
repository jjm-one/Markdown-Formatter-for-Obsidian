# syntax=docker/dockerfile:1

# Runs the standalone CLI from a published GitHub Release — no checkout or build.
#   docker build -t markdown-formatter --build-arg VERSION=0.1.0 examples/docker
#   docker run --rm -v "$PWD:/workspace" markdown-formatter check .   # or: format .
# Runs as the unprivileged `node` user (uid 1000). If `format` can't write your
# mounted files, add --user "$(id -u):$(id -g)".

# Pinned by digest; Dependabot's `docker` updater bumps the tag and digest together.
FROM node:26.9.0-alpine@sha256:dbaa92e5758cbbcf85d65d5403fdb530fe3442cbe8c6dbfb7ef23365450d5070

# Release tag to download the CLI from (or "main-latest" / "develop-latest"). scripts/version-bump.mjs
# keeps this aligned with releases; check:versions enforces it.
ARG VERSION=0.1.0

LABEL org.opencontainers.image.source="https://github.com/jjm-one/Markdown-Formatter-for-Obsidian"
LABEL org.opencontainers.image.description="Standalone Markdown Formatter CLI"
LABEL org.opencontainers.image.licenses="LGPL-3.0-only"

ADD --chmod=644 \
  "https://github.com/jjm-one/Markdown-Formatter-for-Obsidian/releases/download/${VERSION}/markdown-formatter-cli.cjs" \
  /opt/markdown-formatter/cli.cjs

# Drop root: the node:alpine image ships an unprivileged `node` user (uid 1000).
USER node
WORKDIR /workspace
ENTRYPOINT ["node", "/opt/markdown-formatter/cli.cjs"]
CMD ["check", "."]
