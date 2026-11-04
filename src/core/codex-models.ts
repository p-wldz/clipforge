import { spawn } from 'node:child_process';

export type DiscoveredModel = {id:string;label:string;inputModalities:string[];isDefault?:boolean};
/** Codex app-server model/list reflects its current account/client catalog, but it is NOT an entitlement test.
 * Use the existing agent smoke test to verify whether a selected model can actually run.
 */
export async function codexModelCatalog(options:{command?:string;args?:string[];timeoutMs?:number}={}):Promise<DiscoveredModel[]> {
  const command=options.command??(process.platform==='win32'?'cmd.exe':'codex');
  const args=options.args??(process.platform==='win32'?['/d','/s','/c','codex app-server']:['app-server']);
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let done=false,pending='',stderr='',byteCount=0,cursor:string|null=null,pages=0;
    const models=new Map<string,DiscoveredModel>();
    const end=(error?:Error)=>{
      if(done)return;
      done=true;clearTimeout(timer);
      child.kill();
      if(error)reject(error);else resolve([...models.values()]);
    };
    const timer=setTimeout(()=>end(new Error('Codex model discovery timed out')),options.timeoutMs??10000);
    function send(message:object){try{child.stdin.write(JSON.stringify(message)+'\n');}catch(e){end(e as Error);}}
    child.on('error',e=>end(e));
    child.stderr.on('data',(chunk:Buffer)=>{stderr=(stderr+chunk.toString()).slice(-1000);});
    child.on('close',code=>{if(!done)end(new Error(`Codex app-server exited ${code}: ${stderr}`));});
    child.stdout.on('data',(chunk:Buffer)=>{
      byteCount+=chunk.length;if(byteCount>2_000_000)return end(new Error('Codex model catalog exceeds size limit'));
      pending+=chunk.toString();
      for(let pos;(pos=pending.indexOf('\n'))!==-1;){
        const line=pending.slice(0,pos).trim();pending=pending.slice(pos+1);if(!line)continue;
        let response:Record<string,any>;
        try{response=JSON.parse(line);}catch{continue;}
        if(response.id===1){
          if(response.error)return end(new Error(`Codex initialization: ${response.error.message||'unknown error'}`));
          send({method:'initialized'});
          send({method:'model/list',id:2,params:{limit:100,includeHidden:false}});
        }else if(response.id===2){
          if(response.error)return end(new Error(`Codex model/list: ${response.error.message||'unknown error'}`));
          const data=response.result?.data;
          if(!Array.isArray(data))return end(new Error('Codex model/list returned no data array'));
          for(const entry of data){
            const id=entry?.model||entry?.id;
            if(typeof id!=='string'||!id.trim()||entry.hidden)continue;
            models.set(id,{id,label:typeof entry.displayName==='string'?entry.displayName:id,inputModalities:Array.isArray(entry.inputModalities)?entry.inputModalities.filter((x:unknown)=>typeof x==='string'):['text','image'],isDefault:entry.isDefault===true});
          }
          cursor=response.result?.nextCursor??null;
          if(cursor&&++pages<4)send({method:'model/list',id:2,params:{limit:100,cursor,includeHidden:false}});
          else end();
        }
      }
    });
    send({id:1,method:'initialize',params:{clientInfo:{name:'clipforge',title:'Clipforge',version:'0.14.0'},capabilities:{}}});
  });
}
