#!/usr/bin/env bash
set -euo pipefail

# ─── HomeNas OS — x86_64 installer (Ubuntu 22.04/24.04, Debian 12) ────────
#
# This script installs HomeNas OS from scratch on an x86_64 machine running
# Ubuntu 22.04 LTS, Ubuntu 24.04 LTS, or Debian 12 (Bookworm).
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/juanlusoft/homenas-os/main/install-x86.sh | sudo bash
#   — or —
#   sudo bash install-x86.sh
#
# What this script does:
#   1. Verifies you are on x86_64 running a supported Debian-family distro
#   2. Installs Node.js 22 LTS via nodesource
#   3. Installs pnpm, git, and all required system tools
#   4. Installs mergerfs (from GitHub releases)
#   5. Installs snapraid (from apt if available, otherwise builds from source)
#   6. Clones / updates HomeNas OS into /opt/homenas-os
#   7. Installs pnpm dependencies and builds the project
#   8. Generates a self-signed TLS certificate
#   9. Creates a dedicated 'homenas' system user with appropriate sudoers
#  10. Creates and enables a systemd service
#  11. Configures Samba, Avahi (mDNS), and wsdd2 (WS-Discovery)
#
# Idempotent: safe to run again to upgrade an existing installation.

REPO="${HOMENAS_REPO:-https://github.com/juanlusoft/homenas-os.git}"
INSTALL_DIR="/opt/homenas-v3"
SERVICE_NAME="homenas"
PORT=443
CERT_DIR="${INSTALL_DIR}/certs"
CERT_PATH="${CERT_DIR}/server.crt"
KEY_PATH="${CERT_DIR}/server.key"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${GREEN}[homenas]${NC} $*"; }
warn()    { echo -e "${YELLOW}[homenas]${NC} $*"; }
error()   { echo -e "${RED}[homenas]${NC} $*" >&2; }
section() { echo -e "\n${BLUE}══ $* ══${NC}"; }

# ── Preflight checks ──────────────────────────────────────────────────────────

section "Preflight checks"

if [[ $EUID -ne 0 ]]; then
  error "Run as root:  sudo bash install-x86.sh"
  exit 1
fi

ARCH=$(uname -m)
if [[ "${ARCH}" != "x86_64" ]]; then
  error "This script targets x86_64.  Detected: ${ARCH}"
  error "For ARM, use install.sh instead."
  exit 1
fi

# Detect distro
OS_ID=""
OS_VERSION_ID=""
OS_CODENAME=""
OS_PRETTY=""

if [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  source /etc/os-release
  OS_ID="${ID:-}"
  OS_VERSION_ID="${VERSION_ID:-}"
  OS_CODENAME="${VERSION_CODENAME:-${UBUNTU_CODENAME:-}}"
  OS_PRETTY="${PRETTY_NAME:-Linux}"
fi

info "Architecture : x86_64"
info "OS           : ${OS_PRETTY}"
info "Codename     : ${OS_CODENAME:-unknown}"

case "${OS_ID}" in
  ubuntu|debian) : ;;
  *)
    warn "Unsupported distro '${OS_ID}'. Continuing — results may vary."
    ;;
esac

# Ubuntu 20.04 and below are not officially supported
if [[ "${OS_ID}" == "ubuntu" ]]; then
  MAJOR=$(echo "${OS_VERSION_ID}" | cut -d. -f1)
  if (( MAJOR < 22 )); then
    error "Ubuntu ${OS_VERSION_ID} is not supported. Use 22.04 or 24.04."
    exit 1
  fi
fi

# ── System update ─────────────────────────────────────────────────────────────

section "System update"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends \
  curl \
  ca-certificates \
  gnupg \
  lsb-release

# ── Node.js 22 LTS ───────────────────────────────────────────────────────────

section "Node.js"

if command -v node &>/dev/null; then
  NODE_MAJOR=$(node -e "process.stdout.write(String(parseInt(process.versions.node)))")
  if (( NODE_MAJOR >= 18 )); then
    info "Node.js $(node --version) already installed — skipping"
  else
    warn "Node.js ${NODE_MAJOR} is too old (need >= 18). Upgrading to 22 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi
