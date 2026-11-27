import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(), dist=path.join(root,'qa/app/dist'), hits=[];let count=0;
const rules=[['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i],['provider-key',/\b(?:sk_live|sk_test|whsk|whsec)_[A-Za-z0-9_-]{8,}/],['service-role-jwt',/(?:service[_ -]?role(?:[_ -]?key)?|SUPABASE_SERVICE_ROLE_KEY)\s*[:=]\s*["']?eyJ[A-Za-z0-9_.-]{40,}/i],['provider-secret',/(?:PAYMONGO_SECRET_KEY|PAYMONGO_WEBHOOK_SECRET|TICKET_SIGNING_SECRET)\s*[:=]\s*["']?[A-Za-z0-9_./+~-]{16,}/i]];
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else if(e.isFile()){count++;const s=await readFile(p,'utf8');if(s.includes('\0'))continue;for(const [kind,re]of rules){re.lastIndex=0;let m;while((m=re.exec(s)))hits.push(`${path.relative(root,p)},${s.slice(0,m.index).split('\n').length},${kind}`);}}}}
await walk(dist);
const out=[`bundle_files_scanned=${count}`,`redacted_matches=${hits.length}`,...hits,'Secret values are never written.'].join('\n')+'\n';
await writeFile(path.join(root,'qa/evidence/bundle-scan.log'),out);
console.log(out);
