#!/usr/bin/env bash
set -euo pipefail

# ─── HomeNas OS — Install script ───────────────────────────────────────────
# Usage: curl -sSL https://raw.githubusercontent.com/juanlusoft/homenas-os/main/install.sh | bash
# Tested on:
#   - Raspberry Pi OS / Debian arm64
#   - Ubuntu 22.04 / 24.04 x86_64
#   - Debian 12 (Bookworm) x86_64
#   - Node.js >= 18

REPO="https://github.com/juanlusoft/homenas-os.git"
INSTALL_DIR="/opt/homenas-v3"
SERVICE_NAME="homenas"
PORT=443
CERT_DIR="${INSTALL_DIR}/certs"
CERT_PATH="${CERT_DIR}/server.crt"
KEY_PATH="${CERT_DIR}/server.key"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${GREEN}[homenas]${NC} $*"; }
warn()  { echo -e "${YELLOW}[homenas]${NC} $*"; }
error() { echo -e "${RED}[homenas]${NC} $*" >&2; }

# ── Architecture and OS detection ─────────────────────────────────────────────
ARCH=$(uname -m)
OS_ID=""
OS_VERSION_ID=""
OS_PRETTY=""

if [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  source /etc/os-release
  OS_ID="${ID:-}"
  OS_VERSION_ID="${VERSION_ID:-}"
  OS_PRETTY="${PRETTY_NAME:-Linux}"
elif command -v lsb_release &>/dev/null; then
  OS_ID=$(lsb_release -si | tr '[:upper:]' '[:lower:]')
  OS_VERSION_ID=$(lsb_release -sr)
  OS_PRETTY=$(lsb_release -sd)
fi

info "Architecture: ${ARCH}"
info "OS: ${OS_PRETTY}"

# Normalise arch label
case "${ARCH}" in
  x86_64)  ARCH_LABEL="x86_64" ;;
  aarch64|arm64) ARCH_LABEL="arm64" ;;
  armv7l|armhf)  ARCH_LABEL="armhf" ;;
  *) warn "Unrecognised architecture '${ARCH}' — proceeding anyway" ; ARCH_LABEL="${ARCH}" ;;
esac

