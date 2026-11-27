# Iliguide

Responsive visitor booking and destination operations for Iligan City. The React application reads real Supabase records; it does not seed sample destinations or fake bookings.

## Run locally

1. Install Node.js 20+ and pnpm.
2. Run `pnpm install`.
3. Copy `.env.example` to `.env.local`.
4. Add the Supabase project URL and **publishable key** to `.env.local`:

   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
   ```

   Older projects can use `VITE_SUPABASE_ANON_KEY`. Never put a Supabase service role key, PayMongo secret, or webhook secret in a `VITE_` variable.
5. Run `pnpm dev` and open the printed local URL.

The EcoTrack Supabase project is linked to this app, and the migrations in `supabase/migrations` are applied there. For a different empty project, apply all migrations in filename order using the Supabase CLI or SQL editor.

## First account and destination

Public registration creates a visitor only. After registering and verifying your account, replace the email in `supabase/bootstrap_tourism_office.sql` and run that one-time script in the linked project's SQL Editor to make your account the first Tourism Office user. Do not run it with the placeholder email.

Sign in as Tourism Office to create destination records, fees, and operating days. New sites start as drafts. Add future visit slots, then publish. The visitor site shows an empty state until a destination is published.

## Edge Functions and payment setup

The Edge Functions are in `supabase/functions`; `supabase/config.toml` documents their JWT settings. The linked Supabase project has the eight app functions deployed. Deploy again after changing function code, or deploy them to another project with the Supabase CLI:

```powershell
supabase functions deploy ticket
supabase functions deploy scan-ticket
supabase functions deploy invite-staff
supabase functions deploy accept-staff-invitation
supabase functions deploy send-booking-email
```

The PayMongo checkout, webhook, and refund handlers are disabled and return HTTP 410. Do not deploy or configure them for the current demo payment flow.

Set these **server-side Edge Function secrets** in the Supabase Dashboard or with `supabase secrets set`:

- `APP_BASE_URL`: public application origin used for authentication and ticket links.
- `TICKET_SIGNING_SECRET`: random value with at least 32 characters.
- `BREVO_API_KEY`: server-side transactional email key. The four Brevo templates in `supabase/functions/_shared/email.ts` must exist with matching IDs.

The current online option is a demo. It does not call a payment provider or move money. Do not configure PayMongo keys or webhooks. The disabled PayMongo checkout, webhook, and refund handlers return HTTP 410. Ticket, scanner, invitation, and booking-email endpoints retain their own authentication checks.

## Current behavior

- Visitor registration, sign-in, password reset, profile, avatar, and notifications use Supabase Auth and Storage.
- Public destination pages use published site details, fee settings, uploaded images, live slot capacity, and published review aggregates.
- Booking holds last ten minutes and use database-side fee and capacity checks. The current visitor flow uses demo payment only; it makes no provider call and transfers no money. Displayed fees are estimates to be paid under the destination's own admission process. PayMongo checkout, webhook, and refund handlers are disabled and return HTTP 410.
- Confirmed reservations receive an opaque signed QR ticket. Gatekeeper scans and manual lookups record entry and exit in the database.
- Walk-ins record the onsite payment amount and validate current slot, capacity, and staff assignment.
- Site teams manage operating hours, visit slots, closures, gatekeeper assignments, reviews, cancellation requests, and image uploads according to row-level security. Request and decision emails use the linked Brevo templates.
- Reports and audit activity come from database records and are scoped to staff permissions.
- The PWA caches its app shell and same-origin assets for offline startup. Supabase data still needs an internet connection.

## Build

```powershell
pnpm run build
```
