#!/usr/bin/env bash
# ==============================================================================
# DSSH Machine Provisioner & Zero-Touch Fleet Auto-Enrollment
# Automates persistent SSH access, key enrollment, auto-tunneling, and dashboard registration.
# ==============================================================================

set -e

# Ensure full standard system PATH for root utilities (useradd, service, systemctl)
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

# Default Options
SERVICE_USER="dssh"
SSH_PORT="22"
PUBLIC_KEY=""
BOT_CALLBACK_URL=""
MACHINE_TAGS="prod,machine"
FORCE_DIRECT=false

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
        --direct) FORCE_DIRECT=true ;;
        -h|--help)
            echo "Usage: sudo bash setup-node.sh [options]"
            echo "Options:"
            echo "  --key '<ssh-ed25519 ...>'  Cluster master public key"
            echo "  --url '<https://...>'      Bot callback URL for auto-enrollment"
            echo "  --user <username>          Service user (default: dssh)"
            echo "  --port <port>              SSH port (default: 22)"
            echo "  --tags <tag1,tag2>         Machine tags (default: prod,machine)"
            echo "  --direct                   Disable auto-tunneling (use raw public IP)"
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
log_info "Verifying base system utilities (curl, openssh-server, sudo, passwd, tar)..."
if command -v apt-get &>/dev/null; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq 2>/dev/null || true
    apt-get install -y -qq curl openssh-server sudo passwd adduser tar >/dev/null 2>&1 || apt-get install -y -qq curl openssh-server sudo tar >/dev/null 2>&1 || true
elif command -v dnf &>/dev/null; then
    dnf install -y -q curl openssh-server sudo shadow-utils tar >/dev/null 2>&1 || true
elif command -v yum &>/dev/null; then
    yum install -y -q curl openssh-server sudo shadow-utils tar >/dev/null 2>&1 || true
elif command -v pacman &>/dev/null; then
    pacman -Sy --noconfirm curl openssh sudo shadow tar >/dev/null 2>&1 || true
elif command -v apk &>/dev/null; then
    apk add --no-cache curl openssh sudo shadow bash tar >/dev/null 2>&1 || true
fi

# 2. Create / Configure Dedicated Service User
if id "$SERVICE_USER" &>/dev/null; then
    log_info "User '$SERVICE_USER' already exists."
else
    log_info "Creating dedicated cluster service user '$SERVICE_USER'..."
    if command -v useradd &>/dev/null; then
        useradd -m -s /bin/bash "$SERVICE_USER" 2>/dev/null || useradd -m "$SERVICE_USER" 2>/dev/null || true
    elif command -v adduser &>/dev/null; then
        adduser --disabled-password --gecos "" --shell /bin/bash "$SERVICE_USER" 2>/dev/null || adduser -D -s /bin/bash "$SERVICE_USER" 2>/dev/null || true
    elif [ -x /usr/sbin/useradd ]; then
        /usr/sbin/useradd -m -s /bin/bash "$SERVICE_USER" 2>/dev/null || true
    elif [ -x /sbin/useradd ]; then
        /sbin/useradd -m -s /bin/bash "$SERVICE_USER" 2>/dev/null || true
    fi
fi

# Passwordless Sudo for cluster management tasks
log_info "Configuring sudo permissions for '$SERVICE_USER'..."
mkdir -p /etc/sudoers.d
echo "$SERVICE_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/99-dssh-orchestrator"
chmod 0440 "/etc/sudoers.d/99-dssh-orchestrator"

# 3. Configure SSH Keys
USER_HOME=$(eval echo "~$SERVICE_USER" 2>/dev/null || echo "/home/$SERVICE_USER")
if [ ! -d "$USER_HOME" ]; then
    mkdir -p "$USER_HOME"
    chown "$SERVICE_USER:$SERVICE_USER" "$USER_HOME" 2>/dev/null || true
fi

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
chown -R "$SERVICE_USER:$SERVICE_USER" "$USER_HOME/.ssh" 2>/dev/null || true

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

# Ensure SSH privilege separation directory and host keys exist
mkdir -p /run/sshd /var/run/sshd
ssh-keygen -A 2>/dev/null || true

# Restart SSH service safely (supports systemd, SysV init, OpenRC, and container environments)
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

