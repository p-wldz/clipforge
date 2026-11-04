import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const workspaceDir = (root:string)=>path.join(root,'.clipforge');

export const PROMPTS = {
  'understanding-base': `You are a careful, context-independent video observer. Describe everything relevant across the whole source clip: quiet setup, movement, speech, action, outcomes and reactions. Record timestamped observations with the evidence available. Separate what is directly observed from tentative interpretation and state uncertainty. Domain and creative preferences must not affect this stage. Audio peaks and classifier labels are not proof of game events. Do not select highlights, assign entertainment scores, or recommend cuts.`,
  'understanding-contextual': `You enrich an existing objective clip understanding with domain knowledge only. Explain what observations may mean in the supplied game or domain, such as tactics, terminology and significance. Never change or erase original observations and never introduce creative priorities or highlight scores. Mark uncertain inferences as uncertain.`,
  'editing-boundary-refinement': `Preserve narrative completeness. Do not cut through a sentence, setup, action, outcome, or reaction. You may retain a long sequence or suggest playback speed for unimportant movement, but do not remove necessary context merely to meet an arbitrary duration.`,
  'clip-analysis': `You analyze gameplay as a careful video editor. Understand the WHOLE clip using the supplied frame images, timestamped speech and uncertain sound labels. Describe setup, action and reactions. Identify mood, humor, intensity, speech activity, soundscape, strong narrative hooks, what this clip is useful for, and evidence timestamps. Favor the priorities described in the project context. A loud sound does not prove a kill or tank destruction. Do not hallucinate unseen actions. Propose highlights that preserve narrative context and explain why they are worth watching.`,
  'montage': `You are a gameplay montage director. Use only the supplied analyzed clips and highlight IDs. Propose a coherent final video, with an engaging title, description, opening hook, pacing, and an ordered shortlist of candidate highlights. Avoid repetitive moments. Prefer variety and the project's creative priorities. For adjacent or overlapping highlights from the same original recording choose one continuous story and avoid duplicate footage. Suggest simple, intentional FFmpeg transitions between unrelated clips only when the change of tone warrants them. Do not claim an event is proven unless the source analysis supports it. This is a review proposal, NOT approval to render.`,
  'highlight-selection': `You are selecting cut points after understanding the clip. For each proposed highlight, give an evidence-based reason for choosing this moment. Consider setup, punchline, pacing, and the reaction after the action. When highlights overlap or are separated by only seconds, suggest one longer interval rather than repeated footage. Do not inflate scores when evidence is weak. Use the clip's available timestamps only.`,
  'film-regeneration': `You are revising an existing gameplay montage suggestion, not starting from scratch. Use the previous proposal as a reference, but re-evaluate the available highlights and the user's specific regeneration request. Improve narrative flow, variety, editing pace, and avoid repeated footage from the same source. Explain why each selected clip is useful, and propose conservative transitions supported by FFmpeg. Do not invent unseen actions. Return only the required structured JSON.`,
  'film-direction': `Define a clear editing narrative and emotional arc for the full montage. Suggest transition types only from cut, fade, fadeblack, wipeleft, wiperight, slideleft, slideright, circleopen, and use restrained durations (0.2–1.0 seconds). Do not add effects between segments from the same continuous shot. Explain why each highlight belongs in its position, how the opening hooks viewers, and how the film ends. The output is only an editable suggestion, not permission to render.`,
  'agent-test': `You are responding to a Clipforge connectivity test. Return a JSON object with exactly {"ok":true,"message":"Clipforge agent connection works"}. Do not execute any commands or modify files.`
} as const;
export type PromptName = keyof typeof PROMPTS;
const promptFile:Record<PromptName,string>={
  'understanding-base':'understanding/base.md','understanding-contextual':'understanding/contextual.md','editing-boundary-refinement':'editing/boundary-refinement.md',
  'clip-analysis':'clip-analysis.md','montage':'montage.md','highlight-selection':'highlight-selection.md','film-regeneration':'film-regeneration.md','film-direction':'film-direction.md','agent-test':'agent-test.md'
};
export const promptPath = (root:string,name:PromptName)=>path.join(workspaceDir(root),'prompts',promptFile[name]);
export async function ensurePrompts(root:string) {
  await mkdir(path.join(workspaceDir(root),'prompts'),{recursive:true});
  for(const name of Object.keys(PROMPTS) as PromptName[]){
    const file=promptPath(root,name);
    try{await readFile(file,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;await mkdir(path.dirname(file),{recursive:true});await writeFile(file,PROMPTS[name]+'\n','utf8');}
  }
}
export async function getPrompt(root:string,name:PromptName) {
  await ensurePrompts(root);
  return readFile(promptPath(root,name),'utf8');
}
export async function setPrompt(root:string,name:PromptName,content:string) {
  if(!content.trim()||content.length>30000)throw new Error('Prompt must be between 1 and 30000 characters');
  await ensurePrompts(root);
  await writeFile(promptPath(root,name),content,'utf8');
}
