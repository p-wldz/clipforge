import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {initWorkspace} from '../dist/core/paths.js';
import {getPrompt,setPrompt,promptPath} from '../dist/agents/prompts.js';
import {parseFilmProposal} from '../dist/agents/montage.js';

test('editable prompt persists and init does not overwrite it',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'clipforge-prompts-'));
 try{
  await initWorkspace(root);
  const original=await getPrompt(root,'clip-analysis');assert.match(original,/whole clip/i);
  await setPrompt(root,'clip-analysis','Focus on funny voice reactions and uncertain evidence.');
  await initWorkspace(root);
  assert.equal(await readFile(promptPath(root,'clip-analysis'),'utf8'),'Focus on funny voice reactions and uncertain evidence.');
 }finally{await rm(root,{force:true,recursive:true});}
});
test('film proposal rejects invented IDs and uses only real candidates',()=>{
 const source=JSON.stringify({title:'Best HLL moments',description:'Funny and tactical clips',concept:'Escalation',openingHook:'Start with voice reaction',estimatedDurationSeconds:60,ending:'Final explosion',sequence:[{highlightId:'real-1',reason:'Good hook'},{highlightId:'fake',reason:'Not in source'}]});
 const result=parseFilmProposal(source,new Set(['real-1']));assert.equal(result.sequence.length,1);assert.equal(result.sequence[0].highlightId,'real-1');
 assert.throws(()=>parseFilmProposal(source,new Set(['other'])),/valid highlight IDs/);
});
test('empty prompt is rejected',async()=>{const root=await mkdtemp(path.join(os.tmpdir(),'clipforge-prompt-validation-'));try{await initWorkspace(root);await assert.rejects(setPrompt(root,'montage','  '),/Prompt must/)}finally{await rm(root,{recursive:true,force:true})}});
