import { normalizeSettings, uploadCapture } from './core.js';
import { list, put, get, acknowledge, lockName } from './storage.js';

export async function sendPending(onProgress = () => {}) {
  if (!navigator.locks) throw new Error('Open this app in a current Chrome browser over HTTPS to send captures.');
  return navigator.locks.request(lockName, async () => {
    const stored = await get('settings', 'connection');
    if (!stored) throw new Error('Connect your private GitHub repository in Settings first.');
    const settings = normalizeSettings(stored);
    const items = (await list('queue')).sort((a, b) => a.capture.created.localeCompare(b.capture.created));
    const sent = [];
    let error = '';
    const matching = items.filter(item => item.capture.repository.toLowerCase() === settings.repository.toLowerCase());
    for (const item of matching) {
      try {
        const url = await uploadCapture(item.capture, settings);
        await acknowledge(item, url);
        sent.push({ id: item.id, url });
        onProgress(sent.length);
      } catch (failure) {
        error = failure.message;
        await put('queue', { ...item, error });
        break;
      }
    }
    const remaining = await list('queue');
    if (!error && remaining.length && !matching.length) error = 'These waiting captures belong to another repository. Connect that repository in Settings to send them.';
    return { sent, remaining: remaining.length, error };
  });
}