# Read version from package.json after clone/update (fallback hardcoded)
APP_VERSION="1.0.0"
get_version() {
  local pkg="${INSTALL_DIR}/package.json"
  if [[ -f "$pkg" ]]; then
    APP_VERSION=$(grep '"version"' "$pkg" | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
  fi
}

# ── Root check ────────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  error "Run as root: sudo bash install.sh"
  exit 1
fi

# ── Node.js ───────────────────────────────────────────────────────────────────
info "Checking Node.js..."
if ! command -v node &>/dev/null; then
  info "Installing Node.js 22 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
NODE_VER=$(node -e "console.log(parseInt(process.versions.node))")
if (( NODE_VER < 18 )); then
  error "Node.js ≥ 18 required (found $(node --version))"
  exit 1
fi
info "Node.js $(node --version) OK"

# ── npm (upgrade to latest) ───────────────────────────────────────────────────
# Keeps npm up to date against supply chain vulnerabilities in the registry
# client itself and ensures latest audit/integrity features are available.
info "Upgrading npm to latest..."
if npm install -g npm@latest --loglevel=error 2>/dev/null; then
  info "npm $(npm --version) OK"
else
  warn "npm upgrade failed (broken bundled npm) — reinstalling via Node.js corepack..."
  if corepack enable npm 2>/dev/null && npm install -g npm@latest --loglevel=error 2>/dev/null; then
    info "npm $(npm --version) OK"
  else
    warn "npm upgrade skipped — continuing with $(npm --version 2>/dev/null || echo 'unknown')"
  fi
fi

# ── pnpm ─────────────────────────────────────────────────────────────────────
info "Checking pnpm..."
if ! command -v pnpm &>/dev/null; then
  info "Installing pnpm..."
  npm install -g pnpm
fi
info "pnpm $(pnpm --version) OK"

# ── Git ───────────────────────────────────────────────────────────────────────
if ! command -v git &>/dev/null; then
  info "Installing git..."
  apt-get install -y git
fi

# ── System dependencies ───────────────────────────────────────────────────────
info "Installing system dependencies..."

# Base packages available on all supported platforms.
# NB: `stdbuf` is NOT an apt package — the binary ships inside `coreutils`,
# which is already listed below. Adding stdbuf as a pkg name caused
# "E: Unable to locate package stdbuf" on every Debian/Ubuntu install.
BASE_PKGS=(
  xfsprogs
  e2fsprogs
  parted
  util-linux
  udev
  coreutils
  samba
  samba-vfs-modules
  avahi-daemon
  smartmontools
  hdparm
  rsync
  lsof
)

# wsdd2 (Windows WS-Discovery): available in Debian 11+ and Ubuntu 22.04+ repos.
# On older/exotic distros the package may not exist — we install it separately
# with a graceful fallback.
WSDD2_PKGS=(wsdd2)

# mergerfs and snapraid: not in official Ubuntu/Debian repos — installed below
# via architecture-specific method.
# NFS server: nfs-kernel-server (same package name on all Debian-family distros)
NFS_PKGS=(nfs-kernel-server)

# ethtool: used by network.service for interface speed reporting
EXTRA_PKGS=(ethtool)

# Refresh apt index — without this, a stale/empty cache causes silent install
# failures that surface much later (e.g. /etc/samba missing when writing smb.conf).
apt-get update -qq

# Required packages: fail loudly if any can't be installed (set -e aborts).
# Don't wrap in `|| true` — a missing samba/avahi/etc. breaks later steps.
apt-get install -y --no-install-recommends "${BASE_PKGS[@]}" "${NFS_PKGS[@]}" "${EXTRA_PKGS[@]}"

# wsdd2: graceful — not critical if unavailable
apt-get install -y --no-install-recommends "${WSDD2_PKGS[@]}" 2>/dev/null \
  || warn "wsdd2 not available in apt — Windows WS-Discovery will not work"

# ── mergerfs ──────────────────────────────────────────────────────────────────
info "Installing mergerfs..."
MERGERFS_INSTALLED=false

install_mergerfs_deb() {
  local deb_url=""
  # Fetch latest mergerfs release for the correct architecture from GitHub
  local api_url="https://api.github.com/repos/trapexit/mergerfs/releases/latest"
  local arch_deb=""
  case "${ARCH_LABEL}" in
    x86_64) arch_deb="amd64" ;;
    arm64)  arch_deb="arm64" ;;
    armhf)  arch_deb="armhf" ;;
    *)      arch_deb="amd64" ;;
  esac

  # Determine Debian/Ubuntu codename for package selection
  local codename="${VERSION_CODENAME:-}"
  if [[ -z "${codename}" ]] && command -v lsb_release &>/dev/null; then
    codename=$(lsb_release -sc)
  fi

  # Try to find a matching .deb from the release assets
  if command -v curl &>/dev/null; then
    deb_url=$(curl -fsSL "${api_url}" 2>/dev/null \
      | grep -o "https://[^\"]*${arch_deb}[^\"]*\.deb" \
      | grep -v "static" \
      | head -1 || true)
  fi

  if [[ -n "${deb_url}" ]]; then
    local tmp_deb
    tmp_deb=$(mktemp /tmp/mergerfs-XXXXXX.deb)
    if curl -fsSL -o "${tmp_deb}" "${deb_url}" 2>/dev/null; then
      dpkg -i "${tmp_deb}" && MERGERFS_INSTALLED=true || apt-get install -f -y
      rm -f "${tmp_deb}"
    fi
  fi

  # Fallback: try the static build (works on any Linux/libc)
  if [[ "${MERGERFS_INSTALLED}" != "true" ]]; then
    local static_url
    if command -v curl &>/dev/null; then
      static_url=$(curl -fsSL "${api_url}" 2>/dev/null \
        | grep -o "https://[^\"]*${arch_deb}[^\"]*static[^\"]*\.tar\.gz" \
        | head -1 || true)
    fi
    if [[ -n "${static_url:-}" ]]; then
      local tmp_tar
      tmp_tar=$(mktemp /tmp/mergerfs-XXXXXX.tar.gz)
      if curl -fsSL -o "${tmp_tar}" "${static_url}"; then
        tar -xzf "${tmp_tar}" -C /usr/local/bin --wildcards '*/mergerfs' --strip-components=1 2>/dev/null \
          && chmod +x /usr/local/bin/mergerfs \
          && MERGERFS_INSTALLED=true
        rm -f "${tmp_tar}"
      fi
    fi
  fi
}