# 5. Automatic Reverse Tunneling for VMs, NAT & Sandboxes
PUBLIC_IP=$(curl -s4 https://ifconfig.me 2>/dev/null || curl -s4 https://api.ipify.org 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')
HOST_NAME=$(hostname)
ID_SLUG=$(echo "$HOST_NAME" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9-_' '-')

TARGET_HOST="${PUBLIC_IP}"
TARGET_PORT="${SSH_PORT}"
TUNNEL_ACTIVE=false

if [ "$FORCE_DIRECT" = false ]; then
    ARCH=$(uname -m)
    BORE_ARCH="x86_64-unknown-linux-musl"
    case "$ARCH" in
        x86_64|amd64) BORE_ARCH="x86_64-unknown-linux-musl" ;;
        aarch64|arm64) BORE_ARCH="aarch64-unknown-linux-musl" ;;
        armv7*|armhf) BORE_ARCH="armv7-unknown-linux-musleabihf" ;;
        *) BORE_ARCH="x86_64-unknown-linux-musl" ;;
    esac

    # Install bore if not already present
    if ! command -v bore &>/dev/null; then
        log_info "Installing automatic VM tunnel client..."
        curl -fsSL "https://github.com/ekzhang/bore/releases/download/v0.5.1/bore-v0.5.1-${BORE_ARCH}.tar.gz" | tar -xz -C /tmp/ 2>/dev/null || true
        if [ -f /tmp/bore ]; then
            mv /tmp/bore /usr/local/bin/bore
            chmod +x /usr/local/bin/bore
        fi
    fi

    if command -v bore &>/dev/null; then
        log_info "Setting up persistent reverse tunnel for SSH access..."
        pkill -f "bore local" 2>/dev/null || true
        rm -f /var/log/dssh-tunnel.log

        if [ -d /run/systemd/system ] && command -v systemctl &>/dev/null; then
            cat << EOF > /etc/systemd/system/dssh-tunnel.service
[Unit]
Description=DSSH Auto Reverse SSH Tunnel
After=network.target ssh.service sshd.service

[Service]
Type=simple
ExecStart=/usr/local/bin/bore local ${SSH_PORT} --to bore.pub
Restart=always
RestartSec=3
StandardOutput=append:/var/log/dssh-tunnel.log
StandardError=append:/var/log/dssh-tunnel.log

[Install]
WantedBy=multi-user.target
EOF
            systemctl daemon-reload
            systemctl enable --now dssh-tunnel.service >/dev/null 2>&1 || true
        else
            nohup /usr/local/bin/bore local ${SSH_PORT} --to bore.pub > /var/log/dssh-tunnel.log 2>&1 &
        fi

        # Wait up to 5 seconds to capture assigned public port from log
        for i in {1..25}; do
            if [ -f /var/log/dssh-tunnel.log ]; then
                CAPTURED_PORT=$(grep -oE 'listening at bore.pub:[0-9]+' /var/log/dssh-tunnel.log | head -n 1 | awk -F':' '{print $2}')
                if [ -n "$CAPTURED_PORT" ]; then
                    TARGET_HOST="bore.pub"
                    TARGET_PORT="${CAPTURED_PORT}"
                    TUNNEL_ACTIVE=true
                    log_ok "Reverse tunnel active at bore.pub:${TARGET_PORT}"
                    break
                fi
            fi
            sleep 0.2
        done
    fi
fi

TAGS_ARRAY=()
if [ "$TUNNEL_ACTIVE" = true ]; then
    TAGS_ARRAY+=("\"tunnel\"" "\"vm\"")
fi
IFS=',' read -ra ADDR <<< "$MACHINE_TAGS"
for i in "${ADDR[@]}"; do
    TAGS_ARRAY+=("\"$(echo "$i" | xargs)\"")
done
TAGS_JSON=$(IFS=', '; echo "${TAGS_ARRAY[*]}")

# 6. Automatic Self-Registration Callback to Bot
ENROLLED_AUTOMATICALLY=false
if [ -n "$BOT_CALLBACK_URL" ]; then
    log_info "Auto-registering with fleet orchestrator at ${BOT_CALLBACK_URL}..."
    REGISTER_PAYLOAD="{\"hostname\":\"${HOST_NAME}\",\"ip\":\"${TARGET_HOST}\",\"port\":${TARGET_PORT},\"username\":\"${SERVICE_USER}\",\"tags\":[${TAGS_JSON}]}"
    
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
if [ "$TUNNEL_ACTIVE" = true ]; then
    echo -e " Endpoint    : ${CYAN}bore.pub:${TARGET_PORT}${NC} (Local: ${PUBLIC_IP}:${SSH_PORT})"
else
    echo -e " Endpoint    : ${CYAN}${PUBLIC_IP}:${SSH_PORT}${NC}"
fi
echo -e " SSH User    : ${CYAN}${SERVICE_USER}${NC}"
if [ "$ENROLLED_AUTOMATICALLY" = true ]; then
    echo -e " Status      : ${GREEN}● LIVE IN DISCORD DASHBOARD${NC}"
else
    echo -e " Status      : ${CYAN}Provisioned locally${NC}"
fi
echo -e "${GREEN}================================================================${NC}"
echo ""
