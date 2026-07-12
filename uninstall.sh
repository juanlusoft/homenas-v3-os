#!/usr/bin/env bash
set -euo pipefail

# ─── HomeNas OS v3 — Uninstall script ─────────────────────────────────────────
# Usage:
#   sudo bash uninstall.sh                       (interactive, asks for confirm)
#   sudo bash uninstall.sh --yes                 (non-interactive)
#   curl -sSL .../uninstall.sh | sudo bash -s -- --yes
# Removes: systemd service, /opt/homenas-v3, TLS certs
# Does NOT remove: Node.js, pnpm, git, apt packages

INSTALL_DIR="/opt/homenas-v3"
SERVICE_NAME="homenas"
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=1 ;;
  esac
done

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; NC='\033[0m'
info()  { echo -e "${GREEN}[homenas]${NC} $*"; }
warn()  { echo -e "${YELLOW}[homenas]${NC} $*"; }
error() { echo -e "${RED}[homenas]${NC} $*" >&2; }

# ── Root check ────────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  error "Run as root: sudo bash uninstall.sh"
  exit 1
fi

# ── Confirm ───────────────────────────────────────────────────────────────────
warn "This will:"
warn "  - Stop and remove the ${SERVICE_NAME} systemd service"
warn "  - Delete ${INSTALL_DIR} (includes database and certificates)"
warn "  - Remove /etc/sudoers.d/homenas and the 'homenas' system user"
echo ""
if (( ASSUME_YES )); then
  info "--yes set, proceeding without prompt."
elif [[ -t 0 ]]; then
  # stdin is a TTY → ask normally
  read -rp "Are you sure? [y/N] " CONFIRM
  if [[ "${CONFIRM,,}" != "y" ]]; then
    info "Aborted."
    exit 0
  fi
elif [[ -r /dev/tty ]]; then
  # Piped via curl|bash but TTY available → read from controlling terminal
  read -rp "Are you sure? [y/N] " CONFIRM </dev/tty
  if [[ "${CONFIRM,,}" != "y" ]]; then
    info "Aborted."
    exit 0
  fi
else
  error "No interactive terminal detected (running via pipe). Re-run with --yes:"
  error "  curl -sSL .../uninstall.sh | sudo bash -s -- --yes"
  exit 1
fi

# ── Stop and disable service ──────────────────────────────────────────────────
if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  info "Stopping ${SERVICE_NAME}..."
  systemctl stop "$SERVICE_NAME"
fi

if systemctl is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
  info "Disabling ${SERVICE_NAME}..."
  systemctl disable "$SERVICE_NAME"
fi

# ── Remove service file ───────────────────────────────────────────────────────
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
if [[ -f "$SERVICE_FILE" ]]; then
  info "Removing ${SERVICE_FILE}..."
  rm -f "$SERVICE_FILE"
  systemctl daemon-reload
fi

# ── Remove application directory ──────────────────────────────────────────────
if [[ -d "$INSTALL_DIR" ]]; then
  info "Removing ${INSTALL_DIR}..."
  rm -rf "$INSTALL_DIR"
fi

# ── Remove privilege grant and service user ───────────────────────────────────
# The installer grants `homenas ALL=(root) NOPASSWD: ALL`. Leaving it behind
# after uninstall is a latent root-escalation vector, so remove it explicitly.
if [[ -f /etc/sudoers.d/homenas ]]; then
  info "Removing /etc/sudoers.d/homenas (NOPASSWD grant)..."
  rm -f /etc/sudoers.d/homenas
fi
if id homenas &>/dev/null; then
  info "Removing 'homenas' system user..."
  userdel homenas 2>/dev/null || warn "Could not remove 'homenas' user (in use?)"
fi

# ── Remove Avahi advertisement created by the installer ───────────────────────
if [[ -f /etc/avahi/services/smb.service ]]; then
  info "Removing /etc/avahi/services/smb.service..."
  rm -f /etc/avahi/services/smb.service
  systemctl reload avahi-daemon 2>/dev/null || true
fi

# ── Done ──────────────────────────────────────────────────────────────────────
info ""
info "✓ HomeNas OS v3 desinstalado correctamente."
info "  Node.js, pnpm y git no han sido eliminados."
warn "  Samba (smb.conf), wsdd2 y los paquetes apt siguen instalados/activos."
warn "  Si no los usas para otra cosa: apt-get remove samba wsdd2  (revisa antes)."
info ""
