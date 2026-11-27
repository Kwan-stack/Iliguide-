# IliGuide functional QA report

## Verdict: FAIL

FAIL by the supplied verdict rule: core flows S1, S8, S9 and S10 could not be completed in a safe local environment. Podman CLI is installed, but its Linux VM cannot start because WSL is absent; Docker Desktop also needs administrator-enabled virtualization. S4/R6 remains a static product failure. A local R3 guard and regression test were added but not executed. No production app or database functional testing was performed.

Three main test drivers:

- S1 visitor booking: blocked before a database-backed booking could be created.
- S8/S9 attendance: partial check-in and confirmed checkout could not run.
- S10 walk-in: registration and QR check-in could not run. The local R3 migration source contains a rejection guard for manual walk-in confirmation; its pgTAP regression is unrun.

Static failure: S4/R6, because no separate guide-fee field exists. A local R3 migration adds a manual walk-in rejection guard; pgTAP regression is blocked. R7 setup documentation now matches the demo-only payment flow and disabled handlers.

## Environment and safety

- Repository: C:\Users\gaily\OneDrive\Desktop\Iliguide
- Commit: e250e214b26c1aa3b8d8def5a3cc007d31902b44; pre-existing dirty worktree copied into QA snapshot.
- Date: 2026-11-27 (Asia/Manila).
- Target: isolated QA copy; project ID iliguide-qa-local-20261127. API target was not started.
- Node v24.22.3; Supabase CLI 3.2.0; Vite 6.4.5.
- Supabase start after Podman install: cannot connect to Podman Linux socket; no machine exists. Podman CLI 6.2.1 is installed, but `podman machine init` requires WSL 2.5.1 or later. WSL is absent. Docker Desktop install also stopped because Virtual Machine Platform is disabled and enabling it requires administrator rights. Evidence: qa/evidence/supabase-start-after-podman.log; qa/evidence/podman-install-attempt.md; qa/evidence/docker-install-attempt.md.
- Local runtime needs administrator setup for WSL 2 or supported Hyper-V, then a Windows restart. The WSL/Virtual Machine Platform elevation request was canceled; no feature changed. Podman CLI alone cannot run Supabase containers.
- Read-only Supabase and Vercel dashboard metadata accessed only. No production app or database query, write, seed, or deploy. No key revealed; no payment, provider, or email call. No synthetic user, booking, document, or database row created. Seed script syntax checked only. No reset needed because DB never started.
- No production source, database, or deployment changed. Updated route-test expectations and QA test cases. Added local migration `supabase/migrations/20261126224632_walkin_attendance_requires_qr.sql`, pgTAP regression checks, and corrected README/setup payment claims. None deployed or run against a database. Existing dirty worktree changes were preserved.

## Scenario results

