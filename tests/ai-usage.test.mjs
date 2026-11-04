import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCodexUsage,parseClaudeUsage,estimateApiEquivalent,validateCatalog} from '../dist/core/usage.js';
import {selectFrames} from '../dist/pipeline/frame-selection.js';
test('Codex JSONL usage with cached reads',()=>{
 const usage=parseCodexUsage('warning\n'+JSON.stringify({type:'turn.completed',usage:{input_tokens:1000,cached_input_tokens:400,output_tokens:200}})+'\n');
 assert.deepEqual(usage,{inputTokens:1000,cachedInputTokens:400,outputTokens:200});
 const cost=estimateApiEquivalent('codex','gpt-5.3-codex',usage);
 assert.equal(cost.status,'estimated_api_equivalent');
 assert.ok(Math.abs(cost.usd-((600*1.75+400*0.175+200*14)/1e6))<1e-12);
});
test('Claude usage prices cached writes separately',()=>{
 const usage=parseClaudeUsage({usage:{input_tokens:100,cache_read_input_tokens:200,cache_creation_input_tokens:50,output_tokens:20}});
 assert.deepEqual(usage,{inputTokens:350,cachedInputTokens:200,cacheWriteInputTokens:50,outputTokens:20});
 const result=estimateApiEquivalent('claude','claude-sonnet-4-5-20250929',usage);
 assert.ok(Math.abs(result.usd-(100*3+200*.3+50*3.75+20*15)/1e6)<1e-12);
});
test('unknown provider or missing price does not silently become zero',()=>{
 assert.equal(estimateApiEquivalent('custom','my-model',{inputTokens:10,cachedInputTokens:0,outputTokens:4}).usd,null);
 assert.throws(()=>validateCatalog({codex:{bad:{input:-1,cached:0,output:0}}}));
 assert.equal(validateCatalog({custom:{model:{input:1,cached:0.1,output:2}}}).custom.model.output,2);
});
test('image selection prefers events, preserves ends and budget',()=>{
 const frames=Array.from({length:20},(_,i)=>`frame-${i}.jpg`);
 const selected=selectFrames(frames,60,3,5,[{start:22},{start:43}]);
 assert.equal(selected.length,5);assert.equal(selected[0],frames[0]);assert.equal(selected.at(-1),frames.at(-1));
 assert.ok(selected.includes(frames[7]));assert.ok(selected.includes(frames[14]));
});
