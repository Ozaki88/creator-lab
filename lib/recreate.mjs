// Builds a recreation reference folder from one analyzed Reel: the original video, a frame at the start of every
// script beat, the transcript, the beat list and the numbers that made it worth recreating.
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {download} from './providers.mjs';
const exec=promisify(execFile);
const median=a=>{a=a.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=a.length>>1;return a.length%2?a[m]:(a[m-1]+a[m])/2;};
const reach=p=>Number.isFinite(p.views)&&p.views>0?p.views:p.plays;
const clock=s=>`${String(Math.floor(s/60)).padStart(2,'0')}:${(s%60).toFixed(1).padStart(4,'0')}`;
const round=(n,d=1)=>Number.isFinite(n)?Number(n.toFixed(d)):null;
export const slugFor=p=>{const hook=(p.analysis?.anatomy||[]).find(a=>a.value==='hook')?.text||p.transcript?.text||'';const words=hook.toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(Boolean).slice(0,6).join('-');return `${words||'reel'}-${p.id}`.replace(/[^\w-]/g,'');};

export function referenceSummary(job,post){
 const typical=median(job.posts.map(reach));const r=reach(post);const L=post.analysis?.labels||{};
 return {
  url:post.url,creator:post.creator,publishedAt:post.publishedAt,duration:round(post.duration),
  reach:r,likes:post.likes,comments:post.comments,
  likesPer1k:r?round(post.likes/r*1000):null,commentsPer1k:r?round(post.comments/r*1000,2):null,
  creatorMedianReach:typical,outlier:typical&&r?round(r/typical):null,
  labels:Object.fromEntries(Object.entries(L).map(([k,v])=>[k,v.value])),
  caption:post.caption||''
 };
}

export async function buildReference(job,post,outRoot){
 if(!post.analysis?.anatomy?.length)throw new Error('This Reel has no script anatomy yet. Let the run finish first.');
 const dir=join(outRoot,slugFor(post));await mkdir(join(dir,'frames'),{recursive:true});
 const s=referenceSummary(job,post);const beats=post.analysis.anatomy;
 let video='';
 try{const {bytes}=await download(post.videoUrl,300*1024*1024);video=join(dir,'reference.mp4');await writeFile(video,bytes);}
 catch(e){video='';await writeFile(join(dir,'VIDEO-MISSING.txt'),`The video link has expired (${e.message}).\nOpen ${post.url} and save the video here as reference.mp4, or run this creator again in Creator Lab.\n`);}
 const frames=[];
 if(video){
  const points=[...beats.map((b,i)=>({at:Math.max(0,b.start+0.15),name:`${String(i+1).padStart(2,'0')}-${b.value}-${b.start.toFixed(1)}s`})),{at:Math.max(0,(post.duration||beats.at(-1).end)-0.3),name:`${String(beats.length+1).padStart(2,'0')}-last-frame`}];
  for(const p of points){const file=join(dir,'frames',p.name+'.jpg');try{await exec('ffmpeg',['-y','-v','error','-ss',String(p.at),'-i',video,'-frames:v','1','-q:v','2',file],{timeout:60000});frames.push(p.name+'.jpg');}catch{}}
 }else await rm(join(dir,'frames'),{recursive:true,force:true});
 const shots=video?await cameraShots(dir,video,beats):[];
 await writeFile(join(dir,'transcript.txt'),(post.transcript?.text||beats.map(b=>b.text).join(' ')).trim()+'\n');
 await writeFile(join(dir,'scenes.txt'),beats.map((b,i)=>`${String(i+1).padStart(2,'0')}  ${clock(b.start)}–${clock(b.end)}  ${b.value.toUpperCase().padEnd(8)} ${b.text.trim()}`).join('\n')+'\n');
 const L=s.labels;
 await writeFile(join(dir,'stats.txt'),[
  `Original: ${s.url}`,`Creator: @${s.creator}  ·  posted ${s.publishedAt?.slice(0,10)||'unknown'}  ·  ${s.duration}s`,
  `Reach: ${s.reach?.toLocaleString('en')}  (${s.outlier??'?'}× this creator's median of ${s.creatorMedianReach?.toLocaleString('en')})`,
  `Likes: ${s.likes?.toLocaleString('en')}  ·  ${s.likesPer1k} per 1K`,`Comments: ${s.comments?.toLocaleString('en')}  ·  ${s.commentsPer1k} per 1K`,
  '',`Hook: ${L.mechanism} (${L.opening} opening)`,`Structure: ${L.structure}  ·  Emotion: ${L.emotion}  ·  Advice: ${L.specificity}  ·  CTA: ${L.cta}`,
  '',`Caption: ${s.caption.replace(/\s+/g,' ').trim()}`,
  '',`Frames: ${frames.length?frames.length+' in frames/ (one per beat start, plus the last frame)':'none (video missing)'}`,
  `Camera shots: ${shots.length?shots.length+' in setups/ (one frame per shot, see setups.txt)':video?'not detected (install PySceneDetect: pip install --user "scenedetect[opencv-headless]")':'none (video missing)'}`
 ].join('\n')+'\n');
 await writeFile(join(dir,'reel.json'),JSON.stringify({...s,id:post.id,beats:beats.map(({start,end,value,text})=>({start,end,role:value,text})),shots},null,2));
 return {dir,frames:frames.length,shots:shots.length,video:Boolean(video)};
}

