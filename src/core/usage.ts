/** Token accounting is informational. CLI subscriptions do not expose an invoice. */
export interface TokenUsage {inputTokens:number;cachedInputTokens:number;outputTokens:number;cacheWriteInputTokens?:number}
export interface TokenRate {input:number;cached:number;output:number;cacheWrite?:number}
export type PriceCatalog=Record<string,Record<string,TokenRate>>;
export type ApiEstimate={usd:number|null;status:'estimated_api_equivalent'|'unpriced';pricingModel:string|null};
/** Checked against published API pricing when shipped. Users may override rates per model. USD / 1M tokens. */
export const defaultPrices:PriceCatalog={codex:{'gpt-5.3-codex':{input:1.75,cached:0.175,output:14}},deepseek:{'deepseek-flash':{input:0.15,cached:0.003,output:0.60},'deepseek-v4-pro':{input:0.66,cached:0.022,output:1.98}},claude:{'claude-sonnet-4-5-20250929':{input:3,cached:0.30,output:15,cacheWrite:3.75},'claude-haiku-4-5-20251001':{input:1,cached:0.10,output:5,cacheWrite:1.25}}};
export function parseCodexUsage(jsonl:string):TokenUsage|null {
 let result:TokenUsage|null=null;
 for(const line of jsonl.split(/\r?\n/)){
  if(!line.trim())continue;
  try{const event=JSON.parse(line) as {type?:string;usage?:Record<string,unknown>};
   if(event.type!=='turn.completed'||!event.usage)continue;
   const {input_tokens,cached_input_tokens,output_tokens}=event.usage;
   if(typeof input_tokens!=='number'||typeof output_tokens!=='number'||!Number.isFinite(input_tokens)||!Number.isFinite(output_tokens)||input_tokens<0||output_tokens<0)continue;
   result={inputTokens:input_tokens,cachedInputTokens:typeof cached_input_tokens==='number'?Math.min(input_tokens,Math.max(0,cached_input_tokens)):0,outputTokens:output_tokens};
  }catch{ /* CLI warnings may be non-JSON. */ }
 }
 return result;
}
/** Claude response usage can include per-model cache reads and creation. Output is not double counted. */
export function parseClaudeUsage(raw:unknown):TokenUsage|null {
 if(!raw||typeof raw!=='object')return null;
 const o=raw as Record<string,unknown>,u=o.usage;
 if(!u||typeof u!=='object')return null;
 const x=u as Record<string,unknown>;
 const input=x.input_tokens,output=x.output_tokens,cacheRead=x.cache_read_input_tokens??0,cacheWrite=x.cache_creation_input_tokens??0;
 if(typeof input!=='number'||typeof output!=='number'||[input,output,cacheRead,cacheWrite].some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0))return null;
 // Claude reports input_tokens excluding cache read/creation; normalize to total input.
 return {inputTokens:input+(cacheRead as number)+(cacheWrite as number),cachedInputTokens:cacheRead as number,cacheWriteInputTokens:cacheWrite as number,outputTokens:output};
}
export function estimateApiEquivalent(provider:string,model:string|null|undefined,usage:TokenUsage|null,catalog:PriceCatalog=defaultPrices):ApiEstimate {
 const key=model?.toLowerCase().trim()??'';const rate=catalog[provider]?.[key];
 if(!usage||!rate)return {usd:null,status:'unpriced',pricingModel:model??null};
 const normal=Math.max(0,usage.inputTokens-usage.cachedInputTokens-(usage.cacheWriteInputTokens??0));
 if((usage.cacheWriteInputTokens??0)>0&&rate.cacheWrite===undefined)return {usd:null,status:'unpriced',pricingModel:model??null};
 const usd=(normal*rate.input+usage.cachedInputTokens*rate.cached+(usage.cacheWriteInputTokens??0)*(rate.cacheWrite??0)+usage.outputTokens*rate.output)/1_000_000;
 return {usd,status:'estimated_api_equivalent',pricingModel:model??null};
}
export function validateCatalog(raw:unknown):PriceCatalog {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Pricing must be a provider to model map');
 const result:PriceCatalog={};
 for(const [provider,models] of Object.entries(raw)){
  if(!/^[a-z0-9_-]{1,50}$/.test(provider)||!models||typeof models!=='object'||Array.isArray(models))throw new Error('Invalid pricing provider');
  result[provider]={};
  for(const [model,price] of Object.entries(models)){
   if(!model||model.length>180||!price||typeof price!=='object'||Array.isArray(price))throw new Error('Invalid model price');
   const v=price as Record<string,unknown>;
   if(['input','cached','output'].some(k=>typeof v[k]!=='number'||!Number.isFinite(v[k])||(v[k] as number)<0||(v[k] as number)>1e6))throw new Error('Invalid pricing rate');
   if(v.cacheWrite!==undefined&&(typeof v.cacheWrite!=='number'||!Number.isFinite(v.cacheWrite)||v.cacheWrite<0||v.cacheWrite>1e6))throw new Error('Invalid cache write rate');
   result[provider][model.toLowerCase()]={input:v.input as number,cached:v.cached as number,output:v.output as number,...(v.cacheWrite!==undefined?{cacheWrite:v.cacheWrite as number}:{})};
  }
 }
 return result;
}
export function getKnownPrices(){return structuredClone(defaultPrices)}

/** Claude CLI may return a provider-reported USD figure. This is not necessarily an invoice
 * when using a subscription or enterprise seat. */
export function parseClaudeReportedCost(raw:unknown):number|null {
 if(!raw||typeof raw!=='object')return null;
 const value=(raw as Record<string,unknown>).total_cost_usd;
 return typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
}
