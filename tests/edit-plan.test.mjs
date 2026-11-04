import { test } from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEditPlan,transitionGraph,validTransition} from '../dist/pipeline/edit-plan.js';
import {parseClipUnderstanding} from '../dist/agents/agent.js';
import {parseFilmProposal} from '../dist/agents/montage.js';
const cut=(id,clip,start,end,speed=1)=>({id,clip_id:clip,source_path:`/${clip}.mp4`,start,end,speed,transition:'cut'});
test('adjacent highlights from same source merge without replaying overlapping footage',()=>{
 const p=normalizeEditPlan([cut('a','one',2,8),cut('b','one',7,14),cut('c','one',15,19),cut('d','two',3,7)]);
 assert.equal(p.length,2);assert.deepEqual(p[0].sourceHighlightIds,['a','b','c']);assert.equal(p[0].start,2);assert.equal(p[0].end,19);
});
test('separated highlights and different speeds remain distinct',()=>{
 const p=normalizeEditPlan([cut('a','one',2,8),cut('b','one',14,20),cut('c','one',19,24,2)]);
 assert.equal(p.length,3);
});
test('transition graph supports hard cuts and 2-channel audio crossfades',()=>{
 const result=transitionGraph([3,4,2],[{transition:'cut'},{transition:'fade',transitionDuration:0.5},{transition:'cut'}]);
 assert.match(result.filters,/xfade=transition=fade:duration=0.500:offset=2.500/);
 assert.match(result.filters,/acrossfade=d=0.500/);
 assert.match(result.filters,/concat=n=2:v=1:a=1/);
 assert.ok(Math.abs(result.duration-8.5)<0.01);
 assert.ok(validTransition('wipeleft'));assert.ok(!validTransition('invalid;rm -rf'));
});
test('rich clip analysis is backward compatible with earlier model responses',()=>{
 const old=parseClipUnderstanding(JSON.stringify({title:'a',summary:'b',highlights:[{title:'h',description:'d',start:0,end:2,score:90}]}),5);
 assert.equal(old.editorial,undefined);
 const modern=parseClipUnderstanding(JSON.stringify({title:'a',summary:'b',editorial:{tone:'humorous',energy:72,humor:89,action:18,speechLevel:'high',soundscape:['shouting'],bestUses:['funny moments'],hook:'A teammate reacts',notableMoments:[{start:1,end:2,description:'reaction',confidence:.8,evidence:'speech'}]},highlights:[{title:'h',description:'d',start:0,end:2,score:90}]}),5);
 assert.equal(modern.editorial.humor,89);assert.equal(modern.editorial.notableMoments[0].evidence,'speech');
});
test('AI film proposal supports only safe FFmpeg transition types',()=>{
 const result=parseFilmProposal(JSON.stringify({title:'A',description:'B',concept:'C',openingHook:'D',ending:'E',sequence:[{highlightId:'h',reason:'r',transition:'fade',transitionDuration:.65},{highlightId:'z',reason:'r',transition:'evil',transitionDuration:55}]}),new Set(['h','z']));
 assert.equal(result.sequence[0].transition,'fade');assert.equal(result.sequence[0].transitionDuration,.65);
 assert.equal(result.sequence[1].transition,undefined);assert.equal(result.sequence[1].transitionDuration,1.5);
});
