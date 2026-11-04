import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {initWorkspace,loadConfig,saveConfig,artifactDir,stableId} from '../dist/core/paths.js';
import {Store} from '../dist/core/db.js';
import {analyze} from '../dist/pipeline/analyze.js';

test('bad clip and broken AST worker never prevent remaining clips from being analyzed',async(t)=>{
 const ff=spawnSync('ffmpeg',['-version'],{encoding:'utf8'});if(ff.status!==0){t.skip('ffmpeg not available');return;}
 const root=await mkdtemp(path.join(os.tmpdir(),'clipforge-resilient-'));
 try{
  await initWorkspace(root);const clips=path.join(root,'clips');await mkdir(clips,{recursive:true});
  await writeFile(path.join(clips,'00-corrupt.mp4'), 'not a video');
  const good=path.join(clips,'01-working.mp4');
  const generation=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=blue:s=320x180:r=10:d=2','-f','lavfi','-i','sine=frequency=220:duration=2','-c:v','mpeg4','-c:a','aac','-shortest',good],{encoding:'utf8'});
  assert.equal(generation.status,0,generation.stderr);
  const config=await loadConfig(root);config.soundClassifier.enabled=true;config.soundClassifier.command=process.execPath;await saveConfig(root,config);
  const report=await analyze(root,clips,{withAgent:false,force:true},()=>{});
  assert.equal(report.failedFiles,1);assert.equal(report.analyzed,1);assert.equal(report.total,2);
  assert.ok(report.warnings>=2);
  const db=new Store(root);
  try{const runs=db.runs();assert.equal(runs[0].status,'completed_with_warnings');assert.equal(runs[0].processed_count,2);assert.equal(runs[0].failed_files,1);assert.equal(db.clips().length,1);assert.equal(db.skipped().some(x=>x.decision==='error'),true);}
  finally{db.close();}
  const errors=JSON.parse(await readFile(path.join(artifactDir(root,stableId(good)),'stage-errors.json'),'utf8'));
  assert.equal(errors[0].stage,'sound-classifier');
 }finally{await rm(root,{recursive:true,force:true});}
});
