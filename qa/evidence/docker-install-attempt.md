# Docker Desktop install attempt — 2026-11-27

- Official Docker Desktop 4.100.1 installer SHA-256 matched Docker's published package hash.
- First per-user attempt stopped on C: disk space: needed 3278 MiB; 3232 MiB free. Installer moved to `D:\IliGuide-QA-Docker-Install-20261127\Docker Desktop Installer.exe`; hash verified unchanged.
- Retry had sufficient space and extracted setup. Installer reported: “Docker Desktop requires the `Virtual Machine Platform` Windows feature, which is not enabled on this machine. A per-user installation cannot enable it, because that requires administrator privileges.” It offered admin `wsl --install` plus reboot, or all-users setup.
- WSL is not installed; Windows identity is not Administrator. No elevation or OS feature change attempted. Docker Desktop did not install; Podman was not installed.
- Runtime tests remain blocked. After an administrator enables WSL/Virtual Machine Platform and reboots, rerun the installer and start local Supabase. Do not target production.
- Installer log: `%LOCALAPPDATA%\Docker\log\host\Docker Desktop Installer.exe.log`.