if command -v mergerfs &>/dev/null; then
  info "mergerfs already installed: $(mergerfs --version 2>&1 | head -1 || true)"
  MERGERFS_INSTALLED=true
elif apt-cache show mergerfs &>/dev/null 2>&1; then
  apt-get install -y mergerfs && MERGERFS_INSTALLED=true
else
  install_mergerfs_deb
fi

if [[ "${MERGERFS_INSTALLED}" != "true" ]]; then
  warn "mergerfs could not be installed automatically."
  warn "Install manually: https://github.com/trapexit/mergerfs/releases"
fi

# ── snapraid ──────────────────────────────────────────────────────────────────
info "Installing snapraid..."
SNAPRAID_INSTALLED=false

if command -v snapraid &>/dev/null; then
  info "snapraid already installed"
  SNAPRAID_INSTALLED=true
elif apt-cache show snapraid &>/dev/null 2>&1; then
  apt-get install -y snapraid && SNAPRAID_INSTALLED=true
else
  # Build from source (requires gcc make libz-dev)
  if apt-get install -y --no-install-recommends gcc make libz-dev 2>/dev/null; then
    SNAPRAID_SRC_URL="https://github.com/amadvance/snapraid/releases/download/v12.3/snapraid-12.3.tar.gz"
    local_tmp=$(mktemp -d /tmp/snapraid-XXXXXX)
    if curl -fsSL -o "${local_tmp}/snapraid.tar.gz" "${SNAPRAID_SRC_URL}" 2>/dev/null; then
      tar -xzf "${local_tmp}/snapraid.tar.gz" -C "${local_tmp}" --strip-components=1
      pushd "${local_tmp}" >/dev/null
      ./configure --prefix=/usr && make -j"$(nproc)" && make install
      popd >/dev/null
      SNAPRAID_INSTALLED=true
    fi
    rm -rf "${local_tmp}"
  fi
fi

if [[ "${SNAPRAID_INSTALLED}" != "true" ]]; then
  warn "snapraid could not be installed automatically."
  warn "Install manually: https://github.com/amadvance/snapraid/releases"
fi

# ── ARM-specific extras ───────────────────────────────────────────────────────
if [[ "${ARCH_LABEL}" == "arm64" || "${ARCH_LABEL}" == "armhf" ]]; then
  info "ARM platform detected — checking for arm-specific packages..."
  # libraspberrypi-bin provides vcgencmd (Raspberry Pi only; non-fatal if absent)
  apt-get install -y --no-install-recommends libraspberrypi-bin 2>/dev/null \
    || true  # not available on non-RPi ARM boards
fi

# ── Clone / update ────────────────────────────────────────────────────────────
if [[ -d "$INSTALL_DIR/.git" ]]; then
  info "Updating existing installation in $INSTALL_DIR..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  info "Cloning into $INSTALL_DIR..."
  git clone "$REPO" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
get_version
info "HomeNas OS v${APP_VERSION}"

# ── Dedicated service user (must exist BEFORE pnpm install) ───────────────────
# Creating the user up here means we can run `pnpm install` as the homenas
# user, so npm postinstall scripts in transitive deps don't execute as root.
info "Setting up homenas system user..."
if ! id homenas &>/dev/null; then
  useradd -r -s /usr/sbin/nologin -d "$INSTALL_DIR" -c "HomeNas OS service" homenas
fi
chown -R homenas:homenas "$INSTALL_DIR"
git config --global --add safe.directory "$INSTALL_DIR" 2>/dev/null || true
sudo -u homenas git config --global --add safe.directory "$INSTALL_DIR" 2>/dev/null || true

