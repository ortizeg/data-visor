#!/usr/bin/env bash
# scripts/run-local.sh -- Start DataVisor locally via Docker Compose
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Ensure data directory exists (for bind mount)
mkdir -p data

# Check for .env file
if [ ! -f .env ]; then
    echo "No .env file found. Creating from .env.example..."
    cp .env.example .env
    echo ""
    echo "IMPORTANT: You must set AUTH_PASSWORD_HASH in .env before running."
    echo ""
    echo "Generate a password hash with:"
    echo "  docker run --rm caddy:2-alpine caddy hash-password --plaintext 'your-password'"
    echo ""
    echo "Then edit .env and set AUTH_PASSWORD_HASH to the output."
    echo "After that, re-run this script."
    exit 1
fi

# Check that AUTH_PASSWORD_HASH is set (not empty)
if ! grep -q "^AUTH_PASSWORD_HASH=.\+" .env; then
    echo "ERROR: AUTH_PASSWORD_HASH is not set in .env"
    echo ""
    echo "Generate a password hash with:"
    echo "  docker run --rm caddy:2-alpine caddy hash-password --plaintext 'your-password'"
    echo ""
    echo "Then edit .env and set AUTH_PASSWORD_HASH to the output."
    exit 1
fi

echo "Starting DataVisor..."
docker compose up --build -d

echo ""
echo "DataVisor is running at http://localhost"
echo "Username: $(grep '^AUTH_USERNAME=' .env | cut -d= -f2)"
echo ""
echo "Stop with: docker compose down"
echo "View logs: docker compose logs -f"
