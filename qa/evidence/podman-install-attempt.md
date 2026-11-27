# Podman installation attempt — 2026-11-27

- Installed Podman CLI 6.2.1 per-user with Scoop; installer hash matched its manifest.
- `podman machine init` downloaded the machine image, then exited 1: `WSL version 2.5.1 or later is required to run Podman. Please upgrade WSL with: wsl --update`. `wsl --version` and `wsl --status` report WSL is not installed. `podman machine list` shows no machine.
- Isolated QA `supabase start` exited 1 after Podman install: could not connect to the Podman Linux socket. No local Supabase services or database started. Evidence: `qa/evidence/supabase-start-after-podman.log`.
- Docker Desktop per-user install also stopped because Virtual Machine Platform is disabled and Windows feature setup needs administrator rights. The elevated WSL/Virtual Machine Platform enable request was canceled at UAC; no feature changed and no reboot occurred.
- Podman CLI is installed; runtime remains unavailable until an administrator enables WSL 2 or supported Hyper-V, installs/updates the provider, and restarts Windows. Production was not contacted or changed.
