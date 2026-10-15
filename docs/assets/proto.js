/* Shared prototype behaviour.
   The dialog helper implements what aria-modal="true" does NOT give you for
   free: focus trap, Escape to close, focus restore, and background inert.
   In the React app, use a headless dialog primitive instead of this. */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function createDialog(id) {
  const root = document.getElementById(id);
  if (!root) return null;
  const panel = root.querySelector('.dlg');
  let lastFocused = null;

  function onKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const items = [...panel.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function open() {
    lastFocused = document.activeElement;
    root.hidden = false;
    document.body.style.overflow = 'hidden';
    // Background is inert so screen readers and Tab cannot reach it.
    [...document.body.children].forEach(el => {
      if (el !== root) { el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true'); }
    });
    document.addEventListener('keydown', onKeydown);
    const target = panel.querySelector('[data-autofocus]') || panel.querySelector(FOCUSABLE);
    if (target) setTimeout(() => target.focus(), 20);
  }

  function close() {
    root.hidden = true;
    document.body.style.overflow = '';
    [...document.body.children].forEach(el => {
      el.removeAttribute('inert'); el.removeAttribute('aria-hidden');
    });
    document.removeEventListener('keydown', onKeydown);
    if (lastFocused) lastFocused.focus(); // restore focus to the trigger
  }

  root.addEventListener('mousedown', e => { if (e.target === root) close(); });
  root.querySelectorAll('[data-dlg-close]').forEach(b => b.addEventListener('click', close));
  return { open, close, root };
}

/** Announce to screen readers via a polite live region. */
export function announce(msg) {
  let live = document.getElementById('sr-live');
  if (!live) {
    live = document.createElement('div');
    live.id = 'sr-live';
    live.className = 'sr-only';
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    document.body.appendChild(live);
  }
  live.textContent = '';
  setTimeout(() => { live.textContent = msg; }, 60);
}

/**
 * Live catalog search against Deezer's public API.
 * Uses JSONP because api.deezer.com sends no Access-Control-Allow-Origin,
 * so a browser fetch() is blocked. THE REAL APP DOES NOT DO THIS — it calls
 * the server route /api/catalog/search, which also enforces rate limiting.
 */
let jsonpSeq = 0;
export function searchCatalog(term, limit = 8) {
  return new Promise((resolve, reject) => {
    const cb = `__dzcb${++jsonpSeq}`;
    const script = document.createElement('script');
    const timer = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, 8000);
    function cleanup() {
      clearTimeout(timer);
      delete window[cb];
      script.remove();
    }
    window[cb] = data => {
      cleanup();
      resolve((data.data || []).map(t => ({
        deezerId:    t.id,
        title:       t.title,
        artist:      t.artist?.name ?? '',
        album:       t.album?.title ?? '',
        durationSec: t.duration,
        artworkUrl:  t.album?.cover_small ?? '',
        isExplicit:  Boolean(t.explicit_lyrics),
      })));
    };
    script.onerror = () => { cleanup(); reject(new Error('network')); };
    script.src = `https://api.deezer.com/search?q=${encodeURIComponent(term)}` +
                 `&limit=${limit}&output=jsonp&callback=${cb}`;
    document.head.appendChild(script);
  });
}

/**
 * Fetch one track's full detail — notably the ISRC, which the search endpoint
 * does not return. Same JSONP caveat as searchCatalog().
 */
export function getTrack(deezerId) {
  return new Promise((resolve, reject) => {
    const cb = `__dztcb${++jsonpSeq}`;
    const script = document.createElement('script');
    const timer = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, 8000);
    function cleanup() { clearTimeout(timer); delete window[cb]; script.remove(); }
    window[cb] = t => {
      cleanup();
      if (t.error) { reject(new Error(t.error.message || 'not found')); return; }
      resolve({
        deezerId:    t.id,
        title:       t.title,
        artist:      (t.contributors || []).map(c => c.name).join(', ') || t.artist?.name || '',
        album:       t.album?.title ?? '',
        durationSec: t.duration,
        artworkUrl:  t.album?.cover_small ?? '',
        isExplicit:  Boolean(t.explicit_lyrics),
        // Spotify's isrc: filter needs uppercase with no dashes.
        isrc:        (t.isrc || '').toUpperCase().replace(/-/g, ''),
      });
    };
    script.onerror = () => { cleanup(); reject(new Error('network')); };
    script.src = `https://api.deezer.com/track/${deezerId}?output=jsonp&callback=${cb}`;
    document.head.appendChild(script);
  });
}

export const fmtDuration = s =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** School-safety lexicon, phrase-level. Deliberately NOT substring matching:
 *  "Hugs Not Drugs" and "Pumped Up Kicks" must not trip a bare substring rule. */
const LEXICON = [
  { phrase: 'pumped up kicks', reason: 'School-safety theme' },
  { phrase: 'gun',             reason: 'Weapons reference', wholeWord: true },
  { phrase: 'shoot',           reason: 'Violence reference', wholeWord: true },
];

export function screenTrack({ title, artist, isExplicit, source = 'catalog' }) {
  const hay = `${title} ${artist}`.toLowerCase();
  const matched = LEXICON.filter(({ phrase, wholeWord }) =>
    wholeWord ? new RegExp(`\\b${phrase}\\b`).test(hay) : hay.includes(phrase)
  ).map(m => m.reason);

  // A manual row has no label explicit flag, so the ABSENCE of one means
  // nothing. It gets its own status and must never be bulk-approved as clean.
  if (source === 'manual') {
    return { isExplicitTag: false, matchedKeywords: matched, status: 'unverified' };
  }
  return {
    isExplicitTag: Boolean(isExplicit),
    matchedKeywords: matched,
    status: isExplicit || matched.length ? 'flagged' : 'clean',
  };
}