| ID | Scenario | Rule | Expected | Actual | Verdict | Severity | Evidence |
|---|---|---|---|---|---|---|---|
| S1 | Visitor happy path | R9 | QA_Tinago, party 2 adult + 1 child, database-calculated total PHP 275, confirmed booking and ticket | Not run; local DB unavailable | BLOCKED | Critical criterion; environment | qa/evidence/supabase-start.log; qa/seed/seed.mjs |
| S2 | PWD booking and document scope | R10 | Independent discount, required document when enabled, authorized-only read | Not run; no Auth/Storage | BLOCKED | N/A | qa/evidence/supabase-start.log |
| S3 | Mimbalot free booking | R6 | Zero admission total and ticket | Not run; no DB | BLOCKED | N/A | qa/evidence/supabase-start.log; qa/seed/seed.mjs |
| S4 | Sikyop entrance and guide fees | R6 | Show and charge entrance and guide fees separately | Static schema/UI have adult and child fee only; no guide-fee field | FAIL | High | qa/evidence/static-followup-review.log |
| S5 | Demo payment | R7 | Demo label; no provider call, real receipt, refund or verification | Static review: checkout, webhook and refund handlers return 410; README/setup now describe demo-only behavior. Runtime not run | BLOCKED | N/A | qa/evidence/static-followup-review.log; qa/evidence/supabase-start-after-podman.log |
| S6 | Slot exhaustion and concurrency | R9 | Reject over-capacity, invalid party sizes, closed/past dates; exactly one last-seat request succeeds | Not run; no DB | BLOCKED | N/A | qa/evidence/supabase-start.log; qa/seed/seed.mjs |
| S7 | Booking hold | R9 | Verify expiry and released capacity; compare hold/payment windows | Not run. Static values: 10-minute base hold; manual-payment window defaults to 15 minutes and extends active hold | BLOCKED | N/A | qa/01-discovery.md; qa/evidence/supabase-start.log |
| S8 | Check-in and partial group | R1 | No entry until gatekeeper confirms selected visitors; partial group supported | Not run; no Auth/DB | BLOCKED | Critical criterion; environment | qa/evidence/supabase-start.log |
| S9 | Checkout | R2 | Exit only after gatekeeper confirmation; no duplicate/negative occupancy | Not run; no Auth/DB | BLOCKED | Critical criterion; environment | qa/evidence/supabase-start.log |
| S10 | Walk-in | R3 | Counts unchanged until QR scan and confirmed check-in | Not run. New registration path not executed | BLOCKED | Critical criterion; environment | qa/evidence/supabase-start.log |
| S11 | Manual lookup | R3 | Manual lookup cannot record walk-in attendance without required QR confirmation | Static review: local migration contains a walk-in rejection guard; pgTAP regression authored but not run because Podman could not start | BLOCKED | N/A | qa/evidence/static-followup-review.log; qa/evidence/supabase-start-after-podman.log |
| S12 | Cross-site/tampered/replayed QR | R8 | Reject foreign-site and invalid tokens; token contains no readable personal data | Not run; no Auth/DB | BLOCKED | N/A | qa/evidence/supabase-start.log |
| S13 | Asia/Manila boundary | R4 | Daily totals follow local date boundaries | Not run; no DB | BLOCKED | N/A | qa/evidence/supabase-start.log |
| S14 | Cancellation | R8/R9 | Owner request, authorized decision, capacity release; non-owner rejected | Not run; no DB | BLOCKED | N/A | qa/evidence/supabase-start.log |
| S15 | Capacity | R5 | Distinguish slot limit, expected visitors, occupancy, estimate; approval only by authorized role | Not run. Static migrations distinguish approved limit from estimate | BLOCKED | N/A | qa/01-discovery.md; qa/evidence/supabase-start.log |
| S16 | Staff administration | R8 | Site Admin site-scoped; Tourism Office cross-site; invitation and escalation controls hold | API scope not run. Updated route tests pass for assigned Site Admin routes | BLOCKED | N/A | qa/evidence/actor-route-test-fixed.log; qa/evidence/supabase-start.log |
| S17 | Reviews and announcements | R8/R10 | Eligibility, moderation, scope and XSS safety | Not run; no DB/UI data | BLOCKED | N/A | qa/evidence/supabase-start.log |
| S18 | Reports and CSV | R8 | Independent totals, scope, formula-injection neutralization | Not run. Existing unit test for CSV escaping passes | BLOCKED | N/A | qa/evidence/unit-tests.log; qa/evidence/supabase-start.log |
| S19 | Network/camera failures and offline | R10 | Clear errors, safe retries, app shell only, manual fallback | Not run. Local home/discover shell rendered with missing-backend message | BLOCKED | N/A | qa/evidence/ui-preview.txt; qa/evidence/supabase-start.log |

## Rule compliance

| Rule | Status | Evidence and limit |
|---|---|---|
| R1 | Unverifiable | SQL separates scan-state lookup from confirmation; no runtime API or mutation test. qa/01-discovery.md |
| R2 | Unverifiable | Confirmation RPC exists; no runtime checkout attempt. qa/01-discovery.md |
| R3 | Unverifiable | Static review found a local migration guard for `booking_source='walk_in'`; pgTAP not run. qa/evidence/static-followup-review.log; qa/evidence/supabase-start-after-podman.log |
| R4 | Unverifiable | SQL uses per-site attendance and nonnegative active count; date-boundary test not run. qa/01-discovery.md |
| R5 | Unverifiable | Static model distinguishes approved limit and capacity estimate; UI/API comparison not run. qa/01-discovery.md |
| R6 | Violated | Fee schema and editor expose adult/child/PWD only; guide fee cannot be represented separately. qa/evidence/static-findings-rerun.log |
| R7 | Satisfied by static review | README and ILIGUIDE_SETUP now describe demo-only payment and disabled handlers. Checkout, webhook, and refund functions return HTTP 410; runtime/provider calls not tested. qa/evidence/static-followup-review.log |
| R8 | Unverifiable | Static route/RLS policies found; role-by-resource attempts blocked. qa/security-matrix.csv |
| R9 | Unverifiable | Fee/capacity logic is server-side in migrations; API tampering/concurrency not exercised. qa/01-discovery.md |
| R10 | Unverifiable | Redacted source/history and bundle scans found no secret patterns; RLS and Storage unauthorized-access checks not run. qa/evidence/secret-scan.log; qa/evidence/bundle-scan.log |

