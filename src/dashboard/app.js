import { stopAtBoundary } from './playback.js';

const $ = (q) => document.querySelector(q),
  $$ = (q) => [...document.querySelectorAll(q)];
const stopAnalysis = document.createElement('button');
stopAnalysis.id = 'stop-analysis';
stopAnalysis.className = 'button-secondary danger-button';
stopAnalysis.disabled = true;
stopAnalysis.textContent = 'Stop analysis';
$('#start-analysis').after(stopAnalysis);
const safe = (s) =>
  // Dashboard cards are built from stored, user- and agent-provided strings.
  // Escape them before inserting HTML rather than trusting stored content.
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const transitionTypes = [
  'cut',
  'fade',
  'fadeblack',
  'wipeleft',
  'wiperight',
  'slideleft',
  'slideright',
  'circleopen',
];
const seconds = (n) => `${Number(n || 0).toFixed(1)}s`;
const effectNames = {
  cut: 'Hard cut',
  fade: 'Crossfade',
  fadeblack: 'Fade through black',
  wipeleft: 'Wipe left',
  wiperight: 'Wipe right',
  slideleft: 'Slide left',
  slideright: 'Slide right',
  circleopen: 'Circle open',
};
function busy(button, active, label = 'Working...') {
  if (!button) return;
  if (active) {
    if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.classList.add('is-busy');
    button.textContent = label;
    button.setAttribute('aria-busy', 'true');
  } else {
    button.disabled = false;
    button.classList.remove('is-busy');
    button.textContent = button.dataset.originalText || button.textContent;
    delete button.dataset.originalText;
    button.removeAttribute('aria-busy');
  }
}
async function clickTask(button, label, task) {
  busy(button, true, label);
  try {
    return await task();
  } catch (error) {
    notify(error.message);
    throw error;
  } finally {
    busy(button, false);
  }
}

let clips = [],
  highlights = [],
  projects = [],
  analyses = [],
  proposal = null,
  project = null,
  selected = null,
  selectedHighlightIds = new Set(),
  settings = null,
  inventory = null,
  analysisRuns = [],
  uiJob = null,
  playing = false,
  playIndex = 0,
  previewItems = [];