else
  info "Installing Node.js 22 LTS via nodesource..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

info "Node.js $(node --version) — npm $(npm --version)"

# ── pnpm ─────────────────────────────────────────────────────────────────────

section "pnpm"

if ! command -v pnpm &>/dev/null; then
  info "Installing pnpm..."
  npm install -g pnpm
fi
info "pnpm $(pnpm --version)"

# ── Git ───────────────────────────────────────────────────────────────────────

section "Git"

if ! command -v git &>/dev/null; then
  apt-get install -y --no-install-recommends git
fi
info "git $(git --version)"

# ── System tools ──────────────────────────────────────────────────────────────

section "System tools"

# These packages have the same names on Ubuntu 22.04, 24.04, and Debian 12.
SYSTEM_PKGS=(
  # Filesystem
  xfsprogs
  e2fsprogs
  parted
  util-linux
  udev
  coreutils
  # Network shares
  samba
  samba-vfs-modules
  nfs-kernel-server
  # Disk health
  smartmontools
  hdparm
  # RAID / pool helpers
  rsync
  # stdbuf binary ships in coreutils (already pulled in transitively) — NOT a separate package
  lsof
  # Network
  ethtool
  # Discovery
  avahi-daemon
  # WireGuard
  wireguard
  wireguard-tools
  qrencode
  # UPS (optional)
  nut
  nut-client
  # Build tools (snapraid from source fallback)
  gcc
  make
  libz-dev
)

info "Installing system packages..."
apt-get install -y --no-install-recommends "${SYSTEM_PKGS[@]}" 2>/dev/null || {
  warn "Some packages failed. Retrying individually..."
  for pkg in "${SYSTEM_PKGS[@]}"; do
    apt-get install -y --no-install-recommends "${pkg}" 2>/dev/null || warn "  skipped: ${pkg}"
  done
}

# wsdd2 (Windows WS-Discovery): in Ubuntu 22.04+ and Debian 12 repos
apt-get install -y --no-install-recommends wsdd2 2>/dev/null \
  || warn "wsdd2 not available — Windows WS-Discovery disabled"

# ── mergerfs ──────────────────────────────────────────────────────────────────

section "mergerfs"

install_mergerfs() {
  local api_url="https://api.github.com/repos/trapexit/mergerfs/releases/latest"

  info "Fetching latest mergerfs release for amd64..."
  local deb_url
  deb_url=$(curl -fsSL "${api_url}" 2>/dev/null \
    | grep -o '"browser_download_url": *"[^"]*amd64[^"]*.deb"' \
    | grep -v static \
    | head -1 \
    | sed 's/.*"\(https[^"]*\)"/\1/' || true)

  if [[ -n "${deb_url}" ]]; then
    local tmp_deb
    tmp_deb=$(mktemp /tmp/mergerfs-XXXXXX.deb)
    info "Downloading: ${deb_url}"
    if curl -fsSL -o "${tmp_deb}" "${deb_url}"; then
      dpkg -i "${tmp_deb}" || apt-get install -f -y
      rm -f "${tmp_deb}"
      info "mergerfs installed: $(mergerfs --version 2>&1 | head -1)"
      return 0
    fi
    rm -f "${tmp_deb}"
  fi

  # Fallback: static binary
  info "Trying mergerfs static binary..."
  local static_url
  static_url=$(curl -fsSL "${api_url}" 2>/dev/null \
    | grep -o '"browser_download_url": *"[^"]*x86_64[^"]*static[^"]*"' \
    | head -1 \
    | sed 's/.*"\(https[^"]*\)"/\1/' || true)

  if [[ -n "${static_url}" ]]; then
    local tmp_arc
    tmp_arc=$(mktemp /tmp/mergerfs-XXXXXX.tar.gz)
    if curl -fsSL -o "${tmp_arc}" "${static_url}"; then
      tar -xzf "${tmp_arc}" -C /usr/local/bin --wildcards '*/mergerfs' --strip-components=1 2>/dev/null \
        || tar -xzf "${tmp_arc}" -C /usr/local/bin 2>/dev/null
      chmod +x /usr/local/bin/mergerfs 2>/dev/null || true
      rm -f "${tmp_arc}"
      if command -v mergerfs &>/dev/null; then
        info "mergerfs (static) installed"
        return 0
      fi
    fi
    rm -f "${tmp_arc}"
  fi

  warn "mergerfs automatic installation failed."
  warn "Install manually: https://github.com/trapexit/mergerfs/releases"
  return 1
}