## Findings, severity order

1. **Critical, test execution:** S1/S8/S9/S10 unavailable because the Podman VM cannot start without WSL/Hyper-V setup. No production app or database target used. Enable a local provider, restart, then run the isolated QA scenarios.
2. **High, R3 remediation unverified:** The previous manual attendance wrapper passed a null token and `p_require_token=false`. A local migration adds a guard for `booking_source='walk_in'`; the regression is authored but pgTAP could not run. Do not treat this fix as verified or deployed. Evidence: `supabase/migrations/20261126224632_walkin_attendance_requires_qr.sql`; `supabase/tests/qr_attendance_and_live_occupancy.test.sql`; `qa/evidence/supabase-start-after-podman.log`.
3. **High, R6 Sikyop pricing gap:** No separate guide-fee field exists in the database or Site Admin editor. The supplied product backlog workbook has no guide-fee amount or billing basis, so an accurate price calculation cannot be implemented from current requirements. Root: `supabase/migrations/20261119122333_ecotrack_initial_schema.sql:50-60`; `src/components/StaffPages.tsx:1579-1586,1818-1821`; `src/lib/iliguide.ts:44-46`.
4. **Low, hold-window documentation:** Base reservation hold is 10 minutes. Manual/demo payment window defaults to 15 minutes (configurable 5–120) and extends an active hold to the payment deadline. README mentions only 10 minutes. Root: supabase/migrations/20261119122333_ecotrack_initial_schema.sql:540; supabase/migrations/20261121103000_manual_payment_workflow.sql:3,113-119; README.md:60.

## Test failure fix

The two failed route assertions used stale Site Admin expectations. `Sites and staff` and `Activity` are allowed for assigned Site Admins by `src/lib/actorRoutes.ts` and rendered in `StaffPages.tsx`. Updated those assertions in `tests/actorRoutes.test.mjs` and the isolated `qa/app` copy. Root route suite: 8/8 pass. Full QA copy suite: 65/65 pass. This fixes test expectations; API/RLS scope remains unverified.

## Security sweep

- Static migration inventory: 44 tables, 44 with RLS enabled in migration history, 118 final migration-derived policy names. No live PostgreSQL catalog available.
- 105 latest SECURITY DEFINER function definitions: 0 missing search_path, 0 nonempty search_path, 0 dynamic SQL patterns. 60 had no obvious inline actor-check marker; many wrappers/helpers depend on callers/triggers. Treat as review flags, not confirmed authorization defects. Evidence: qa/evidence/security-static.log.
- Five storage bucket IDs inventoried. PWD documents use an authorized manual deletion RPC after delete_after; delete_after is slot date + 30 days. No automatic retention job found. No direct URL/signed URL/file-limit test.
- Audit triggers exist for profiles, bookings, payments, attendance, staff assignments, cancellations, reviews, capacity assessments/zones/limits and more. Audit immutability and non-admin writes not tested.
- Notification/email delivery not tested; delivery depends on configured Edge Functions and templates.
- Secret scan rerun: 532 text files, 52 commits, 0 matches. Bundle rerun: 70 files, 0 matches. Evidence: qa/evidence/secret-scan.log; qa/evidence/bundle-scan.log. Custom redacted patterns; not a full secret scanner.

## Quality measurements

