#!/bin/bash
# Script for deploing the snap-in to local or Lambda environment.

# Minimal colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

error() { echo -e "${RED}ERROR: $1${NC}"; }
success() { echo -e "${GREEN}SUCCESS: $1${NC}"; }

# Prompt with default value
prompt_with_default() {
    local prompt="$1"
    local default="$2"
    local result
    
    if [ -n "$default" ]; then
        read -p "$prompt [$default]: " result
        echo "${result:-$default}"
    else
        read -p "$prompt: " result
        echo "$result"
    fi
}

# Interactive menu with arrow keys
# Arguments: $1=prompt, $2=default index, $3+=options
# Returns: selected index in MENU_RESULT
interactive_menu() {
    local prompt="$1"
    local default="$2"
    shift 2
    local options=("$@")
    local selected=$default
    local num_options=${#options[@]}
    
    echo "$prompt"
    
    display_options() {
        for i in "${!options[@]}"; do
            if [ $i -eq $selected ]; then
                echo -e "  ${GREEN}> ${options[$i]}${NC}"
            else
                echo "    ${options[$i]}"
            fi
        done
    }
    
    tput civis
    display_options
    
    while true; do
        read -rsn1 key
        if [[ $key == $'\x1b' ]]; then
            read -rsn2 key
            case $key in
                '[A') [ $selected -gt 0 ] && selected=$((selected - 1)) ;;
                '[B') [ $selected -lt $((num_options - 1)) ] && selected=$((selected + 1)) ;;
            esac
            tput cuu $num_options
            display_options
        elif [[ $key == "" ]]; then
            break
        fi
    done
    
    tput cnorm
    MENU_RESULT=$selected
}

# Cross-platform port check
check_port() {
    local port=$1
    if command -v lsof &> /dev/null; then
        lsof -ti:$port 2>/dev/null
    elif command -v ss &> /dev/null; then
        ss -tlnp 2>/dev/null | grep ":$port " | grep -oP '(?<=pid=)\d+' | head -1
    elif command -v netstat &> /dev/null; then
        netstat -tlnp 2>/dev/null | grep ":$port " | awk '{print $7}' | cut -d'/' -f1 | head -1
    fi
}

# Deployment mode selection
DEPLOY_MODES=("Local  - Deploy with ngrok tunnel" "Lambda - Deploy to Lambda")
interactive_menu "Select deployment mode:" 0 "${DEPLOY_MODES[@]}"

case "$MENU_RESULT" in
    0) DEPLOY_MODE="local" ;;
    1) DEPLOY_MODE="lambda" ;;
esac

echo ""
echo "Selected: $DEPLOY_MODE deployment"
echo ""

# Find project root (where manifest.yaml is)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODE_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$CODE_DIR")"

cd "$PROJECT_ROOT" || exit 1

# Validate project structure
if [ ! -f "manifest.yaml" ]; then
    error "manifest.yaml not found. Run this script from a valid snap-in project."
    exit 1
fi

if [ ! -d "code" ] || [ ! -f "code/package.json" ]; then
    error "code/ directory with package.json not found."
    exit 1
fi

# Check prerequisites
if ! command -v devrev &> /dev/null; then
    error "devrev CLI is not installed"
    exit 1
fi

if ! command -v jq &> /dev/null; then
    error "jq is not installed"
    exit 1
fi

if [ "$DEPLOY_MODE" = "local" ]; then
    if ! command -v ngrok &> /dev/null; then
        error "ngrok is not installed (required for local mode)"
        exit 1
    fi
    # Check if ngrok is configured with an authtoken
    if ! ngrok config check &>/dev/null; then
        error "ngrok is not configured with an authtoken"
        echo "Run: ngrok config add-authtoken YOUR_AUTH_TOKEN"
        echo "Get your authtoken at: https://dashboard.ngrok.com/get-started/your-authtoken"
        exit 1
    fi
fi

# Load .env from code/ (optional, provides defaults)
ENV_FILE="$CODE_DIR/.env"
if [ -f "$ENV_FILE" ]; then
    set -a
    source "$ENV_FILE"
    set +a
