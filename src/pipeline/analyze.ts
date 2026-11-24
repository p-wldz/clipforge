import path from 'node:path';
import { readFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Store, type Highlight } from '../core/db.js';
import { stableId, artifactDir, loadConfig, newId, sourceRevision } from '../core/paths.js';
import { isAnalysisProvider } from '../core/providers.js';
import { probe, frames, audioEvents, saveJson, sceneChanges } from './media.js';
import { candidates, padCandidateBoundary, type CandidateSignal } from './highlights.js';
import { classifySound } from './sound-classifier.js';
import { inspectAudio } from './audio-signals.js';
import { transcribe } from './transcribe.js';
import { selectFrames } from './frame-selection.js';
import { suggestFilm } from '../agents/montage.js';
import {
  baseUnderstanding,
  conversationUnderstanding,
  profileFor,
  contexts,
  persistEditingSet,
  contextualEditing,
  criticalReview,
} from './staged-ai.js';
const extensions = new Set(['.mp4', '.mkv', '.mov', '.webm']);
export async function analyze(
  root: string,
  input: string,
  options: {
    withAgent: boolean;
    force: boolean;
    provider?: 'codex' | 'claude' | 'cursor' | 'deepseek' | 'openai' | 'anthropic';
    signal?: AbortSignal;
  },
  onProgress: (line: string) => void = console.log,
) {
  const config = await loadConfig(root),
    provider = options.withAgent
      ? (options.provider ?? profileFor(config, 'understanding').provider)
      : 'none';
  if (options.withAgent && provider === 'none')
    throw new Error('No agent selected. Run clipforge agent codex or use --agent codex');
  if (provider === 'cursor')
    throw new Error('Cursor analysis adapter is not implemented. Choose a supported AI provider.');
  const db = new Store(root),
    runId = newId();
  let processed = 0,
    analyzed = 0,
    failedFiles = 0;
  const throwIfCancelled = () => {
    if (!options.signal?.aborted) return;
    const error = new Error('Analysis cancelled');
    error.name = 'AbortError';
    throw error;
  };
  try {
    const stat = await import('node:fs/promises').then((fs) => fs.stat(input));
    const files = stat.isDirectory()
      ? (await readdir(input))
          .filter((x) => extensions.has(path.extname(x).toLowerCase()))
          .map((x) => path.join(input, x))
      : [input];
    db.startRun(runId, provider, files.length);
    const context = await readFile(path.join(root, '.clipforge', 'context.md'), 'utf8').catch(
      () => config.project.focus,
    );
    const scopedContexts = await contexts(root, config);
    function event(
      stage: string,
      message: string,
      clipId: string | null = null,
      level = 'info',
      file: string | null = null,
    ) {
      db.progressRun(runId, stage, file);
      db.addEvent(runId, stage, message, clipId, level);
      onProgress(`[${stage}] ${message}`);
    }

    for (const file of files) {
      throwIfCancelled();
      const full = path.resolve(file),
        id = stableId(full),
        folder = artifactDir(root, id),
        name = path.basename(file);
      try {
        const existing = db.clip(id);
        const revision = await sourceRevision(full);
        const sourceChanged = !!existing?.source_revision && existing.source_revision !== revision;
        if (existing && !options.force && existing.source_revision === revision) {
          event('skip', `${name}: source unchanged; --force to reanalyze`, id, 'info', name);
          processed++;
          db.progressRun(runId, 'skip', name, processed);
          continue;
        }
        const stageErrors: Array<{
          stage: string;
          message: string;
          at: string;
        }> = [];
        async function optionalStage<T>(
          stage: string,
          task: () => Promise<T>,
          fallback: T,
        ): Promise<T> {
          try {
            return await task();
          } catch (e) {
            if ((e as Error).name === 'AbortError') throw e;
            const message = (e as Error).message;
            stageErrors.push({ stage, message, at: new Date().toISOString() });
            event(
              stage,
              `${name}: unavailable (${message}); continuing without this signal`,
              id,
              'warn',
              name,
            );
            return fallback;
          }
        }
        event('probe', `${name}: inspecting media`, id, 'info', name);
        const meta = await probe(full, options.signal);
        const reasons: string[] = [];
        if (meta.duration < config.analysis.minDurationSeconds)
          reasons.push(`duration ${meta.duration.toFixed(2)}s below minimum`);
        if (
          config.analysis.maxDurationSeconds !== null &&
          meta.duration > config.analysis.maxDurationSeconds
        )
          reasons.push(`duration ${meta.duration.toFixed(2)}s exceeds maximum`);
        if (config.analysis.requireAudio && !meta.hasAudio) reasons.push('audio track required');
        if (reasons.length) {
          const reason = reasons.join('; ');
          db.saveScan(id, full, meta.duration, meta.hasAudio, 'skip', reason);
          event('filtered', `${name}: ${reason}`, id, 'warn', name);
          onProgress(`FILTERED ${name} (${reason})`);
          processed++;
          db.progressRun(runId, 'filtered', name, processed);
          continue;
        }
        if (sourceChanged) {
          // A replacement at the same path invalidates generated artifacts and old candidate ranges.
          // User feedback becomes clip-level review observations before candidate rows are removed.
          const removed = db.resetClipHighlights(id);
          await rm(folder, { recursive: true, force: true });
          event(
            'source-revision',
            `${name}: source changed; reset ${removed} generated highlight(s) and invalidated artifacts`,
            id,
            'warn',
            name,
          );
        } else if (existing && !existing.source_revision) {
          event(
            'source-revision',
            `${name}: recording source revision for this legacy clip`,
            id,
            'info',
            name,
          );
        }
        db.saveScan(id, full, meta.duration, meta.hasAudio, 'analyze', null);
        event('audio', `${name}: extracting audio activity and peaks`, id, 'info', name);
        const activity = await audioEvents(
          full,
          meta.duration,
          meta.hasAudio,
          config.analysis.minAudioSilenceSeconds,
          options.signal,
        );
        const audioSignals = await optionalStage(
          'audio-signals',
          () => inspectAudio(full, meta.hasAudio, options.signal),
          { windowSeconds: 0.1, levels: [], events: [] },
        );
        await saveJson(path.join(folder, 'audio-signals.json'), audioSignals);
        event(
          'sound-classifier',
          `${name}: ${config.soundClassifier.enabled ? 'running sound classifier' : 'classifier disabled'}`,
          id,
          'info',
          name,
        );
        const classified = meta.hasAudio
          ? await optionalStage(
              'sound-classifier',
              () => classifySound(root, config, full, meta.duration, folder, options.signal),
              [],
            )
          : [];
        if (stageErrors.some((x) => x.stage === 'sound-classifier'))
          await saveJson(path.join(folder, 'sound-events.json'), []);
        event(
          'transcription',
          `${name}: ${config.transcription.enabled ? 'transcribing speech' : 'transcription disabled'}`,
          id,
          'info',
          name,
        );
        const transcript = meta.hasAudio
          ? await optionalStage(
              'transcription',
              () => transcribe(config, full, folder, options.signal),
              null,
            )
          : null;
        if (stageErrors.some((x) => x.stage === 'transcription'))
          await rm(path.join(folder, 'transcript.json'), { force: true }).catch(() => {});
        const segments = normalizeTranscript(transcript);
        event(
          'frames',
          `${name}: extracting screenshots every ${config.analysis.frameIntervalSeconds}s`,
          id,
          'info',
          name,
        );
        const frameSamples = await frames(
          full,
          path.join(folder, 'frames'),
          config.analysis.frameIntervalSeconds,
          meta.duration,
          config.analysis.imageMaxWidth ?? 640,
          options.signal,
        );
        const pics = frameSamples.map((sample) => sample.path);
        db.upsertClip({
          id,
          source_path: full,
          source_revision: revision,
          duration: meta.duration,
          width: meta.width,
          height: meta.height,
          analyzed_at: new Date().toISOString(),
          transcript: transcript ? JSON.stringify(transcript) : null,
        });
        db.saveTranscriptSegments(id, segments);
        await saveJson(path.join(folder, 'metadata.json'), {
          source: full,
          ...meta,
        });
        await saveJson(path.join(folder, 'audio-activity.json'), activity);
        if (transcript) await saveJson(path.join(folder, 'transcript.json'), transcript);
        event('scene-changes', `${name}: detecting visual scene changes`, id, 'info', name);
        const scenes = await optionalStage(
          'scene-changes',
          () => sceneChanges(full, options.signal),
          [],
        );
        await saveJson(path.join(folder, 'scene-changes.json'), scenes);
        const classifiedWindows: CandidateSignal[] = classified.map((e) => ({
          start: Math.max(0, e.start - 3),
          end: Math.min(meta.duration, e.end + 4),
          source: 'sound_event',
        }));
        const signalWindows: CandidateSignal[] = audioSignals.events.map((e) => ({
          start: Math.max(0, e.start - 3),
          end: Math.min(meta.duration, e.end + 4),
          source: 'volume_peak',
        }));
        const transcriptWindows: CandidateSignal[] = segments.map((s) => ({
          start: Math.max(0, s.start - 2),
          end: Math.min(meta.duration, s.end + 2),
          source: 'speech',
        }));
        const sceneWindows: CandidateSignal[] = scenes.map((scene) => ({
          start: Math.max(0, scene.at - 3),
          end: Math.min(meta.duration, scene.at + 4),
          source: 'scene_change',
        }));
        const candidateSignals: CandidateSignal[] = [
          ...classifiedWindows,
          ...signalWindows,
          ...transcriptWindows,
          ...sceneWindows,
          ...activity.map((window) => ({ ...window, source: 'audio_activity' as const })),
        ];
        await saveJson(path.join(folder, 'candidate-signals.json'), candidateSignals);
        let highlights = candidates(
          id,
          meta.duration,
          candidateSignals,
          config.analysis.maxHighlightsPerClip,
          config.analysis.highlightDurationSeconds,
          {
            preRollSeconds: config.analysis.candidatePreRollSeconds,
            postRollSeconds: config.analysis.candidatePostRollSeconds,
          },
        );
        throwIfCancelled();
        if (provider !== 'none') {
          // This objective artifact is intentionally produced before contextual editing.
          // Its cache key excludes the project creative brief, so it survives a new film idea.
          const agentPayload: Record<string, unknown> = {
            project: {
              name: config.project.name,
              description: config.project.description,
            },
            sourceRevision: revision,
            duration: meta.duration,
            framesEverySeconds: config.analysis.frameIntervalSeconds,
            transcript: segments,
            soundEvents: classified,
            audioSignals: audioSignals.events,
            // User-owned notes are included only in an explicitly requested AI run.
            reviewObservations: db.reviewObservations(id),
          };
          const max = config.analysis.maxImagesPerClip ?? 8;
          const selection = selectFrames(
            pics,
            meta.duration,
            config.analysis.frameIntervalSeconds,
            max,
            [...classified, ...audioSignals.events, ...segments],
          );
          const selectedFrameTimestamps = new Map(
            frameSamples.map((sample) => [sample.path, sample.timestamp]),
          );
          agentPayload.frameSampling = {
            requestedEverySeconds: config.analysis.frameIntervalSeconds,
            extractedFrames: frameSamples.length,
            selectedFrames: selection.map((frame) => ({
              path: frame,
              timestamp: selectedFrameTimestamps.get(frame),
            })),
          };
          let conversation;
          if (segments.length) {
            event(
              'conversation-understanding',
              `${name}: grouping transcript into conversations`,
              id,
              'info',
              name,
            );
            try {
              const result = await conversationUnderstanding(
                root,
                db,
                {
                  clipId: id,
                  duration: meta.duration,
                  transcript: segments.map((segment, index) => ({
                    ...segment,
                    id: `utt-${index + 1}`,
                  })),
                  events: [
                    ...classified.map((event, index) => ({
                      id: `sound-${index + 1}`,
                      start: event.start,
                      end: event.end,
                      kind: 'sound',
                      detail: event.label,
                    })),
                    ...audioSignals.events.map((event, index) => ({
                      id: `audio-${index + 1}`,
                      start: event.start,
                      end: event.end,
                      kind: 'audio-signal',
                      detail: event.description,
                    })),
                  ],
                  config,
                  runId,
                  signal: options.signal,
                },
                (message) =>
                  event('conversation-understanding', `${name}: ${message}`, id, 'info', name),
              );
              conversation = result.conversation;
              agentPayload.conversationUnderstanding = conversation;
              event(
                'conversation-understanding',
                `${name}: ${result.cached ? 'cache hit' : `saved ${conversation.conversations.length} conversations`}`,
                id,
                'info',
                name,
              );
            } catch (e) {
              event(
                'conversation-understanding',
                `${name}: FAILED: ${(e as Error).message}; continuing with other evidence`,
                id,
                'warn',
                name,
              );
            }
          }
          event('understanding', `${name}: building reusable base understanding`, id, 'info', name);
          let deepAction;
          try {
            const result = await baseUnderstanding(
              root,
              db,
              {
                clipId: id,
                duration: meta.duration,
                media: agentPayload,
                images: selection,
                conversation,
                config,
                runId,
                signal: options.signal,
              },
              (message) => event('understanding', `${name}: ${message}`, id, 'info', name),
            );
            deepAction = result.understanding;
            event(
              'understanding',
              `${name}: ${result.cached ? 'cache hit' : 'saved Deep Action Analysis'}`,
              id,
              'info',
              name,
            );
          } catch (e) {
            event(
              'understanding',
              `${name}: FAILED: ${(e as Error).message}; heuristic candidates retained`,
              id,
              'warn',
              name,
            );
          }
          const editingProfile = options.provider
            ? { provider: options.provider, model: config.agent.model }
            : profileFor(config, 'editing');
          if (!isAnalysisProvider(editingProfile.provider)) {
            event(
              'editing',
              `${name}: editing provider disabled; base understanding remains available`,
              id,
              'warn',
              name,
            );
          } else
            event('editing', `${name}: selecting highlights for editing context`, id, 'info', name);
          try {
            if (!deepAction) throw new Error('Deep Action Analysis is unavailable');
            if (!isAnalysisProvider(editingProfile.provider))
              throw new Error('Editing provider is disabled');
            event(
              'editing',
              `${name}: Contextual Editing evaluates ${deepAction.actions.length} complete actions with ${editingProfile.provider}${editingProfile.model ? ` (${editingProfile.model})` : ''}`,
              id,
              'info',
              name,
            );
            let result = await contextualEditing(
              root,
              db,
              {
                clipId: id,
                duration: meta.duration,
                understanding: deepAction,
                context: scopedContexts.editing || context,
                config: {
                  ...config,
                  aiStages: { ...config.aiStages, editing: editingProfile },
                },
                runId,
                signal: options.signal,
              },
              (message) => event('editing', `${name}: ${message}`, id, 'info', name),
            );
            if ((config.analysis.criticalReviewPasses ?? 0) > 0) {
              event(
                'critical-review',
                `${name}: checking proposed cuts with ${profileFor(config, 'criticalReview').provider} (one bounded pass)`,
                id,
                'info',
                name,
              );
              try {
                result = {
                  ...result,
                  decisions: (
                    await criticalReview(
                      root,
                      db,
                      {
                        clipId: id,
                        duration: meta.duration,
                        understanding: deepAction,
                        context: scopedContexts.editing || context,
                        decisions: result.decisions,
                        config,
                        runId,
                        signal: options.signal,
                      },
                      (message) =>
                        event('critical-review', `${name}: ${message}`, id, 'info', name),
                    )
                  ).decisions,
                };
              } catch (e) {
                event(
                  'critical-review',
                  `${name}: FAILED: ${(e as Error).message}; retaining original proposal`,
                  id,
                  'warn',
                  name,
                );
              }
            }
            highlights = result.decisions
              .filter((d) => d.include)
              .slice(0, config.analysis.maxHighlightsPerClip)
              .map((d, i): Highlight => {
                const interval = padCandidateBoundary(
                  { start: d.start, end: d.end },
                  meta.duration,
                  {
                    preRollSeconds: config.analysis.candidatePreRollSeconds,
                    postRollSeconds: config.analysis.candidatePostRollSeconds,
                  },
                );
                return {
                  id: createHash('sha256')
                    .update(`${id}:action:${d.actionId}:${interval.start}:${interval.end}:${i}`)
                    .digest('hex')
                    .slice(0, 20),
                  clip_id: id,
                  ...interval,
                  title: d.title,
                  description: `${d.description}\nReason: ${d.reason}\nAction: ${d.actionId}${d.conversationId ? `\nConversation: ${d.conversationId}\nNarrative phases: ${d.narrativePhaseCoverage.join(', ') || 'unspecified'}\nMissing-context risks: ${d.missingContextRisks.join('; ') || 'none recorded'}` : ''}${d.accelerate.length ? `\nAcceleration suggested: ${JSON.stringify(d.accelerate)}` : ''}`,
                  score: Math.round(d.confidence * 100),
                  status: 'pending_review',
                  origin: provider,
                  created_at: new Date().toISOString(),
                };
              });
            const analysis = {
              title: 'Contextual editing proposal',
              summary: deepAction.summary,
              story: deepAction.actions.map((a) => ({
                start: a.start,
                end: a.end,
                description: a.whatHappens,
              })),
              tags: [],
              highlights: highlights.map((h) => ({
                start: h.start,
                end: h.end,
                title: h.title,
                description: h.description,
                score: h.score,
                reason: h.description,
              })),
            };
            await saveJson(path.join(folder, 'clip-analysis.json'), analysis);
            db.saveClipAnalysis(
              id,
              runId,
              provider,
              'success',
              analysis,
              path.join(folder, 'editing', 'contextual-editing-response.txt'),
              null,
            );
            persistEditingSet(db, scopedContexts.editing || context, highlights, result.key);
            event(
              'editing',
              `${name}: SUCCESS: ${highlights.length} contextual selections`,
              id,
              'info',
              name,
            );
          } catch (e) {
            const message = (e as Error).message;
            db.saveClipAnalysis(
              id,
              runId,
              provider,
              'failed',
              null,
              path.join(folder, 'editing', 'contextual-editing-response.txt'),
              message,
            );
            event(
              'editing',
              `${name}: FAILED: ${message}. Heuristic candidates retained, clearly marked.`,
              id,
              'error',
              name,
            );
          }
        } else {
          db.saveClipAnalysis(
            id,
            runId,
            'none',
            'skipped',
            null,
            null,
            'Agent analysis not requested. Use --agent followed by a supported AI provider.',
          );
          event('llm', `${name}: SKIPPED (no --agent flag)`, id, 'warn', name);
        }
        throwIfCancelled();
        if (stageErrors.length) await saveJson(path.join(folder, 'stage-errors.json'), stageErrors);
        else
          await rm(path.join(folder, 'stage-errors.json'), {
            force: true,
          }).catch(() => {});
        if (options.force) db.clearPendingHighlights(id);
        for (const h of highlights) db.upsertHighlight(h);
        await saveJson(path.join(folder, 'highlights.json'), highlights);
        analyzed++;
        processed++;
        db.progressRun(runId, 'done', name, processed);
        event(
          'done',
          `${name}: ${highlights.length} candidates (${highlights[0]?.origin ?? 'none'})${stageErrors.length ? `; ${stageErrors.length} nonfatal stage warning(s)` : ''}`,
          id,
        );
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        failedFiles++;
        const message = (e as Error).message;
        db.recordFileFailure(runId, id, full, message);
        processed++;
        db.progressRun(runId, 'file-error', name, processed);
        event(
          'file-error',
          `${name}: FAILED (${message}); skipping this file and continuing with the others`,
          id,
          'error',
          name,
        );
      }
    }
    const montageProvider =
      config.aiStages?.filmDirection?.provider ?? config.aiStages?.montage?.provider ?? provider;
    if (isAnalysisProvider(montageProvider)) {
      event('montage', `Preparing AI proposal for the final movie`);
      try {
        const candidates = db.highlights().filter((h) => h.status !== 'rejected');
        const summaries = db.clipAnalyses().filter((a: any) => a.status === 'success');
        if (candidates.length)
          await suggestFilm(
            root,
            montageProvider,
            config.aiStages?.filmDirection?.model ??
              config.aiStages?.montage?.model ??
              config.agent.model,
            scopedContexts.filmDirection || context,
            candidates,
            summaries,
            (msg) => event('montage', msg),
            runId,
            '',
            options.signal,
          );
        else event('montage', 'No AI highlights available; film proposal skipped', null, 'warn');
      } catch (e) {
        event('montage', `Film proposal FAILED: ${(e as Error).message}`, null, 'error');
      }
    }
    const warnings = db.runSummary(runId)?.warning_count ?? 0;
    db.finishRun(runId, warnings > 0 ? 'completed_with_warnings' : 'completed');
    const usage = db.aiUsageSummary(runId);
    event(
      'usage',
      `RUN FINISHED · ${usage.calls} AI calls · ${usage.inputTokens} input + ${usage.outputTokens} output tokens · ${usage.imagesSent} images · OPTIONAL pricing estimate ${usage.pricedCalls ? '$' + usage.apiEquivalentUsd.toFixed(5) : 'unavailable'}${!usage.complete ? ' (partial; unknown rates or usage)' : ''}`,
    );
    return {
      runId,
      analyzed,
      failedFiles,
      total: files.length,
      warnings,
      usage,
    };
  } catch (error) {
    db.finishRun(
      runId,
      (error as Error).name === 'AbortError' ? 'cancelled' : 'failed',
      (error as Error).message,
    );
    throw error;
  } finally {
    db.close();
  }
}
export function normalizeTranscript(
  data: unknown,
): Array<{ start: number; end: number; text: string }> {
  const raw =
    data && typeof data === 'object' && 'segments' in data
      ? (data as { segments: unknown }).segments
      : data;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x) => {
    if (!x || typeof x !== 'object') return [];
    const row = x as Record<string, unknown>;
    if (
      typeof row.start !== 'number' ||
      typeof row.end !== 'number' ||
      typeof row.text !== 'string' ||
      !Number.isFinite(row.start) ||
      !Number.isFinite(row.end) ||
      row.start < 0 ||
      row.end <= row.start ||
      !row.text.trim()
    )
      return [];
    return [{ start: row.start, end: row.end, text: row.text.trim() }];
  });
}
