// Builds a recreation reference folder from one analyzed Reel: the original video, a frame at the start of every
// script beat, the transcript, the beat list and the numbers that made it worth recreating.
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
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
 await writeFile(join(dir,'transcript.txt'),(post.transcript?.text||beats.map(b=>b.text).join(' ')).trim()+'\n');
 await writeFile(join(dir,'scenes.txt'),beats.map((b,i)=>`${String(i+1).padStart(2,'0')}  ${clock(b.start)}–${clock(b.end)}  ${b.value.toUpperCase().padEnd(8)} ${b.text.trim()}`).join('\n')+'\n');
 const L=s.labels;
 await writeFile(join(dir,'stats.txt'),[
  `Original: ${s.url}`,`Creator: @${s.creator}  ·  posted ${s.publishedAt?.slice(0,10)||'unknown'}  ·  ${s.duration}s`,
  `Reach: ${s.reach?.toLocaleString('en')}  (${s.outlier??'?'}× this creator's median of ${s.creatorMedianReach?.toLocaleString('en')})`,
  `Likes: ${s.likes?.toLocaleString('en')}  ·  ${s.likesPer1k} per 1K`,`Comments: ${s.comments?.toLocaleString('en')}  ·  ${s.commentsPer1k} per 1K`,
  '',`Hook: ${L.mechanism} (${L.opening} opening)`,`Structure: ${L.structure}  ·  Emotion: ${L.emotion}  ·  Advice: ${L.specificity}  ·  CTA: ${L.cta}`,
  '',`Caption: ${s.caption.replace(/\s+/g,' ').trim()}`,
  '',`Frames: ${frames.length?frames.length+' in frames/ (one per beat start, plus the last frame)':'none (video missing)'}`
 ].join('\n')+'\n');
 await writeFile(join(dir,'reel.json'),JSON.stringify({...s,id:post.id,beats:beats.map(({start,end,value,text})=>({start,end,role:value,text}))},null,2));
 return {dir,frames:frames.length,video:Boolean(video)};
}
