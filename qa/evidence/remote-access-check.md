# Remote access check — 2026-11-27

Read-only account, project, and deployment metadata. No app runtime, database rows, environment variable values, or secrets were read or changed.

- Supabase CLI `projects list` returned three account project records. Repository link `xiyybsijpdrrkufwphuv` maps to project `Ecotrack`, status `ACTIVE_HEALTHY`, region `ap-northeast-1`. Project environment type is not identified; this does not prove it is a QA project.
- Vercel dashboard project `iliguide`; deployment `6MEKLt625` (commit `e250e214b26c1aa3b8d8def5a3cc007d31902b44`) marked Environment `Production`, Status `Ready`, branch `main`.
- Vercel environment-variable settings page showed `VITE_SUPABASE_URL` exists, but safe read did not reveal its target project ref. Preview backend therefore remains unverified.
- Production deployment URL was not opened. No Supabase database query, auth flow, seed, provider call, deployment, or settings change was made.
- QA-local Supabase still cannot run: Docker and Podman are unavailable. Existing static QA verdict remains unchanged.

## Supabase dashboard confirmation

Opened the user-provided Supabase project link in the authenticated Chrome session and read the project overview only. Dashboard header: `main PRODUCTION`; project status `Healthy`; recent branches `No branches`. SQL Editor link was not run. No query, table read, auth request, storage request, or database write performed. This target is explicitly production and cannot be used for the attached QA mission.

Vercel team deployment page lists deployment `6MEKLt625` at commit `e250e21` as `Production`, branch `main`, status `Ready`. The app URL was not opened. No deployment or settings changed.