if command -v mergerfs &>/dev/null; then
  info "mergerfs already installed: $(mergerfs --version 2>&1 | head -1 || true)"
elif apt-cache show mergerfs &>/dev/null 2>&1; then
  apt-get install -y mergerfs
else
  install_mergerfs || true
fi

# ── snapraid ──────────────────────────────────────────────────────────────────

section "snapraid"

install_snapraid_from_source() {
  local version="12.3"
  local src_url="https://github.com/amadvance/snapraid/releases/download/v${version}/snapraid-${version}.tar.gz"
  local build_dir
  build_dir=$(mktemp -d /tmp/snapraid-build-XXXXXX)

  info "Building snapraid ${version} from source..."
  if curl -fsSL -o "${build_dir}/snapraid.tar.gz" "${src_url}"; then
    tar -xzf "${build_dir}/snapraid.tar.gz" -C "${build_dir}" --strip-components=1
    pushd "${build_dir}" >/dev/null
    ./configure --prefix=/usr && make -j"$(nproc)" && make install
    popd >/dev/null
    rm -rf "${build_dir}"
    info "snapraid installed: $(snapraid --version 2>&1 | head -1)"
    return 0
  fi

  rm -rf "${build_dir}"
  warn "snapraid source build failed."
  return 1
}

if command -v snapraid &>/dev/null; then
  info "snapraid already installed"
elif apt-cache show snapraid &>/dev/null 2>&1; then
  apt-get install -y snapraid
else
  install_snapraid_from_source || {
    warn "snapraid not installed. Pool health features will be limited."
    warn "Install manually: https://github.com/amadvance/snapraid/releases"
  }
fi

# ── Docker (optional — needed for docker route) ───────────────────────────────

section "Docker"

if command -v docker &>/dev/null; then
  info "Docker already installed: $(docker --version)"
else
  info "Docker not found — installing via official get.docker.com script..."
  if curl -fsSL https://get.docker.com | sh; then
    systemctl enable --now docker
    info "Docker installed: $(docker --version)"
  else
    warn "Docker install failed. The docker management panel will be unavailable."
    warn "Retry manually: curl -fsSL https://get.docker.com | sh"
  fi
fi

# ── Clone / update HomeNas OS v3 ──────────────────────────────────────────────

section "HomeNas OS v3 source"

if [[ -d "${INSTALL_DIR}/.git" ]]; then
  info "Updating existing installation in ${INSTALL_DIR}..."
  git -C "${INSTALL_DIR}" pull --ff-only
else
  info "Cloning into ${INSTALL_DIR}..."
  git clone "${REPO}" "${INSTALL_DIR}"
fi

APP_VERSION="1.0.0"
if [[ -f "${INSTALL_DIR}/package.json" ]]; then
  APP_VERSION=$(grep '"version"' "${INSTALL_DIR}/package.json" | head -1 \
    | sed 's/.*"version": *"\([^"]*\)".*/\1/')
fi
info "HomeNas OS v${APP_VERSION}"

# ── Dedicated service user (must exist BEFORE pnpm install) ───────────────────
# Create the homenas user up front so that `pnpm install`/`build` — and any
# npm postinstall scripts in transitive deps — run UNPRIVILEGED. Previously this
# ran as root (the user was created later), so a compromised transitive dep's
# install script executed with full root access. Mirrors install.sh.

section "System user"

if ! id homenas &>/dev/null; then
  useradd -r -s /usr/sbin/nologin -d "${INSTALL_DIR}" -c "HomeNas OS service" homenas
  info "User 'homenas' created"
else
  info "User 'homenas' already exists"
