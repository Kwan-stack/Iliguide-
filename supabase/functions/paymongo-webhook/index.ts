import { json, preflight } from '../_shared/http.ts';

Deno.serve((req) => {
  const options = preflight(req);
  if (options) return options;
  return json({ error: 'PayMongo webhook processing is disabled.' }, 410);
});