# ── Install dependencies (as homenas, NOT root) ───────────────────────────────
# postinstall scripts of any compromised npm transitive dep would otherwise
# run as root with full system access.
# --ignore-scripts: skip ALL install scripts during resolution so that pnpm v11+
# doesn't abort with ERR_PNPM_IGNORED_BUILDS (exit 1) when the lockfile was
# generated with an older pnpm that stored build approvals in package.json.
# Native addons are compiled explicitly in the next step.
info "Installing dependencies..."
sudo -u homenas pnpm install --frozen-lockfile --ignore-scripts

# Compile native addons that require a build step (better-sqlite3, esbuild).
# pnpm rebuild is unreliable here because pnpm v11 uses a content-addressable
# virtual store — the rebuild command may not locate the package correctly when
# the lockfile was generated with an older pnpm. We call node-pre-gyp/npm
# directly inside the package directory instead.
info "Building native addons (better-sqlite3)..."
SQLITE3_PKG=$(find "${INSTALL_DIR}/node_modules/.pnpm" -maxdepth 2 -name "better-sqlite3" -type d 2>/dev/null | grep "node_modules/better-sqlite3$" | head -1)
if [[ -n "${SQLITE3_PKG}" ]]; then
  if ! ls "${SQLITE3_PKG}"/build/Release/better_sqlite3.node &>/dev/null; then
    (cd "${SQLITE3_PKG}" && npm install --ignore-scripts=false 2>&1 | tail -3) \
      || warn "better-sqlite3 native build failed — app may not start"
  else
    info "better-sqlite3 already compiled"
  fi
else
  warn "better-sqlite3 package not found in virtual store"
fi

# ── Build (as homenas) ────────────────────────────────────────────────────────
info "Building frontend and backend..."
sudo -u homenas NODE_ENV=production pnpm -r build

# ── Self-signed TLS certificate ───────────────────────────────────────────────
info "Generating self-signed TLS certificate..."
mkdir -p "$CERT_DIR"
if [[ ! -f "$CERT_PATH" || ! -f "$KEY_PATH" ]]; then
  # Use the interface that routes to the internet — avoids picking Docker/loopback IPs
  LOCAL_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1); exit}')
  LOCAL_IP=${LOCAL_IP:-$(hostname -I | awk '{print $1}')}
  openssl req -x509 -nodes -newkey rsa:2048 \
    -keyout "$KEY_PATH" \
    -out "$CERT_PATH" \
    -days 3650 \
    -subj "/CN=homenas" \
    -addext "subjectAltName=IP:${LOCAL_IP},DNS:homenas,DNS:localhost" \
    2>/dev/null
  info "Certificate generated (valid 10 years)"
else
  info "Certificate already exists — skipping"
fi
chown root:homenas "$CERT_DIR"   # homenas user must be able to enter the dir
chmod 750 "$CERT_DIR"
chown homenas:homenas "$KEY_PATH" "$CERT_PATH"
chmod 600 "$KEY_PATH" "$CERT_PATH"

# ── Docker (needed for the docker management panel) ──────────────────────────
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

# ── Docker group for homenas ──────────────────────────────────────────────────
# Docker installed earlier in the script (or by an earlier install). Add the
# user to the docker group so the homestore service can run docker commands
# without needing sudo for them.
usermod -aG docker homenas 2>/dev/null || warn "docker group not found — skipping (Docker not installed?)"

# Sudoers: homenas can run any command as root without password.
# TODO(security): replace with an enumerated allowlist of /usr/bin/lsblk,
# /usr/sbin/smartctl, /bin/mount, /bin/umount, /usr/bin/systemctl restart …
# and the rest of the privileged commands the backend actually invokes.
# Currently NOPASSWD: ALL means any RCE in the Node backend = root.
cat > /etc/sudoers.d/homenas <<'SUDOEOF'
homenas ALL=(root) NOPASSWD: ALL
SUDOEOF
chmod 440 /etc/sudoers.d/homenas

# ── Systemd service ───────────────────────────────────────────────────────────
info "Creating systemd service..."
SERVER_JS="${INSTALL_DIR}/apps/backend/dist/apps/backend/src/server.js"

