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

The linked Supabase project already has the four migrations in `supabase/migrations`. For a different empty project, apply them in filename order using the Supabase CLI or SQL editor.

## First account and destination

Public registration creates a visitor only. After registering and verifying your account, replace the email in `supabase/bootstrap_tourism_office.sql` and run that one-time script in the linked project's SQL Editor to make your account the first Tourism Office user. Do not run it with the placeholder email.

Sign in as Tourism Office to create destination records, fees, and operating days. New sites start as drafts. Add future visit slots, then publish. The visitor site shows an empty state until a destination is published.

## Edge Functions and payment setup

The Edge Functions are in `supabase/functions`; `supabase/config.toml` documents their JWT settings. The linked Supabase project already has all seven functions deployed. Deploy again after changing function code, or deploy them to another project with the Supabase CLI:

```powershell
supabase functions deploy ticket
supabase functions deploy scan-ticket
supabase functions deploy invite-staff
supabase functions deploy accept-staff-invitation
```

The PayMongo checkout, webhook, and refund handlers are disabled and return HTTP 410. Do not deploy or configure them for the current demo payment flow.

Set these **server-side Edge Function secrets** in the Supabase Dashboard or with `supabase secrets set`:

- `APP_BASE_URL`: public application origin used for authentication and ticket links.
- `TICKET_SIGNING_SECRET`: server-only HMAC key, at least 32 characters. Generate 32 random bytes and encode them as unpadded Base64URL (43 characters). Do not use a `VITE_` variable.

The current online option is a demo. It does not call a payment provider or move money. Do not configure PayMongo keys or webhooks. The disabled PayMongo checkout, webhook, and refund handlers return HTTP 410. Ticket, scanner, invitation, and booking-email endpoints retain their own authentication checks.

For local Edge Function development, put this in the ignored `supabase/.env.ticket` file:

```env
TICKET_SIGNING_SECRET=<43-character Base64URL secret>
```

Run `supabase functions serve --env-file supabase/.env.ticket`. For production, preserve any existing value. If none exists, set it once with `supabase secrets set --env-file supabase/.env.ticket --remote <project-ref>`. The same key must remain available to both `ticket` and `scan-ticket` so existing QR tokens keep verifying.

## Current behavior

- Visitor registration, sign-in, password reset, profile, avatar, and notifications use Supabase Auth and Storage.
- Public destination pages use published site details, fee settings, uploaded images, live slot capacity, and published review aggregates.
- Booking holds last ten minutes and use database-side fee and capacity checks. The current visitor flow uses demo payment only; it makes no provider call and transfers no money. PayMongo checkout, webhook, and refund handlers are disabled and return HTTP 410.
- Guest bookings can be recovered with both the booking reference and private access code.
- Paid tickets contain an opaque signed QR token. Gatekeeper scans and manual lookups record entry and exit in the database.
- Walk-ins record the onsite payment amount and validate current slot, capacity, and staff assignment.
- Site teams manage operating hours, visit slots, closures, gatekeeper assignments, reviews, cancellations, refunds, and image uploads according to row-level security.
- Reports and audit activity come from database records and are scoped to staff permissions.
- The PWA caches its app shell and same-origin assets for offline startup. Supabase data still needs an internet connection.

## Build

```powershell
pnpm run build
```

## Deploy to Vercel

Import this GitHub repository as a Vite project. Use `pnpm run build` and the `dist` output directory. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in Vercel's project environment variables for each deployment environment. The local `.env` is ignored by Git and is not uploaded.

In Supabase Auth URL Configuration, set the Site URL to the production domain and allow each deployment URL used for email confirmation and password reset. The `vercel.json` rewrite serves the app for direct visits to nested routes.
