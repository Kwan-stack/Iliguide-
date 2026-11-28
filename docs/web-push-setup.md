# Web push setup

Illiguide creates a push subscription only after the signed-in user enables notifications. Each inserted `notifications` row queues a push request; push failure does not affect the originating transaction.

## Configure keys

Generate one VAPID key pair with `npx web-push generate-vapid-keys --json`. Keep the private key secret.

Set the backend secrets:

```powershell
supabase secrets set PUSH_VAPID_PUBLIC_KEY=<public-key> PUSH_VAPID_PRIVATE_KEY=<private-key> PUSH_VAPID_SUBJECT=https://iliguide.vercel.app/ PUSH_DISPATCH_SECRET=<random-secret>
supabase functions deploy dispatch-push --no-verify-jwt
supabase functions deploy push-config
```

Apply `20261128130000_web_push_notifications.sql`, then store the function URL and same dispatch secret in Supabase Vault:

```sql
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/dispatch-push', 'push_dispatch_url');
select vault.create_secret('<same-random-secret>', 'push_dispatch_secret');
```

Deploy the frontend over HTTPS. Visitors and staff enable push from the bell control. iPhone/iPad users must add the site to the Home Screen and open that app before enabling notifications. In-app notifications remain available if push is unsupported or denied.