fi
chown -R homenas:homenas "${INSTALL_DIR}"
git config --global --add safe.directory "${INSTALL_DIR}" 2>/dev/null || true
sudo -u homenas git config --global --add safe.directory "${INSTALL_DIR}" 2>/dev/null || true

# ── Install pnpm dependencies and build (as homenas, NOT root) ─────────────────

section "Build"

cd "${INSTALL_DIR}"
info "Installing pnpm dependencies..."
# --ignore-scripts: install scripts of transitive deps must not run as part of
# resolution; native addons are compiled explicitly below.
sudo -u homenas pnpm install --frozen-lockfile --ignore-scripts

# Compile native addons that require a build step (better-sqlite3).
info "Building native addons (better-sqlite3)..."
SQLITE3_PKG=$(find "${INSTALL_DIR}/node_modules/.pnpm" -maxdepth 2 -name "better-sqlite3" -type d 2>/dev/null | grep "node_modules/better-sqlite3$" | head -1)
if [[ -n "${SQLITE3_PKG}" ]]; then
  if ! ls "${SQLITE3_PKG}"/build/Release/better_sqlite3.node &>/dev/null; then
    (cd "${SQLITE3_PKG}" && sudo -u homenas npm install --ignore-scripts=false 2>&1 | tail -3) \
      || warn "better-sqlite3 native build failed — app may not start"
  else
    info "better-sqlite3 already compiled"
  fi
else
  warn "better-sqlite3 package not found in virtual store"
fi

info "Building frontend and backend (NODE_ENV=production)..."
sudo -u homenas NODE_ENV=production pnpm -r build

# ── TLS certificate ───────────────────────────────────────────────────────────

section "TLS certificate"

mkdir -p "${CERT_DIR}"
if [[ ! -f "${CERT_PATH}" || ! -f "${KEY_PATH}" ]]; then
  LOCAL_IP=$(ip route get 1.1.1.1 2>/dev/null \
    | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1); exit}')
  LOCAL_IP="${LOCAL_IP:-$(hostname -I | awk '{print $1}')}"

  openssl req -x509 -nodes -newkey rsa:2048 \
    -keyout "${KEY_PATH}" \
    -out "${CERT_PATH}" \
    -days 3650 \
    -subj "/CN=homenas" \
    -addext "subjectAltName=IP:${LOCAL_IP},DNS:homenas,DNS:localhost" \
    2>/dev/null
  info "Certificate generated (IP: ${LOCAL_IP}, valid 10 years)"
else
  info "Certificate already exists — skipping"
fi
chmod 600 "${KEY_PATH}" "${CERT_PATH}"

# ── Privileges (user already created before the build above) ──────────────────

section "Privileges"

usermod -aG docker homenas 2>/dev/null \
  || warn "docker group not found — skipping (Docker not installed?)"

cat > /etc/sudoers.d/homenas <<'SUDOEOF'
homenas ALL=(root) NOPASSWD: ALL
SUDOEOF
chmod 440 /etc/sudoers.d/homenas

chown -R homenas:homenas "${INSTALL_DIR}"
chmod 750 "${CERT_DIR}"

git config --global --add safe.directory "${INSTALL_DIR}" 2>/dev/null || true
sudo -u homenas git config --global --add safe.directory "${INSTALL_DIR}" 2>/dev/null || true

# ── Systemd service ───────────────────────────────────────────────────────────

section "systemd service"

SERVER_JS="${INSTALL_DIR}/apps/backend/dist/apps/backend/src/server.js"
NODE_BIN=$(command -v node)

# Build PATH string covering all common locations on x86 installs
NODE_DIR=$(dirname "${NODE_BIN}")
SERVICE_PATH="${NODE_DIR}:/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin"

mkdir -p "${INSTALL_DIR}/apps/backend/data"
chown homenas:homenas "${INSTALL_DIR}/apps/backend/data"

cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=HomeNas OS v3
After=network.target
Wants=network.target

[Service]
Type=simple
User=homenas
WorkingDirectory=${INSTALL_DIR}/apps/backend
ExecStart=${NODE_BIN} ${SERVER_JS}
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=${PORT}
Environment=CERT_PATH=${CERT_PATH}
Environment=KEY_PATH=${KEY_PATH}
Environment=PATH=${SERVICE_PATH}

