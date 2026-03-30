# cue-ts - justfile
# Run `just` or `just help` to see available commands

# Default recipe: show help
default:
    @just --list --unsorted

# ============================================================================
# Development
# ============================================================================

# Install dependencies
install:
    pnpm install

# Install dependencies (frozen lockfile, for CI)
install-frozen:
    pnpm install --frozen-lockfile

# Run tests (watch mode)
test *ARGS:
    pnpm test {{ ARGS }}

# Run tests once
test-run:
    pnpm test --run

# Run linter (Biome)
lint:
    pnpm lint

# Run all checks (lint + test)
check: lint test-run

# CI workflow (install, lint, test)
ci: install-frozen lint test-run

# ============================================================================
# Build
# ============================================================================

# Build WASM module
wasm-build:
    cd ./wasm && wasm-pack build --target web --release

# Build library
build:
    pnpm build

# Build everything (WASM + TypeScript)
build-all: wasm-build build

# Clean build artifacts
clean:
    rm -rf ./dist ./wasm/pkg

# Clean everything including dependencies
clean-all: clean
    rm -rf ./node_modules

# ============================================================================
# Changelog (git-cliff)
# ============================================================================

# Generate full changelog
changelog:
    git cliff -o CHANGELOG.md

# Preview unreleased changes
changelog-preview:
    git cliff --unreleased

# ============================================================================
# Version Management
# ============================================================================

# Show current version
version:
    @echo "Current version: $(jq -r .version package.json)"

# Bump patch version (0.1.0 → 0.1.1)
bump-patch:
    #!/bin/sh
    set -e
    CURRENT=$(jq -r '.version' package.json)
    echo "Current version: $CURRENT"
    MAJOR=$(echo "$CURRENT" | cut -d. -f1)
    MINOR=$(echo "$CURRENT" | cut -d. -f2)
    PATCH=$(echo "$CURRENT" | cut -d. -f3)
    NEW="$MAJOR.$MINOR.$((PATCH + 1))"
    echo "New version: $NEW"
    jq --arg v "$NEW" '.version = $v' package.json > package.json.tmp && mv package.json.tmp package.json
    git add package.json
    git commit -m "chore(release): bump version to $NEW"
    git tag "v$NEW"
    echo ""
    echo "Created tag v$NEW"
    echo ""
    echo "Push with:"
    echo "  git push origin main --tags"

# Bump minor version (0.1.0 → 0.2.0)
bump-minor:
    #!/bin/sh
    set -e
    CURRENT=$(jq -r '.version' package.json)
    echo "Current version: $CURRENT"
    MAJOR=$(echo "$CURRENT" | cut -d. -f1)
    MINOR=$(echo "$CURRENT" | cut -d. -f2)
    NEW="$MAJOR.$((MINOR + 1)).0"
    echo "New version: $NEW"
    jq --arg v "$NEW" '.version = $v' package.json > package.json.tmp && mv package.json.tmp package.json
    git add package.json
    git commit -m "chore(release): bump version to $NEW"
    git tag "v$NEW"
    echo ""
    echo "Created tag v$NEW"
    echo ""
    echo "Push with:"
    echo "  git push origin main --tags"

# Bump major version (0.1.0 → 1.0.0)
bump-major:
    #!/bin/sh
    set -e
    CURRENT=$(jq -r '.version' package.json)
    echo "Current version: $CURRENT"
    MAJOR=$(echo "$CURRENT" | cut -d. -f1)
    NEW="$((MAJOR + 1)).0.0"
    echo "New version: $NEW"
    jq --arg v "$NEW" '.version = $v' package.json > package.json.tmp && mv package.json.tmp package.json
    git add package.json
    git commit -m "chore(release): bump version to $NEW"
    git tag "v$NEW"
    echo ""
    echo "Created tag v$NEW"
    echo ""
    echo "Push with:"
    echo "  git push origin main --tags"

# Release: bump patch, push, and trigger release workflow
release-patch: bump-patch
    git push origin main --tags

# Release: bump minor, push, and trigger release workflow
release-minor: bump-minor
    git push origin main --tags

# Release: bump major, push, and trigger release workflow
release-major: bump-major
    git push origin main --tags
