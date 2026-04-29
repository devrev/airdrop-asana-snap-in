#!/bin/bash
# Script for creatin a developer keyring for Asana OAuth.

# Minimal colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

error() { echo -e "${RED}ERROR: $1${NC}"; }
success() { echo -e "${GREEN}SUCCESS: $1${NC}"; }

# Find project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODE_DIR="$(dirname "$SCRIPT_DIR")"

# Load .env from code/
ENV_FILE="$CODE_DIR/.env"
if [ -f "$ENV_FILE" ]; then
    set -a
    source "$ENV_FILE"
    set +a
else
    error ".env file not found at $ENV_FILE"
    echo "Please copy .env.example to .env and fill in your values."
    exit 1
fi

# Validate required environment variables
if [ -z "$ASANA_CLIENT_ID" ]; then
    error "ASANA_CLIENT_ID is not set in .env"
    exit 1
fi

if [ -z "$ASANA_CLIENT_SECRET" ]; then
    error "ASANA_CLIENT_SECRET is not set in .env"
    exit 1
fi

# Check prerequisites
if ! command -v devrev &> /dev/null; then
    error "devrev CLI is not installed"
    exit 1
fi

echo "Creating developer keyring for Asana OAuth..."

# Create the keyring
echo '{"client_id":"'"$ASANA_CLIENT_ID"'","client_secret":"'"$ASANA_CLIENT_SECRET"'"}' | devrev developer_keyring create oauth-secret asana-oauth-secret

if [ $? -eq 0 ]; then
    success "Developer keyring 'asana-oauth-secret' created successfully"
else
    error "Failed to create developer keyring"
    exit 1
fi
