# syntax=docker/dockerfile:1

# Runs the standalone CLI from a published GitHub Release — no checkout or build.
#   docker build -t markdown-formatter --build-arg VERSION=0.2.1 examples/docker
#   docker run --rm -v "$PWD:/workspace" markdown-formatter check .   # or: format .
# Runs as the unprivileged `node` user (uid 1000). If `format` can't write your
# mounted files, add --user "$(id -u):$(id -g)".

# Pinned by digest; Dependabot's `docker` updater bumps the tag and digest together.
FROM node:26.12.0-alpine@sha256:6f08a523443ddedf52941874c203475b0ad503e859ad70cb26ab8be9a517dbd5

# Release tag to download the CLI from (or "main-latest" / "develop-latest"). scripts/version-bump.mjs
# keeps this aligned with releases; check:versions enforces it.
ARG VERSION=0.2.1

LABEL org.opencontainers.image.source="https://github.com/jjm-one/Markdown-Formatter-for-Obsidian"
LABEL org.opencontainers.image.description="Standalone Markdown Formatter CLI"
LABEL org.opencontainers.image.licenses="LGPL-3.0-only"

# To pin the exact file, add --checksum=sha256:<hash> (verify the release asset first with
# `gh attestation verify markdown-formatter-cli.cjs --repo jjm-one/Markdown-Formatter-for-Obsidian`).
ADD --chmod=644 \
  "https://github.com/jjm-one/Markdown-Formatter-for-Obsidian/releases/download/${VERSION}/markdown-formatter-cli.cjs" \
  /opt/markdown-formatter/cli.cjs

# Drop root: the node:alpine image ships an unprivileged `node` user (uid 1000).
USER node
WORKDIR /workspace
ENTRYPOINT ["node", "/opt/markdown-formatter/cli.cjs"]
CMD ["check", "."]
