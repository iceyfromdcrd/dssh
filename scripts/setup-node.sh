#!/usr/bin/env bash
# ==============================================================================
# DSSH Machine Provisioner & Zero-Touch Fleet Auto-Enrollment
# Automates persistent SSH access, key enrollment, and registers into the dashboard.
# ==============================================================================

set -e

# Default Options
SERVICE_USER="dssh"
SSH_PORT="22"
PUBLIC_KEY=""
BOT_CALLBACK_URL=""
MACHINE_TAGS="prod,machine"

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info()  { echo -e "${CYAN}[DSSH INFO]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[DSSH OK]${NC} $1"; }
log_err()   { echo -e "${RED}[DSSH ERR]${NC} $1"; }

# Parse arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --key) PUBLIC_KEY="$2"; shift ;;
        --url) BOT_CALLBACK_URL="$2"; shift ;;
        --user) SERVICE_USER="$2"; shift ;;
        --port) SSH_PORT="$2"; shift ;;
        --tags) MACHINE_TAGS="$2"; shift ;;
        -h|--help)
            echo "Usage: sudo bash setup-node.sh [options]"
            echo "Options:"
            echo "  --key '<ssh-ed25519 ...>'  Cluster master public key"
            echo "  --url '<https://...>'      Bot callback URL for auto-enrollment"
            echo "  --user <username>          Service user (default: dssh)"
            echo "  --port <port>              SSH port (default: 22)"
            echo "  --tags <tag1,tag2>         Machine tags (default: prod,machine)"
            exit 0
            ;;
        *) echo "Unknown parameter passed: $1"; exit 1 ;;
    esac
    shift
done

# Ensure script is running as root
if [ "$EUID" -ne 0 ]; then
  log_err "Please run as root (sudo bash setup-node.sh)"
  exit 1
fi

log_info "Initializing machine provisioning on $(hostname)..."

# 1. Install Essential Dependencies
log_info "Verifying base system utilities (curl, openssh-server, sudo)..."
if command -v apt-get &>/dev/null; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq && apt-get install -y -qq curl openssh-server sudo >/dev/null
elif command -v dnf &>/dev/null; then
    dnf install -y -q curl openssh-server sudo >/dev/null
elif command -v yum &>/dev/null; then
    yum install -y -q curl openssh-server sudo >/dev/null
elif command -v pacman &>/dev/null; then
    pacman -Sy --noconfirm curl openssh sudo >/dev/null
fi

# 2. Create / Configure Dedicated Service User
if id "$SERVICE_USER" &>/dev/null; then
    log_info "User '$SERVICE_USER' already exists."
else
    log_info "Creating dedicated cluster service user '$SERVICE_USER'..."
    useradd -m -s /bin/bash "$SERVICE_USER"
fi

# Passwordless Sudo for cluster management tasks
log_info "Configuring sudo permissions for '$SERVICE_USER'..."
mkdir -p /etc/sudoers.d
echo "$SERVICE_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/99-dssh-orchestrator"
chmod 0440 "/etc/sudoers.d/99-dssh-orchestrator"

# 3. Configure SSH Keys
USER_HOME=$(eval echo "~$SERVICE_USER")
mkdir -p "$USER_HOME/.ssh"
chmod 0700 "$USER_HOME/.ssh"
touch "$USER_HOME/.ssh/authorized_keys"
chmod 0600 "$USER_HOME/.ssh/authorized_keys"

if [ -n "$PUBLIC_KEY" ]; then
    if ! grep -qF "$PUBLIC_KEY" "$USER_HOME/.ssh/authorized_keys"; then
        echo "$PUBLIC_KEY" >> "$USER_HOME/.ssh/authorized_keys"
        log_ok "Public key enrolled in $USER_HOME/.ssh/authorized_keys"
    else
        log_info "Public key already enrolled."
    fi

    # Also add to root for fallback
    mkdir -p /root/.ssh
    chmod 0700 /root/.ssh
    touch /root/.ssh/authorized_keys
    chmod 0600 /root/.ssh/authorized_keys
    if ! grep -qF "$PUBLIC_KEY" /root/.ssh/authorized_keys; then
        echo "$PUBLIC_KEY" >> /root/.ssh/authorized_keys
    fi
