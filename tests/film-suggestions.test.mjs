import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {initWorkspace} from '../dist/core/paths.js';
import {Store} from '../dist/core/db.js';
import {latestFilmProposal,updateFilmProposal,suggestFilm} from '../dist/agents/montage.js';
import {getPrompt} from '../dist/agents/prompts.js';
import {startServer} from '../dist/server.js';
const example={provider:'codex',createdAt:'2026-11-04T10:00:00Z',proposal:{title:'The best HLL moments',description:'Comedy into chaos',concept:'A crescendo',openingHook:'Comms',estimatedDurationSeconds:40,sequence:[{highlightId:'h1',reason:'Good opener',transition:'cut',transitionDuration:0.5},{highlightId:'h2',reason:'Loud ending',transition:'fade',transitionDuration:0.6}],ending:'Boom'}};
async function fixture(){
 const root=await mkdtemp(path.join(os.tmpdir(),'clipforge-v015-'));
 await initWorkspace(root);
 const folder=path.join(root,'.clipforge','projects','suggestions');await mkdir(folder,{recursive:true});
 await writeFile(path.join(folder,'latest.json'),JSON.stringify(example));
 const db=new Store(root),now=new Date().toISOString();
 db.upsertClip({id:'c1',source_path:path.join(root,'clips','test.mp4'),duration:60,width:1920,height:1080,analyzed_at:now,transcript:null});
 for(const id of ['h1','h2'])db.upsertHighlight({id,clip_id:'c1',start:id==='h1'?1:10,end:id==='h1'?8:20,title:id,description:'Description',score:80,status:'pending_review',origin:'codex',created_at:now});
 return {root,db};
}
test('human transitions can be edited without losing the original proposal or accepting made-up effects',async()=>{
 const {root,db}=await fixture();
 try{
  assert.match(await getPrompt(root,'film-regeneration'),/previous proposal/);
  const updated=await updateFilmProposal(root,example.createdAt,[{highlightId:'h1',transition:'fade',transitionDuration:0.5},{highlightId:'h2',transition:'wipeleft',transitionDuration:0.8}]);
  assert.equal(updated.proposal.sequence[0].transition,'cut');
  assert.equal(updated.proposal.sequence[1].transition,'wipeleft');
  assert.equal((await latestFilmProposal(root)).proposal.sequence[1].transitionDuration,0.8);
  await assert.rejects(updateFilmProposal(root,example.createdAt,[{highlightId:'h1',transition:'cut',transitionDuration:0.4},{highlightId:'h2',transition:'untrusted',transitionDuration:0.8}]),/Invalid transition/);
  await assert.rejects(updateFilmProposal(root,'older-version',[{highlightId:'h1',transition:'cut',transitionDuration:0.4},{highlightId:'h2',transition:'cut',transitionDuration:0.4}]),/Suggestion changed/);
 }finally{db.close();await rm(root,{recursive:true,force:true})}
});
test('API allows editing suggestion effects and deleting selected montage drafts without deleting highlights',async()=>{
 const {root,db}=await fixture();db.createEditorProject('filmA','Film A',['h1','h2']);db.createEditorProject('filmB','Film B',['h2']);db.close();
 const server=startServer(root,0);await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 async function req(url,method='GET',body){const r=await fetch(base+url,{method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}}
 try{
  const edited=await req('/api/montage/suggestion','PATCH',{createdAt:example.createdAt,sequence:[{highlightId:'h1',transition:'cut',transitionDuration:0.5},{highlightId:'h2',transition:'slideleft',transitionDuration:0.3}]});
  assert.equal(edited.status,200);assert.equal(edited.data.proposal.sequence[1].transition,'slideleft');
  const deleted=await req('/api/editor/projects/filmA','DELETE');assert.equal(deleted.status,200);assert.equal(deleted.data.sourcesPreserved,true);
  assert.equal((await req('/api/editor/projects/filmA')).status,404);
  assert.equal((await req('/api/editor/projects/filmB')).status,200);
  assert.equal((await req('/api/highlights')).data.length,2);
  assert.equal((await req('/api/editor/projects/filmA','DELETE')).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true})}
});
test('regeneration includes edited instruction, previous story and user guidance in model prompt', {skip:process.platform==='win32'},async()=>{
 const {root,db}=await fixture();db.close();
 const originalPath=process.env.PATH;
 try{
  await writeFile(path.join(root,'.clipforge','prompts','film-regeneration.md'),'Change pacing without repeating footage.');
  const bin=path.join(root,'fake-bin');await mkdir(bin);
  const command=path.join(bin,'codex');
  await writeFile(command,`#!/usr/bin/env node
const fs=require('node:fs');const args=process.argv.slice(2);let prompt='';process.stdin.on('data',b=>prompt+=b.toString());process.stdin.on('end',()=>{fs.writeFileSync(args[args.indexOf('-o')+1],JSON.stringify(${JSON.stringify(example.proposal)}));});`,{mode:0o755});
  process.env.PATH=bin+path.delimiter+originalPath;
  await suggestFilm(root,'codex',undefined,'HLL funny moments',[{id:'h1',clip_id:'c1',title:'Funny',description:'Example',start:1,end:8,score:80,origin:'codex'}],[],undefined,undefined,'Fewer kills and more teamwork');
  const latest=await latestFilmProposal(root);const prompt=await readFile(latest.promptFile,'utf8');
  assert.match(prompt,/Change pacing without repeating footage/);
  assert.match(prompt,/PREVIOUS PROPOSAL/);
  assert.match(prompt,/Fewer kills and more teamwork/);
 }finally{process.env.PATH=originalPath;await rm(root,{recursive:true,force:true})}
});