# Resolve the absolute path of node — prefer the binary that is currently in
# PATH (nodesource installs to /usr/bin/node; nvm installs under ~/.nvm).
# Using `which` inside the script captures the runtime PATH at install time.
NODE_BIN=$(command -v node 2>/dev/null || which node 2>/dev/null)
if [[ -z "${NODE_BIN}" ]]; then
  error "Cannot find node binary. Install Node.js first."
  exit 1
fi
info "node binary: ${NODE_BIN}"

# Ensure data directory exists and is writable
mkdir -p "${INSTALL_DIR}/apps/backend/data"
chown homenas:homenas "${INSTALL_DIR}/apps/backend/data"

# Build a PATH that covers the most common Node.js installation locations:
#  - /usr/bin          (apt/nodesource)
#  - /usr/local/bin    (manual / n / volta)
#  - /usr/local/sbin   (mergerfs static build)
#  - /sbin /usr/sbin   (smartctl, hdparm, parted, mkfs.*)
NODE_DIR=$(dirname "${NODE_BIN}")
SERVICE_PATH="${NODE_DIR}:/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin"

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
# CapabilityBoundingSet is intentionally omitted: homenas uses sudo (NOPASSWD:ALL) for
# privileged commands (lsblk, smartctl, mount, systemctl...). A bounding set that only
# allows CAP_NET_BIND_SERVICE blocks sudo's setuid/setgid syscalls and breaks all those calls.

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
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

# ── Network discovery (Mac Bonjour + Windows WSD) ────────────────────────────
info "Configuring network discovery..."

HOSTNAME_SHORT=$(hostname -s)

# ── Samba global config ───────────────────────────────────────────────────────
# Write a [global] section that gives the NAS a friendly name and ensures
# it appears in Mac Finder and Windows Explorer network browsers.
SMB_CONF=/etc/samba/smb.conf
# Defensive: if samba install failed silently the parent dir won't exist and the
# heredoc redirect would die with "No such file or directory". Skip with warning
# instead of crashing the whole installer.
if [[ ! -d /etc/samba ]]; then
  warn "/etc/samba missing — samba install failed earlier. Skipping smb.conf setup."
  warn "Reinstall samba manually: apt-get install -y samba samba-vfs-modules"
elif [[ ! -f "$SMB_CONF" ]] || ! grep -q '^\[global\]' "$SMB_CONF" 2>/dev/null; then
  cat > "$SMB_CONF" <<SMBEOF
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
fi

systemctl enable smbd nmbd
systemctl restart smbd nmbd

# ── Avahi: advertise SMB so Mac Finder shows the NAS in the sidebar ───────────
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

# Disable IPv6 publish if not needed (avoids avahi conflicts on some setups)
sed -i 's/^#use-ipv6=yes/use-ipv6=no/' /etc/avahi/avahi-daemon.conf 2>/dev/null || true

systemctl enable avahi-daemon
systemctl restart avahi-daemon

# ── wsdd2: Windows 10/11 WS-Discovery ────────────────────────────────────────
systemctl enable wsdd2
systemctl restart wsdd2

info "Network discovery enabled (Mac Bonjour + Windows WSD)"

# ── Done ──────────────────────────────────────────────────────────────────────
sleep 2
if systemctl is-active --quiet "$SERVICE_NAME"; then
  LOCAL_IP=$(hostname -I | awk '{print $1}')
  info ""
  info "✓ HomeNas OS v${APP_VERSION} instalado y funcionando"
  info ""
  info "  Dashboard: https://${LOCAL_IP}:${PORT}"
  info "  Usuario:   admin"
  info "  El asistente de configuración te guiará al abrir el panel."
  info "  Si te pide la contraseña inicial:"
  info "    sudo cat ${INSTALL_DIR}/data/initial-admin-password.txt"
  info ""
  info "  Logs:  journalctl -u ${SERVICE_NAME} -f"
  info "  Stop:  systemctl stop ${SERVICE_NAME}"
else
  error "El servicio no arrancó. Comprueba: journalctl -u ${SERVICE_NAME} -e"
  exit 1
fi
