import { json, preflight } from '../_shared/http.ts';

Deno.serve((req) => {
  const options = preflight(req);
  if (options) return options;
  return json({ error: 'Gateway refunds are disabled. Contact the Tourism Office for refund assistance.' }, 410);
});
