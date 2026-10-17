import { safeWebUrl } from './core.js';

function textValue(value, max = 50000) { return typeof value === 'string' ? value.slice(0, max).trim() : ''; }
function candidates(text) {
  return (text.match(/https?:\/\/[^\s<>"`]+/gi) || []).map(raw => {
    let url = raw.replace(/[.,;!?]+$/, '');
    while (url.endsWith(')') && (url.match(/\)/g) || []).length > (url.match(/\(/g) || []).length) url = url.slice(0, -1);
    return { raw, url: safeWebUrl(url) };
  }).filter(item => item.url);
}

export function parseTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d+(?:\.\d+)?s?$/.test(raw)) return Math.floor(Number(raw.replace(/s$/, '')));
  if (/^\d+:\d{1,2}(?::\d{1,2})?$/.test(raw)) {
    const parts = raw.split(':').map(Number);
    if (parts.slice(1).some(part => part >= 60)) return null;
    return parts.reduce((seconds, part) => seconds * 60 + part, 0);
  }
  const units = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  return units && units[0] ? Number(units[1] || 0) * 3600 + Number(units[2] || 0) * 60 + Number(units[3] || 0) : null;
}

export function positionFromUrl(source) {
  try {
    const url = new URL(source);
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname)) return null;
    return parseTime(url.searchParams.get('t') || url.searchParams.get('start') || url.hash.replace(/^#t=/, ''));
  } catch { return null; }
}

export function parseShare(input) {
  const title = textValue(input.title, 1000);
  const text = textValue(input.text);
  const link = textValue(input.url, 10000);
  const fromText = candidates(text);
  const source = safeWebUrl(link) || fromText[0]?.url || candidates(title)[0]?.url || '';
  let quote = text;
  if (source && fromText.length) {
    const first = fromText[0];
    if (first.url === source) quote = quote.replace(first.raw, '').trim();
  }
  if (source && quote === title) quote = '';
  const sourceTitle = title && !safeWebUrl(title) ? title : source ? new URL(source).hostname : 'Shared text';
  return { title: sourceTitle.slice(0, 250), source, quote, seconds: positionFromUrl(source) };
}

export function sharedFields(form) {
  // Android commonly puts the URL in text rather than the url field.
  return { title: textValue(form.get('title'), 1000), text: textValue(form.get('text')), url: textValue(form.get('url'), 10000) };
}

export function freshDraft(context = {}) {
  return { id: crypto.randomUUID(), kind: 'note', text: '', source: '', title: '', quote: '', seconds: null, timeText: '', includeSource: true, touched: Date.now(), ...context };
}

export function hasDraftContent(draft) {
  return Boolean(draft.text?.trim() || draft.source?.trim() || draft.quote?.trim());
}
