import http from 'node:http';
import path from 'node:path';
import { readFile, stat, writeFile, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Store } from './core/db.js';
import {
  artifactDir,
  inside,
  newId,
  loadConfig,
  saveConfig,
  workspaceDir,
  rendersDir,
  type Config,
} from './core/paths.js';
import { render } from './pipeline/render.js';
import { getPrompt, setPrompt, type PromptName } from './agents/prompts.js';
import { latestFilmProposal, suggestFilm, updateFilmProposal } from './agents/montage.js';
import { smokeTestAgent } from './agents/smoke.js';
import { scanAiModels } from './core/ai-models.js';

import { analyze } from './pipeline/analyze.js';
import { contexts } from './pipeline/staged-ai.js';
import { validateCatalog } from './core/usage.js';
import { errorStatus, publicError } from './core/errors.js';
import { isAnalysisProvider } from './core/providers.js';
const dashboardRoot = fileURLToPath(new URL('./dashboard/', import.meta.url));
const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
};
async function jsonBody(req: http.IncomingMessage) {
  let buf = '';
  for await (const part of req) {
    buf += part.toString();
    if (buf.length > 1024 * 1024) throw new Error('Request body exceeds 1MB');
  }
  return (buf ? JSON.parse(buf) : {}) as Record<string, unknown>;
}
function send(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}
async function streamFile(res: http.ServerResponse, file: string) {
  const data = await readFile(file);
  res.writeHead(200, {
    'content-type': contentTypes[path.extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(data);
}
type RenderJob = {
  status: 'running' | 'completed' | 'failed';
  file?: string;
  error?: string;
};
type AnalysisJob = {
  status: string;
  error?: string;
  controller: AbortController;
  completion?: Promise<void>;
};
export type DashboardServer = http.Server & { abortAnalysis(): Promise<void> };
export function startServer(root: string, port: number, host = '127.0.0.1'): DashboardServer {
  const renderJobs = new Map<string, RenderJob>();
  let proposalJob: {
    status: 'running' | 'completed' | 'failed';
    error?: string;
  } | null = null;
  let analysisStarting = false;
  const activeAnalysisJobs = new Map<string, AnalysisJob>();
  const server = http.createServer(async (req, res) => {
    const db = new Store(root);
    try {
      const url = new URL(req.url ?? '/', `http://${host}:${port}`);
      const parts = url.pathname.split('/').filter(Boolean);
      if (url.pathname === '/api/ai/pricing' && req.method === 'GET') {
        const config = await loadConfig(root);
        return send(res, 200, config.pricing ?? {});
      }
      if (url.pathname === '/api/ai/pricing' && req.method === 'PUT') {
        const input = await jsonBody(req),
          config = await loadConfig(root);
        config.pricing = validateCatalog(input);
        await saveConfig(root, config);
        return send(res, 200, { saved: true });
      }
      if (url.pathname === '/api/ai/usage' && req.method === 'GET') {
        const runId = url.searchParams.get('runId') ?? undefined;
        return send(res, 200, {
          summary: db.aiUsageSummary(runId),
          calls: db.aiUsage(runId),
          note: 'Reported usage and estimated API-equivalent pricing; subscription billing cannot be inferred from these values.',
        });
      }
      if (url.pathname === '/api/ai/models' && req.method === 'GET')
        return send(res, 200, await scanAiModels(root));
      if (url.pathname === '/api/ai/stages' && req.method === 'PUT') {
        const input = await jsonBody(req);
        if (!input.clipAnalysis || !input.montage)
          throw new Error('Expected clipAnalysis and montage settings');
        const config = await loadConfig(root);
        const validate = (v: unknown) => {
          if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid stage');
          const stage = v as Record<string, unknown>;
          if (stage.provider !== 'none' && !isAnalysisProvider(stage.provider))
            throw new Error('Unsupported provider');
          if (
            stage.model !== undefined &&
            (typeof stage.model !== 'string' ||
              stage.model.length > 180 ||
              /[\r\n]/.test(stage.model))
          )
            throw new Error('Invalid model');
          return {
            provider: stage.provider as 'none' | 'codex' | 'claude' | 'deepseek' | 'openai',
            ...(stage.model ? { model: stage.model as string } : {}),
          };
        };
        const catalog = await scanAiModels(root);
        const stages = {
          clipAnalysis: validate(input.clipAnalysis),
          montage: validate(input.montage),
        };
        for (const [stageName, entry] of Object.entries(stages)) {
          if (entry.model && !catalog.providers[entry.provider]?.models.includes(entry.model))
            throw new Error(
              `${stageName}: model '${entry.model}' was not returned by the current ${entry.provider} catalog. Scan models again or use provider default.`,
            );
          if (entry.provider !== 'none' && !catalog.providers[entry.provider]?.usable)
            throw new Error(`${stageName}: provider ${entry.provider} is not available`);
        }
        // Preserve independent new-stage profiles when an older dashboard saves its two controls.
        config.aiStages = { ...config.aiStages, ...stages };
        await saveConfig(root, config);
        return send(res, 200, { saved: true, stages: config.aiStages });
      }
      if (url.pathname === '/api/analysis/start' && req.method === 'POST') {
        if (
          analysisStarting ||
          [...activeAnalysisJobs.values()].some((j) => j.status === 'running')
        )
          return send(res, 409, {
            error: 'Analysis already running in this dashboard',
          });
        // Also prevent starting another UI job while a CLI analysis is active.
        if (
          db
            .runs()
            .some(
              (r: any) =>
                r.status === 'running' && Date.now() - Date.parse(r.started_at) < 60 * 60 * 1000,
            )
        )
          return send(res, 409, {
            error: 'An analysis run is already active. Check Pipeline progress.',
          });
        const input = await jsonBody(req);
        const config = await loadConfig(root);
        const provider =
          input.provider ??
          config.aiStages?.understanding?.provider ??
          config.aiStages?.clipAnalysis?.provider ??
          config.agent.provider;
        if (provider !== 'none' && !isAnalysisProvider(provider))
          throw new Error('Unsupported analysis provider');
        if (typeof input.force !== 'boolean') throw new Error('force must be a boolean');
        const jobId = newId();
        analysisStarting = true;
        const controller = new AbortController();
        const job: AnalysisJob = { status: 'running', controller };
        activeAnalysisJobs.set(jobId, job);
        const inputDir = path.resolve(root, config.mediaDir);
        job.completion = analyze(
          root,
          inputDir,
          {
            withAgent: provider !== 'none',
            provider:
              provider === 'none' ? undefined : (provider as 'codex' | 'claude' | 'deepseek' | 'openai'),
            force: input.force,
            signal: controller.signal,
          },
          () => {},
        )
          .then(
            (result) => {
              Object.assign(job, {
                status: controller.signal.aborted
                  ? 'cancelled'
                  : result.warnings > 0
                    ? 'completed_with_warnings'
                    : 'completed',
                ...(result.warnings > 0
                  ? {
                      error: `${result.warnings} warnings; ${result.failedFiles} failed files`,
                    }
                  : {}),
              });
            },
            (error) => {
              Object.assign(job, {
                status: controller.signal.aborted ? 'cancelled' : 'failed',
                error: (error as Error).message,
              });
            },
          )
          .finally(() => {
            analysisStarting = false;
          });
        return send(res, 202, { jobId, status: 'running' });
      }
      if (
        parts[0] === 'api' &&
        parts[1] === 'analysis' &&
        parts[2] === 'jobs' &&
        parts[3] === 'active' &&
        parts[4] === 'cancel' &&
        req.method === 'POST'
      ) {
        const active = [...activeAnalysisJobs.entries()].find(
          ([, job]) => job.status === 'running',
        );
        if (!active)
          return send(res, 409, {
            error: 'No dashboard-owned analysis is active; stop the CLI process in its terminal.',
          });
        active[1].controller.abort();
        return send(res, 202, { jobId: active[0], status: 'cancelling' });
      }
      if (
        parts[0] === 'api' &&
        parts[1] === 'analysis' &&
        parts[2] === 'jobs' &&
        parts[3] === 'active' &&
        req.method === 'GET'
      ) {
        const active = [...activeAnalysisJobs.entries()].find(
          ([, job]) => job.status === 'running',
        );
        return send(
          res,
          200,
          active ? { jobId: active[0], status: active[1].status } : { status: 'idle' },
        );
      }
      if (
        parts[0] === 'api' &&
        parts[1] === 'analysis' &&
        parts[2] === 'jobs' &&
        parts[3] &&
        parts[4] === 'cancel' &&
        req.method === 'POST'
      ) {
        const job = activeAnalysisJobs.get(parts[3]);
        if (!job) return send(res, 404, { error: 'Analysis job not found' });
        if (job.status !== 'running')
          return send(res, 409, { error: 'Analysis job is not running' });
        job.controller.abort();
        return send(res, 202, { status: 'cancelling' });
      }
      if (
        parts[0] === 'api' &&
        parts[1] === 'analysis' &&
        parts[2] === 'runs' &&
        parts[3] &&
        parts[4] === 'cancel' &&
        req.method === 'POST'
      ) {
        const run = db.runs().find((entry: any) => entry.id === parts[3]) as
          | { id: string; status: string }
          | undefined;
        if (!run) return send(res, 404, { error: 'Analysis run not found' });
        if (run.status !== 'running')
          return send(res, 409, { error: 'Analysis run is not running' });
        db.finishRun(
          run.id,
          'cancelled',
          'Marked cancelled after its dashboard process was no longer available.',
        );
        return send(res, 200, { status: 'cancelled' });
      }
      if (
        parts[0] === 'api' &&
        parts[1] === 'analysis' &&
        parts[2] === 'jobs' &&
        parts[3] &&
        req.method === 'GET'
      )
        return send(res, 200, activeAnalysisJobs.get(parts[3]) ?? { status: 'unknown' });
      if (url.pathname === '/api/prompts' && req.method === 'GET') {
        const names: PromptName[] = [
          'deep-action-analysis',
          'contextual-editing',
          'critical-review',
          'understanding-base',
          'understanding-contextual',
          'editing-boundary-refinement',
          'clip-analysis',
          'highlight-selection',
          'montage',
          'film-direction',
          'film-regeneration',
          'agent-test',
        ];
        return send(
          res,
          200,
          Object.fromEntries(
            await Promise.all(names.map(async (name) => [name, await getPrompt(root, name)])),
          ),
        );
      }
      if (url.pathname === '/api/prompts' && req.method === 'PUT') {
        const input = await jsonBody(req);
        if (
          typeof input.name !== 'string' ||
          ![
            'deep-action-analysis',
            'contextual-editing',
            'critical-review',
            'understanding-base',
            'understanding-contextual',
            'editing-boundary-refinement',
            'clip-analysis',
            'highlight-selection',
            'montage',
            'film-direction',
            'film-regeneration',
            'agent-test',
          ].includes(input.name) ||
          typeof input.content !== 'string'
        )
          throw new Error('Invalid prompt name/content');
        await setPrompt(root, input.name as PromptName, input.content);
        return send(res, 200, { saved: true });
      }
      if (url.pathname === '/api/contexts' && req.method === 'GET') {
        const config = await loadConfig(root);
        const raw = await readFile(path.join(workspaceDir(root), 'contexts.json'), 'utf8')
          .then(JSON.parse)
          .catch(() => ({}));
        return send(res, 200, {
          domain: raw.domain ?? config.contexts?.domain ?? '',
          editing: raw.editing ?? config.contexts?.editing ?? config.project.focus,
          filmDirection:
            raw.filmDirection ?? config.contexts?.filmDirection ?? config.project.focus,
        });
      }
      if (url.pathname === '/api/contexts' && req.method === 'PUT') {
        const input = await jsonBody(req);
        const value = ['domain', 'editing', 'filmDirection'].reduce(
          (out, key) => {
            const v = input[key];
            if (typeof v !== 'string' || v.length > 30000)
              throw new Error(`Invalid ${key} context`);
            out[key] = v;
            return out;
          },
          {} as Record<string, string>,
        );
        await writeFile(
          path.join(workspaceDir(root), 'contexts.json'),
          JSON.stringify(value, null, 2) + '\n',
        );
        return send(res, 200, { saved: true, ...value });
      }
      if (url.pathname === '/api/montage/suggestion' && req.method === 'GET')
        return send(res, 200, await latestFilmProposal(root));
      if (url.pathname === '/api/montage/suggestion' && req.method === 'PATCH') {
        if (proposalJob?.status === 'running')
          return send(res, 409, { error: 'Suggestion generation is running' });
        const input = await jsonBody(req);
        if (typeof input.createdAt !== 'string' || !Array.isArray(input.sequence))
          throw new Error('Expected suggestion revision and transitions');
        return send(
          res,
          200,
          await updateFilmProposal(
            root,
            input.createdAt,
            input.sequence as Array<{
              highlightId: string;
              transition: string;
              transitionDuration: number;
            }>,
          ),
        );
      }
      if (url.pathname === '/api/montage/generate' && req.method === 'POST') {
        if (proposalJob?.status === 'running')
          return send(res, 409, { error: 'Movie suggestion already running' });
        const input = await jsonBody(req);
        if (
          input.guidance !== undefined &&
          (typeof input.guidance !== 'string' || input.guidance.length > 3000)
        )
          throw new Error('Invalid regeneration guidance');
        const config = await loadConfig(root);
        const provider =
          config.aiStages?.filmDirection?.provider ??
          config.aiStages?.montage?.provider ??
          config.agent.provider;
        if (!isAnalysisProvider(provider))
          throw new Error('Configure a Codex, Claude or DeepSeek movie suggestion provider first');
        const items = db.highlights().filter((h) => h.status !== 'rejected');
        if (!items.length) throw new Error('No highlight candidates. Analyze clips first.');
        const summaries = db.clipAnalyses().filter((r: any) => r.status === 'success');
        const context = (await contexts(root, config)).filmDirection;
        proposalJob = { status: 'running' };
        void suggestFilm(
          root,
          provider,
          config.aiStages?.filmDirection?.model ??
            config.aiStages?.montage?.model ??
            config.agent.model,
          context,
          items,
          summaries,
          undefined,
          undefined,
          typeof input.guidance === 'string' ? input.guidance : '',
        ).then(
          () => {
            proposalJob = { status: 'completed' };
          },
          (err) => {
            proposalJob = { status: 'failed', error: (err as Error).message };
          },
        );
        return send(res, 202, { status: 'running' });
      }
      if (url.pathname === '/api/montage/generate/status' && req.method === 'GET')
        return send(res, 200, proposalJob ?? { status: 'not_started' });

      if (url.pathname === '/api/editor/projects' && req.method === 'POST') {
        const input = await jsonBody(req);
        if (
          typeof input.name !== 'string' ||
          !Array.isArray(input.highlightIds) ||
          input.highlightIds.some((x) => typeof x !== 'string')
        )
          throw new Error('Expected name and highlightIds');
        const id = newId();
        db.createEditorProject(
          id,
          input.name,
          input.highlightIds,
          typeof input.description === 'string' ? input.description : '',
          input.origin === 'ai-suggestion' ? 'ai-suggestion' : 'manual',
        );
        return send(res, 201, db.editorProject(id));
      }
      if (
        parts[0] === 'api' &&
        parts[1] === 'editor' &&
        parts[2] === 'projects' &&
        parts[3] &&
        parts.length === 4
      ) {
        if (req.method === 'GET') {
          const project = db.editorProject(parts[3]);
          return project ? send(res, 200, project) : send(res, 404, { error: 'Project not found' });
        }
        if (req.method === 'DELETE') {
          if (renderJobs.get(parts[3])?.status === 'running')
            return send(res, 409, {
              error: 'Cannot remove a film while it is rendering',
            });
          if (!db.deleteEditorProject(parts[3])) return send(res, 404, { error: 'Film not found' });
          const generated = path.join(rendersDir(root), parts[3]);
          if (
            inside(rendersDir(root), generated) &&
            path.resolve(generated) !== path.resolve(rendersDir(root))
          )
            await rm(generated, { recursive: true, force: true });
          renderJobs.delete(parts[3]);
          return send(res, 200, {
            deleted: true,
            filmId: parts[3],
            sourcesPreserved: true,
          });
        }
        if (req.method === 'PUT') {
          const input = await jsonBody(req);
          if (
            typeof input.name !== 'string' ||
            typeof input.description !== 'string' ||
            !Array.isArray(input.items) ||
            input.items.some(
              (x) =>
                !x ||
                typeof x.highlightId !== 'string' ||
                typeof x.start !== 'number' ||
                typeof x.end !== 'number' ||
                (x.speed !== undefined && typeof x.speed !== 'number') ||
                (x.transition !== undefined && typeof x.transition !== 'string') ||
                (x.transitionDuration !== undefined && typeof x.transitionDuration !== 'number'),
            )
          )
            throw new Error('Invalid edit list');
          return send(
            res,
            200,
            db.updateEditorProject(
              parts[3],
              input as {
                name: string;
                description: string;
                items: Array<{
                  highlightId: string;
                  start: number;
                  end: number;
                  speed?: number;
                  transition?: import('./pipeline/edit-plan.js').Transition;
                  transitionDuration?: number;
                }>;
              },
            ),
          );
        }
      }
      if (
        parts[0] === 'api' &&
        parts[1] === 'editor' &&
        parts[2] === 'projects' &&
        parts[3] &&
        parts[4] === 'render' &&
        req.method === 'POST'
      ) {
        if (!db.editorProject(parts[3])) return send(res, 404, { error: 'Project not found' });
        if (renderJobs.get(parts[3])?.status === 'running')
          return send(res, 409, { error: 'Render already running' });
        renderJobs.set(parts[3], { status: 'running' });
        void render(root, parts[3]!).then(
          (file) => renderJobs.set(parts[3]!, { status: 'completed', file }),
          (e) =>
            renderJobs.set(parts[3]!, {
              status: 'failed',
              error: (e as Error).message,
            }),
        );
        return send(res, 202, { projectId: parts[3], status: 'running' });
      }
      if (url.pathname === '/api/montage/from-suggestion' && req.method === 'POST') {
        const input = await jsonBody(req);
        const latest = await latestFilmProposal(root);
        if (!latest?.proposal) throw new Error('No film suggestion available');
        if (typeof input.createdAt !== 'string' || input.createdAt !== latest.createdAt)
          throw new Error('Film suggestion changed. Refresh before rendering.');
        const allowed = new Set(latest.proposal.sequence.map((item) => item.highlightId));
        if (
          !Array.isArray(input.highlightIds) ||
          input.highlightIds.some((id) => typeof id !== 'string' || !allowed.has(id))
        )
          throw new Error('Selection must contain IDs from the current suggestion');
        if (typeof input.title !== 'string' || !input.title.trim())
          throw new Error('Missing film title');
        const id = newId();
        db.createSuggestedProject(id, input.title, input.highlightIds, {
          ...latest,
          selectedHighlightIds: input.highlightIds,
        });
        renderJobs.set(id, { status: 'running' });
        // Background render without blocking request, report status via polling.
        void render(root, id).then(
          (file) => renderJobs.set(id, { status: 'completed', file }),
          (e) =>
            renderJobs.set(id, {
              status: 'failed',
              error: (e as Error).message,
            }),
        );
        return send(res, 202, { projectId: id, status: 'running' });
      }
      if (
        parts[0] === 'api' &&
        parts[1] === 'projects' &&
        parts[2] &&
        parts[3] === 'status' &&
        parts.length === 4 &&
        req.method === 'GET'
      ) {
        if (!db.project(parts[2])) return send(res, 404, { error: 'Project not found' });
        return send(res, 200, renderJobs.get(parts[2]) ?? { status: 'not_started' });
      }
      if (
        parts[0] === 'api' &&
        parts[1] === 'projects' &&
        parts[2] &&
        parts[3] === 'download' &&
        parts.length === 4 &&
        req.method === 'GET'
      ) {
        if (!db.project(parts[2])) return send(res, 404, { error: 'Project not found' });
        const file = path.join(rendersDir(root), parts[2], 'final.mp4');
        const info = await stat(file);
        res.writeHead(200, {
          'content-type': 'video/mp4',
          'content-disposition': 'attachment; filename="clipforge-final.mp4"',
          'content-length': info.size,
        });
        return createReadStream(file).pipe(res);
      }
      if (url.pathname === '/api/agent-test' && req.method === 'POST') {
        const input = await jsonBody(req);
        const config = await loadConfig(root);
        const stage = input.stage === 'montage' ? 'montage' : 'clipAnalysis';
        const profile = config.aiStages?.[stage] ?? config.agent;
        const provider = input.provider ?? profile.provider;
        if (!isAnalysisProvider(provider))
          throw new Error('Select codex, claude, deepseek or openai');
        // Explicit action only, never called by polling.
        const result = await smokeTestAgent(
          root,
          provider,
          typeof input.model === 'string' && input.model.trim() ? input.model : profile.model,
        );
        return send(res, 200, result);
      }
      if (url.pathname === '/api/settings' && req.method === 'GET') {
        const [config, context, workflow] = await Promise.all([
          loadConfig(root),
          readFile(path.join(workspaceDir(root), 'context.md'), 'utf8'),
          readFile(path.join(workspaceDir(root), 'workflow.json'), 'utf8'),
        ]);
        return send(res, 200, {
          config,
          context,
          workflow: JSON.parse(workflow),
        });
      }
      if (url.pathname === '/api/settings' && req.method === 'PUT') {
        const body = await jsonBody(req);
        if (
          !body.config ||
          typeof body.config !== 'object' ||
          typeof body.context !== 'string' ||
          body.context.length > 100_000
        )
          throw new Error('Invalid config or context');
        let workflow: unknown;
        if (body.workflow !== undefined) {
          if (typeof body.workflow !== 'object' || !body.workflow || Array.isArray(body.workflow))
            throw new Error('Invalid workflow');
          workflow = body.workflow;
          const w = workflow as Record<string, unknown>;
          if (
            w.version !== 1 ||
            !Array.isArray(w.steps) ||
            w.steps.some((s) => typeof s !== 'string') ||
            w.reviewRequired !== true
          )
            throw new Error('Workflow needs version=1, steps:string[], and reviewRequired=true');
        }
        const config = body.config as unknown as Config;
        const old = await loadConfig(root);
        // Preserve the existing workflow unless the user edits it explicitly in a future API.
        await saveConfig(root, {
          ...old,
          ...config,
          project: { ...old.project, ...config.project },
          agent: { ...old.agent, ...config.agent },
          analysis: { ...old.analysis, ...config.analysis },
          transcription: { ...old.transcription, ...config.transcription },
          soundClassifier: {
            ...old.soundClassifier,
            ...config.soundClassifier,
          },
        });
        await writeFile(path.join(workspaceDir(root), 'context.md'), body.context, 'utf8');
        if (workflow)
          await writeFile(
            path.join(workspaceDir(root), 'workflow.json'),
            JSON.stringify(workflow, null, 2) + '\n',
            'utf8',
          );
        return send(res, 200, { saved: true });
      }
      if (
        parts[0] === 'api' &&
        parts[1] === 'audio-signals' &&
        parts[2] &&
        parts.length === 3 &&
        req.method === 'GET'
      ) {
        if (!db.clip(parts[2])) return send(res, 404, { error: 'Clip not found' });
        const file = path.join(artifactDir(root, parts[2]), 'audio-signals.json');
        return send(res, 200, JSON.parse(await readFile(file, 'utf8')));
      }
      if (
        parts[0] === 'api' &&
        parts[1] === 'sound-events' &&
        parts[2] &&
        parts.length === 3 &&
        req.method === 'GET'
      ) {
        if (!db.clip(parts[2])) return send(res, 404, { error: 'Clip not found' });
        const file = path.join(artifactDir(root, parts[2]), 'sound-events.json');
        return send(res, 200, JSON.parse(await readFile(file, 'utf8').catch(() => '[]')));
      }
      if (url.pathname === '/api/analysis/runs' && req.method === 'GET')
        return send(res, 200, db.runs());
      if (
        parts[0] === 'api' &&
        parts[1] === 'analysis' &&
        parts[2] === 'events' &&
        parts[3] &&
        req.method === 'GET'
      )
        return send(res, 200, db.events(parts[3], Number(url.searchParams.get('after') ?? 0)));
      if (url.pathname === '/api/analysis/clips' && req.method === 'GET')
        return send(res, 200, db.clipAnalyses());
      if (url.pathname === '/api/analysis/highlight-sets' && req.method === 'GET')
        return send(res, 200, db.highlightSets());
      if (
        parts[0] === 'api' &&
        parts[1] === 'analysis' &&
        parts[2] === 'clip' &&
        parts[3] &&
        req.method === 'GET'
      ) {
        const clip = db.clip(parts[3]);
        if (!clip) return send(res, 404, { error: 'Clip not found' });
        const info = db.clipAnalysis(parts[3]);
        const folder = artifactDir(root, parts[3]);
        const trace = await readFile(path.join(folder, 'ai', 'trace.json'), 'utf8')
          .then(JSON.parse)
          .catch(() => null);
        const response = await readFile(path.join(folder, 'ai', 'response.txt'), 'utf8').catch(
          () => null,
        );
        const stdout = await readFile(path.join(folder, 'ai', 'stdout.log'), 'utf8').catch(
          () => null,
        );
        const stderr = await readFile(path.join(folder, 'ai', 'stderr.log'), 'utf8').catch(
          () => null,
        );
        return send(res, 200, {
          info,
          stages: db.stageArtifacts(parts[3]),
          trace,
          response,
          stdout,
          stderr,
        });
      }
      if (url.pathname === '/api/clips' && req.method === 'GET') return send(res, 200, db.clips());
      if (url.pathname === '/api/transcripts/search' && req.method === 'GET')
        return send(res, 200, db.searchTranscripts(url.searchParams.get('q') ?? ''));
      if (url.pathname === '/api/skipped' && req.method === 'GET')
        return send(res, 200, db.skipped());
      if (url.pathname === '/api/highlights' && req.method === 'GET')
        return send(res, 200, db.highlights());
      if (url.pathname === '/api/highlights' && req.method === 'DELETE') {
        const body = await jsonBody(req);
        if (
          body.all !== true &&
          (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== 'string'))
        )
          throw new Error('Provide highlight IDs or all:true');
        return send(res, 200, {
          deleted: db.deleteHighlights(body.all === true ? undefined : (body.ids as string[])),
        });
      }
      if (
        parts[0] === 'api' &&
        parts[1] === 'highlights' &&
        parts[2] &&
        parts[3] === 'feedback' &&
        req.method === 'GET'
      )
        return send(res, 200, db.feedback(parts[2]));
      if (
        parts[0] === 'api' &&
        parts[1] === 'highlights' &&
        parts[2] &&
        parts[3] === 'feedback' &&
        req.method === 'POST'
      ) {
        const body = await jsonBody(req);
        if (
          ('rating' in body && typeof body.rating !== 'number') ||
          ('category' in body && typeof body.category !== 'string') ||
          ('notes' in body && typeof body.notes !== 'string') ||
          ('favorite' in body && typeof body.favorite !== 'boolean')
        )
          throw new Error('Invalid feedback');
        return send(
          res,
          201,
          db.saveFeedback({
            highlightId: parts[2],
            rating: body.rating as number | undefined,
            category: body.category as import('./core/db.js').FeedbackCategory | undefined,
            notes: body.notes as string | undefined,
            favorite: body.favorite as boolean | undefined,
          }),
        );
      }
      if (url.pathname === '/api/missed-moments' && req.method === 'GET')
        return send(res, 200, db.missedMoments(url.searchParams.get('clipId') ?? undefined));
      if (url.pathname === '/api/missed-moments' && req.method === 'POST') {
        const body = await jsonBody(req);
        if (
          typeof body.clipId !== 'string' ||
          typeof body.start !== 'number' ||
          typeof body.end !== 'number' ||
          ('description' in body && typeof body.description !== 'string') ||
          ('category' in body && typeof body.category !== 'string') ||
          ('rating' in body && typeof body.rating !== 'number')
        )
          throw new Error('Invalid missed moment');
        return send(
          res,
          201,
          db.createMissedMoment({
            id: newId(),
            clipId: body.clipId,
            start: body.start,
            end: body.end,
            description: body.description as string | undefined,
            category: body.category as import('./core/db.js').FeedbackCategory | undefined,
            rating: body.rating as number | undefined,
          }),
        );
      }
      if (url.pathname === '/api/projects' && req.method === 'GET')
        return send(res, 200, db.projects());
      if (url.pathname === '/api/projects' && req.method === 'POST') {
        const body = await jsonBody(req);
        const ids = body.highlightIds;
        if (
          typeof body.name !== 'string' ||
          !Array.isArray(ids) ||
          ids.some((x) => typeof x !== 'string')
        )
          throw new Error('Expected name and highlightIds');
        const selected = ids.map((id) => db.highlight(id));
        if (selected.some((x) => !x || x.status !== 'approved'))
          throw new Error('Projects can only contain approved highlights');
        const id = newId();
        db.createProject(id, body.name, ids);
        return send(res, 201, { id });
      }
      if (
        parts[0] === 'api' &&
        parts[1] === 'highlights' &&
        parts[2] &&
        parts.length === 3 &&
        req.method === 'PATCH'
      ) {
        const old = db.highlight(parts[2]);
        if (!old) return send(res, 404, { error: 'Not found' });
        const input = await jsonBody(req);
        const patch: Record<string, unknown> = {};
        for (const key of ['start', 'end', 'title', 'description', 'status'])
          if (key in input) patch[key] = input[key];
        if ('start' in patch && (typeof patch.start !== 'number' || !Number.isFinite(patch.start)))
          throw new Error('Invalid start');
        if ('end' in patch && (typeof patch.end !== 'number' || !Number.isFinite(patch.end)))
          throw new Error('Invalid end');
        for (const key of ['title', 'description', 'status'])
          if (key in patch && typeof patch[key] !== 'string') throw new Error(`Invalid ${key}`);
        return send(res, 200, db.updateHighlight(parts[2], patch));
      }
      if (
        parts[0] === 'api' &&
        parts[1] === 'highlights' &&
        parts[2] &&
        parts.length === 3 &&
        req.method === 'DELETE'
      )
        return send(res, 200, { deleted: db.deleteHighlights([parts[2]]) });
      if (
        parts[0] === 'api' &&
        parts[1] === 'projects' &&
        parts[2] &&
        parts[3] === 'render' &&
        parts.length === 4 &&
        req.method === 'POST'
      ) {
        // Render runs as an explicit action, never as a side-effect of viewing an item.
        db.close();
        const file = await render(root, parts[2]);
        return send(res, 200, { file });
      }
      if (parts[0] === 'media' && parts.length === 2 && req.method === 'GET') {
        const clip = db.clip(parts[1]!);
        if (!clip) return send(res, 404, { error: 'Clip not found' });
        const file = clip.source_path;
        const info = await stat(file);
        let start = 0,
          end = info.size - 1;
        const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
        if (range) {
          start = range[1] ? Number(range[1]) : 0;
          end = range[2] ? Math.min(end, Number(range[2])) : end;
        }
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start > end ||
          start >= info.size
        ) {
          res.writeHead(416, { 'content-range': `bytes */${info.size}` });
          return res.end();
        }
        res.writeHead(range ? 206 : 200, {
          'content-type': 'video/mp4',
          'accept-ranges': 'bytes',
          'content-length': end - start + 1,
          ...(range ? { 'content-range': `bytes ${start}-${end}/${info.size}` } : {}),
        });
        const { createReadStream } = await import('node:fs');
        createReadStream(file, { start, end }).pipe(res);
        return;
      }
      if (parts[0] === 'thumbnail' && parts.length === 2 && req.method === 'GET') {
        const folder = path.join(artifactDir(root, parts[1]!), 'frames');
        const names = await import('node:fs/promises')
          .then((m) => m.readdir(folder))
          .catch(() => []);
        const file = path.join(
          folder,
          names.find((n) => /^frame-000.*\.(jpg|png)$/.test(n)) ?? 'frame-000.png',
        );
        if (!db.clip(parts[1]!)) return send(res, 404, { error: 'Clip not found' });
        return await streamFile(res, file);
      }
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
        const file = path.resolve(
          dashboardRoot,
          '.' + (url.pathname === '/' ? '/index.html' : url.pathname),
        );
        if (!inside(dashboardRoot, file)) return send(res, 403, { error: 'Forbidden' });
        return await streamFile(res, file);
      }
      return send(res, 404, { error: 'Not found' });
    } catch (e) {
      const error = e as Error;
      // Do not log request bodies: they can contain private creative context or credentials.
      console.error(`[dashboard] ${req.method} ${req.url}: ${error.stack ?? error.message}`);
      if (!res.headersSent) send(res, errorStatus(e), publicError(e));
      else res.destroy();
    } finally {
      try {
        db.close();
      } catch {}
    }
  });
  const abortAnalysis = async () => {
    const jobs = [...activeAnalysisJobs.values()];
    for (const job of jobs) job.controller.abort();
    await Promise.allSettled(jobs.flatMap((job) => (job.completion ? [job.completion] : [])));
  };
  server.on('close', () => void abortAnalysis());
  server.listen(port, host, () => console.log(`Dashboard: http://${host}:${port}`));
  return Object.assign(server, { abortAnalysis });
}