# Allow binding to port 443 without root
AmbientCapabilities=CAP_NET_BIND_SERVICE

# Systemd hardening (NoNewPrivileges omitted — OTA update needs sudo systemctl restart)
PrivateTmp=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
LockPersonality=yes
RestrictRealtime=yes

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"
info "Service '${SERVICE_NAME}' enabled and started"

# ── Samba ─────────────────────────────────────────────────────────────────────

section "Samba"

SMB_CONF=/etc/samba/smb.conf
if [[ ! -f "${SMB_CONF}" ]] || ! grep -q '^\[global\]' "${SMB_CONF}" 2>/dev/null; then
  cat > "${SMB_CONF}" <<'SMBEOF'
[global]
   netbios name = HOMENAS
   server string = HomeNas OS
   workgroup = WORKGROUP
   security = user
   map to guest = bad user
   log level = 1
   max log size = 1000
   dns proxy = no
   server min protocol = SMB2
   server max protocol = SMB3

   # Performance
   socket options = TCP_NODELAY IPTOS_LOWDELAY
   use sendfile = yes
   aio read size = 16384
   aio write size = 16384

   # macOS / Finder compatibility (Fruit VFS)
   fruit:enabled = yes
   fruit:metadata = stream
   fruit:locking = netatalk
   fruit:posix_rename = yes
   vfs objects = catia fruit streams_xattr
SMBEOF
  info "smb.conf written"
else
  info "smb.conf already configured — skipping"
fi

systemctl enable smbd nmbd
systemctl restart smbd nmbd
info "Samba started"

# ── Avahi ─────────────────────────────────────────────────────────────────────

section "Avahi (mDNS)"

mkdir -p /etc/avahi/services
cat > /etc/avahi/services/smb.service <<'AVAHIEOF'
<?xml version="1.0" standalone='no'?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name replace-wildcards="yes">%h</name>
  <service>
    <type>_smb._tcp</type>
    <port>445</port>
  </service>
  <service>
    <type>_device-info._tcp</type>
    <port>0</port>
    <txt-record>model=RackMac</txt-record>
  </service>
</service-group>
AVAHIEOF

sed -i 's/^#use-ipv6=yes/use-ipv6=no/' /etc/avahi/avahi-daemon.conf 2>/dev/null || true

systemctl enable avahi-daemon
systemctl restart avahi-daemon
info "Avahi started"

# ── wsdd2 ─────────────────────────────────────────────────────────────────────

if systemctl list-unit-files wsdd2.service &>/dev/null 2>&1; then
  systemctl enable wsdd2
  systemctl restart wsdd2
  info "wsdd2 started (Windows WS-Discovery)"
else
  warn "wsdd2 service not found — Windows network discovery skipped"
fi

# ── Done ──────────────────────────────────────────────────────────────────────

section "Done"

sleep 2
if systemctl is-active --quiet "${SERVICE_NAME}"; then
  LOCAL_IP=$(hostname -I | awk '{print $1}')
  info ""
  info "HomeNas OS v${APP_VERSION} installed and running on x86_64"
  info ""
  info "  Dashboard : https://${LOCAL_IP}:${PORT}"
  info "  User      : admin"
  info "  The setup wizard will guide you when you open the panel."
  info "  If it asks for the initial password:"
  info "    sudo cat ${INSTALL_DIR}/data/initial-admin-password.txt"
  info ""
  info "  Logs  : journalctl -u ${SERVICE_NAME} -f"
  info "  Stop  : systemctl stop ${SERVICE_NAME}"
  info ""
  info "  mergerfs  : $(command -v mergerfs &>/dev/null && mergerfs --version 2>&1 | head -1 || echo 'not installed')"
  info "  snapraid  : $(command -v snapraid &>/dev/null && snapraid --version 2>&1 | head -1 || echo 'not installed')"
  info "  smartctl  : $(command -v smartctl &>/dev/null && smartctl --version 2>&1 | head -1 || echo 'not installed')"
else
  error "Service did not start. Check: journalctl -u ${SERVICE_NAME} -e"
  exit 1
fi
