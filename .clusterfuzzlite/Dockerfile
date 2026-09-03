# OSS-Fuzz build environment for `fuzz/format.fuzz.cjs`. Not run in CI
# (.github/workflows/fuzz.yml runs jazzer.js directly); kept ready for OSS-Fuzz.
FROM gcr.io/oss-fuzz-base/base-builder-javascript@sha256:2e218dedc1603f15e34cec784030789e06db1df8eb5356f0a8e27285619ac8c2

COPY . $SRC/markdown-formatter
WORKDIR $SRC/markdown-formatter
COPY .clusterfuzzlite/build.sh $SRC/
