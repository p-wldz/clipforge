import { DatabaseSync } from 'node:sqlite';
import { dbPath } from './paths.js';
import { validTransition, type Transition } from '../pipeline/edit-plan.js';
export type Status = 'pending_review' | 'approved' | 'rejected';
export type Clip = { id: string; source_path: string; duration: number; width: number; height: number; analyzed_at: string; transcript: string | null };
export type Highlight = { id: string; clip_id: string; start: number; end: number; title: string; description: string; score: number; status: Status; origin: string; created_at: string };
export class Store {
  private db: DatabaseSync;
  constructor(root: string) {
    this.db = new DatabaseSync(dbPath(root));
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS clips(id TEXT PRIMARY KEY,source_path TEXT NOT NULL,duration REAL NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,analyzed_at TEXT NOT NULL,transcript TEXT);
      CREATE TABLE IF NOT EXISTS highlights(id TEXT PRIMARY KEY,clip_id TEXT NOT NULL REFERENCES clips(id),start REAL NOT NULL,end REAL NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,score INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending_review','approved','rejected')),origin TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_highlights_clip ON highlights(clip_id);
      CREATE TABLE IF NOT EXISTS clip_scans(id TEXT PRIMARY KEY,source_path TEXT NOT NULL,duration REAL,has_audio INTEGER,decision TEXT NOT NULL,reason TEXT,scanned_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS transcript_segments(id INTEGER PRIMARY KEY AUTOINCREMENT,clip_id TEXT NOT NULL REFERENCES clips(id),start REAL NOT NULL,end REAL NOT NULL,text TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_segments_clip_start ON transcript_segments(clip_id,start);
      CREATE TABLE IF NOT EXISTS analysis_runs(id TEXT PRIMARY KEY,started_at TEXT NOT NULL,finished_at TEXT,status TEXT NOT NULL,provider TEXT,source_count INTEGER NOT NULL,processed_count INTEGER NOT NULL DEFAULT 0,current_file TEXT,current_stage TEXT,error TEXT);
      CREATE TABLE IF NOT EXISTS analysis_events(id INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,at TEXT NOT NULL,level TEXT NOT NULL,stage TEXT NOT NULL,clip_id TEXT,message TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_analysis_events_run ON analysis_events(run_id,id);
      CREATE TABLE IF NOT EXISTS clip_analyses(clip_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,provider TEXT NOT NULL,status TEXT NOT NULL,title TEXT,summary TEXT,story_json TEXT,tags_json TEXT,trace_path TEXT,error TEXT,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS project_items(project_id TEXT NOT NULL,highlight_id TEXT NOT NULL,position INTEGER NOT NULL,PRIMARY KEY(project_id,highlight_id));
      CREATE TABLE IF NOT EXISTS project_proposals(project_id TEXT PRIMARY KEY,proposal_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_usage(id INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT,clip_id TEXT,stage TEXT NOT NULL,provider TEXT NOT NULL,model TEXT,at TEXT NOT NULL,input_tokens INTEGER,cached_input_tokens INTEGER,output_tokens INTEGER,api_equivalent_usd REAL,cost_status TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_ai_usage_run ON ai_usage(run_id);
      CREATE TABLE IF NOT EXISTS stage_artifacts(clip_id TEXT NOT NULL,stage TEXT NOT NULL,cache_key TEXT NOT NULL,provider TEXT NOT NULL,model TEXT,status TEXT NOT NULL,artifact_path TEXT,payload_json TEXT,error TEXT,created_at TEXT NOT NULL,PRIMARY KEY(clip_id,stage,cache_key));
      CREATE TABLE IF NOT EXISTS highlight_sets(context_key TEXT NOT NULL,cache_key TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(context_key,cache_key));
      CREATE TABLE IF NOT EXISTS highlight_set_items(context_key TEXT NOT NULL,cache_key TEXT NOT NULL,highlight_id TEXT NOT NULL REFERENCES highlights(id),PRIMARY KEY(context_key,cache_key,highlight_id));`);
    const usageColumns=this.db.prepare('PRAGMA table_info(ai_usage)').all() as Array<{name:string}>;
    if(!usageColumns.some(c=>c.name==='cache_write_tokens'))this.db.exec('ALTER TABLE ai_usage ADD COLUMN cache_write_tokens INTEGER');
    if(!usageColumns.some(c=>c.name==='image_count'))this.db.exec('ALTER TABLE ai_usage ADD COLUMN image_count INTEGER');
    if(!usageColumns.some(c=>c.name==='provider_reported_usd'))this.db.exec('ALTER TABLE ai_usage ADD COLUMN provider_reported_usd REAL');
    const runColumns=this.db.prepare('PRAGMA table_info(analysis_runs)').all() as Array<{name:string}>;
    if(!runColumns.some(c=>c.name==='warning_count'))this.db.exec('ALTER TABLE analysis_runs ADD COLUMN warning_count INTEGER NOT NULL DEFAULT 0');
    if(!runColumns.some(c=>c.name==='failed_files'))this.db.exec('ALTER TABLE analysis_runs ADD COLUMN failed_files INTEGER NOT NULL DEFAULT 0');
    const analysisColumns=this.db.prepare('PRAGMA table_info(clip_analyses)').all() as Array<{name:string}>;
    if(!analysisColumns.some(x=>x.name==='analysis_json'))this.db.exec('ALTER TABLE clip_analyses ADD COLUMN analysis_json TEXT');
    this.db.exec(`CREATE TABLE IF NOT EXISTS run_balance_snapshots(run_id TEXT NOT NULL,provider TEXT NOT NULL,phase TEXT NOT NULL,observed_at TEXT NOT NULL,currency TEXT NOT NULL,total_balance REAL NOT NULL,PRIMARY KEY(run_id,provider,phase,currency))`);
  }
  close() { this.db.close(); }
  private ensureEditorSchema(){
    const columns=this.db.prepare('PRAGMA table_info(project_items)').all() as Array<{name:string}>;
    if(!columns.some(x=>x.name==='start_override'))this.db.exec('ALTER TABLE project_items ADD COLUMN start_override REAL');
    if(!columns.some(x=>x.name==='end_override'))this.db.exec('ALTER TABLE project_items ADD COLUMN end_override REAL');
    if(!columns.some(x=>x.name==='speed'))this.db.exec('ALTER TABLE project_items ADD COLUMN speed REAL NOT NULL DEFAULT 1');
    if(!columns.some(x=>x.name==='transition'))this.db.exec("ALTER TABLE project_items ADD COLUMN transition TEXT NOT NULL DEFAULT 'cut'");
    if(!columns.some(x=>x.name==='transition_duration'))this.db.exec('ALTER TABLE project_items ADD COLUMN transition_duration REAL NOT NULL DEFAULT 0.5');
    this.db.exec(`CREATE TABLE IF NOT EXISTS project_editor_metadata(project_id TEXT PRIMARY KEY,description TEXT NOT NULL DEFAULT '',origin TEXT NOT NULL DEFAULT 'manual',updated_at TEXT NOT NULL)`);
  }
  /** Editable montage uses references to source highlights, never alters the originals. */
  createEditorProject(id:string,name:string,highlightIds:string[],description='',origin='manual'){
    this.ensureEditorSchema();
    if(!name.trim()||name.length>180)throw new Error('Invalid montage title');
    if(!highlightIds.length||highlightIds.length>100||new Set(highlightIds).size!==highlightIds.length)throw new Error('Choose 1-100 unique highlights');
    if(highlightIds.some(h=>!this.highlight(h)))throw new Error('Unknown highlight in montage');
    this.db.exec('BEGIN');
    try{
      this.createProject(id,name.trim(),highlightIds);
      this.db.prepare('INSERT INTO project_editor_metadata VALUES(?,?,?,?)').run(id,description.slice(0,4000),origin,new Date().toISOString());
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  /** Delete an editable montage and its references, never the original clips or highlights. */
  deleteEditorProject(id:string){
    this.ensureEditorSchema();
    if(!this.project(id))return false;
    this.db.exec('BEGIN');
    try{
      this.db.prepare('DELETE FROM project_items WHERE project_id=?').run(id);
      this.db.prepare('DELETE FROM project_proposals WHERE project_id=?').run(id);
      this.db.prepare('DELETE FROM project_editor_metadata WHERE project_id=?').run(id);
      this.db.prepare('DELETE FROM projects WHERE id=?').run(id);
      this.db.exec('COMMIT');
      return true;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  editorProject(id:string){
    this.ensureEditorSchema();
    const project=this.project(id);if(!project)return null;
    const metadata=this.db.prepare('SELECT * FROM project_editor_metadata WHERE project_id=?').get(id) as {description:string;origin:string}|undefined;
    return {...project,description:metadata?.description??'',origin:metadata?.origin??(this.projectProposal(id)?'ai-suggestion':'legacy'),items:this.projectItems(id)};
  }
  updateEditorProject(id:string,input:{name:string;description:string;items:Array<{highlightId:string;start:number;end:number;speed?:number;transition?:Transition;transitionDuration?:number}>}){
    this.ensureEditorSchema();
    if(!this.project(id))throw new Error('Unknown montage project');
    if(typeof input.name!=='string'||!input.name.trim()||input.name.length>180||typeof input.description!=='string'||input.description.length>4000)throw new Error('Invalid montage metadata');
    if(!Array.isArray(input.items)||!input.items.length||input.items.length>100||new Set(input.items.map(i=>i.highlightId)).size!==input.items.length)throw new Error('Montage needs 1-100 unique items');
    for(const item of input.items){
      const h=this.highlight(item.highlightId);if(!h)throw new Error('Unknown highlight');
      const clip=this.clip(h.clip_id);
      if(!clip||!Number.isFinite(item.start)||!Number.isFinite(item.end)||item.start<0||item.end<=item.start||item.end>clip.duration+0.05||!Number.isFinite(item.speed??1)||(item.speed??1)<0.25||(item.speed??1)>4)throw new Error('Invalid cut timestamps for '+h.title);
      if(item.transition!==undefined&&!validTransition(item.transition))throw new Error('Unsupported transition');
      if(item.transitionDuration!==undefined&&(!Number.isFinite(item.transitionDuration)||item.transitionDuration<0.1||item.transitionDuration>1.5))throw new Error('Transition duration must be 0.1–1.5 seconds');
    }
    this.db.exec('BEGIN');
    try{
      this.db.prepare('UPDATE projects SET name=? WHERE id=?').run(input.name.trim(),id);
      this.db.prepare('DELETE FROM project_items WHERE project_id=?').run(id);
      const insert=this.db.prepare('INSERT INTO project_items(project_id,highlight_id,position,start_override,end_override,speed,transition,transition_duration) VALUES(?,?,?,?,?,?,?,?)');
      input.items.forEach((h,i)=>insert.run(id,h.highlightId,i,h.start,h.end,h.speed??1,i===0?'cut':h.transition??'cut',h.transitionDuration??0.5));
      this.db.prepare(`INSERT INTO project_editor_metadata VALUES(?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET description=excluded.description,updated_at=excluded.updated_at`).run(id,input.description,'manual',new Date().toISOString());
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
    return this.editorProject(id);
  }

  saveAiUsage(data:{runId?:string|null;clipId?:string|null;stage:string;provider:string;model?:string|null;usage?:{inputTokens:number;cachedInputTokens:number;outputTokens:number;cacheWriteInputTokens?:number}|null;imageCount?:number|null;apiEquivalentUsd?:number|null;providerReportedUsd?:number|null;costStatus:string}){this.db.prepare('INSERT INTO ai_usage(run_id,clip_id,stage,provider,model,at,input_tokens,cached_input_tokens,output_tokens,api_equivalent_usd,cost_status,cache_write_tokens,image_count,provider_reported_usd) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(data.runId??null,data.clipId??null,data.stage,data.provider,data.model??null,new Date().toISOString(),data.usage?.inputTokens??null,data.usage?.cachedInputTokens??null,data.usage?.outputTokens??null,data.apiEquivalentUsd??null,data.costStatus,data.usage?.cacheWriteInputTokens??null,data.imageCount??null,data.providerReportedUsd??null);}
  aiUsage(runId?:string){return runId?this.db.prepare('SELECT * FROM ai_usage WHERE run_id=? ORDER BY id').all(runId):this.db.prepare('SELECT * FROM ai_usage ORDER BY id DESC LIMIT 500').all();}
  aiUsageSummary(runId?:string){const rows=this.aiUsage(runId) as Array<{input_tokens:number|null;cached_input_tokens:number|null;output_tokens:number|null;cache_write_tokens:number|null;image_count:number|null;api_equivalent_usd:number|null;provider_reported_usd:number|null}>;return {calls:rows.length,measuredCalls:rows.filter(x=>x.input_tokens!==null).length,pricedCalls:rows.filter(x=>x.api_equivalent_usd!==null).length,inputTokens:rows.reduce((a,x)=>a+(x.input_tokens??0),0),cachedInputTokens:rows.reduce((a,x)=>a+(x.cached_input_tokens??0),0),outputTokens:rows.reduce((a,x)=>a+(x.output_tokens??0),0),cacheWriteTokens:rows.reduce((a,x)=>a+(x.cache_write_tokens??0),0),imagesSent:rows.reduce((a,x)=>a+(x.image_count??0),0),apiEquivalentUsd:rows.reduce((a,x)=>a+(x.api_equivalent_usd??0),0),providerReportedCalls:rows.filter(x=>x.provider_reported_usd!==null).length,providerReportedUsd:rows.reduce((a,x)=>a+(x.provider_reported_usd??0),0),complete:rows.every(x=>x.api_equivalent_usd!==null)};}
  startRun(id:string,provider:string,total:number){this.db.prepare('INSERT INTO analysis_runs(id,started_at,status,provider,source_count,current_stage) VALUES(?,?,?,?,?,?)').run(id,new Date().toISOString(),'running',provider,total,'starting');}
  progressRun(id:string,stage:string,file:string|null,processed?:number){if(processed===undefined)this.db.prepare('UPDATE analysis_runs SET current_stage=?,current_file=? WHERE id=?').run(stage,file,id);else this.db.prepare('UPDATE analysis_runs SET current_stage=?,current_file=?,processed_count=? WHERE id=?').run(stage,file,processed,id);}
  finishRun(id:string,status:'completed'|'completed_with_warnings'|'failed',error?:string){this.db.prepare('UPDATE analysis_runs SET finished_at=?,status=?,current_stage=?,error=? WHERE id=?').run(new Date().toISOString(),status,status,error??null,id);}
  addEvent(runId:string,stage:string,message:string,clipId:string|null=null,level='info'){this.db.prepare('INSERT INTO analysis_events(run_id,at,level,stage,clip_id,message) VALUES(?,?,?,?,?,?)').run(runId,new Date().toISOString(),level,stage,clipId,message.slice(0,3000));if(level==='warn'||level==='error')this.db.prepare('UPDATE analysis_runs SET warning_count=warning_count+1 WHERE id=?').run(runId);}
  runs(){return this.db.prepare('SELECT * FROM analysis_runs ORDER BY started_at DESC LIMIT 30').all();}
  events(runId:string,after=0){return this.db.prepare('SELECT * FROM analysis_events WHERE run_id=? AND id>? ORDER BY id LIMIT 500').all(runId,after);}
  saveClipAnalysis(clipId:string,runId:string,provider:string,status:'success'|'failed'|'skipped',analysis:{title:string;summary:string;story:unknown;tags:unknown;editorial?:unknown}|null,tracePath:string|null,error:string|null){this.db.prepare(`INSERT INTO clip_analyses(clip_id,run_id,provider,status,title,summary,story_json,tags_json,trace_path,error,updated_at,analysis_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(clip_id) DO UPDATE SET run_id=excluded.run_id,provider=excluded.provider,status=excluded.status,title=excluded.title,summary=excluded.summary,story_json=excluded.story_json,tags_json=excluded.tags_json,trace_path=excluded.trace_path,error=excluded.error,updated_at=excluded.updated_at,analysis_json=excluded.analysis_json`).run(clipId,runId,provider,status,analysis?.title??null,analysis?.summary??null,analysis?JSON.stringify(analysis.story):null,analysis?JSON.stringify(analysis.tags):null,tracePath,error,new Date().toISOString(),analysis?JSON.stringify(analysis):null);}
  clipAnalysis(clipId:string){return this.db.prepare('SELECT * FROM clip_analyses WHERE clip_id=?').get(clipId);}
  clipAnalyses(){return this.db.prepare('SELECT * FROM clip_analyses ORDER BY updated_at DESC').all();}
  stageArtifact(clipId:string,stage:string,cacheKey:string){return this.db.prepare('SELECT * FROM stage_artifacts WHERE clip_id=? AND stage=? AND cache_key=?').get(clipId,stage,cacheKey) as {status:string;payload_json:string;artifact_path:string|null}|undefined;}
  stageArtifacts(clipId:string){return this.db.prepare('SELECT * FROM stage_artifacts WHERE clip_id=? ORDER BY created_at DESC').all(clipId);}
  saveStageArtifact(clipId:string,stage:string,cacheKey:string,provider:string,model:string|undefined,status:'success'|'failed',artifactPath:string|null,payload:unknown,error:string|null){this.db.prepare('INSERT INTO stage_artifacts(clip_id,stage,cache_key,provider,model,status,artifact_path,payload_json,error,created_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(clip_id,stage,cache_key) DO UPDATE SET status=excluded.status,artifact_path=excluded.artifact_path,payload_json=excluded.payload_json,error=excluded.error,created_at=excluded.created_at').run(clipId,stage,cacheKey,provider,model??null,status,artifactPath,payload?JSON.stringify(payload):null,error,new Date().toISOString());}
  saveHighlightSet(contextKey:string,cacheKey:string,highlights:Highlight[]){this.db.exec('BEGIN');try{this.db.prepare('INSERT INTO highlight_sets(context_key,cache_key,created_at) VALUES(?,?,?) ON CONFLICT(context_key,cache_key) DO NOTHING').run(contextKey,cacheKey,new Date().toISOString());const insert=this.db.prepare('INSERT OR IGNORE INTO highlight_set_items(context_key,cache_key,highlight_id) VALUES(?,?,?)');for(const h of highlights){this.upsertHighlight(h);insert.run(contextKey,cacheKey,h.id);}this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}}
  highlightSets(){return this.db.prepare('SELECT s.context_key,s.cache_key,s.created_at,count(i.highlight_id) AS count FROM highlight_sets s LEFT JOIN highlight_set_items i USING(context_key,cache_key) GROUP BY s.context_key,s.cache_key ORDER BY s.created_at DESC').all();}
  highlightsForSet(contextKey:string,cacheKey:string){return this.db.prepare('SELECT h.* FROM highlight_set_items i JOIN highlights h ON h.id=i.highlight_id WHERE i.context_key=? AND i.cache_key=? ORDER BY h.score DESC').all(contextKey,cacheKey) as Highlight[];}

  upsertClip(clip: Clip) {
    this.db.prepare(`INSERT INTO clips VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_path=excluded.source_path,duration=excluded.duration,width=excluded.width,height=excluded.height,analyzed_at=excluded.analyzed_at,transcript=excluded.transcript`).run(clip.id,clip.source_path,clip.duration,clip.width,clip.height,clip.analyzed_at,clip.transcript);
  }
  saveScan(id:string,sourcePath:string,duration:number|null,hasAudio:boolean|null,decision:'analyze'|'skip'|'error',reason:string|null) {
    this.db.prepare(`INSERT INTO clip_scans VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET duration=excluded.duration,has_audio=excluded.has_audio,decision=excluded.decision,reason=excluded.reason,scanned_at=excluded.scanned_at`).run(id,sourcePath,duration,hasAudio===null?null:hasAudio?1:0,decision,reason,new Date().toISOString());
  }
  skipped(){return this.db.prepare("SELECT * FROM clip_scans WHERE decision IN ('skip','error') ORDER BY scanned_at DESC").all();}
  recordFileFailure(runId:string,id:string,file:string,error:string){this.saveScan(id,file,null,null,'error',error.slice(0,2500));this.db.prepare('UPDATE analysis_runs SET failed_files=failed_files+1 WHERE id=?').run(runId);}
  runSummary(id:string){return this.db.prepare('SELECT warning_count,failed_files FROM analysis_runs WHERE id=?').get(id) as {warning_count:number;failed_files:number}|undefined;}
  saveBalanceSnapshot(runId:string,provider:string,phase:'before'|'after',balances:Array<{currency:string;totalBalance:number}>){const sql=this.db.prepare('INSERT INTO run_balance_snapshots(run_id,provider,phase,observed_at,currency,total_balance) VALUES(?,?,?,?,?,?) ON CONFLICT(run_id,provider,phase,currency) DO UPDATE SET observed_at=excluded.observed_at,total_balance=excluded.total_balance');for(const row of balances)sql.run(runId,provider,phase,new Date().toISOString(),row.currency,row.totalBalance);}
  billingSnapshots(runId:string){return this.db.prepare('SELECT provider,currency,phase,total_balance,observed_at FROM run_balance_snapshots WHERE run_id=? ORDER BY provider,currency,phase').all(runId);}
  balanceChanges(runId:string){const rows=this.billingSnapshots(runId) as Array<{provider:string;currency:string;phase:string;total_balance:number}>;return rows.filter(x=>x.phase==='before').flatMap(a=>{const b=rows.find(x=>x.provider===a.provider&&x.currency===a.currency&&x.phase==='after');return b?[{provider:a.provider,currency:a.currency,openingBalance:a.total_balance,closingBalance:b.total_balance,change:a.total_balance-b.total_balance,scope:'account-wide balance change; not a per-run invoice'}]:[];});}
  saveTranscriptSegments(clipId:string,segments:Array<{start:number;end:number;text:string}>) {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM transcript_segments WHERE clip_id=?').run(clipId);
      const insert=this.db.prepare('INSERT INTO transcript_segments(clip_id,start,end,text) VALUES(?,?,?,?)');
      for(const s of segments)insert.run(clipId,s.start,s.end,s.text);
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  searchTranscripts(query:string){
    if(!query.trim())return [];
    return this.db.prepare(`SELECT s.clip_id,c.source_path,s.start,s.end,s.text FROM transcript_segments s JOIN clips c ON c.id=s.clip_id WHERE instr(lower(s.text),lower(?))>0 ORDER BY c.source_path,s.start LIMIT 200`).all(query.trim()) as Array<{clip_id:string;source_path:string;start:number;end:number;text:string}>;
  }
  setTranscript(clipId:string, transcript:string) { this.db.prepare('UPDATE clips SET transcript=? WHERE id=?').run(transcript,clipId); }
  clip(id:string) { return this.db.prepare('SELECT * FROM clips WHERE id=?').get(id) as Clip|undefined; }
  clips() { return this.db.prepare('SELECT * FROM clips ORDER BY analyzed_at DESC').all() as Clip[]; }
  clearPendingHighlights(clipId:string){this.db.prepare("DELETE FROM highlights WHERE clip_id=? AND status='pending_review'").run(clipId);}
  upsertHighlight(h:Highlight) {
    this.db.prepare(`INSERT INTO highlights VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET start=excluded.start,end=excluded.end,title=excluded.title,description=excluded.description,score=excluded.score,origin=excluded.origin`).run(h.id,h.clip_id,h.start,h.end,h.title,h.description,h.score,h.status,h.origin,h.created_at);
  }
  highlights(status?:Status) {return (status ? this.db.prepare('SELECT * FROM highlights WHERE status=? ORDER BY score DESC').all(status) : this.db.prepare('SELECT * FROM highlights ORDER BY score DESC').all()) as Highlight[];}
  highlight(id:string) {return this.db.prepare('SELECT * FROM highlights WHERE id=?').get(id) as Highlight|undefined;}
  updateHighlight(id:string, data:Partial<Pick<Highlight,'start'|'end'|'title'|'description'|'status'>>) {
    const old=this.highlight(id); if (!old) throw new Error('Highlight not found');
    const next={...old,...data};
    if(next.start<0||next.end<=next.start) throw new Error('Invalid time range');
    const clip=this.clip(old.clip_id); if(!clip || next.end>clip.duration+0.05) throw new Error('End exceeds clip duration');
    if(!['pending_review','approved','rejected'].includes(next.status)) throw new Error('Invalid status');
    this.db.prepare('UPDATE highlights SET start=?,end=?,title=?,description=?,status=? WHERE id=?').run(next.start,next.end,next.title,next.description,next.status,id);
    return this.highlight(id)!;
  }
  createProject(id:string,name:string,highlightIds:string[]) {
    this.db.prepare('INSERT INTO projects VALUES(?,?,?)').run(id,name,new Date().toISOString());
    const insert=this.db.prepare('INSERT INTO project_items(project_id,highlight_id,position) VALUES(?,?,?)');
    highlightIds.forEach((h,i)=>insert.run(id,h,i));
  }
  /** Create an explicit montage from AI-suggested, user-reviewed choices.
   * Do not mutate highlight review statuses; suggestions are selections, not approvals.
   * The renderer accepts this specific project because it was explicitly requested.
   */
  createSuggestedProject(id:string,name:string,highlightIds:string[],proposal:unknown) {
    if(!name.trim()||name.length>180)throw new Error('Invalid film title');
    if(!highlightIds.length||highlightIds.length>100||new Set(highlightIds).size!==highlightIds.length)throw new Error('Select 1-100 unique highlights');
    const selected=highlightIds.map(h=>this.highlight(h));
    if(selected.some(h=>!h||h.status==='rejected'))throw new Error('Film contains a missing or rejected highlight');
    this.db.exec('BEGIN');
    try {
      this.db.prepare('INSERT INTO projects VALUES(?,?,?)').run(id,name,new Date().toISOString());
      const insert=this.db.prepare('INSERT INTO project_items(project_id,highlight_id,position) VALUES(?,?,?)');
      highlightIds.forEach((h,i)=>insert.run(id,h,i));
      this.db.prepare('INSERT INTO project_proposals(project_id,proposal_json) VALUES(?,?)').run(id,JSON.stringify(proposal));
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  project(id:string){return this.db.prepare('SELECT * FROM projects WHERE id=?').get(id) as {id:string;name:string;created_at:string}|undefined;}
  projectProposal(id:string){return this.db.prepare('SELECT proposal_json FROM project_proposals WHERE project_id=?').get(id) as {proposal_json:string}|undefined;}
  projects() {return this.db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();}
  projectItems(projectId:string) {this.ensureEditorSchema();return this.db.prepare(`SELECT h.id,h.clip_id,COALESCE(pi.start_override,h.start) AS start,COALESCE(pi.end_override,h.end) AS end,pi.speed AS speed,pi.transition AS transition,pi.transition_duration AS transitionDuration,h.title,h.description,h.score,h.status,h.origin,h.created_at,c.source_path FROM project_items pi JOIN highlights h ON h.id=pi.highlight_id JOIN clips c ON c.id=h.clip_id WHERE pi.project_id=? ORDER BY pi.position`).all(projectId) as (Highlight&{source_path:string;speed:number;transition:Transition;transitionDuration:number})[];}
}
