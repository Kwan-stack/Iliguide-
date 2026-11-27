# Stage 2 — Build and baseline

## Safety and target

QA copy only: qa/app plus qa/local-supabase. Local config project ID: iliguide-qa-local-20261127. No production URL/key copied. Original Supabase project config was not used. No API key, auth token, provider call, payment, or personal data entered. No database or QA rows created.

## Environment

- Commit: e250e214b26c1aa3b8d8def5a3cc007d31902b44; worktree was already dirty. QA app copy includes the current uncommitted files.
- Date: 2026-11-27 (Asia/Manila).
- Node: v24.22.3. Supabase CLI: 3.2.0. Vite build: 6.4.5.
- Docker and Podman absent. Local Supabase start failed with DockerLifecycleInspectError: docker: command not found (podman also not found). Evidence: qa/evidence/supabase-start.log.
- Earlier rejected config used obsolete inbucket; fixed only qa/local-supabase/supabase/config.toml. No repository config changed.

## Commands and results

- node --test in qa/app: 65 tests, 63 pass, 2 fail. Evidence: qa/evidence/unit-tests.log.
- node --test tests/actorRoutes.test.mjs in qa/app: rerun reproduced both failures (6 pass, 2 fail). Site Admin “Sites and staff” resolves to that page, while tests expect “Overview” at tests/actorRoutes.test.mjs:31,64. Evidence: qa/evidence/actor-routes-rerun.log.
- node node_modules/typescript/bin/tsc -b in qa/app: PASS.
- node node_modules/vite/bin/vite.js build in qa/app with all Supabase VITE variables blank: PASS; 2,171 modules transformed. Evidence: qa/evidence/build.log.
- No lint or standalone typecheck script. Build includes TypeScript tsc -b.
- npm audit not run: npm executable unavailable; registry audit would make a third-party call. No dependency was installed.
- Redacted secret scanner: 444 working-tree text files, 52 Git commits, 0 matching secrets. Values never printed or saved. Evidence: qa/evidence/secret-scan.log. Custom pattern scan, not gitleaks.
- Built bundle scan: 70 files, 0 matching service-role/provider secret patterns. Build used blank VITE Supabase settings. Evidence: qa/evidence/bundle-scan.log.
- Seed script syntax: PASS via node --check qa/seed/seed.mjs. It was not executed.

## UI smoke check

Local Vite preview at http://127.0.0.1:4173/ rendered the visitor home and /discover. With blank Supabase config, UI showed “Add Supabase URL and publishable key to connect live data” and “Loading workspace…”. No data flow tested. Accessibility-tree snapshot: qa/evidence/ui-preview.txt. No screenshot file was captured.

## Blocked checks

- Supabase migration apply/reset, SQL tests, API/RPC, S1–S19 end-to-end, role-by-resource access, storage access, payment/webhook, PWD authorization, timezone calculations, offline behavior, camera fallback.
- npm audit, axe, Lighthouse, physical mobile device.
- No live or dedicated test project used. No test data cleanup needed because no database started and seed was not run.


## Verification rerun — 2026-11-27

After the user's request to test again: isolated Node suite 63/65 passed, with the same 2 actor-route assertions failing; TypeScript typecheck passed; Vite build passed with 2,171 modules; secret scan found 0 matches across 532 text files and 52 commits; bundle scan found 0 matches in 70 files. Evidence: qa/evidence/test-rerun.log, 	ypecheck-rerun.log, uild-rerun.log, secret-scan.log, and undle-scan.log.
