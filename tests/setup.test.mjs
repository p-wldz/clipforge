import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { setupPlan,venvPython,detectPython,chooseTranscriptionDevice } from '../dist/core/setup.js';
import { initWorkspace } from '../dist/core/paths.js';

test('cross-platform venv interpreter paths',()=>{
 assert.equal(venvPython('/some/project','win32'),path.join('/some/project','.clipforge','tools','python','Scripts','python.exe'));
 assert.equal(venvPython('/some/project','linux'),path.join('/some/project','.clipforge','tools','python','bin','python'));
});

test('setup plan is read-only and skips FFmpeg when available',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'clipforge-setup-'));
 try {await initWorkspace(root);const result=await setupPlan(root,{transcription:false});
  assert.ok(Array.isArray(result.plans));assert.ok(Array.isArray(result.warnings));
  assert.ok(result.plans.every(p=>['ffmpeg','transcription'].includes(p.kind)));
  assert.ok(result.plans.every(p=>Array.isArray(p.args)));
  assert.ok(result.plans.every(p=>typeof p.requiresElevation==='boolean'));
 } finally{await rm(root,{force:true,recursive:true});}
});

test('python detection does not execute installations',async()=>{
 const python=await detectPython();
 assert.ok(python===null || (typeof python.command==='string' && Array.isArray(python.prefix)));
});


test('transcription device always falls back to CPU when CUDA inference fails',()=>{
 assert.equal(chooseTranscriptionDevice('auto',false),'cpu');
 assert.equal(chooseTranscriptionDevice('cuda',false),'cpu');
 assert.equal(chooseTranscriptionDevice('auto',true),'cuda');
 assert.equal(chooseTranscriptionDevice('cpu',true),'cpu');
});

test('classifier environment uses separate cross-platform paths',async()=>{
 const {classifierPython}=await import('../dist/core/setup.js');
 assert.equal(classifierPython('/some/project','win32'),path.join('/some/project','.clipforge','tools','sound-classifier','Scripts','python.exe'));
 assert.equal(classifierPython('/some/project','linux'),path.join('/some/project','.clipforge','tools','sound-classifier','bin','python'));
});

test('sound classifier can be planned independently from Whisper',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'clipforge-ast-'));
 try {
  await initWorkspace(root);
  const result=await setupPlan(root,{ffmpeg:false,soundClassifier:true,transcription:false});
  assert.ok(result.plans.some(p=>p.kind==='sound-classifier') || result.warnings.some(w=>w.includes('Python')));
  assert.equal(result.plans.some(p=>p.kind==='transcription'),false);
 } finally {await rm(root,{force:true,recursive:true});}
});
