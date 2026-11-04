import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {initWorkspace,loadConfig} from '../dist/core/paths.js';
import {Store} from '../dist/core/db.js';
import {ensurePrompts,promptPath} from '../dist/agents/prompts.js';
import {contexts,profileFor} from '../dist/pipeline/staged-ai.js';

test('stage artifacts and editing sets retain independent cache keys',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'clipforge-stages-'));
 try{
  await initWorkspace(root);const db=new Store(root);
  db.upsertClip({id:'c1',source_path:path.join(root,'clips','one.mp4'),duration:30,width:1,height:1,analyzed_at:new Date().toISOString(),transcript:null});
  const understanding={clipId:'c1',summary:'quiet setup then action',observations:[{start:0,end:10,type:'setup',description:'waits',confidence:.7,evidence:['visual']}],themes:[],tone:{intensity:.2,humor:null,tension:.4,voiceActivity:null}};
  db.saveStageArtifact('c1','base','objective-key','codex',undefined,'success','artifact.json',understanding,null);
  assert.deepEqual(JSON.parse(db.stageArtifact('c1','base','objective-key').payload_json),understanding);
  const highlight={id:'h1',clip_id:'c1',start:0,end:12,title:'Complete action',description:'setup through result',score:90,status:'pending_review',origin:'codex',created_at:new Date().toISOString()};
  db.saveHighlightSet('funny','funny-key',[highlight]);db.saveHighlightSet('cinematic','cinematic-key',[highlight]);
  assert.equal(db.highlightSets().length,2);assert.equal(db.highlightsForSet('funny','funny-key')[0].id,'h1');db.close();
 }finally{await rm(root,{recursive:true,force:true});}
});
test('new projects create independent context and nested stage prompts while legacy profiles still work',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'clipforge-contexts-'));
 try{await initWorkspace(root);await ensurePrompts(root);const config=await loadConfig(root);const value=await contexts(root,config);
  assert.equal(value.editing,config.project.focus);assert.match(await readFile(promptPath(root,'understanding-base'),'utf8'),/context-independent/i);
  assert.equal(profileFor(config,'editing').provider,config.agent.provider);
 }finally{await rm(root,{recursive:true,force:true});}
});
