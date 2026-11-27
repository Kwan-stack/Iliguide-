import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(), dir=path.join(root,'supabase/migrations');
const files=(await readdir(dir)).filter(f=>f.endsWith('.sql')).sort(), functions=new Map();
for(const file of files){
 const sql=await readFile(path.join(dir,file),'utf8');
 for(const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+((?:public|private)\.[\w]+)\s*\(/ig)){
  const tail=sql.slice(m.index,m.index+4000), as=tail.search(/\bas\s+\$[\w]*\$/i); if(as<0)continue;
  const token=(tail.slice(as).match(/\bas\s+(\$[\w]*\$)/i)||[])[1]; if(!token)continue;
  const header=tail.slice(0,as), bodyStart=as+tail.slice(as).indexOf(token)+token.length, end=tail.indexOf(token,bodyStart), body=tail.slice(bodyStart,end<0?bodyStart+2500:end);
  functions.set(m[1].toLowerCase(),{definer:/security\s+definer/i.test(header),file,line:sql.slice(0,m.index).split('\n').length,path:/set\s+search_path\s*=\s*''/i.test(header)?'empty':/set\s+search_path\s*=/i.test(header)?'explicit-nonempty':'missing',dynamic:/\bexecute\s+(?:format|\$|['"])/i.test(body),actor:/auth\.uid\s*\(|current_role\s*\(|user_has|can_work|require_active|assert_/i.test(body)});
 }
}
const defs=[...functions].filter(([,v])=>v.definer).sort(([a],[b])=>a.localeCompare(b));
const rows=defs.map(([n,v])=>`${n},${v.path},${v.dynamic?'yes':'no'},${v.actor?'marker':'no-inline-marker'},${v.file}:${v.line}`);
const summary=[`security_definer_functions=${defs.length}`,`missing_search_path=${defs.filter(([,v])=>v.path==='missing').length}`,`nonempty_search_path=${defs.filter(([,v])=>v.path==='explicit-nonempty').length}`,`dynamic_sql=${defs.filter(([,v])=>v.dynamic).length}`,`no_obvious_actor_marker=${defs.filter(([,v])=>!v.actor).length}`,'name,path,dynamic_sql,actor_marker,source',...rows,'Static heuristic only; trigger helpers may rely on callers or table permissions. Runtime authorization not tested.'].join('\n')+'\n';
await writeFile(path.join(root,'qa/evidence/security-static.log'),summary);
console.log(summary.split('\n').slice(0,6).join('\n'));
