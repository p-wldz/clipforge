import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeepseekUsage } from '../dist/agents/deepseek.js';
import { estimateApiEquivalent, defaultPrices } from '../dist/core/usage.js';
import { initWorkspace, loadConfig, saveConfig } from '../dist/core/paths.js';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
test('DeepSeek API token usage including cache hits',()=>{
 const usage=parseDeepseekUsage({prompt_tokens:1000,completion_tokens:200,prompt_cache_hit_tokens:700,prompt_cache_miss_tokens:300});
 assert.deepEqual(usage,{inputTokens:1000,cachedInputTokens:700,outputTokens:200});
 const cost=estimateApiEquivalent('deepseek','deepseek-flash',usage,defaultPrices);
 assert.equal(cost.status,'estimated_api_equivalent');
 assert.ok(cost.usd>0);
});
test('DeepSeek provider can be saved for each stage',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'cf-ds-'));
 try {await initWorkspace(root);const cfg=await loadConfig(root);cfg.aiStages={clipAnalysis:{provider:'deepseek',model:'deepseek-flash'},montage:{provider:'deepseek',model:'deepseek-v4-pro'}};await saveConfig(root,cfg);assert.equal((await loadConfig(root)).aiStages.montage.model,'deepseek-v4-pro');}
 finally {await rm(root,{recursive:true,force:true});}
});
test('DeepSeek sends screenshots and parses reported token usage',async()=>{
 const {deepseekChat}=await import('../dist/agents/deepseek.js');
 const {writeFile}=await import('node:fs/promises');
 const dir=await mkdtemp(path.join(os.tmpdir(),'cf-ds-image-'));
 const image=path.join(dir,'frame.jpg');await writeFile(image,Buffer.from([0xff,0xd8,0xff,0xd9]));
 const oldKey=process.env.DEEPSEEK_API_KEY,oldFetch=globalThis.fetch;
 try{
  process.env.DEEPSEEK_API_KEY='fake-test-key';
  globalThis.fetch=async(url,opts)=>{
   assert.equal(url,'https://api.deepseek.com/chat/completions');
   const body=JSON.parse(opts.body);
   assert.equal(body.model,'deepseek-flash');
   assert.equal(body.messages[0].content.length,2);
   assert.match(body.messages[0].content[1].image_url.url,/^data:image\/jpeg;base64,/);
   assert.equal(opts.headers.Authorization,'Bearer fake-test-key');
   return new Response(JSON.stringify({choices:[{message:{content:'{"ok":true}'}}],usage:{prompt_tokens:10,completion_tokens:5,prompt_cache_hit_tokens:2}}),{status:200});
  };
  const result=await deepseekChat('describe',{model:'deepseek-flash',images:[image]});
  assert.equal(result.text,'{"ok":true}');assert.equal(result.usage.cachedInputTokens,2);
 }finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=oldKey;await rm(dir,{recursive:true,force:true});}
});
