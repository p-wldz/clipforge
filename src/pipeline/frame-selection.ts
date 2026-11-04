/** Cost-aware selection: timeline coverage plus samples near sound/speech events. */
export function selectFrames(frames:string[],duration:number,interval:number,limit:number,events:Array<{start:number;end?:number}>):string[]{
 if(frames.length<=limit)return frames;
 const candidates=new Set<number>();
 // Start and end preserve establishing shots and reactions.
 candidates.add(0);if(limit>1)candidates.add(frames.length-1);
 const safe=(t:number)=>Math.max(0,Math.min(frames.length-1,Math.floor(t/interval)));
 const scored=new Map<number,number>();
 for(const e of events){if(!Number.isFinite(e.start))continue;const i=safe(e.start);scored.set(i,(scored.get(i)??0)+1);}
 for(const [idx] of [...scored.entries()].sort((a,b)=>b[1]-a[1])){if(candidates.size>=limit)break;candidates.add(idx);}
 // Fill remaining slots across the largest unsampled time gap.
 while(candidates.size<limit){const selected=[...candidates].sort((a,b)=>a-b);let best=-1,dist=-1;
  for(let i=0;i<frames.length;i++){if(candidates.has(i))continue;const gap=Math.min(...selected.map(j=>Math.abs(j-i)));if(gap>dist){best=i;dist=gap;}}
  if(best<0)break;candidates.add(best);
 }
 return [...candidates].sort((a,b)=>a-b).map(i=>frames[i]!);
}
