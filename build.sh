#!/bin/bash
set -e

# Build the extension
# Remove node_modules to ensure correct platform binaries are installed
# This fixes npm bug with optional dependencies: https://github.com/npm/cli/issues/4828
# CI is set by GitHub Actions, ACT is set by nektos/act
if [ -n "$CI" ] || [ -n "$ACT" ]; then
  rm -rf node_modules package-lock.json
fi
npm install
npm run build


