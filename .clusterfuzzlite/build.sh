#!/bin/bash -eu
# SPDX-FileCopyrightText: 2026 jjm.one
# SPDX-License-Identifier: LGPL-3.0-only
# Build the fuzz target for ClusterFuzzLite / OSS-Fuzz.

npm ci --no-audit --no-fund

# Bundle the shared formatter core to CommonJS so the fuzz target can require it.
npm run build:fuzz

compile_javascript_fuzzer markdown-formatter fuzz/format.fuzz.cjs
