import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const qa = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localProject = path.join(qa, 'local-supabase');
const config = await readFile(path.join(localProject, 'supabase/config.toml'), 'utf8');
if (!config.includes('project_id = "iliguide-qa-local-20261127"')) throw new Error('Refusing non-QA Supabase project.');
let status;
try { status = execFileSync('C:\\Users\\gaily\\scoop\\shims\\supabase.exe', ['status', '-o', 'env'], { cwd: localProject, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
catch { throw new Error('Local Supabase is not running; no credentials printed.'); }
const vars = Object.fromEntries(status.split(/\r?\n/).map(line => { const i=line.indexOf('='); return i<0?['','']:[line.slice(0,i),line.slice(i+1).replace(/^"|"$/g,'')]; }).filter(([k])=>k));
const api = vars.API_URL;
if (!['http://127.0.0.1:54321','http://localhost:54321'].includes(api) || !vars.ANON_KEY || !vars.SERVICE_ROLE_KEY) throw new Error('Refusing unverified local endpoint.');
const anon = vars.ANON_KEY, service = vars.SERVICE_ROLE_KEY;
async function call(route, method='GET', body, bearer=service, prefer) {
  const url = new URL(route, api);
  if (!['127.0.0.1','localhost'].includes(url.hostname) || url.port !== '54321') throw new Error('Refusing non-local request.');
  const headers = { apikey: anon, authorization: `Bearer ${bearer}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(url, { method, headers, body: body===undefined?undefined:JSON.stringify(body), redirect: 'error' });
  if (!response.ok) throw new Error(`Local seed request failed: ${method} ${url.pathname} (${response.status}).`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
const datePh = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function addDays(date, n) { return new Date(Date.parse(`${date}T00:00:00Z`)+n*86400000).toISOString().slice(0,10); }
let visitDate=addDays(datePh,14); while(new Date(`${visitDate}T00:00:00Z`).getUTCDay()===1) visitDate=addDays(visitDate,1);
const sites=[
  {id:'51000000-0000-4000-8000-000000000001',name:'QA_Tinago',slug:'qa-tinago',category:'QA test',description:'Synthetic QA destination.',address:'QA test address',timezone:'Asia/Manila',status:'published'},
  {id:'51000000-0000-4000-8000-000000000002',name:'QA_Mimbalot',slug:'qa-mimbalot',category:'QA test',description:'Synthetic QA destination.',address:'QA test address',timezone:'Asia/Manila',status:'published'},
  {id:'51000000-0000-4000-8000-000000000003',name:'QA_Timoga',slug:'qa-timoga',category:'QA test',description:'Synthetic QA destination.',address:'QA test address',timezone:'Asia/Manila',status:'published'},
  {id:'51000000-0000-4000-8000-000000000004',name:'QA_Sikyop',slug:'qa-sikyop',category:'QA test',description:'Synthetic QA destination.',address:'QA test address',timezone:'Asia/Manila',status:'published'},
  {id:'51000000-0000-4000-8000-000000000005',name:'QA_Draft',slug:'qa-draft',category:'QA test',description:'Synthetic unpublished QA destination.',address:'QA test address',timezone:'Asia/Manila',status:'draft'},
];
await call('/rest/v1/tourism_sites?on_conflict=slug','POST',sites,service,'resolution=merge-duplicates,return=representation');
const siteIds=Object.fromEntries(sites.map(s=>[s.name,s.id]));
const fees=[110,0,140,190,0];
const settings=sites.map((s,i)=>({site_id:s.id,adult_fee:fees[i],child_fee:Math.round(fees[i]/2),pwd_discount_percent:i===1?0:20,fee_information_confirmed:true,max_per_booking:20,cancellation_cutoff_hours:24,daily_capacity:50}));
await call('/rest/v1/site_settings?on_conflict=site_id','POST',settings,service,'resolution=merge-duplicates,return=minimal');
const hours=[];
for(let i=0;i<sites.length;i++) for(let weekday=0;weekday<7;weekday++){const closed=i===2&&weekday===0;hours.push({site_id:sites[i].id,weekday,opens_at:closed?null:'07:00',closes_at:closed?null:'18:00',is_closed:closed});}
await call('/rest/v1/site_operating_hours?on_conflict=site_id%2Cweekday','POST',hours,service,'resolution=merge-duplicates,return=minimal');
const slots=[];
for(let i=0;i<4;i++){const count=i===0?2:1;for(let n=0;n<count;n++)slots.push({site_id:sites[i].id,slot_date:visitDate,starts_at:n===0?'09:00':'10:00',ends_at:n===0?'10:00':'11:00',capacity:i===0&&n===0?2:5,status:'open'});}
await call('/rest/v1/site_slots?on_conflict=site_id%2Cslot_date%2Cstarts_at','POST',slots,service,'resolution=merge-duplicates,return=minimal');
await call('/rest/v1/site_closures','POST',{site_id:siteIds.QA_Tinago,starts_on:addDays(visitDate,10),ends_on:addDays(visitDate,10),reason:'QA_Closure'},service,'return=minimal');
const roles=[['V1','visitor'],['V2','visitor'],['G1','gatekeeper'],['G2','gatekeeper'],['A1','site_admin'],['T1','tourism_office']];
const users={};
for(const [label,role] of roles){
  const email=`QA_${label}_${randomBytes(5).toString('hex')}@example.test`;
  const password=`QA_${randomBytes(32).toString('base64url')}`;
  const created=await call('/auth/v1/admin/users','POST',{email,password,email_confirm:true,user_metadata:{full_name:`QA_${label}`}});
  users[label]={id:created.id,email,role,password};
  if(role!=='visitor') await call(`/rest/v1/profiles?id=eq.${created.id}`,'PATCH',{role,account_status:'active'},service,'return=minimal');
}
for(const [label,siteName,role] of [['G1','QA_Tinago','gatekeeper'],['G2','QA_Mimbalot','gatekeeper'],['A1','QA_Tinago','site_admin']]) await call('/rest/v1/staff_assignments','POST',{profile_id:users[label].id,site_id:siteIds[siteName],staff_role:role,assigned_by:users.T1.id,is_active:true},service,'return=minimal');
const sessions={};
for(const [label,user] of Object.entries(users)){const data=await call('/auth/v1/token?grant_type=password','POST',{email:user.email,password:user.password},anon);if(!data?.access_token)throw new Error(`QA session creation failed for ${label}.`);sessions[label]=data.access_token;user.password='';}
const headers=(token)=>token;
const assessmentBase={site_id:siteIds.QA_Tinago,methodology:'QA_usable_area_capacity',inputs:{usable_area:120,space_per_visitor:2,operating_hours:11,average_visit_hours:2},estimated_capacity:330,assessment_date:visitDate,assumptions:'Synthetic QA estimate only.',source_reference:'QA_seed'};
const unapproved=await call('/rest/v1/site_capacity_assessments','POST',{...assessmentBase,status:'needs_review'},headers(sessions.T1),'return=representation');
const approved=await call('/rest/v1/site_capacity_assessments','POST',{...assessmentBase,status:'approved_for_operational_use'},headers(sessions.T1),'return=representation');
await call('/rest/v1/site_capacity_zones','POST',[
  {site_id:siteIds.QA_Tinago,assessment_id:approved[0].id,name:'QA_UsableZone',zone_type:'usable',measured_area:120,area_unit:'square_meters',notes:'Synthetic.'},
  {site_id:siteIds.QA_Tinago,assessment_id:approved[0].id,name:'QA_RestrictedZone',zone_type:'restricted',measured_area:30,area_unit:'square_meters',notes:'Synthetic.'},
],headers(sessions.T1),'return=minimal');
await call('/rest/v1/site_approved_visitor_limits','POST',{site_id:siteIds.QA_Tinago,visitor_limit:5,effective_from:visitDate,supporting_assessment_id:approved[0].id,policy_reference:'QA_approval',status:'active'},headers(sessions.T1),'return=minimal');
const feeOracles={Tinago:{'2 adult + 1 child':275,'same party, 1 PWD':253},Mimbalot:{'any party':0},Timoga:{'2 adult + 1 child':350},Sikyop:{'2 adult + 1 child':475,'same party, 1 PWD':437}};
console.log(JSON.stringify({result:'seeded local synthetic data',target:'iliguide-qa-local-20261127',sites:sites.map(s=>s.name),users:Object.keys(users),sessions:'created in memory; values redacted and discarded',visitDate,slotCapacities:slots.map(s=>s.capacity),feeOracles,guideFee:'not representable; no guide-fee field',assessments:['approved','needs_review']}));
// Session JWTs and generated passwords remain memory-only; caller must reset this local DB after QA.
export { sessions, siteIds, users, feeOracles, visitDate };
