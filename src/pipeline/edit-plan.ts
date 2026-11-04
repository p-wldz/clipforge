/** Deterministic, auditable timeline normalization. Never changes source highlights. */
export const TRANSITIONS = ['cut','fade','fadeblack','wipeleft','wiperight','slideleft','slideright','circleopen'] as const;
export type Transition = typeof TRANSITIONS[number];
export type EditSegment = {
  id:string; clip_id:string; source_path:string; start:number;end:number;speed:number;
  transition?:Transition;transitionDuration?:number;sourceHighlightIds?:string[];
};
export function validTransition(v:unknown): v is Transition {
  return typeof v==='string' && (TRANSITIONS as readonly string[]).includes(v);
}
export function normalizeEditPlan<T extends EditSegment>(items: T[], maxGap=1.5):EditSegment[] {
  if(!Number.isFinite(maxGap)||maxGap<0||maxGap>10)throw new Error('Invalid maximum merge gap');
  const plan:EditSegment[]=[];
  for(const current of items){
    const item:EditSegment={...current,transition:validTransition(current.transition)?current.transition:'cut',transitionDuration:current.transitionDuration??0.5,sourceHighlightIds:[...(current.sourceHighlightIds??[current.id])]};
    if(!Number.isFinite(item.start)||!Number.isFinite(item.end)||item.end<=item.start||!Number.isFinite(item.speed)||item.speed<0.25||item.speed>4)throw new Error('Invalid clip time or speed');
    const last=plan.at(-1);
    // Only adjacent selections from the same file, moving forward in time,
    // and at the same playback rate can be joined without losing editorial intent.
    if(last && last.clip_id===item.clip_id && last.source_path===item.source_path && last.speed===item.speed &&
       item.start>=last.start && item.start<=last.end+maxGap){
      last.end=Math.max(last.end,item.end);
      last.sourceHighlightIds!.push(...item.sourceHighlightIds!);
    }else {
      // A single continuous shot cannot have a transition into itself.
      if(!plan.length)item.transition='cut';
      plan.push(item);
    }
  }
  return plan;
}

/** The first item never has an incoming transition; subsequent transitions are applied at their start. */
export function transitionGraph(durations:number[],transitions:Array<{transition?:string;transitionDuration?:number}>):{filters:string;video:string;audio:string;duration:number}{
  if(!durations.length||durations.length!==transitions.length)throw new Error('Invalid transition graph');
  const filters:string[]=[];
  // Segments are pre-encoded at 30 fps, 48kHz stereo. FFmpeg concat may
  // emit 1/1000000 timebase, while xfade requires identical timebases.
  // Normalize to a fixed timebase before AND after each join. Avoid setpts:
  // it can strip the frame-rate metadata and make xfade reject CFR streams.
  durations.forEach((_,i)=>{
    filters.push(`[${i}:v]fps=30,settb=expr=1/15360,format=yuv420p[v${i}]`);
    filters.push(`[${i}:a]aresample=48000[a${i}]`);
  });
  let video='v0',audio='a0',running=durations[0]!;
  for(let i=1;i<durations.length;i++){
    const kind=validTransition(transitions[i]?.transition)?transitions[i]!.transition!:'cut';
    const requested=transitions[i]?.transitionDuration??0.5;
    const d=kind==='cut'?0:Math.min(Math.max(0.1,requested),1.5,running/3,durations[i]!/3);
    const nextVideo=`mixv${i}`,nextAudio=`mixa${i}`,rawVideo=`rawv${i}`;
    if(d>=0.1){
      const offset=Math.max(0,running-d);
      filters.push(`[${video}][v${i}]xfade=transition=${kind}:duration=${d.toFixed(3)}:offset=${offset.toFixed(3)}[${rawVideo}]`);
      filters.push(`[${audio}][a${i}]acrossfade=d=${d.toFixed(3)}[${nextAudio}]`);
      running+=durations[i]!-d;
    }else{
      filters.push(`[${video}][${audio}][v${i}][a${i}]concat=n=2:v=1:a=1[${rawVideo}][${nextAudio}]`);
      running+=durations[i]!;
    }
    filters.push(`[${rawVideo}]fps=30,settb=expr=1/15360[${nextVideo}]`);
    video=nextVideo;audio=nextAudio;
  }
  return {filters:filters.join(';'),video,audio,duration:running};
}
