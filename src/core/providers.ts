import { checkTool } from './process.js';
import type { AgentProvider } from './paths.js';
export async function detectAgents(){
  const checks = await Promise.all([checkTool('codex',['--version']),checkTool('claude',['--version']),checkTool('cursor',['--version'])]);
  return Object.fromEntries((['codex','claude','cursor'] as AgentProvider[]).map((name,i)=>[name,checks[i]]));
}
