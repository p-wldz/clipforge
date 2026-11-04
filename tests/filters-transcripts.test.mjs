import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {initWorkspace,loadConfig} from '../dist/core/paths.js';
import {analyze,normalizeTranscript} from '../dist/pipeline/analyze.js';
import {Store} from '../dist/core/db.js';

test('transcript timestamps normalize and search by phrase',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'cf-search-'));
 try{
  await initWorkspace(root);
  const db=new Store(root);
  try{
   db.upsertClip({id:'a',source_path:'test.mp4',duration:30,width:640,height:360,analyzed_at:new Date().toISOString(),transcript:'{}'});
   const segments=normalizeTranscript({segments:[{start:2,end:4,text:'Tank behind us!'},{start:5,end:7,text:'Fire!'},{start:8,end:8,text:'invalid'}]});
   assert.equal(segments.length,2);
   db.saveTranscriptSegments('a',segments);
   assert.equal(db.searchTranscripts('TANK')[0].start,2);
   assert.equal(db.searchTranscripts('fire')[0].text,'Fire!');
   assert.deepEqual(db.searchTranscripts('nonexistent'),[]);
   db.saveTranscriptSegments('a',[{start:1,end:2,text:'New words'}]);
   assert.deepEqual(db.searchTranscripts('tank'),[]);
  }finally{db.close();}
 }finally{await rm(root,{recursive:true,force:true});}
});

test('duration filter skips before extracting any frames',async(t)=>{
 try{execFileSync('ffmpeg',['-version'],{stdio:'ignore'});}catch{t.skip('ffmpeg unavailable');return;}
 const root=await mkdtemp(path.join(os.tmpdir(),'cf-filter-'));
 try{
  await initWorkspace(root,{maxDurationSeconds:2});
  const input=path.join(root,'clips','long.mp4');
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=320x180:r=10','-t','3','-c:v','mpeg4','-y',input]);
  const lines=[];
  const result=await analyze(root,path.join(root,'clips'),{withAgent:false,force:false},line=>lines.push(line));
  assert.equal(result.analyzed,0);
  const db=new Store(root);
  try{
   assert.equal(db.clips().length,0);
   assert.equal(db.skipped().length,1);
   assert.match(db.skipped()[0].reason,/exceeds maximum/);
  }finally{db.close();}
  assert.ok(lines.some(line=>line.startsWith('FILTERED')));
 }finally{await rm(root,{recursive:true,force:true});}
});