- Latest rerun: full QA copy suite 65/65 pass; root actor-route suite 8/8 pass. The two stale Site Admin route expectations were corrected. TypeScript and Vite builds pass. Evidence: qa/evidence/test-fixed.log; qa/evidence/actor-route-test-fixed.log; qa/evidence/typecheck-rerun.log; qa/evidence/build-rerun.log.
- TypeScript build: pass. Vite build: pass; 2,171 modules transformed.
- UI smoke: visitor home and discover shell rendered; missing Supabase banner and “Loading workspace…” observed.
- Local home-shell viewport smoke: 390x844 and 1280x800 rendered with no horizontal overflow; backend stayed disconnected. Axe, Lighthouse, and npm audit: not run; npm/a11y tooling unavailable. No lint script. The updated DOCX passed structural count/status checks; PNG render was unavailable because LibreOffice is absent and Word reports an expired subscription. Evidence: qa/evidence/responsive-smoke.md; qa/evidence/local-tooling.log; qa/evidence/docx-render-attempt.log.

## Coverage and known gaps

- Scenario rows: 19 total; 0 runtime scenario passes; 1 static FAIL (S4); 18 blocked (including S11, whose local fix is unverified).
- Rule rows: R6 violated; R7 satisfied by static documentation/code review; R1-R5 and R8-R10 unverifiable; R3 remediation unverified. No rule passed by runtime.
- Confirmed manually: guide fee cannot be represented; R3 local guard authored but untested; README/setup payment claims corrected; base hold 10 minutes vs manual/demo payment window 15 minutes; PWD deletion manually allowed after 30 days; no automatic retention found; notification delivery unverified.
- Runtime production behavior not checked. Read-only deployment metadata identifies the current Vercel deployment as Production; its app was not opened. Preview Supabase target remains unverified. Real-device camera, actual email delivery, and provider behavior need separate authorized environments. Evidence: qa/evidence/remote-access-check.md.
- Security matrix has 56 rows across seven roles and eight resources; SELECT/INSERT/UPDATE/DELETE/RPC attempts all marked NOT_RUN because DB did not start.

## Reproduction commands

Run only against the QA-local config; never add --remote.

~~~powershell
$node = 'C:\Program Files\WindowsApps\OpenAI.CodexPrimaryRuntime.v26-1123-915-0_26.1123.915.0_x64__3k8sg7r9htsxt\dependencies\node\bin\node.exe'
$supabase = 'C:\Users\gaily\scoop\shims\supabase.exe'
Set-Location C:\Users\gaily\OneDrive\Desktop\Iliguide\qa\local-supabase
& $supabase start
if ($LASTEXITCODE -ne 0) { throw 'Local Supabase did not start; stop here.' }
& $supabase db reset
if ($LASTEXITCODE -ne 0) { throw 'Local QA database reset failed; stop here.' }
Set-Location C:\Users\gaily\OneDrive\Desktop\Iliguide
& $node qa\seed\seed.mjs
if ($LASTEXITCODE -ne 0) { throw 'QA seed failed; stop here.' }
Set-Location C:\Users\gaily\OneDrive\Desktop\Iliguide\qa\app
$env:VITE_SUPABASE_URL = ''
$env:VITE_SUPABASE_ANON_KEY = ''
& $node --test
& $node node_modules\typescript\bin\tsc -b
& $node node_modules\vite\bin\vite.js build
~~~

`supabase start` needs a running Docker or Podman engine. Podman CLI 6.2.1 is installed; its VM setup is blocked until WSL 2/Hyper-V is enabled. Latest attempt: qa/evidence/supabase-start-after-podman.log. Actual baseline logs: qa/evidence/supabase-start.log, unit-tests.log, actor-routes-rerun.log, build.log, secret-scan.log and bundle-scan.log. S1–S19 do not yet have an executable scenario runner; blocked runtime scenarios need local Supabase and a runner. `npm audit`, axe and Lighthouse were not run.


## Remote access follow-up

Read-only account checks found the repository-linked Supabase project named Ecotrack; the supplied Supabase Dashboard explicitly labels its branch main PRODUCTION and lists no branches. Vercel deployment 6MEKLt625 is marked Production on main. The preview environment's Supabase URL value was not exposed in the safe dashboard view, so its backend target cannot be confirmed. The user-provided Supabase target is explicitly production and was not queried. No deployed app or database was accessed. Evidence: qa/evidence/remote-access-check.md.



## Self-review

Retests, assumptions, untested areas, and evidence-path audit: qa/07-self-review.md.
