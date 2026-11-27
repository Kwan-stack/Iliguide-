import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const dir = path.join(root, 'supabase/migrations');
const files = (await readdir(dir)).filter(x => x.endsWith('.sql')).sort();
const tables = new Map(), enums = new Map(), rlsEvents = [], policyEvents = [], functions = new Map(), triggers = new Set(), views = new Set(), buckets = new Set();
const lineAt = (s, i) => s.slice(0, i).split('\n').length;
function splitTop(s) {
  const out=[]; let start=0, depth=0, q='';
  for(let i=0;i<s.length;i++){const c=s[i]; if(q){if(c===q&&s[i+1]===q){i++;continue;} if(c===q)q=''; continue;} if(c==="'"||c==='"'){q=c;continue;} if(c==='(')depth++; else if(c===')')depth--; else if(c===','&&depth===0){out.push(s.slice(start,i));start=i+1;}}
  out.push(s.slice(start)); return out;
}
function tableBody(s, open) {
 let depth=0,q='';
 for(let i=open;i<s.length;i++){const c=s[i];if(q){if(c===q&&s[i+1]===q){i++;continue;}if(c===q)q='';continue;}if(c==="'"||c==='"'){q=c;continue;}if(c==='(')depth++;else if(c===')'&&--depth===0)return s.slice(open+1,i);}
 return '';
}
for(const file of files){
 const s=await readFile(path.join(dir,file),'utf8');
 let m;
 const ct=/create\s+table\s+(?:if\s+not\s+exists\s+)?((?:public|private)\.[a-z_][\w]*)\s*\(/ig;
 while((m=ct.exec(s))){const name=m[1].toLowerCase(), open=m.index+m[0].lastIndexOf('('), body=tableBody(s,open); const cols=splitTop(body).map(x=>x.trim()).filter(x=>x&&!/^(constraint|primary|foreign|unique|check|exclude)\b/i.test(x)).map(x=>(x.match(/^(["\w]+)/)||[])[1]?.replaceAll('"','')).filter(Boolean); const t=tables.get(name)||{columns:new Set(),file,line:lineAt(s,m.index)}; cols.forEach(c=>t.columns.add(c)); tables.set(name,t);}
 const at=/alter\s+table\s+(public|private)\.([a-z_][\w]*)\s+([^;]+);/ig;
 while((m=at.exec(s))){const name=`${m[1]}.${m[2]}`.toLowerCase(), body=m[3], t=tables.get(name)||{columns:new Set(),file,line:lineAt(s,m.index)}; for(const d of body.matchAll(/\bdrop\s+(?:column\s+)?(?:if\s+exists\s+)?("?[a-z_][\w]*"?)/ig)) t.columns.delete(d[1].replaceAll('"','')); for(const a of body.matchAll(/\badd\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?("?[a-z_][\w]*"?)/ig)) t.columns.add(a[1].replaceAll('"','')); const rn=body.match(/\brename\s+column\s+("?[\w]+"?)\s+to\s+("?[\w]+"?)/i); if(rn){t.columns.delete(rn[1].replaceAll('"',''));t.columns.add(rn[2].replaceAll('"',''));} tables.set(name,t);}
 for(const m of s.matchAll(/create\s+type\s+(public\.[\w]+)\s+as\s+enum\s*\(([^)]*)\)/ig)) enums.set(m[1],new Set([...m[2].matchAll(/'([^']+)'/g)].map(x=>x[1])));
 for(const m of s.matchAll(/alter\s+type\s+(public\.[\w]+)\s+add\s+value\s+(?:if\s+not\s+exists\s+)?'([^']+)'/ig)){const e=enums.get(m[1])||new Set();e.add(m[2]);enums.set(m[1],e);}
 for(const m of s.matchAll(/alter\s+table\s+((?:public|private)\.[\w]+)\s+(enable|disable)\s+row\s+level\s+security/ig)) rlsEvents.push({pos:m.index,table:m[1].toLowerCase(),on:m[2].toLowerCase()==='enable'});
 for(const m of s.matchAll(/create\s+policy\s+("?[\w]+"?)\s+on\s+([\w.]+)|drop\s+policy\s+(?:if\s+exists\s+)?("?[\w]+"?)\s+on\s+([\w.]+)/ig)) policyEvents.push({pos:m.index,name:(m[1]||m[3]).replaceAll('"',''),table:(m[2]||m[4]).toLowerCase(),create:!!m[1]});
 for(const m of s.matchAll(/create\s+(?:or\s+replace\s+)?function\s+((?:public|private)\.[\w]+)\s*\(/ig)){const tail=s.slice(m.index,m.index+1400);const as=tail.search(/\bas\s+\$[\w]*\$/i);const header=as>=0?tail.slice(0,as):tail.slice(0,700);functions.set(m[1].toLowerCase(),{definer:/security\s+definer/i.test(header),file,line:lineAt(s,m.index)});}
 for(const m of s.matchAll(/create\s+(?:or\s+replace\s+)?trigger\s+([\w]+)/ig)) triggers.add(m[1]);
 for(const m of s.matchAll(/create\s+(?:or\s+replace\s+)?view\s+([\w.]+)/ig)) views.add(m[1].toLowerCase());
 for(const m of s.matchAll(/insert\s+into\s+storage\.buckets[\s\S]{0,500}?values\s*\(\s*'([^']+)'/ig)) buckets.add(m[1]);
 for(const m of s.matchAll(/bucket_id\s*=\s*'([^']+)'/ig)) buckets.add(m[1]);
}
const rls=new Map(); for(const e of rlsEvents.sort((a,b)=>a.pos-b.pos)) rls.set(e.table,e.on);
const policies=new Map(); for(const e of policyEvents.sort((a,b)=>a.pos-b.pos)){const p=policies.get(e.table)||new Set(); if(e.create)p.add(e.name);else p.delete(e.name);policies.set(e.table,p);}
const tableRows=[...tables].sort(([a],[b])=>a.localeCompare(b)).map(([name,t])=>`| ${name} | ${[...t.columns].join(', ')} | ${rls.get(name)===true?'Yes':rls.get(name)===false?'No':'Unknown'} | ${[...(policies.get(name)||[])].sort().join(', ')||'—'} | ${t.file}:${t.line} |`).join('\n');
const enumRows=[...enums].sort(([a],[b])=>a.localeCompare(b)).map(([n,v])=>`| ${n} | ${[...v].join(', ')} |`).join('\n');
const pub=[...functions].filter(([n])=>n.startsWith('public.')).sort(([a],[b])=>a.localeCompare(b));
const def=[...functions].filter(([,v])=>v.definer).sort(([a],[b])=>a.localeCompare(b));
const edge=(await readdir(path.join(root,'supabase/functions'),{withFileTypes:true})).filter(x=>x.isDirectory()&&x.name!=='_shared').map(x=>x.name).sort();
const sqlTests=(await readdir(path.join(root,'supabase/tests'))).filter(x=>x.endsWith('.sql')).sort();
const md=`# Stage 1 — System discovery

- Target: working tree, commit e250e214b26c1aa3b8d8def5a3cc007d31902b44. No production connection.
- Method: static source/migration inspection. No final PostgreSQL catalog or runtime behavior observed.
- Migrations: ${files.length}; tables: ${tables.size}; enums: ${enums.size}; policies in final migration-derived set: ${[...policies.values()].reduce((a,s)=>a+s.size,0)}; RLS-enabled tables: ${[...rls.values()].filter(Boolean).length}; functions: ${functions.size} distinct; public RPC names: ${pub.length}; SECURITY DEFINER declarations: ${def.length}; triggers: ${triggers.size}; views: ${views.size}; bucket IDs: ${[...buckets].size}.

## Pages and roles

- Visitor: landing, discover, destination list/detail/map, how-it-works, booking, bookings, tickets, account, payment, confirmation. Routes: src/lib/appRoutes.ts; guard: src/lib/actorRoutes.ts:17.
- Gatekeeper: overview, reservations, visitor management/logbook, scan/exit, walk-in registration, capacity map, duty details, reports, payment verification, password. Nav: src/components/StaffPages.tsx:88-89.
- Site Admin: overview, schedule/operations, sites/staff, staff/accounts, destination updates, payment verification/settings, feedback/reviews, visitor logbook, capacity map, reports, activity, password. Site-admin UI selectors use siteId at StaffPages.tsx:1199,1492; DB scope remains untested.
- Tourism Office: cross-site office pages; payment verification routed away. Navigation at StaffPages.tsx:89; route guard in actorRoutes.ts:16-25.

## Tables, columns, RLS and policies

Migration-derived column inventory: declarations plus parsed ADD/DROP/RENAME edits. No live catalog. Policy list reflects create/drop order only.

| Table | Columns | RLS | Policies | Declaration |
|---|---|---:|---|---|
${tableRows}

## Enums and status values

| Enum | Values |
|---|---|
${enumRows}

Reservation visitor check-in values: not_checked_in, checked_in, checked_out (20261123130000_qr_attendance_and_live_occupancy.sql:18-28).

## RPCs and SECURITY DEFINER functions

- Public RPC names (${pub.length}): ${pub.map(([n])=>n).join(', ')}.
- SECURITY DEFINER functions (${def.length}): ${def.map(([n,v])=>`${n} (${v.file}:${v.line})`).join(', ')}. Header scan only; authorization and search_path need per-function review.

## Triggers, views, storage and Edge Functions

- Triggers (${triggers.size} names): ${[...triggers].sort().join(', ')}.
- Views: ${[...views].sort().join(', ')}.
- Storage bucket IDs: ${[...buckets].sort().join(', ')}. Policy source lives in migrations; object access not tested.
- Edge Functions: ${edge.join(', ')}; shared code under _shared.
- SQL test files: ${sqlTests.map(n=>`supabase/tests/${n}`).join(', ')}. Not executed: local PostgreSQL unavailable.

## State models

~~~mermaid
stateDiagram-v2
  [*] --> awaiting_payment: booking hold created
  awaiting_payment --> confirmed: payment or onsite confirmation
  awaiting_payment --> expired: hold expiry
  confirmed --> completed: visit completed
  confirmed --> cancelled: approved cancellation
  confirmed --> needs_resolution: payment event conflict
  cancelled --> [*]
  expired --> [*]
~~~

~~~mermaid
stateDiagram-v2
  [*] --> not_scanned
  not_scanned --> scan_result: valid QR or manual reference lookup
  scan_result --> checked_in: gatekeeper confirms entry
  checked_in --> checked_out: gatekeeper confirms exit
  checked_out --> [*]
  scan_result --> checked_in: manual reference confirmation, QR token not required
~~~

## Defaults and constants

- Site timezone: Asia/Manila. UI date helpers use same zone.
- Hold: 10 minutes in SQL, UI and README.
- Cancellation cutoff: 24 hours by default.
- Staff invite expiry: 7 days; guest booking token expiry: 2 years.
- QR attendance window: 30 minutes before slot through 3 hours after.
- Slot duration: per slot; no fixed duration found.
- Current visitor flow uses onsite reservation confirmation without online checkout; manual payment workflow has payment_deadline field, runtime duration not verified.
- No conflicting hold durations found.

## README and project-doc claims reviewed

- React visitor booking/destination operations; live Supabase records; no sample seeds.
- Local setup: Node 20+, pnpm, .env.local with publishable/anon key; says never expose service-role or provider secrets in VITE variables.
- Claims linked EcoTrack project has applied migrations; Tourism Office bootstrap via SQL; new sites draft and require slots before publish.
- Documents eight deployed Edge Functions, PayMongo checkout/webhook/refunds, server secrets, webhook creation/events, ticket signing, and email templates.
- Current behavior says visitor booking confirms onsite, fees are estimates, online checkout is not called; says QR tickets opaque, attendance and walk-ins recorded, staff scoped by RLS, reports audited, PWA caches app shell/assets only.
- ILIGUIDE_SETUP.md and supabase/coordinate-sources.md also present; deployment claims not runtime verified. public/falls/ATTRIBUTION.md is image attribution.

## Commands

- package.json: pnpm dev, pnpm run build (tsc -b + Vite), pnpm test (node --test).
- No lint or standalone typecheck script. tsc -b is part of build.
- supabase start needs Docker/Podman. Neither is installed; no safe DB target available.
`;
await writeFile(path.join(root,'qa/01-discovery.md'),md);
await writeFile(path.join(root,'qa/evidence/inventory-summary.json'),JSON.stringify({migrations:files.length,tables:tables.size,rlsEnabled:[...rls.values()].filter(Boolean).length,policyNames:[...policies.values()].reduce((a,s)=>a+s.size,0),enums:enums.size,functions:functions.size,publicRpcNames:pub.length,securityDefinerDeclarations:def.length,triggers:triggers.size,views:views.size,buckets:[...buckets].sort(),edgeFunctions:edge,sqlTests},null,2)+'\n');
console.log(JSON.stringify({migrations:files.length,tables:tables.size,rlsEnabled:[...rls.values()].filter(Boolean).length,policyNames:[...policies.values()].reduce((a,s)=>a+s.size,0),enums:enums.size,functions:functions.size,publicRpcNames:pub.length,securityDefinerDeclarations:def.length,triggers:triggers.size,views:views.size,buckets:[...buckets].sort(),edgeFunctions:edge}));
