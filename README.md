# HomeNas OS

Panel de control para tu NAS casero. Gestiona discos, archivos, copias de seguridad, Docker, red y más desde cualquier navegador.

**Versión 1.0.0** · [homelabs.club](https://homelabs.club)

---

## Instalación

### Raspberry Pi / ARM64

```bash
curl -fsSL https://raw.githubusercontent.com/juanlusoft/homenas-os/main/install.sh | sudo bash
```

### PC / Servidor x86 (Ubuntu 22.04 / 24.04 · Debian 12)

```bash
curl -fsSL https://raw.githubusercontent.com/juanlusoft/homenas-os/main/install-x86.sh | sudo bash
```

El instalador hace todo solo: instala dependencias, configura el servicio y arranca el panel. Cuando termine, abre `https://IP-DE-TU-NAS` en el navegador.

> El instalador es **idempotente**: puedes volver a ejecutarlo para actualizar una instalación existente sin perder datos.

---

## Qué incluye

### Almacenamiento
- **Discos** — ve el estado de todos tus discos y su temperatura en tiempo real
- **Archivos** — navega, sube, descarga y organiza tus archivos desde el navegador
- **Pool de datos** — combina varios discos en uno usando MergerFS
- **Paridad** — protege tus datos frente a fallos de disco con SnapRAID
- **Unidades de red** — conecta y monta carpetas remotas (WebDAV, SFTP, S3, SMB, FTP, Backblaze B2)

### Copias de seguridad
- **Copia en la nube** — sincroniza con cualquier servicio compatible con rclone (Dropbox, Google Drive, Backblaze, etc.)

### Red y acceso
- **Samba** — comparte carpetas con Windows, Mac y Linux de tu red local automáticamente
- **WireGuard** — VPN integrada para acceder a tu NAS desde fuera de casa de forma segura
- **NFS** — comparte carpetas con otros servidores Linux
- **DNS personalizado** — bloquea publicidad y configura dominios locales

### Aplicaciones
- **Docker** — gestiona contenedores e imágenes sin tocar la terminal
- **Syncthing** — sincronización continua entre dispositivos

### Sistema
- **Dashboard** — resumen en tiempo real: CPU, RAM, temperatura, red, discos
- **Usuarios** — crea cuentas con distintos niveles de acceso
- **Actualizaciones** — actualiza el panel y el sistema operativo con un clic
- **Alertas** — recibe notificaciones por email o Telegram cuando algo falla
- **2FA** — autenticación en dos pasos para mayor seguridad

---

## Requisitos

| Componente | Mínimo |
|---|---|
| CPU | ARM64 (Raspberry Pi 4/5) o x86_64 |
| RAM | 1 GB |
| Almacenamiento del sistema | 8 GB (tarjeta SD o SSD) |
| Sistema operativo | Raspberry Pi OS · Ubuntu 22.04/24.04 · Debian 12 |
| Conexión | Red local |

---

## Actualizar

El panel incluye actualizaciones con un clic desde **Sistema → Actualizaciones**. También puedes volver a ejecutar el instalador sobre una instalación existente.

---

## Desinstalar

```bash
curl -fsSL https://raw.githubusercontent.com/juanlusoft/homenas-os/main/uninstall.sh | sudo bash
```

---

---

# HomeNas OS — English

Control panel for your home NAS. Manage disks, files, backups, Docker, networking and more from any browser.

**Version 1.0.0** · [homelabs.club](https://homelabs.club)

---

## Installation

### Raspberry Pi / ARM64

```bash
curl -fsSL https://raw.githubusercontent.com/juanlusoft/homenas-os/main/install.sh | sudo bash
```

### PC / Server x86 (Ubuntu 22.04 / 24.04 · Debian 12)

```bash
curl -fsSL https://raw.githubusercontent.com/juanlusoft/homenas-os/main/install-x86.sh | sudo bash
```

The installer handles everything: installs dependencies, sets up the service and starts the panel. When it's done, open `https://YOUR-NAS-IP` in your browser.

> The installer is **idempotent**: you can run it again to update an existing installation without losing any data.

---

## What's included

### Storage
- **Disks** — see all your disks, their usage and temperature in real time
- **Files** — browse, upload, download and organize your files from the browser
- **Data pool** — combine multiple disks into one using MergerFS
- **Parity** — protect your data against disk failures with SnapRAID
- **Network drives** — connect and mount remote folders (WebDAV, SFTP, S3, SMB, FTP, Backblaze B2)

### Backups
- **Cloud backup** — sync with any rclone-compatible service (Dropbox, Google Drive, Backblaze, etc.)

### Network & access
- **Samba** — share folders with Windows, Mac and Linux on your local network automatically
- **WireGuard** — built-in VPN to access your NAS from anywhere securely
- **NFS** — share folders with other Linux servers
- **Custom DNS** — block ads and set up local domains

### Applications
- **Docker** — manage containers and images without touching the terminal
- **Syncthing** — continuous sync between devices

### System
- **Dashboard** — real-time overview: CPU, RAM, temperature, network, disks
- **Users** — create accounts with different access levels
- **Updates** — update the panel and OS with one click
- **Alerts** — get notified by email or Telegram when something goes wrong
- **2FA** — two-factor authentication for extra security

---

## Requirements

| Component | Minimum |
|---|---|
| CPU | ARM64 (Raspberry Pi 4/5) or x86_64 |
| RAM | 1 GB |
| System storage | 8 GB (SD card or SSD) |
| Operating system | Raspberry Pi OS · Ubuntu 22.04/24.04 · Debian 12 |
| Network | Local network |

---

## Update

The panel includes one-click updates from **System → Updates**. You can also re-run the installer on top of an existing installation.

---

## Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/juanlusoft/homenas-os/main/uninstall.sh | sudo bash
```