const clipOf = (h) => clips.find((c) => c.id === h?.clip_id);
const highlightOf = (id) => highlights.find((h) => h.id === id);
const fileName = (p) => (p || '').split(/[\\/]/).pop();
function notify(s) {
  const t = $('#toast');
  t.textContent = s;
  t.style.display = 'block';
  setTimeout(() => (t.style.display = 'none'), 4200);
}
async function api(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const body = await r.json();
  if (!r.ok) throw Error(body.error || `Request failed (${r.status})`);
  return body;
}
async function send(url, method, data) {
  return api(url, { method, body: JSON.stringify(data) });
}
function navigate(page) {
  $$('.page').forEach((e) => e.classList.toggle('active', e.id === 'page-' + page));
  $$('.nav').forEach((e) => e.classList.toggle('active', e.dataset.page === page));
  const titles = {
    home: 'Overview',
    library: 'Highlights',
    studio: 'Film studio',
    adapters: 'AI adapters',
    settings: 'Project settings',
  };
  $('#section-title').textContent = titles[page];
  history.replaceState(null, '', '#' + page);
  if (page === 'settings' || page === 'adapters') loadSettings().catch((e) => notify(e.message));
}
$$('.nav').forEach((el) => (el.onclick = () => navigate(el.dataset.page)));
$('#go-studio').onclick = () => navigate('studio');
$('#refresh').onclick = () => reload();
function mountTranscriptSearch() {
  if ($('#transcript-query')) return;
  const target = $('#page-home .stats');
  target.insertAdjacentHTML(
    'afterend',
    `<section class="panel"><div class="panel-heading"><div><h2>Search dialogue</h2><p>Search local transcripts and jump to a matching moment.</p></div></div><div class="toolbar"><input id="transcript-query" type="search" placeholder="tank, behind us, what the fuck…"><button id="transcript-search" class="button-secondary">Search</button></div><div id="transcript-results" class="cards-list"></div></section>`,
  );
  const search = async () => {
    const query = $('#transcript-query').value.trim();
    if (!query) return ($('#transcript-results').innerHTML = '');
    const rows = await api('/api/transcripts/search?q=' + encodeURIComponent(query));
    $('#transcript-results').innerHTML = rows.length
      ? rows
          .map(
            (r) =>
              `<button class="highlight-card" data-transcript-clip="${safe(r.clip_id)}" data-transcript-start="${r.start}"><div class="highlight-copy"><strong>${safe(fileName(r.source_path))} · ${seconds(r.start)}</strong><p>${safe(r.text)}</p><small>${safe(r.context || '')}</small></div></button>`,
          )
          .join('')
      : '<div class="empty">No transcript matches.</div>';
    $$('[data-transcript-clip]').forEach(
      (button) =>
        (button.onclick = () =>
          openTranscriptMoment(
            button.dataset.transcriptClip,
            Number(button.dataset.transcriptStart),
          )),
    );
  };
  $('#transcript-search').onclick = () => search().catch((e) => notify(e.message));
  $('#transcript-query').onkeydown = (e) => {
    if (e.key === 'Enter') search().catch((error) => notify(error.message));
  };
}
function openTranscriptMoment(clipId, start) {
  const clipHighlights = highlights.filter((h) => h.clip_id === clipId);
  if (clipHighlights[0]) {
    navigate('library');
    showHighlight(clipHighlights[0].id).then(() => {
      const video = $('#review-player');
      video.currentTime = start;
      video.play().catch(() => {});
    });
  } else notify('This transcript has no highlight yet; create one from a clip review.');
}
mountTranscriptSearch();
function mountHighlightDeletion() {
  $('#add-selected-to-studio').insertAdjacentHTML(
    'afterend',
    '<button id="delete-selected-highlights" class="button-secondary danger-button" disabled>Delete selected</button><button id="delete-all-highlights" class="button-secondary danger-button">Delete all</button>',
  );
  const remove = async (body, label) => {
    if (
      !confirm(
        `${label}? This removes highlights from film drafts but never deletes source videos or analysis artifacts.`,
      )
    )
      return;
    const result = await api('/api/highlights', { method: 'DELETE', body: JSON.stringify(body) });
    selectedHighlightIds.clear();
    selected = null;
    $('#review').innerHTML =
      '<div class="empty">Select a highlight to see its video and adjust the cut.</div>';
    await reload();
    notify(`${result.deleted} highlight${result.deleted === 1 ? '' : 's'} deleted`);
  };
  $('#delete-selected-highlights').onclick = () =>
    remove(
      { ids: [...selectedHighlightIds] },
      `Delete ${selectedHighlightIds.size} selected highlight(s)`,
    ).catch((error) => notify(error.message));
  $('#delete-all-highlights').onclick = () =>
    remove({ all: true }, `Delete all ${highlights.length} highlights`).catch((error) =>
      notify(error.message),
    );
}
mountHighlightDeletion();
async function reload() {
  try {
    [clips, highlights, projects, analyses] = await Promise.all(
      ['/api/clips', '/api/highlights', '/api/projects', '/api/analysis/clips'].map((u) => api(u)),
    );
    $('#stat-clips').textContent = clips.length;
    $('#stat-highlights').textContent = highlights.length;
    $('#stat-approved').textContent = highlights.filter((h) => h.status === 'approved').length;
    $('#stat-movies').textContent = projects.length;
    renderLibrary();
    renderProjectList();
    await loadProposal();
    if (selected) showHighlight(selected.id);
    if (project) await openProject(project.id);
  } catch (e) {
    notify(e.message);
  }
}
function renderLibrary() {
  const query = $('#highlight-query').value.toLowerCase(),
    status = $('#filter').value;
  const items = highlights.filter(
    (h) =>
      (status === 'all' || status === h.status) &&
      `${h.title} ${h.description}`.toLowerCase().includes(query),
  );
  $('#highlight-list').innerHTML =
    items
      .map(
        (h) =>
          `<div class="highlight-card ${selected?.id === h.id ? 'selected' : ''}" data-h="${safe(h.id)}"><img src="/thumbnail/${encodeURIComponent(h.clip_id)}" alt=""><div class="highlight-copy"><strong>${safe(h.title)}</strong><small>${safe(fileName(clipOf(h)?.source_path))} · ${seconds(h.start)}–${seconds(h.end)} · ${h.score}/100</small><span class="tag ${safe(h.status)}">${h.origin === 'heuristic' ? 'Heuristic' : `AI · ${safe(h.origin)}`} · ${h.status.replace('_', ' ')}</span></div></div>`,
      )
      .join('') || '<div class="empty">No highlights match your search.</div>';
  $$('[data-h]').forEach((el) => (el.onclick = () => showHighlight(el.dataset.h)));
  $$('[data-h]').forEach((card) => {
    const id = card.dataset.h;
    card.insertAdjacentHTML(
      'afterbegin',
      `<input class="highlight-select" type="checkbox" data-highlight-select="${safe(id)}" ${selectedHighlightIds.has(id) ? 'checked' : ''} aria-label="Select highlight">`,
    );
  });
  $$('[data-highlight-select]').forEach((input) => {
    input.onclick = (event) => event.stopPropagation();
    input.onchange = () => {
      input.checked
        ? selectedHighlightIds.add(input.dataset.highlightSelect)
        : selectedHighlightIds.delete(input.dataset.highlightSelect);
      $('#delete-selected-highlights').disabled = !selectedHighlightIds.size;
    };
  });
  $('#delete-selected-highlights').disabled = !selectedHighlightIds.size;
}
$('#highlight-query').oninput = renderLibrary;
$('#filter').onchange = renderLibrary;
async function showHighlight(id) {
  selected = highlightOf(id);
  if (!selected) return;
  renderLibrary();
  const h = selected,
    a = analyses.find((x) => x.clip_id === h.clip_id);
  $('#review').innerHTML =
    `<video id="review-player" src="/media/${encodeURIComponent(h.clip_id)}" controls preload="metadata"></video><h2>${safe(h.title)}</h2><p>${safe(h.description)}</p><div class="range-fields"><label>Start (seconds)<input id="review-start" type="number" step="0.1" min="0" value="${h.start}"></label><label>End (seconds)<input id="review-end" type="number" step="0.1" min="0" max="${clipOf(h)?.duration || 1000}" value="${h.end}"></label></div><div class="review-buttons"><button id="review-save" class="button-secondary">Save cut</button><button id="review-approve">Approve</button><button id="review-reject">Reject</button><button id="review-to-film" class="primary">Add to film →</button></div><div class="clip-meta"><span class="eyebrow">WHOLE CLIP AI ANALYSIS</span><h3>${safe(a?.title || 'Not yet analyzed')}</h3><p>${safe(a?.summary || a?.error || 'No summary available')}</p><div id="clip-editorial"></div><details><summary>AI evidence, story and reasoning</summary><div id="clip-story"></div></details><details><summary>LLM request and raw response (technical)</summary><pre id="clip-raw" class="log">Loading...</pre></details></div>`;
  $('#clip-editorial').insertAdjacentHTML(
    'afterend',
    '<details class="clip-meta"><summary>Conversation understanding</summary><div id="clip-conversations" class="cards-list">Loading…</div></details>',
  );
  $('#review-to-film').insertAdjacentHTML(
    'beforebegin',
    '<button id="review-delete" class="button-secondary danger-button">Delete</button>',
  );
  const update = async (status) => {
    try {
      const h2 = await send(`/api/highlights/${encodeURIComponent(h.id)}`, 'PATCH', {
        start: Number($('#review-start').value),
        end: Number($('#review-end').value),
        ...(status ? { status } : {}),
      });
      Object.assign(h, h2);
      notify('Highlight updated');
      renderLibrary();
    } catch (e) {
      notify(e.message);
    }
  };
  $('#review-save').onclick = () => update();
  $('#review-approve').onclick = () => update('approved');
  $('#review-reject').onclick = () => update('rejected');
  $('#review-to-film').onclick = async () => {
    navigate('studio');
    await addHighlightIds([h.id]);
  };
  $('#review-delete').onclick = async () => {
    if (!confirm(`Delete “${h.title}”? This cannot be undone.`)) return;
    try {
      await api(`/api/highlights/${encodeURIComponent(h.id)}`, { method: 'DELETE' });
      selectedHighlightIds.delete(h.id);
      selected = null;
      $('#review').innerHTML = '<div class="empty">Highlight deleted.</div>';
      await reload();
      notify('Highlight deleted');
    } catch (error) {
      notify(error.message);
    }
  };
  $('#review').insertAdjacentHTML(
    'beforeend',
    `<details class="clip-meta"><summary>Your feedback</summary><div class="range-fields"><label>Rating<select id="feedback-rating"><option value="">No rating</option>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}">${n} star${n === 1 ? '' : 's'}</option>`).join('')}</select></label><label>Category<select id="feedback-category"><option value="">Choose one</option>${['too_short', 'too_long', 'starts_too_late', 'ends_too_early', 'missed_important_action', 'missing_context', 'missing_reaction', 'wrong_interpretation', 'not_interesting', 'repetitive', 'bad_audio', 'funny_moment', 'great_action', 'excellent_storytelling'].map((x) => `<option value="${x}">${safe(x.replaceAll('_', ' '))}</option>`).join('')}</select></label></div><label>Notes<textarea id="feedback-notes" rows="2" placeholder="Optional feedback for future review"></textarea></label><label class="checkbox-row"><input id="feedback-favorite" type="checkbox"> Favorite</label><button id="feedback-save" class="button-secondary">Save feedback</button><div id="feedback-history" class="muted little"></div></details><details class="clip-meta"><summary>Mark a missed moment</summary><p class="muted little">Uses the current cut range; adjust start/end above first.</p><label>Description<textarea id="missed-description" rows="2" placeholder="What did Clipforge miss?"></textarea></label><button id="missed-save" class="button-secondary">Save missed moment</button></details>`,
  );
  const renderFeedback = async () => {
    const rows = await api(`/api/highlights/${encodeURIComponent(h.id)}/feedback`);
    $('#feedback-history').textContent = rows.length
      ? rows
          .map(
            (r) =>
              `${r.rating ? `${r.rating}/5` : ''}${r.category ? ` · ${r.category.replaceAll('_', ' ')}` : ''}${r.favorite ? ' · favorite' : ''}`,
          )
          .join('\n')
      : 'No feedback yet.';
  };
  $('#feedback-save').onclick = async () => {
    try {
      await clickTask($('#feedback-save'), 'Saving...', async () => {
        await send(`/api/highlights/${encodeURIComponent(h.id)}/feedback`, 'POST', {
          ...(Number($('#feedback-rating').value)
            ? { rating: Number($('#feedback-rating').value) }
            : {}),
          ...($('#feedback-category').value ? { category: $('#feedback-category').value } : {}),
          notes: $('#feedback-notes').value,
          favorite: $('#feedback-favorite').checked,
        });
        await renderFeedback();
        notify('Feedback saved');
      });
    } catch {}
  };
  $('#missed-save').onclick = async () => {
    try {
      await clickTask($('#missed-save'), 'Saving...', async () => {
        await send('/api/missed-moments', 'POST', {
          clipId: h.clip_id,
          start: Number($('#review-start').value),
          end: Number($('#review-end').value),
          description: $('#missed-description').value,
          category: 'missed_important_action',
        });
        notify('Missed moment saved for your next targeted reanalysis');
      });
    } catch {}
  };
  renderFeedback().catch((e) => notify(e.message));
  const v = $('#review-player');
  v.addEventListener('loadedmetadata', () => {
    v.currentTime = h.start;
  });
  v.addEventListener('timeupdate', () => {
    stopAtBoundary(v, Number($('#review-end').value));
  });
  const conversationBox = $('#clip-conversations');
  const editorialBox = $('#clip-editorial');
  if (editorialBox) {
    try {
      const data = JSON.parse(a?.analysis_json || '{}');
      const e = data.editorial;
      if (e) {
        editorialBox.innerHTML = `<div class="editorial-pills"><span class="pill">Tone: ${safe(e.tone || 'unknown')}</span><span class="pill">Energy: ${safe(e.energy ?? '?')}/100</span><span class="pill">Humor: ${safe(e.humor ?? '?')}/100</span><span class="pill">Action: ${safe(e.action ?? '?')}/100</span><span class="pill">Speech: ${safe(e.speechLevel || 'unknown')}</span></div><p><b>Best suited for:</b> ${safe((e.bestUses || []).join(' · ') || 'Not classified')}</p><p><b>Audio:</b> ${safe((e.soundscape || []).join(' · ') || 'No confirmed events')}</p><p><b>Hook:</b> ${safe(e.hook || 'None identified')}</p>`;
      }
    } catch {}
  }
  const story = $('#clip-story');
  try {
    const events = JSON.parse(a?.story_json || '[]');
    story.innerHTML =
      events
        .map(
          (x) =>
            `<button class="button-secondary" data-seek="${x.start}">${seconds(x.start)}: ${safe(x.description)}</button>`,
        )
        .join('') || '<p>No event breakdown.</p>';
    story.querySelectorAll('[data-seek]').forEach(
      (b) =>
        (b.onclick = () => {
          v.currentTime = Number(b.dataset.seek);
          v.play();
        }),
    );
  } catch {
    story.textContent = 'No structured story.';
  }
  api('/api/analysis/clip/' + encodeURIComponent(h.clip_id))
    .then((r) => {
      const out = $('#clip-raw');
      if (out) out.textContent = JSON.stringify(r, null, 2);
      const stage = r.stages?.find(
        (s) => s.stage === 'conversation-understanding' && s.status === 'success',
      );
      if (conversationBox) {
        try {
          const conversations = JSON.parse(stage?.payload_json || '{}').conversations || [];
          conversationBox.innerHTML = conversations.length
            ? conversations
                .map(
                  (c) =>
                    `<button class="button-secondary" data-conversation-seek="${c.start}">${seconds(c.start)}–${seconds(c.end)}: ${safe(c.summary)}</button>`,
                )
                .join('')
            : '<p class="muted little">No conversation artifact for this clip.</p>';
          conversationBox.querySelectorAll('[data-conversation-seek]').forEach(
            (button) =>
              (button.onclick = () => {
                v.currentTime = Number(button.dataset.conversationSeek);
                v.play();
              }),
          );
        } catch {
          conversationBox.textContent = 'Conversation artifact could not be read.';
        }
      }
    })
    .catch((e) => {
      const out = $('#clip-raw');
      if (out) out.textContent = e.message;
    });
}
$('#add-selected-to-studio').onclick = async () => {
  navigate('studio');
  openPicker();
};
async function loadProposal() {
  try {
    proposal = await api('/api/montage/suggestion');
  } catch {
    proposal = null;
  }
  const p = proposal?.proposal;
  $('#proposal-overview').innerHTML = p
    ? `<span class="tag">AI suggestion · ${p.sequence.length} highlights</span><h3>${safe(p.title)}</h3><p>${safe(p.description)}</p><p class="muted little">${safe(p.concept)}</p>`
    : '<p>No AI suggestion yet. Analyze clips or generate a suggestion.</p>';
  $('#suggestion-to-editor').hidden = !p;
  $('#studio-suggestion').innerHTML = p
    ? `<strong>${safe(p.title)}</strong><p>${safe(p.description)}</p><p class="muted little">${p.sequence.length} suggested highlights. Effects below can be edited before creating a film.</p>`
    : 'No suggestion yet.';
  $('#load-ai-suggestion').disabled = !p;
  $('#save-suggestion-effects').disabled = !p;
  renderSuggestionTransitions();
}
function renderSuggestionTransitions() {
  const p = proposal?.proposal;
  const target = $('#suggestion-transition-editor');
  if (!p) {
    target.innerHTML = '';
    return;
  }
  target.innerHTML = p.sequence
    .map((part, i) => {
      const h = highlightOf(part.highlightId),
        type =
          i === 0 ? 'cut' : transitionTypes.includes(part.transition) ? part.transition : 'cut';
      const opts = transitionTypes
        .map(
          (t) =>
            `<option value="${t}" ${type === t ? 'selected' : ''}>${safe(effectNames[t])}</option>`,
        )
        .join('');
      return `<div class="suggestion-cut" data-suggestion-cut="${safe(part.highlightId)}"><div class="suggestion-cut-top"><span class="suggestion-count">${i + 1}</span><div><strong>${safe(h?.title || part.highlightId)}</strong><p class="muted little">${safe(part.reason)}</p></div></div><div class="suggestion-effect-fields"><label>Transition in<select data-suggestion-transition ${i === 0 ? 'disabled' : ''}>${opts}</select></label><label>Duration (s)<input data-suggestion-duration type="number" min="0.1" max="1.5" step="0.1" value="${part.transitionDuration ?? 0.5}" ${i === 0 ? 'disabled' : ''}></label></div></div>`;
    })
    .join('');
}
function suggestionEdits() {
  return $$('[data-suggestion-cut]').map((element, i) => ({
    highlightId: element.dataset.suggestionCut,
    transition: i === 0 ? 'cut' : element.querySelector('[data-suggestion-transition]').value,
    transitionDuration: Number(element.querySelector('[data-suggestion-duration]').value),
  }));
}
async function saveSuggestionEffects() {
  if (!proposal) return;
  const result = await send('/api/montage/suggestion', 'PATCH', {
    createdAt: proposal.createdAt,
    sequence: suggestionEdits(),
  });
  proposal = result;
  $('#suggestion-edit-status').textContent =
    'Effects saved. They will be applied when creating a film draft.';
}
$('#save-suggestion-effects').onclick = async () => {
  try {
    await clickTask($('#save-suggestion-effects'), 'Saving...', saveSuggestionEffects);
  } catch {}
};
$('#suggestion-to-editor').onclick = () => {
  navigate('studio');
  $('#suggestion-transition-editor').scrollIntoView({
    behavior: 'smooth',
    block: 'center',
  });
};
$('#load-ai-suggestion').onclick = () => makeSuggestedDraft();
async function makeSuggestedDraft() {
  const p = proposal?.proposal;
  if (!p) return;
  try {
    await clickTask($('#load-ai-suggestion'), 'Creating film...', async () => {
      await saveSuggestionEffects();
      const ids = p.sequence.map((x) => x.highlightId).filter((id) => highlightOf(id));
      const made = await send('/api/editor/projects', 'POST', {
        name: p.title,
        description: p.description,
        highlightIds: ids,
        origin: 'ai-suggestion',
      });
      await reload();
      await openProject(made.id);
      project.items.forEach((item, i) => {
        const source = proposal.proposal.sequence.find((x) => x.highlightId === item.id);
        item.transition =
          i === 0
            ? 'cut'
            : transitionTypes.includes(source?.transition)
              ? source.transition
              : 'cut';
        item.transitionDuration = source?.transitionDuration ?? 0.5;
      });
      renderTimeline();
      await saveFilm();
      navigate('studio');
      notify('AI suggestion copied to a film draft with editable transitions');
    });
  } catch {}
}
async function pollSuggestionJob() {
  try {
    const result = await api('/api/montage/generate/status');
    const running = result.status === 'running',
      button = $('#proposal-generate');
    if (running && !button.classList.contains('is-busy')) busy(button, true, 'Generating...');
    if (!running && button.classList.contains('is-busy')) {
      busy(button, false);
      if (result.status === 'completed') await loadProposal();
      if (result.status === 'failed') notify('Film suggestion failed: ' + result.error);
    }
    $('#proposal-generation-status').textContent = running
      ? 'AI is regenerating your film suggestion. You can continue browsing.'
      : result.status === 'failed'
        ? `Last regeneration failed: ${result.error}`
        : '';
  } catch (error) {
    $('#proposal-generation-status').textContent =
      'Suggestion status unavailable: ' + error.message;
  }
}
$('#proposal-generate').onclick = async () => {
  const btn = $('#proposal-generate');
  busy(btn, true, 'Generating...');
  $('#proposal-generation-status').textContent = 'Sending your editing instructions to AI...';
  try {
    await send('/api/montage/generate', 'POST', {
      guidance: $('#proposal-guidance').value,
    });
    await pollSuggestionJob();
    notify('AI is preparing a new film suggestion');
  } catch (e) {
    busy(btn, false);
    $('#proposal-generation-status').textContent = e.message;
    notify(e.message);
  }
};
function renderProjectList() {
  $('#film-project-list').innerHTML =
    projects
      .map(
        (p) =>
          `<div class="film-project-row"><label class="film-project-select" title="Select film for deletion"><input type="checkbox" data-film-select value="${safe(p.id)}" aria-label="Select ${safe(p.name)} for deletion"></label><button class="project-entry ${project?.id === p.id ? 'active' : ''}" data-project="${safe(p.id)}"><strong>${safe(p.name)}</strong><span class="muted little">${new Date(p.created_at).toLocaleDateString()} · ${safe(p.id.slice(0, 8))}</span></button></div>`,
      )
      .join('') || '<p class="muted little">No films yet. Start a new draft.</p>';
  $$('[data-project]').forEach((b) => (b.onclick = () => openProject(b.dataset.project)));
  $$('[data-film-select]').forEach(
    (c) =>
      (c.onchange = () => {
        $('#delete-selected-films').disabled = !$$('[data-film-select]:checked').length;
      }),
  );
  $('#delete-selected-films').disabled = true;
}
$('#delete-selected-films').onclick = async () => {
  const ids = $$('[data-film-select]:checked').map((x) => x.value),
    names = projects.filter((p) => ids.includes(p.id)).map((p) => p.name);
  if (!ids.length) return;
  if (
    !confirm(
      `Delete ${ids.length} film project(s)?\n\n${names.join('\n')}\n\nThis deletes film drafts and generated renders. Original clips and highlights will remain.`,
    )
  )
    return;
  try {
    await clickTask($('#delete-selected-films'), 'Deleting...', async () => {
      for (const id of ids)
        await api('/api/editor/projects/' + encodeURIComponent(id), {
          method: 'DELETE',
        });
      if (project && ids.includes(project.id)) {
        stopPreview();
        project = null;
        $('#editor-empty').hidden = false;
        $('#editor-content').hidden = true;
      }
      await reload();
      notify(`${ids.length} film project(s) removed; source clips preserved`);
    });
  } catch {}
};
async function makeFilm(ids = [], name = 'Untitled film', description = '') {
  if (!ids.length) {
    const first = highlights.find((h) => h.status !== 'rejected') || highlights[0];
    if (!first) throw Error('Analyze clips before creating a film');
    ids = [first.id];
  }
  const p = await send('/api/editor/projects', 'POST', {
    name,
    description,
    highlightIds: ids,
    origin: 'manual',
  });
  await reload();
  await openProject(p.id);
}
$('#new-film').onclick = async () => {
  try {
    await clickTask($('#new-film'), 'Creating film...', async () => {
      await makeFilm();
      notify('New editable film created');
    });
  } catch {}
};
async function openProject(id) {
  try {
    stopPreview();
    project = await api('/api/editor/projects/' + encodeURIComponent(id));
    $('#editor-empty').hidden = true;
    $('#editor-content').hidden = false;
    $('#film-title').value = project.name;
    $('#film-description').value = project.description || '';
    renderTimeline();
    renderProjectList();
  } catch (e) {
    notify(e.message);
  }
}
function captureCuts() {
  if (!project) return;
  $$('.timeline-item').forEach((el) => {
    const item = project.items.find((x) => x.id === el.dataset.item);
    if (item) {
      item.start = Number(el.querySelector('[data-cut=start]').value);
      item.end = Number(el.querySelector('[data-cut=end]').value);
      item.speed = Number(el.querySelector('[data-cut=speed]').value);
      item.transition = el.querySelector('[data-cut=transition]').value;
      item.transitionDuration = Number(el.querySelector('[data-cut=transitionDuration]').value);
    }
  });
}
function renderTimeline() {
  if (!project) return;
  const d = project.items.reduce((sum, i) => sum + (i.end - i.start) / (i.speed || 1), 0);
  $('#editor-duration').textContent = `${seconds(d)} · ${project.items.length} cuts`;
  $('#timeline').innerHTML = project.items
    .map(
      (h, i) =>
        `<div class="timeline-item" data-item="${safe(h.id)}"><div class="timeline-index">${i + 1}</div><div><div class="timeline-title">${safe(h.title)}</div><div class="timeline-reason">${safe(h.description)}</div><div class="timeline-cuts"><label>In <input type="number" min="0" step="0.1" data-cut="start" value="${h.start}"></label><label>Out <input type="number" min="0" step="0.1" data-cut="end" value="${h.end}"></label><label>Speed<select data-cut="speed">${[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((v) => `<option value="${v}" ${(h.speed || 1) === v ? 'selected' : ''}>${v}×</option>`).join('')}</select></label><label>Transition in<select data-cut="transition" ${i === 0 ? 'disabled' : ''}>${transitionTypes.map((t) => `<option value="${t}" ${h.transition === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label><label>Effect (s)<input type="number" min="0.1" max="1.5" step="0.1" data-cut="transitionDuration" value="${h.transitionDuration ?? 0.5}" ${i === 0 ? 'disabled' : ''}></label><span class="muted little">${safe(fileName(h.source_path))}</span></div></div><div class="timeline-buttons"><button data-move="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move cut up">↑</button><button data-move="${i}" data-dir="1" ${i === project.items.length - 1 ? 'disabled' : ''} aria-label="Move cut down">↓</button><button data-remove="${i}" ${project.items.length === 1 ? 'disabled' : ''} aria-label="Remove cut">✕</button></div></div>`,
    )
    .join('');
  $$('[data-move]').forEach(
    (b) =>
      (b.onclick = () => {
        captureCuts();
        const i = Number(b.dataset.move),
          j = i + Number(b.dataset.dir);
        [project.items[i], project.items[j]] = [project.items[j], project.items[i]];
        renderTimeline();
      }),
  );
  $$('[data-remove]').forEach(
    (b) =>
      (b.onclick = () => {
        captureCuts();
        project.items.splice(Number(b.dataset.remove), 1);
        renderTimeline();
      }),
  );
  $$('[data-cut]').forEach(
    (input) =>
      (input.onchange = () => {
        captureCuts();
        $('#editor-duration').textContent =
          `${seconds(project.items.reduce((a, i) => a + (i.end - i.start) / (i.speed || 1), 0))} · ${project.items.length} cuts`;
      }),
  );
}
async function saveFilm() {
  if (!project) return;
  captureCuts();
  const body = {
    name: $('#film-title').value.trim(),
    description: $('#film-description').value,
    items: project.items.map((x) => ({
      highlightId: x.id,
      start: x.start,
      end: x.end,
      speed: x.speed || 1,
      transition: x.transition || 'cut',
      transitionDuration: x.transitionDuration ?? 0.5,
    })),
  };
  project = await send(`/api/editor/projects/${encodeURIComponent(project.id)}`, 'PUT', body);
  await reload();
  notify('Montage draft saved');
}
$('#save-film').onclick = async () => {
  try {
    await clickTask($('#save-film'), 'Saving...', saveFilm);
  } catch {}
};
async function addHighlightIds(ids) {
  if (!ids.length) return;
  try {
    if (!project) {
      await makeFilm(ids, 'My montage');
      return;
    }
    captureCuts();
    for (const id of ids) {
      if (project.items.some((x) => x.id === id)) continue;
      const h = highlightOf(id);
      if (h) {
        project.items.push({
          ...h,
          speed: 1,
          transition: 'cut',
          transitionDuration: 0.5,
          source_path: clipOf(h)?.source_path,
        });
      }
    }
    renderTimeline();
    notify('Added to montage. Save draft to persist.');
  } catch (e) {
    notify(e.message);
  }
}
function openPicker() {
  if (!highlights.length) {
    notify('Analyze your clips first');
    return;
  }
  $('#picker-query').value = '';
  renderPicker();
  $('#picker-dialog').showModal();
}
function renderPicker() {
  const q = $('#picker-query').value.toLowerCase();
  $('#picker-items').innerHTML =
    highlights
      .filter((h) => `${h.title} ${h.description}`.toLowerCase().includes(q))
      .map(
        (h) =>
          `<div class="picker-item"><label><input type="checkbox" value="${safe(h.id)}" ${project?.items.some((i) => i.id === h.id) ? 'disabled' : ''}><span><strong>${safe(h.title)}</strong><small>${seconds(h.start)}–${seconds(h.end)} · ${h.score}/100 · ${safe(h.origin)}</small></span></label></div>`,
      )
      .join('') || '<p>No matching highlights</p>';
}
$('#pick-highlights').onclick = openPicker;
$('#picker-query').oninput = renderPicker;
$('#picker-close').onclick = () => $('#picker-dialog').close();
$('#picker-add').onclick = async () => {
  const ids = $$('#picker-items input:checked').map((x) => x.value);
  $('#picker-dialog').close();
  await addHighlightIds(ids);
};
const player = $('#sequence-player');
function planForPreview(items) {
  // The browser cannot preview FFmpeg transitions, so merge compatible adjacent cuts
  // to avoid a visible seek between contiguous pieces of the same source.
  const plan = [];
  for (const source of items) {
    const item = { ...source };
    const last = plan.at(-1);
    if (
      last &&
      last.clip_id === item.clip_id &&
      last.source_path === item.source_path &&
      last.speed === item.speed &&
      item.start >= last.start &&
      item.start <= last.end + 1.5
    ) {
      last.end = Math.max(last.end, item.end);
    } else {
      plan.push(item);
    }
  }
  return plan;
}
function stopPreview() {
  playing = false;
  player.pause();
  $('#preview-status').textContent = 'Preview stopped';
}
function playPart(index) {
  if (!playing) return;
  if (index >= previewItems.length) {
    stopPreview();
    $('#preview-status').textContent = 'Preview finished';
    return;
  }
  playIndex = index;
  const item = previewItems[index];
  player.style.display = 'block';
  $('#preview-placeholder').hidden = true;
  $('#preview-status').textContent = `Cut ${index + 1}/${previewItems.length}: ${item.title}`;
  const source = `/media/${encodeURIComponent(item.clip_id)}`;
  const seek = () => {
    player.playbackRate = item.speed || 1;
    player.currentTime = item.start;
    player.play().catch((e) => notify('Preview playback: ' + e.message));
  };
  if (player.getAttribute('src') !== source) {
    player.setAttribute('src', source);
    player.load();
    player.addEventListener('loadedmetadata', seek, { once: true });
  } else seek();
}
player.addEventListener('timeupdate', () => {
  if (playing && player.currentTime >= previewItems[playIndex].end - 0.075) playPart(playIndex + 1);
});
player.addEventListener('ended', () => {
  if (playing) playPart(playIndex + 1);
});
$('#preview-film').onclick = () => {
  if (!project) return;
  captureCuts();
  if (
    project.items.some(
      (x) =>
        !Number.isFinite(x.start) ||
        !Number.isFinite(x.end) ||
        x.end <= x.start ||
        !Number.isFinite(x.speed || 1),
    )
  ) {
    notify('Fix invalid trim values');
    return;
  }
  previewItems = planForPreview(project.items);
  playing = true;
  playPart(0);
  if (previewItems.some((x, i) => i > 0 && x.transition && x.transition !== 'cut'))
    notify('Preview uses hard cuts; transitions appear in rendered MP4');
};
$('#stop-preview').onclick = stopPreview;
$('#render-film').onclick = async () => {
  if (!project) return;
  const btn = $('#render-film');
  busy(btn, true, 'Rendering MP4...');
  try {
    await saveFilm();
    const id = project.id;
    await send(`/api/editor/projects/${encodeURIComponent(id)}/render`, 'POST', {});
    $('#render-status').textContent = 'Rendering MP4...';
    let attempts = 0;
    const poll = async () => {
      const state = await api(`/api/projects/${encodeURIComponent(id)}/status`);
      if (state.status === 'running' && attempts++ < 1200) return setTimeout(poll, 1500);
      busy(btn, false);
      if (state.status === 'completed') {
        $('#render-status').innerHTML =
          `Ready: <a href="/api/projects/${encodeURIComponent(id)}/download">Download MP4</a>`;
      } else $('#render-status').textContent = 'Render failed: ' + (state.error || 'timeout');
    };
    poll().catch((e) => {
      busy(btn, false);
      notify(e.message);
    });
  } catch (e) {
    busy(btn, false);
    notify(e.message);
  }
};
let lastRun = '';
async function pollRuns() {
  try {
    analysisRuns = await api('/api/analysis/runs');
    const latest = analysisRuns[0];
    $('#run-status').textContent = latest
      ? `${latest.status.toUpperCase()} · ${latest.current_stage || 'pending'} · ${latest.processed_count}/${latest.source_count} files${latest.current_file ? ' · ' + fileName(latest.current_file) : ''}${latest.error ? ' · ' + latest.error : ''}`
      : 'No analysis yet';
    $('#run-select').innerHTML = analysisRuns
      .map(
        (r) => `<option value="${safe(r.id)}">${safe(r.started_at)} · ${safe(r.status)}</option>`,
      )
      .join('');
    const current = $('#run-select').dataset.selected;
    if (current && analysisRuns.some((r) => r.id === current)) $('#run-select').value = current;
    if (latest) {
      const id = $('#run-select').value || latest.id,
        events = await api('/api/analysis/events/' + encodeURIComponent(id));
      $('#run-log').textContent =
        events.map((e) => `${e.at} [${e.stage}] ${e.level}: ${e.message}`).join('\n') ||
        'No events yet';
      const usage = await api('/api/ai/usage?runId=' + encodeURIComponent(id));
      const s = usage.summary;
      $('#run-usage').textContent =
        `${s.calls} AI calls · ${s.inputTokens.toLocaleString()} input tokens · ${s.outputTokens.toLocaleString()} output tokens · ${s.imagesSent} images · Subscription CLI billing not available per run${s.providerReportedCalls ? ` · $${s.providerReportedUsd.toFixed(5)} CLI-reported (${s.providerReportedCalls} calls)` : ''}`;
      $('#usage-calls').innerHTML =
        usage.calls
          .map(
            (c) =>
              `<div>${safe(c.stage)} · ${safe(c.provider)}/${safe(c.model || 'default')} · ${Number(c.input_tokens || 0).toLocaleString()} in / ${Number(c.output_tokens || 0).toLocaleString()} out · ${c.image_count ?? 0} images${c.provider_reported_usd === null ? '' : ` · CLI $${Number(c.provider_reported_usd).toFixed(5)}`}</div>`,
          )
          .join('') || 'No AI calls recorded';
    }
    if (!uiJob) {
      const active = await api('/api/analysis/jobs/active');
      if (active.status === 'running') uiJob = active.jobId;
    }
    const running = latest?.status === 'running' || Boolean(uiJob);
    const banner = $('#global-run-banner');
    banner.hidden = !running;
    if (running) {
      $('#global-run-label').textContent =
        `Analysis running · ${latest?.current_stage || 'starting'} · ${latest?.processed_count || 0}/${latest?.source_count || '?'} files`;
      const total = latest?.source_count || 0;
      $('#global-run-fill').style.width = total
        ? `${Math.min(100, (100 * (latest?.processed_count || 0)) / total)}%`
        : '5%';
    }
    $('#start-analysis').disabled = running;
    $('#stop-analysis').disabled = !(uiJob || latest?.status === 'running');
    if (lastRun && latest?.id === lastRun && latest.status !== 'running') {
      await reload();
      lastRun = '';
    }
    if (latest?.status === 'running') lastRun = latest.id;
  } catch (e) {
    $('#run-status').textContent = e.message;
  }
}
$('#go-run-details').onclick = () => {
  navigate('home');
  document.querySelector('#run-status').scrollIntoView({ behavior: 'smooth', block: 'center' });
};
$('#run-select').onchange = () => {
  $('#run-select').dataset.selected = $('#run-select').value;
  pollRuns();
};
$('#start-analysis').onclick = async () => {
  busy($('#start-analysis'), true, 'Analyzing...');
  try {
    const r = await send('/api/analysis/start', 'POST', {
      provider: $('#analysis-provider').value,
      force: $('#analysis-force').checked,
    });
    uiJob = r.jobId;
    notify('Analysis started');
    $('#analysis-job-status').textContent = 'Analysis in progress...';
    pollRuns();
  } catch (e) {
    busy($('#start-analysis'), false);
    notify(e.message);
  }
};
$('#stop-analysis').onclick = async () => {
  busy($('#stop-analysis'), true, 'Stopping...');
  try {
    const latest = analysisRuns[0];
    if (!uiJob && latest?.status === 'running') {
      const active = await api('/api/analysis/jobs/active');
      if (active.status === 'running') uiJob = active.jobId;
    }
    if (!uiJob && latest?.status === 'running') {
      if (
        !confirm(
          'The dashboard that started this run is no longer available. Clear its stuck record? This cannot stop a separately run CLI analysis.',
        )
      )
        return;
      await send('/api/analysis/runs/' + encodeURIComponent(latest.id) + '/cancel', 'POST');
      $('#analysis-job-status').textContent = 'Abandoned analysis record cleared.';
      await pollRuns();
      return;
    }
    const result = await send(
      uiJob
        ? '/api/analysis/jobs/' + encodeURIComponent(uiJob) + '/cancel'
        : '/api/analysis/jobs/active/cancel',
      'POST',
    );
    if (result.jobId) uiJob = result.jobId;
    $('#analysis-job-status').textContent = 'Stopping analysis...';
  } catch (e) {
    notify(e.message);
  } finally {
    busy($('#stop-analysis'), false);
  }
};
async function pollUiJob() {
  if (!uiJob) return;
  try {
    const result = await api('/api/analysis/jobs/' + uiJob);
    if (result.status !== 'running') {
      uiJob = null;
      busy($('#start-analysis'), false);
      $('#analysis-job-status').textContent =
        result.status === 'cancelled'
          ? 'Analysis stopped'
          : result.status === 'completed'
            ? 'Analysis complete'
            : result.status === 'completed_with_warnings'
              ? `Analysis finished with warnings: ${result.error}`
              : `Analysis failed: ${result.error}`;
      await reload();
    }
  } catch (e) {
    $('#analysis-job-status').textContent = e.message;
  }
}
async function loadSettings() {
  settings = await api('/api/settings');
  const c = settings.config;
  $('#project-name').textContent = c.project.name;
  $('#ctx-name').value = c.project.name;
  $('#ctx-focus').value = c.project.focus;
  $('#ctx-description').value = c.project.description;
  $('#ctx-content').value = settings.context;
  $('#analysis-provider').value = c.aiStages?.clipAnalysis?.provider || c.agent.provider;
  await loadInventory();
  renderProcessing();
  await loadPrompts();
}
$('#save-creative').onclick = async () => {
  try {
    busy($('#save-creative'), true, 'Saving...');
    settings.config.project.name = $('#ctx-name').value;
    settings.config.project.focus = $('#ctx-focus').value;
    settings.config.project.description = $('#ctx-description').value;
    settings.context = $('#ctx-content').value;
    await send('/api/settings', 'PUT', settings);
    $('#project-name').textContent = settings.config.project.name;
    notify('Project direction saved');
  } catch (e) {
    notify(e.message);
  } finally {
    busy($('#save-creative'), false);
  }
};
function modelOptions(provider, selectedModel = '') {
  const entry = inventory?.providers?.[provider];
  const models = entry?.modelDetails || [];
  const fallback = provider === 'none' ? 'No AI' : 'Use provider default';
  const options = [
    `<option value="">${safe(fallback)}</option>`,
    ...models.map(
      (m) =>
        `<option value="${safe(m.id)}" ${selectedModel === m.id ? 'selected' : ''}>${safe(m.label)}${m.inputModalities?.length ? ' · ' + safe(m.inputModalities.join(', ')) : ''}${m.isDefault ? ' (default)' : ''}</option>`,
    ),
  ];
  if (selectedModel && !models.some((x) => x.id === selectedModel))
    options.push(
      `<option value="${safe(selectedModel)}" disabled>Unavailable: ${safe(selectedModel)}</option>`,
    );
  return options.join('');
}
async function loadInventory() {
  inventory = await api('/api/ai/models');
  $('#model-scan-results').innerHTML = Object.entries(inventory.providers)
    .map(
      ([key, v]) =>
        `<div class="adapter-card"><div class="adapter-card-title"><strong>${safe(key.toUpperCase())}</strong><span class="tag ${v.usable ? 'approved' : 'rejected'}">${v.usable ? 'Available' : v.installed ? 'CLI only' : 'Not installed'}</span></div><div class="muted little">${safe(v.version || 'Provider API')} · ${safe(v.note)}</div><div class="adapter-models">${v.modelDetails.map((m) => `<code title="${safe(m.inputModalities.join(', '))}">${safe(m.label)}</code>`).join('') || '<span class="muted little">No models available. Use CLI default, connect the API or refresh the catalog.</span>'}</div></div>`,
    )
    .join('');
  const stages = inventory.stages;
  $('#stage-config').innerHTML = [
    ['clipAnalysis', 'Clip analysis'],
    ['montage', 'Movie suggestion'],
  ]
    .map(
      ([id, label]) =>
        `<div><label>${label} agent<select id="agent-${id}">${['none', 'codex', 'claude', 'deepseek'].map((p) => `<option value="${p}" ${stages[id].provider === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label></div><div><label>${label} model<select id="model-${id}">${modelOptions(stages[id].provider, stages[id].model || '')}</select></label></div>`,
    )
    .join('');
}
$('#model-scan').onclick = async () => {
  try {
    await clickTask($('#model-scan'), 'Scanning...', loadInventory);
  } catch {}
};
$('#save-stages').onclick = async () => {
  try {
    busy($('#save-stages'), true, 'Saving...');
    const get = (id) => ({
      provider: $('#agent-' + id).value,
      model: $('#model-' + id).value,
    });
    const stages = {
      clipAnalysis: get('clipAnalysis'),
      montage: get('montage'),
    };
    await send('/api/ai/stages', 'PUT', stages);
    $('#analysis-provider').value = stages.clipAnalysis.provider;
    notify('Agent and model settings saved');
  } catch (e) {
    notify(e.message);
  } finally {
    busy($('#save-stages'), false);
  }
};
$('#stage-config').addEventListener('change', (event) => {
  if (!event.target.id?.startsWith('agent-')) return;
  const stage = event.target.id.replace('agent-', '');
  const data = $('#model-' + stage);
  if (data) data.innerHTML = modelOptions(event.target.value);
});
$('#agent-test-button').onclick = async () => {
  busy($('#agent-test-button'), true, 'Testing AI...');
  const e = $('#agent-test-result');
  e.hidden = false;
  e.textContent = 'Calling agent...';
  try {
    e.textContent = JSON.stringify(
      await send('/api/agent-test', 'POST', {
        stage: 'clipAnalysis',
        provider: $('#agent-clipAnalysis').value,
        model: $('#model-clipAnalysis').value,
      }),
      null,
      2,
    );
  } catch (error) {
    e.textContent = 'ERROR: ' + error.message;
  } finally {
    busy($('#agent-test-button'), false);
  }
};
async function loadPrompts() {
  const prompts = await api('/api/prompts');
  $('#prompts-panel').innerHTML = Object.entries(prompts)
    .map(
      ([name, value]) =>
        `<div class="prompt-entry"><h3>${safe(name)}.md</h3><textarea id="prompt-${safe(name)}" rows="11" aria-label="${safe(name)} prompt">${safe(value)}</textarea><button data-prompt-save="${safe(name)}" class="button-secondary">Save prompt</button></div>`,
    )
    .join('');
  $$('[data-prompt-save]').forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          await clickTask(b, 'Saving...', async () => {
            await send('/api/prompts', 'PUT', {
              name: b.dataset.promptSave,
              content: $('#prompt-' + b.dataset.promptSave).value,
            });
            notify('Prompt updated');
          });
        } catch {}
      }),
  );
}
function renderProcessing() {
  const c = settings.config;
  $('#processing-fields').innerHTML =
    `<label>Clips directory<input id="cfg-directory" value="${safe(c.mediaDir)}"></label><label>Screenshot interval (seconds)<input id="cfg-interval" type="number" min="0.1" step="0.1" value="${c.analysis.frameIntervalSeconds}"></label><label>Max clip duration (seconds)<input id="cfg-duration" type="number" min="1" value="${c.analysis.maxDurationSeconds ?? ''}" placeholder="Unlimited"></label><label>Max images sent to AI (1–30)<input id="cfg-image-limit" type="number" min="1" max="30" value="${c.analysis.maxImagesPerClip ?? 8}"></label><label>Screenshot max width (px)<input id="cfg-image-width" type="number" min="256" max="1920" step="1" value="${c.analysis.imageMaxWidth ?? 640}"></label><label>Max highlights per clip<input id="cfg-highlights" type="number" min="1" value="${c.analysis.maxHighlightsPerClip}"></label><label><input id="cfg-transcription" type="checkbox" ${c.transcription.enabled ? 'checked' : ''}> Enable transcription</label><label><input id="cfg-sounds" type="checkbox" ${c.soundClassifier.enabled ? 'checked' : ''}> Enable sound classifier</label>`;
}
$('#save-processing').onclick = async () => {
  try {
    const c = settings.config;
    c.mediaDir = $('#cfg-directory').value;
    c.analysis.frameIntervalSeconds = Number($('#cfg-interval').value);
    c.analysis.maxDurationSeconds = $('#cfg-duration').value
      ? Number($('#cfg-duration').value)
      : null;
    c.analysis.maxHighlightsPerClip = Number($('#cfg-highlights').value);
    c.analysis.maxImagesPerClip = Number($('#cfg-image-limit').value);
    c.analysis.imageMaxWidth = Number($('#cfg-image-width').value);
    c.transcription.enabled = $('#cfg-transcription').checked;
    c.soundClassifier.enabled = $('#cfg-sounds').checked;
    await send('/api/settings', 'PUT', settings);
    notify('Processing settings saved');
  } catch (e) {
    notify(e.message);
  }
};
$('#refresh-diagnostics').onclick = async () => {
  try {
    $('#technical-diagnostics').textContent = JSON.stringify(
      {
        runs: await api('/api/analysis/runs'),
        models: await api('/api/ai/models'),
      },
      null,
      2,
    );
  } catch (e) {
    notify(e.message);
  }
};
async function init() {
  await Promise.all([reload(), loadSettings(), pollRuns(), pollSuggestionJob()]);
  const hash = location.hash.slice(1);
  navigate(['home', 'library', 'studio', 'adapters', 'settings'].includes(hash) ? hash : 'home');
  setInterval(() => {
    pollRuns();
    pollUiJob();
    pollSuggestionJob();
  }, 2400);
}
init().catch((e) => notify(e.message));