fi
chown -R "$SERVICE_USER:$SERVICE_USER" "$USER_HOME/.ssh"

# 4. SSH Daemon Keepalive & Hardening
log_info "Configuring SSH keepalive and persistent daemon options..."
mkdir -p /etc/ssh/sshd_config.d
cat << 'EOF' > /etc/ssh/sshd_config.d/99-dssh-keepalive.conf
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys
ClientAliveInterval 30
ClientAliveCountMax 6
TCPKeepAlive yes
EOF

# Restart SSH service safely (supports both systemd and container/service environments)
if [ -d /run/systemd/system ] && command -v systemctl &>/dev/null; then
    if systemctl is-active --quiet sshd 2>/dev/null; then
        systemctl restart sshd 2>/dev/null || true
    else
        systemctl restart ssh 2>/dev/null || systemctl start ssh 2>/dev/null || true
    fi
elif command -v service &>/dev/null; then
    service ssh restart 2>/dev/null || service sshd restart 2>/dev/null || service ssh start 2>/dev/null || true
elif [ -x /etc/init.d/ssh ]; then
    /etc/init.d/ssh restart 2>/dev/null || /etc/init.d/ssh start 2>/dev/null || true
elif [ -x /usr/sbin/sshd ]; then
    /usr/sbin/sshd 2>/dev/null || true
fi

# 5. Gather Machine Telemetry & Discovery
PUBLIC_IP=$(curl -s4 https://ifconfig.me 2>/dev/null || curl -s4 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
HOST_NAME=$(hostname)
ID_SLUG=$(echo "$HOST_NAME" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9-_' '-')
TAGS_JSON=$(echo "$MACHINE_TAGS" | awk -F',' '{for(i=1;i<=NF;i++) printf "\"%s\"%s", $i, (i==NF?"":", ")}')

# 6. Automatic Self-Registration Callback to Bot
ENROLLED_AUTOMATICALLY=false
if [ -n "$BOT_CALLBACK_URL" ]; then
    log_info "Auto-registering with fleet orchestrator at ${BOT_CALLBACK_URL}..."
    REGISTER_PAYLOAD="{\"hostname\":\"${HOST_NAME}\",\"ip\":\"${PUBLIC_IP}\",\"port\":${SSH_PORT},\"username\":\"${SERVICE_USER}\",\"tags\":[${TAGS_JSON}]}"
    
    REGISTER_RES=$(curl -s -X POST "${BOT_CALLBACK_URL}/api/register" \
        -H "Content-Type: application/json" \
        -d "$REGISTER_PAYLOAD" 2>/dev/null || echo "")

    if echo "$REGISTER_RES" | grep -q '"success":true'; then
        ENROLLED_AUTOMATICALLY=true
        log_ok "Machine successfully enrolled and live in your Discord dashboard!"
    else
        log_err "Auto-registration response: ${REGISTER_RES:-no response from server}"
    fi
fi

echo ""
echo -e "${GREEN}================================================================${NC}"
echo -e "${GREEN}            DSSH MACHINE PROVISIONING COMPLETE                  ${NC}"
echo -e "${GREEN}================================================================${NC}"
echo -e " Hostname    : ${CYAN}${HOST_NAME}${NC}"
echo -e " Host / IP   : ${CYAN}${PUBLIC_IP}${NC}"
echo -e " SSH User    : ${CYAN}${SERVICE_USER}${NC}"
echo -e " Port        : ${CYAN}${SSH_PORT}${NC}"
echo -e " Tags        : ${CYAN}${MACHINE_TAGS}${NC}"
if [ "$ENROLLED_AUTOMATICALLY" = true ]; then
    echo -e " Status      : ${GREEN}● LIVE IN DISCORD DASHBOARD${NC}"
else
    echo -e " Status      : ${CYAN}Provisioned locally${NC}"
fi
echo -e "${GREEN}================================================================${NC}"
echo ""
