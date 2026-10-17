import { normalizeSettings, checkRepository, createCapture, safeWebUrl, displayTime } from './core.js';
import { parseShare, parseTime, positionFromUrl, freshDraft, hasDraftContent } from './share.js';
import { get, put, list, remove, enqueue, acceptShare, journalDraft, forgetJournal, recoverDraftJournal } from './storage.js';
import { sendPending } from './queue.js';

const $ = id => document.getElementById(id);
let connection;
let draft;
let busy = true;
let writes = Promise.resolve();
let installPrompt;

function message(text, error = false, target = 'status') {
  $(target).textContent = text;
  $(target).classList.toggle('error', error);
}
function setBusy(value) {
  busy = value;
  $('capture-fields').disabled = value;
  $('save').disabled = value;
  $('retry').disabled = value;
  $('save').textContent = value ? 'Saving…' : connection ? 'Save to GitHub ↗' : 'Connect GitHub';
}
function readDraft() {
  return { ...draft, text: $('thought').value, kind: document.querySelector('input[name="kind"]:checked').value,
    source: $('source-url').value.trim(), title: $('source-title').value.trim(), timeText: $('video-time').value.trim(),
    includeSource: $('include-source').checked, touched: Date.now() };
}
function persistDraft() {
  if (!draft) return writes;
  draft = readDraft();
  const snapshot = { ...draft };
  journalDraft(snapshot);
  writes = writes.catch(() => {}).then(() => hasDraftContent(snapshot) ? put('drafts', snapshot) : remove('drafts', snapshot.id));
  return writes;
}
function renderSource() {
  let host = '';
  try { host = new URL(draft.source).hostname; } catch { /* A manual URL may still be incomplete. */ }
  const position = draft.timeText ? parseTime(draft.timeText) : draft.seconds;
  $('source-summary').textContent = host ? host + (position != null ? ' · ' + displayTime(position) : '') : draft.quote ? 'Shared text included' : 'Add a link or video time';
  $('shared-text').textContent = draft.quote || '';
  $('shared-text').hidden = !draft.quote;
}
function renderDraft() {
  $('thought').value = draft.text || '';
  const kind = ['note', 'task', 'idea'].includes(draft.kind) ? draft.kind : 'note';
  document.querySelector('input[name="kind"][value="' + kind + '"]').checked = true;
  $('source-url').value = draft.source || '';
  $('source-title').value = draft.title || '';
  $('video-time').value = draft.timeText || (draft.seconds != null ? displayTime(draft.seconds) : '');
  $('include-source').checked = draft.includeSource !== false;
  $('source-details').open = false;
  renderSource();
}
async function refreshCounts() {
  const [drafts, queue] = await Promise.all([list('drafts'), list('queue')]);
  $('draft-count').textContent = drafts.length;
  $('waiting-count').textContent = queue.length;
  $('pending-card').hidden = !queue.length;
  $('pending-count').textContent = queue.length + (queue.length === 1 ? ' capture waiting' : ' captures waiting');
}
function renderConnection() {
  $('connection').textContent = connection?.repository || 'Connect your private repository';
  $('disconnect').hidden = !connection;
  if (!busy) setBusy(false);
}
function openSettings() {
  $('repository').value = connection?.repository || '';
  $('token').value = connection?.token || '';
  $('folder').value = connection?.folder || 'inbox';
  $('settings-dialog').showModal();
}
function reportFailure(error) { message(error.message || 'Something went wrong. Your draft has not been cleared.', true); }

async function receiveShares() {
  const url = new URL(location.href);
  const requested = url.searchParams.get('share');
  const incoming = (await list('shares')).sort((a, b) => a.received - b.received);
  for (const share of incoming) {
    const context = parseShare(share.fields);
    const received = freshDraft({ ...context, id: share.id, touched: share.received });
    await acceptShare(share.id, received);
  }
  if (url.searchParams.has('share-error')) message('Shared content could not be kept on this phone. Allow site storage, then share it again.', true);
  url.searchParams.delete('share');
  url.searchParams.delete('share-error');
  history.replaceState({}, '', url);
  return requested;
}

async function init() {
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('./sw.js', { type: 'module', scope: './' }).then(registration => {
      if (registration.waiting) message('An app update is ready. Close all Repo Notes windows and reopen it to apply.');
    }).catch(() => message('Offline setup could not finish. Keep this page open while saving and reopen it online before sharing.', true));
  } else message('Phone installation and offline sharing need this app to be served over HTTPS.', true);
  await recoverDraftJournal();
  const requested = await receiveShares();
  connection = await get('settings', 'connection');
  const drafts = (await list('drafts')).sort((a, b) => b.touched - a.touched);
  draft = drafts.find(item => item.id === requested) || drafts[0] || freshDraft();
  renderDraft();
  renderConnection();
  await refreshCounts();
  setBusy(false);
  $('online').textContent = navigator.onLine ? 'Markdown, yours.' : 'Offline · saved here first';
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) $('install-card').hidden = true;
}

