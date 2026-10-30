// Turns analyzed Reels into recreation reference folders on this computer.
//   npm run recreate -- <reel URL or shortcode>          one Reel
//   npm run recreate -- --top 3 <handle>                 the 3 biggest outliers from that creator's latest run
// Runs come from the hosted lab when CREATOR_LAB_URL (+ CREATOR_LAB_PASSWORD) is set in .env, otherwise from data/runs.
// Folders go to RECREATION_DIR (or --out), default ./recreations.
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {buildReference,referenceSummary} from '../lib/recreate.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
let env={};try{env=parseEnv(await readFile(join(root,'.env'),'utf8'));}catch{}
const get=k=>env[k]||process.env[k]||'';
const args=process.argv.slice(2);const flag=n=>{const i=args.indexOf(n);if(i<0)return '';const v=args[i+1];args.splice(i,2);return v;};
const top=Number(flag('--top')||0),out=flag('--out')||get('RECREATION_DIR')||join(root,'recreations'),server=(flag('--server')||get('CREATOR_LAB_URL')).replace(/\/$/,'');
const target=args[0];
if(!target){console.log('Usage: npm run recreate -- <reel URL or shortcode>\n       npm run recreate -- --top 3 <instagram handle>');process.exit(1);}

async function loadRuns(){
 if(server){
  const headers=get('CREATOR_LAB_PASSWORD')?{Authorization:'Basic '+Buffer.from('lab:'+get('CREATOR_LAB_PASSWORD')).toString('base64')}:{};
  const fetchJSON=async path=>{const r=await fetch(server+path,{headers});if(r.status===401)throw new Error('Wrong or missing CREATOR_LAB_PASSWORD in .env');if(!r.ok)throw new Error(`${path}: HTTP ${r.status}`);return r.json();};
  const {runs}=await fetchJSON('/api/bootstrap');return Promise.all(runs.map(r=>fetchJSON('/api/runs/'+r.id)));
 }
 const dir=join(get('LAB_DATA_DIR')||join(root,'data'),'runs');
 return Promise.all((await readdir(dir)).filter(n=>n.endsWith('.json')&&!n.endsWith('.raw.json')).map(async n=>JSON.parse(await readFile(join(dir,n),'utf8'))));
}

const runs=(await loadRuns()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
let picks=[];
if(top){
 const handle=target.replace(/^@/,'').toLowerCase();const job=runs.find(j=>j.creator.toLowerCase()===handle);
 if(!job)throw new Error(`No run found for @${handle}. Run it in Creator Lab first.`);
 picks=job.posts.filter(p=>p.analysis&&!p.duplicateOf).map(p=>({job,post:p,s:referenceSummary(job,p)})).sort((a,b)=>(b.s.outlier||0)-(a.s.outlier||0)).slice(0,top);
}else{
 const id=(target.match(/\/(?:p|reel|reels)\/([\w-]+)/)||[,target])[1];
 for(const job of runs){const post=job.posts.find(p=>p.id===id);if(post){picks=[{job,post}];break;}}
 if(!picks.length)throw new Error(`Reel ${id} is not in any run${server?' on '+server:' in data/runs'}.`);
}
for(const {job,post} of picks){
 const r=await buildReference(job,post,out);const s=referenceSummary(job,post);
 console.log(`${s.outlier??'?'}× · ${s.reach?.toLocaleString('en')} plays · ${r.frames} frames${r.video?'':' · VIDEO MISSING'}\n  ${r.dir}`);
}