fi

# Prompt for credentials (with .env values as defaults)
DEV_ORG=$(prompt_with_default "Enter organization" "$DEV_ORG")
USER_EMAIL=$(prompt_with_default "Enter user email" "$USER_EMAIL")

# Validate required values
if [ -z "$DEV_ORG" ]; then
    error "Organization is required"
    exit 1
fi

if [ -z "$USER_EMAIL" ]; then
    error "User email is required"
    exit 1
fi

# Default to prod environment (can be overridden via ENV in .env)
DEVREV_ENV="${ENV:-prod}"

echo ""
# Authenticate
echo "Authenticating as $USER_EMAIL into $DEV_ORG ($DEVREV_ENV)..."
devrev profiles authenticate --env "$DEVREV_ENV" --usr "$USER_EMAIL" --org "$DEV_ORG" --expiry 5

if [ $? -ne 0 ]; then
    error "DevRev authentication failed"
    exit 1
fi

success "Authenticated"
echo ""

# LOCAL DEPLOYMENT
if [ "$DEPLOY_MODE" = "local" ]; then
    # Check and free port 8000
    PORT_PID=$(check_port 8000)
    if [ -n "$PORT_PID" ]; then
        echo "Killing process on port 8000 (PID: $PORT_PID)..."
        kill -9 $PORT_PID 2>/dev/null
        sleep 1
    fi

    # Check for existing ngrok
    NGROK_URL=""
    EXISTING_NGROK=$(pgrep -f "ngrok http")
    
    if [ -n "$EXISTING_NGROK" ]; then
        EXISTING_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | grep -o 'https://[a-z0-9-]*\.ngrok-free\.app' | head -1)
        if [ -n "$EXISTING_URL" ]; then
            echo "Found existing ngrok: $EXISTING_URL"
            NGROK_OPTIONS=("Yes - Reuse existing tunnel" "No  - Start new tunnel")
            interactive_menu "Reuse existing ngrok?" 0 "${NGROK_OPTIONS[@]}"
            
            if [ "$MENU_RESULT" -eq 0 ]; then
                NGROK_URL="$EXISTING_URL"
            else
                pkill -f "ngrok http"
                sleep 2
            fi
        else
            pkill -f "ngrok http"
            sleep 2
        fi
    fi

    # Start ngrok as background process if needed
    if [ -z "$NGROK_URL" ]; then
        echo "Starting ngrok..."
        NGROK_LOG=$(mktemp)
        ngrok http 8000 > "$NGROK_LOG" 2>&1 &
        NGROK_PID=$!
        
        # Wait for ngrok to be ready
        for i in {1..20}; do
            sleep 2
            NGROK_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | grep -o 'https://[a-z0-9-]*\.ngrok-free\.app' | head -1)
            if [ -n "$NGROK_URL" ]; then
                rm -f "$NGROK_LOG"
                break
            fi
            # Check if ngrok process died
            if ! kill -0 $NGROK_PID 2>/dev/null; then
                error "ngrok process died. Output:"
                cat "$NGROK_LOG"
                rm -f "$NGROK_LOG"
                echo ""
                echo "If you see an auth error, run: ngrok config add-authtoken YOUR_AUTH_TOKEN"
                echo "Get your authtoken at: https://dashboard.ngrok.com/get-started/your-authtoken"
                exit 1
            fi
            echo "Waiting for ngrok... ($i/20)"
        done

        if [ -z "$NGROK_URL" ]; then
            error "Failed to start ngrok"
            echo "Common causes:"
            echo "  - ngrok not authenticated: ngrok config add-authtoken YOUR_TOKEN"
            echo "  - Port 4040 blocked by firewall"
            echo "  - Try running 'ngrok http 8000' manually to see the error"
            rm -f "$NGROK_LOG" 2>/dev/null
            exit 1
        fi
    fi

    success "ngrok ready: $NGROK_URL"
    echo ""

    # Create snap-in version with testing URL
    echo "Creating snap-in version..."
    devrev snap_in_version create-one --manifest ./manifest.yaml --create-package --testing-url "$NGROK_URL"

    if [ $? -ne 0 ]; then
        error "Failed to create snap-in version"
        exit 1
    fi

    sleep 2

    echo "Creating snap-in draft..."
    devrev snap_in draft

    if [ $? -ne 0 ]; then
        error "Failed to create snap-in draft"
        exit 1
    fi

    sleep 2

    echo "Activating snap-in..."
    devrev snap_in activate

    if [ $? -ne 0 ]; then
        error "Failed to activate snap-in"
        exit 1
    fi

    echo ""
    success "Local deployment complete!"
    echo "ngrok URL: $NGROK_URL"
    echo ""
    echo "Starting test server (Ctrl+C to stop)..."
    echo ""

    cd "$CODE_DIR"
    npm run test:server -- local