for (const input of document.querySelectorAll('#capture-fields input, #thought')) {
  input.addEventListener('input', () => {
    persistDraft().then(refreshCounts).catch(reportFailure);
    renderSource();
  });
}
$('capture-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  if (!connection) { openSettings(); return; }
  setBusy(true);
  $('saved-link').hidden = true;
  message('');
  try {
    await persistDraft();
    const input = { ...draft };
    if (input.includeSource && input.source && !safeWebUrl(input.source)) throw new Error('Enter a complete http:// or https:// link, or turn off Include source.');
    const seconds = input.timeText ? parseTime(input.timeText) : positionFromUrl(input.source);
    if (input.includeSource && input.timeText && seconds === null) throw new Error('Use a video time such as 12:34, 1:02:03, or 754 seconds.');
    if (!input.title && input.source && safeWebUrl(input.source)) input.title = new URL(input.source).hostname;
    input.seconds = seconds;
    const capture = createCapture(input, normalizeSettings(connection), new Date(), input.id);
    await enqueue(capture);
    forgetJournal(capture.id);
    draft = freshDraft({ source: draft.source, title: draft.title, quote: draft.quote, seconds, timeText: draft.timeText, includeSource: draft.includeSource });
    renderDraft();
    await refreshCounts();
    const result = await sendPending();
    const saved = result.sent.find(item => item.id === capture.id);
    if (saved) {
      message('Saved to your private repository.');
      $('saved-link').href = saved.url;
      $('saved-link').hidden = false;
    } else message(result.error || 'Kept on this phone. Tap Retry to send it to GitHub.', true);
    await refreshCounts();
  } catch (error) { reportFailure(error); }
  finally { setBusy(false); }
});
$('retry').addEventListener('click', async () => {
  if (busy) return;
  if (!connection) { openSettings(); return; }
  setBusy(true);
  message('Sending waiting captures…');
  try {
    const result = await sendPending();
    message(result.error || result.sent.length + (result.sent.length === 1 ? ' capture saved to GitHub.' : ' captures saved to GitHub.'), Boolean(result.error));
    await refreshCounts();
  } catch (error) { reportFailure(error); }
  finally { setBusy(false); }
});
$('settings-open').addEventListener('click', openSettings);
$('settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('connect').disabled = true;
  $('disconnect').disabled = true;
  message('Checking your private repository…', false, 'settings-status');
  try {
    const settings = normalizeSettings({ repository: $('repository').value, token: $('token').value, folder: $('folder').value });
    await checkRepository(settings);
    await put('settings', settings, 'connection');
    connection = settings;
    renderConnection();
    message('Connected to ' + settings.repository + '. Save a note to check write access.', false, 'settings-status');
  } catch (error) { message(error.message, true, 'settings-status'); }
  finally { $('connect').disabled = false; $('disconnect').disabled = false; }
});
$('disconnect').addEventListener('click', async () => {
  try {
    await remove('settings', 'connection');
    connection = undefined;
    $('token').value = '';
    renderConnection();
    message('Disconnected. Drafts and waiting captures are still on this phone.', false, 'settings-status');
  } catch (error) { message(error.message, true, 'settings-status'); }
});
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => $(button.dataset.close).close());

async function openLocal(kind) {
  if (busy) return;
  await persistDraft();
  const items = (await list(kind)).sort((a, b) => kind === 'drafts' ? b.touched - a.touched : b.capture.created.localeCompare(a.capture.created));
  $('local-heading').textContent = kind === 'drafts' ? 'Your drafts' : 'Waiting for GitHub';
  $('local-list').replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = kind === 'drafts' ? 'No unfinished thoughts. You have a clear page.' : 'Everything has been sent to GitHub.';
    $('local-list').append(empty);
  }
  for (const item of items) {
    const note = kind === 'drafts' ? item : item.capture;
    const card = document.createElement('div');
    card.className = 'list-item';
    const title = document.createElement(kind === 'drafts' ? 'button' : 'p');
    title.textContent = (note.text || note.title || note.source || 'Shared text').slice(0, 160);
    if (kind === 'drafts') {
      title.type = 'button';
      title.addEventListener('click', async () => {
        try { draft = await get('drafts', item.id) || freshDraft(); renderDraft(); $('local-dialog').close(); await refreshCounts(); } catch (error) { reportFailure(error); }
      });
    }
    const meta = document.createElement('p');
    meta.className = 'list-meta';
    meta.textContent = kind === 'drafts' ? note.kind + (note.source ? ' · ' + note.source : '') : note.repository + (item.error ? ' · ' + item.error : ' · Waiting to send');
    card.append(title, meta);
    $('local-list').append(card);
  }
  $('local-dialog').showModal();
  await refreshCounts();
}
$('drafts-open').addEventListener('click', () => openLocal('drafts').catch(reportFailure));
$('waiting-open').addEventListener('click', () => openLocal('queue').catch(reportFailure));
$('backup').addEventListener('click', async () => {
  try {
    await persistDraft();
    const [drafts, queue, shares] = await Promise.all([list('drafts'), list('queue'), list('shares')]);
    const blob = new Blob([JSON.stringify({ app: 'Repo Notes', exported: new Date().toISOString(), drafts, waiting: queue, shares }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'repo-notes-local-backup.json';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    message('Local backup prepared. It contains drafts and waiting captures, without your token.', false, 'settings-status');
  } catch (error) { message(error.message, true, 'settings-status'); }
});
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; });
window.addEventListener('appinstalled', () => { installPrompt = undefined; $('install-card').hidden = true; });
$('install').addEventListener('click', async () => {
  if (!installPrompt) { $('install-help').showModal(); return; }
  await installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = undefined;
});
window.addEventListener('online', () => { $('online').textContent = 'Online · tap Retry to send'; });
window.addEventListener('offline', () => { $('online').textContent = 'Offline · saved here first'; });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persistDraft().catch(() => {});
  else refreshCounts().catch(reportFailure);
});
init().catch(error => { message(error.message, true); $('save').disabled = true; });
