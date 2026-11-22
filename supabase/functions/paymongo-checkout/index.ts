import { json, preflight } from '../_shared/http.ts';

Deno.serve((req) => {
  const options = preflight(req);
  if (options) return options;
  return json({ error: 'PayMongo checkout is disabled. Use the manual payment flow.' }, 410);
});