// One frame from the middle of every camera shot (PySceneDetect), with the words spoken over it, so setups can be
// counted at a glance. Skipped quietly when Python or PySceneDetect is missing.
async function cameraShots(dir,video,beats){
 let shots;
 try{const {stdout}=await exec('python',['-P','-E',join(dirname(fileURLToPath(import.meta.url)),'..','scripts','setups.py'),video],{timeout:180000,maxBuffer:4*1024*1024});shots=JSON.parse(stdout.trim().split('\n').at(-1));}catch{return [];}
 if(!shots.length)return [];
 await mkdir(join(dir,'setups'),{recursive:true});
 const lines=[];
 for(const [i,sh] of shots.entries()){
  const name=`${String(i+1).padStart(2,'0')}-${sh.start.toFixed(1)}s.jpg`;
  try{await exec('ffmpeg',['-y','-v','error','-ss',String((sh.start+sh.end)/2),'-i',video,'-frames:v','1','-q:v','2',join(dir,'setups',name)],{timeout:60000});}catch{continue;}
  const said=beats.filter(b=>b.end>sh.start&&b.start<sh.end).map(b=>b.text.trim()).join(' ');
  sh.frame=name;lines.push(`${name.padEnd(14)} ${clock(sh.start)}–${clock(sh.end)}  ${said}`);
 }
 await writeFile(join(dir,'setups.txt'),lines.join('\n')+'\n');
 // motion.jpg: one row per shot, its start / middle / end side by side, to read framing and camera movement.
 const tmp=join(dir,'setups','_motion');await mkdir(tmp,{recursive:true});let k=0;
 for(const sh of shots.filter(s=>s.frame))for(const f of [0.08,0.5,0.92]){const at=sh.start+(sh.end-sh.start)*f;try{await exec('ffmpeg',['-y','-v','error','-ss',String(at),'-i',video,'-frames:v','1','-vf','scale=240:-2',join(tmp,`${String(++k).padStart(3,'0')}.jpg`)],{timeout:60000});}catch{}}
 try{await exec('ffmpeg',['-y','-v','error','-i',join(tmp,'%03d.jpg'),'-vf',`tile=3x${Math.ceil(k/3)}:padding=6:color=white`,'-frames:v','1','-q:v','3',join(dir,'motion.jpg')],{timeout:60000});}catch{}
 await rm(tmp,{recursive:true,force:true});
 return shots.filter(s=>s.frame);
}
