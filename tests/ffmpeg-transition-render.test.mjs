import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {initWorkspace} from '../dist/core/paths.js';
import {Store} from '../dist/core/db.js';
import {render} from '../dist/pipeline/render.js';
const hasFfmpeg=(()=>{try{execFileSync('ffmpeg',['-version'],{stdio:'ignore'});execFileSync('ffprobe',['-version'],{stdio:'ignore'});return true}catch{return false}})();
test('FFmpeg renders a mix of hard cuts and crossfades with correct duration', {skip:!hasFfmpeg, timeout:90000},async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'clipforge-crossfade-'));
 try{
  await initWorkspace(root);const db=new Store(root),now=new Date().toISOString();
  for(const [clip,frequency] of [['one','440'],['two','880'],['three','660']]){
   const source=path.join(root,'clips',`${clip}.mp4`);
   execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i',`color=c=blue:s=320x180:r=30:d=1.8`,'-f','lavfi','-i',`sine=frequency=${frequency}:duration=1.8`,'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',source],{timeout:20000});
   db.upsertClip({id:clip,source_path:source,duration:1.8,width:320,height:180,analyzed_at:now,transcript:null});
   db.upsertHighlight({id:'h'+clip,clip_id:clip,start:0,end:1.5,title:clip,description:clip,score:90,status:'approved',origin:'codex',created_at:now});
  }
  db.createEditorProject('film','test',['hone','htwo','hthree']);
  db.updateEditorProject('film',{name:'test',description:'',items:[
    {highlightId:'hone',start:0,end:1.5,transition:'cut'},
    {highlightId:'htwo',start:0,end:1.5,transition:'cut'},
    {highlightId:'hthree',start:0,end:1.5,transition:'fade',transitionDuration:0.5}
  ]});
  db.close();
  const output=await render(root,'film');
  const duration=Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',output],{encoding:'utf8'}).trim());
  assert.ok(duration>3.8&&duration<4.2,`Unexpected ${duration} seconds`);
 }finally{await rm(root,{recursive:true,force:true})}
});
