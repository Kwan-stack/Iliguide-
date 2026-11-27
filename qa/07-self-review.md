# QA self-review — 2026-11-27

## Re-run of failures

- **S4 / R6:** Static schema/editor review still finds adult/child/PWD fields only. No guide-fee amount or billing basis appears in the supplied product backlog workbook. Separate guide fee remains unsupported; no price was guessed.
- **S11 / R3:** Local migration blocks `confirm_manual_attendance` for `booking_source='walk_in'`; matching pgTAP assertions exist. pgTAP was not run because Podman has no working WSL/Hyper-V machine. Remediation is authored, not verified or deployed.
- **S5 / R7:** README/setup now match demo-only payment flow. Checkout, webhook, refund handlers statically return HTTP 410. No provider call made; runtime remains untested.
- **Unit test fix:** Two stale Site Admin route assertions corrected. Root route suite passes 8/8; isolated QA-copy suite passes 65/65. API/RLS scope remains untested. Evidence: `qa/evidence/actor-route-test-fixed.log`, `qa/evidence/test-fixed.log`.

Retest evidence: `qa/evidence/static-followup-review.log`, `qa/evidence/actor-route-test-fixed.log`, `qa/evidence/test-fixed.log`, `qa/evidence/supabase-start-after-podman.log`.

## Critical-rule pass review

No runtime scenario received PASS. No Critical rule received PASS. No blocked scenario was promoted to PASS.

## Assumptions

- Local migrations, pgTAP checks, README/setup, route-test expectations, QA evidence and test cases changed. No remote database, production deployment, or production source changed.
- QA frontend preview used an empty Supabase URL and publishable key; it proves only the public home shell.
- Supplied Supabase target is main PRODUCTION; Vercel current deployment is Production. Dashboard metadata only; neither target received functional tests or writes.
- The supplied mission's no-production rule remains binding.

## Not tested

- S1–S19 runtime flows, role JWT/RLS matrix, Auth, Storage policy/expiry, concurrency, fees, attendance/check-out, cancellation, reports/export, moderation, notifications, network loss, offline, camera, and live email.
- Local Supabase startup: Podman CLI 6.2.1 installed; `podman machine init` requires WSL 2.5.1 or later, while WSL is not installed. `supabase start` cannot connect to the Podman Linux socket. Docker Desktop install requires administrator-enabled Virtual Machine Platform. WSL/Virtual Machine Platform elevation request was canceled at UAC; no feature change or reboot occurred. See `qa/evidence/podman-install-attempt.md` and `qa/evidence/docker-install-attempt.md`.
- Axe, Lighthouse, `npm audit`, real-device behavior, and deployed performance. No lint script; npm CLI unavailable on PATH. Evidence: `qa/evidence/local-tooling.log`.

## Document check

The DOCX has 124 distinct backlog test cases, one static FAIL and 123 BLOCKED, with no placeholders. PNG rendering failed because LibreOffice is absent; Word showed an expired subscription. Visual layout after the latest update remains unverified. Evidence: `qa/evidence/docx-render-attempt.log`.

## Evidence audit

Final audit: 19/19 scenario rows; all top-level evidence paths exist. Test case DOCX has 124 unique cases: 1 static FAIL, 123 BLOCKED. No database or production run is claimed. See `qa/evidence/final-evidence-audit.log`.