fi

# LAMBDA DEPLOYMENT
if [ "$DEPLOY_MODE" = "lambda" ]; then
    cd "$CODE_DIR"

    echo "Building..."
    if ! npm run build; then
        error "Build failed"
        exit 1
    fi

    echo "Packaging..."
    if ! npm run package; then
        error "Package failed"
        exit 1
    fi

    cd "$PROJECT_ROOT"

    echo "Creating snap-in version..."
    
    # Capture output while allowing interactive prompts
    TEMP_OUTPUT=$(mktemp)
    if [[ "$OSTYPE" == "darwin"* ]]; then
        script -q "$TEMP_OUTPUT" devrev snap_in_version create-one --path "." --create-package
    else
        script -q -c "devrev snap_in_version create-one --path '.' --create-package" "$TEMP_OUTPUT"
    fi

    VER_OUTPUT=$(cat "$TEMP_OUTPUT")
    rm -f "$TEMP_OUTPUT"

    FILTERED_OUTPUT=$(echo "$VER_OUTPUT" | grep "snap_in_version" | grep -o '{.*}')

    if echo "$FILTERED_OUTPUT" | jq '.message' 2>/dev/null | grep -v null > /dev/null; then
        error "Failed to create snap-in version"
        exit 1
    fi

    VERSION_ID=$(echo "$FILTERED_OUTPUT" | jq -r '.snap_in_version.id' 2>/dev/null)

    if [ -z "$VERSION_ID" ] || [ "$VERSION_ID" == "null" ]; then
        error "Failed to get version ID"
        exit 1
    fi

    success "Created version: $VERSION_ID"

    # Wait for version to be ready
    echo "Waiting for version to be ready..."
    sleep 10

    while true; do
        VER_STATUS=$(devrev snap_in_version show "$VERSION_ID" 2>/dev/null)
        STATE=$(echo "$VER_STATUS" | jq -r '.snap_in_version.state' 2>/dev/null)
        
        if [ -z "$STATE" ] || [ "$STATE" == "null" ]; then
            error "Failed to get version status"
            exit 1
        fi
        
        if [[ "$STATE" == "ready" ]]; then
            success "Version ready"
            break
        elif [[ "$STATE" == "build_failed" ]] || [[ "$STATE" == "deployment_failed" ]]; then
            REASON=$(echo "$VER_STATUS" | jq -r '.snap_in_version.failure_reason' 2>/dev/null)
            error "Build/deployment failed: $REASON"
            exit 1
        else
            echo "Status: $STATE, waiting..."
            sleep 10
        fi
    done

    echo "Creating snap-in draft..."
    DRAFT_OUTPUT=$(devrev snap_in draft --snap_in_version "$VERSION_ID" 2>&1)

    if echo "$DRAFT_OUTPUT" | jq '.message' 2>/dev/null | grep -v null > /dev/null; then
        error "Failed to create draft"
        exit 1
    fi

    sleep 2

    echo "Activating snap-in..."
    ACTIVATE_OUTPUT=$(devrev snap_in activate 2>&1)

    if echo "$ACTIVATE_OUTPUT" | jq '.message' 2>/dev/null | grep -v null > /dev/null; then
        error "Failed to activate snap-in"
        exit 1
    fi

    echo ""
    success "Lambda deployment complete!"
    echo "Version ID: $VERSION_ID"
fi