// Starlit Lyrics webview. Plain JS, no build step. All text goes through textContent (no innerHTML).
// @ts-check
(function () {
  'use strict';

  /** @type {{ postMessage(msg: unknown): void }} */
  // eslint-disable-next-line no-undef
  const vscode = acquireVsCodeApi();

  const header = /** @type {HTMLElement} */ (document.getElementById('header'));
  const banner = /** @type {HTMLElement} */ (document.getElementById('banner'));
  const scroller = /** @type {HTMLElement} */ (document.getElementById('scroller'));
  const content = /** @type {HTMLElement} */ (document.getElementById('content'));
  const pill = /** @type {HTMLButtonElement} */ (document.getElementById('pill'));
  const sky = /** @type {HTMLElement} */ (document.getElementById('sky'));

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let settings = { theme: document.body.dataset.theme || 'starryNight', offsetMs: 0, fontSize: 16, follow: true, redirectUri: '', clientId: '' };
  /** @type {any} */
  let view = { status: 'nothing' };
  /** @type {string | null} */
  let trackId = null;

  // Synced lyrics state
  /** @type {{ timeMs: number, text: string, words?: { timeMs: number, text: string }[] }[]} */
  let lines = [];
  /** @type {HTMLElement[]} */
  let lineEls = [];
  /** @type {HTMLElement[][]} */
  let wordEls = [];
  let activeIndex = -2;
  let activeWord = -1;

  // Timing anchor: position `pos` was true at performance.now() === `at`.
  /** @type {{ pos: number, at: number, playing: boolean, duration: number } | null} */
  let anchor = null;

  // Scrolling
  let following = true; // false once the user scrolls away
  let programmaticUntil = 0;
  let scrollEndTimer = 0;

  // ---------------------------------------------------------------------------------------------
  // Messages

  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg?.type) {
      case 'view':
        renderView(msg.view);
        break;
      case 'tick':
        applyTick(msg.tick);
        break;
      case 'settings':
        applySettings(msg.settings);
        break;
      case 'banner':
        banner.hidden = !msg.message;
        banner.textContent = msg.message || '';
        break;
    }
  });

  // ---------------------------------------------------------------------------------------------
  // Views

  function renderView(next) {
    const nextTrackId = next.track ? next.track.id : null;
    if (nextTrackId !== trackId) {
      anchor = null; // timing of the old track is meaningless now
      following = true;
    }
    view = next;
    trackId = nextTrackId;

    lines = [];
    lineEls = [];
    wordEls = [];
    activeIndex = -2;
    activeWord = -1;
    content.replaceChildren();
    content.className = 'status-' + next.status;
    hidePill();
    renderHeader(next.track);

    switch (next.status) {
      case 'signedOut':
        renderSignIn();
        break;
      case 'nothing':
        renderEmpty('♪', 'Nothing playing', 'Start something in Spotify and the lyrics show up here.');
        break;
      case 'ad':
        renderEmpty('✦', 'Ad break', 'Lyrics are back after the ad.');
        break;
      case 'podcast':
        renderEmpty('🎙', 'Podcast episode', 'Podcasts have no lyrics. Enjoy the show.');
        break;
      case 'loading':
        renderLoading();
        break;
      case 'none':
        renderEmpty('☾', `No synced lyrics for “${next.track.title}”`, "LRClib doesn't have lyrics for this track yet.");
        break;
      case 'instrumental':
        renderEmpty('✧', 'Instrumental', 'No words in this one. Enjoy the music.');
        break;
      case 'error':
        renderError(next.message);
        break;
      case 'plain':
        renderPlain(next.lines);
        break;
      case 'synced':
        renderSynced(next.lines);
        break;
    }
    scroller.scrollTop = 0;
  }

  function renderHeader(track) {
    header.replaceChildren();
    header.hidden = !track;
    if (!track) return;

    const art = el('div', 'art');
    if (track.artUrl) {
      const img = document.createElement('img');
      img.src = track.artUrl;
      img.alt = '';
      img.addEventListener('error', () => img.remove());
      art.append(img);
    }
    const meta = el('div', 'meta');
    const title = el('div', 'title', track.title);
    title.title = track.title;
    const artist = el('div', 'artist', track.artists.join(', '));
    artist.title = track.album ? `${track.artists.join(', ')} · ${track.album}` : track.artists.join(', ');
    const badge = el('span', 'badge', 'Paused');
    badge.hidden = true;
    meta.append(title, artist);
    const progress = el('div', 'progress');
    progress.append(el('div', 'progress-fill'));
    header.append(art, meta, badge, progress);
    updatePlayingUi();
  }

  function renderEmpty(icon, title, sub) {
    const box = el('div', 'empty');
    box.append(el('div', 'empty-icon', icon), el('div', 'empty-title', title), el('div', 'empty-sub', sub));
    content.append(box);
  }

  function renderLoading() {
    const box = el('div', 'loading');
    box.setAttribute('aria-label', 'Looking up lyrics');
    for (const w of [72, 55, 84, 48, 66]) {
      const bar = el('div', 'skeleton');
      bar.style.setProperty('width', w + '%');
      box.append(bar);
    }
    box.append(el('div', 'empty-sub', 'Looking up lyrics…'));
    content.append(box);
  }

  function renderError(message) {
    const box = el('div', 'empty');
    const button = el('button', 'btn', 'Try again');
    button.addEventListener('click', () => vscode.postMessage({ type: 'retry' }));
    box.append(el('div', 'empty-icon', '!'), el('div', 'empty-title', "Couldn't load lyrics"), el('div', 'empty-sub', message), button);
    content.append(box);
  }

  function renderPlain(plain) {
    content.append(el('div', 'note', 'Lyrics are not synced'));
    const box = el('div', 'lines plain');
    for (const text of plain) {
      box.append(text ? el('div', 'line', text) : el('div', 'stanza'));
    }
    content.append(box);
  }

  function renderSynced(synced) {
    lines = synced;
    const box = el('div', 'lines synced');
    synced.forEach((line, i) => {
      const div = el('div', 'line future');
      div.dataset.i = String(i);
      if (!line.text) {
        div.classList.add('gap');
        div.textContent = '♪';
      } else if (line.words && line.words.length) {
        const spans = line.words.map((w) => el('span', 'word', w.text));
        div.append(...spans);
        wordEls[i] = spans;
      } else {
        div.textContent = line.text;
      }
      div.addEventListener('click', () => {
        // Seek so this line becomes active under the current offset.
        const target = Math.max(0, line.timeMs - settings.offsetMs + 30);
        following = true;
        hidePill();
        if (anchor) anchor = { ...anchor, pos: target, at: performance.now() };
        vscode.postMessage({ type: 'seek', positionMs: target });
      });
      lineEls.push(div);
      box.append(div);
    });
    content.append(box);
  }

  function renderSignIn() {
    const form = el('form', 'signin');
    form.append(el('div', 'empty-icon', '✦'), el('div', 'empty-title', 'Connect Spotify'));
    form.append(
      el('p', 'empty-sub', 'Create a free app in the Spotify Developer Dashboard, add this redirect URI, then paste its Client ID.'),
    );
    const uri = el('code', 'uri', settings.redirectUri);
    const input = /** @type {HTMLInputElement} */ (el('input', 'input'));
    input.type = 'text';
    input.placeholder = 'Client ID';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.value = settings.clientId || '';
    input.setAttribute('aria-label', 'Spotify Client ID');
    const button = el('button', 'btn', 'Sign in');
    /** @type {HTMLButtonElement} */ (button).type = 'submit';
    const fine = el('p', 'fine', 'Since 11 Feb 2026 Spotify requires Premium for Development Mode apps.');
    form.append(uri, input, button, fine);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (input.value.trim()) vscode.postMessage({ type: 'signIn', clientId: input.value.trim() });
    });
    content.append(form);
  }

  // ---------------------------------------------------------------------------------------------
  // Timing

  function applyTick(tick) {
    // Second stale guard: ignore timing that belongs to a different track than the one on screen.
    if (!tick.trackId || tick.trackId !== trackId) {
      if (!tick.trackId) anchor = null;
      return;
    }
    const pos = tick.progressMs + (tick.isPlaying ? Math.max(0, Date.now() - tick.sampledAt) : 0);
    const now = performance.now();
    // Ignore tiny corrections so the highlight doesn't jitter between polls.
    if (anchor && anchor.playing && tick.isPlaying && Math.abs(position() - pos) < 150) {
      anchor.duration = tick.durationMs;
    } else {
      anchor = { pos, at: now, playing: tick.isPlaying, duration: tick.durationMs };
    }
    updatePlayingUi();
  }

  function position() {
    if (!anchor) return 0;
    const p = anchor.playing ? anchor.pos + (performance.now() - anchor.at) : anchor.pos;
    return anchor.duration ? Math.min(p, anchor.duration) : p;
  }

  function updatePlayingUi() {
    const badge = header.querySelector('.badge');
    const paused = !!anchor && !anchor.playing;
    if (badge) /** @type {HTMLElement} */ (badge).hidden = !paused;
    document.body.classList.toggle('paused', paused);
  }

  function frame() {
    if (anchor) {
      const pos = position();
      const fill = /** @type {HTMLElement | null} */ (header.querySelector('.progress-fill'));
      if (fill && anchor.duration) fill.style.setProperty('transform', `scaleX(${Math.min(1, pos / anchor.duration)})`);
      if (lines.length) {
        const shifted = pos + settings.offsetMs;
        const idx = findActive(lines, shifted);
        if (idx !== activeIndex) setActive(idx);
        if (idx >= 0 && wordEls[idx]) setActiveWord(idx, shifted);
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function findActive(items, t) {
    let lo = 0;
    let hi = items.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (items[mid].timeMs <= t) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found;
  }

  function setActive(idx) {
    const prev = activeIndex;
    activeIndex = idx;
    activeWord = -1;
    const jump = prev < -1 || Math.abs(idx - prev) > 1;
    const from = jump ? 0 : Math.max(0, Math.min(prev, idx));
    const to = jump ? lineEls.length - 1 : Math.min(lineEls.length - 1, Math.max(prev, idx));
    for (let i = from; i <= to; i++) {
      const cls = i < idx ? 'past' : i === idx ? 'active' : 'future';
      const e = lineEls[i];
      if (!e.classList.contains(cls)) {
        e.classList.remove('past', 'active', 'future');
        e.classList.add(cls);
      }
      if (i !== idx && wordEls[i]) wordEls[i].forEach((w) => w.classList.remove('sung'));
    }
    // First highlight after a render jumps straight there; later ones glide.
    if (settings.follow && following) scrollToActive(prev >= -1);
    else updatePill();
  }

  function setActiveWord(idx, t) {
    const words = lines[idx].words || [];
    const w = findActive(words, t);
    if (w === activeWord) return;
    activeWord = w;
    wordEls[idx].forEach((span, i) => span.classList.toggle('sung', i <= w));
  }

  // ---------------------------------------------------------------------------------------------
  // Scrolling, follow mode and the "Back to current line" pill

  function targetTop(index) {
    if (index < 0 || !lineEls[index]) return 0;
    const e = lineEls[index];
    // Keep the active line about 40% from the top of the lyrics area.
    return e.offsetTop + e.offsetHeight / 2 - scroller.clientHeight * 0.4;
  }

  function scrollToActive(smooth = true) {
    const top = Math.max(0, targetTop(activeIndex));
    if (Math.abs(scroller.scrollTop - top) < 2) return;
    programmaticUntil = performance.now() + 800;
    scroller.scrollTo({ top, behavior: smooth && !reducedMotion.matches ? 'smooth' : 'auto' });
  }

  function activeLineInZone() {
    if (activeIndex < 0) return true;
    const e = lineEls[activeIndex];
    if (!e) return true;
    const lineCenter = e.offsetTop + e.offsetHeight / 2 - scroller.scrollTop;
    const h = scroller.clientHeight;
    return Math.abs(lineCenter - h * 0.4) < Math.max(48, h * 0.12) || Math.abs(scroller.scrollTop - Math.max(0, targetTop(activeIndex))) < 4;
  }

  function activeLineVisible() {
    if (activeIndex < 0) return true;
    const e = lineEls[activeIndex];
    if (!e) return true;
    const top = e.offsetTop - scroller.scrollTop;
    return top + e.offsetHeight > 0 && top < scroller.clientHeight;
  }

  function userScrolled() {
    if (!lines.length) return;
    following = false;
    updatePill();
  }

  // Only real user input turns follow mode off; our own smooth scrolls never do.
  scroller.addEventListener('wheel', userScrolled, { passive: true });
  scroller.addEventListener('touchmove', userScrolled, { passive: true });
  scroller.addEventListener('pointerdown', (e) => {
    if (e.target === scroller) userScrolled(); // dragging the scrollbar
  });
  scroller.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) userScrolled();
  });
  scroller.addEventListener(
    'scroll',
    () => {
      if (performance.now() < programmaticUntil) return;
      clearTimeout(scrollEndTimer);
      scrollEndTimer = window.setTimeout(() => {
        // The user scrolled back to the active line on their own: resume following.
        if (!following && settings.follow && activeLineInZone()) {
          following = true;
          hidePill();
        } else updatePill();
      }, 160);
    },
    { passive: true },
  );

  function updatePill() {
    const away = settings.follow ? !following : !activeLineVisible();
    if (activeIndex < 0 || !lines.length || !away) return hidePill();
    const e = lineEls[activeIndex];
    const above = e.offsetTop + e.offsetHeight / 2 < scroller.scrollTop + scroller.clientHeight * 0.4;
    pill.classList.toggle('up', above);
    pill.hidden = false;
    requestAnimationFrame(() => pill.classList.add('show'));
  }

  function hidePill() {
    pill.classList.remove('show');
    pill.hidden = true;
  }

  pill.addEventListener('click', () => {
    following = true;
    hidePill();
    scrollToActive(true);
  });

  window.addEventListener('resize', () => {
    if (settings.follow && following && activeIndex >= 0) scrollToActive(false);
  });

  // ---------------------------------------------------------------------------------------------
  // Settings and theme

  function applySettings(next) {
    const themeChanged = next.theme !== settings.theme;
    const prevRedirect = settings.redirectUri;
    const prevClient = settings.clientId;
    settings = next;
    document.body.dataset.theme = next.theme;
    document.body.style.setProperty('--lyrics-size', next.fontSize + 'px');
    if (themeChanged || !sky.childElementCount) setupSky();
    if (view.status === 'signedOut' && (prevRedirect !== next.redirectUri || prevClient !== next.clientId)) renderView(view);
    if (!next.follow) following = true;
    if (next.follow && following && activeIndex >= 0) scrollToActive(true);
    else updatePill();
  }

  let shootingTimer = 0;
  function setupSky() {
    clearTimeout(shootingTimer);
    sky.replaceChildren();
    if (settings.theme !== 'starryNight') return;
    for (let i = 0; i < 46; i++) {
      const s = el('span', 'star');
      const size = Math.random() < 0.15 ? 2.5 : Math.random() < 0.5 ? 1.5 : 1;
      s.style.setProperty('left', (Math.random() * 100).toFixed(2) + '%');
      s.style.setProperty('top', (Math.random() * 100).toFixed(2) + '%');
      s.style.setProperty('width', size + 'px');
      s.style.setProperty('height', size + 'px');
      s.style.setProperty('--twinkle', (2.5 + Math.random() * 4).toFixed(2) + 's');
      s.style.setProperty('--delay', (-Math.random() * 6).toFixed(2) + 's');
      s.style.setProperty('--peak', (0.55 + Math.random() * 0.45).toFixed(2));
      sky.append(s);
    }
    scheduleShootingStar();
  }

  const SHOOTING_SPEED_PX_S = 120;
  const SHOOTING_TRAIL_PX = 170; // matches .shooting width in main.css

  function scheduleShootingStar() {
    shootingTimer = window.setTimeout(() => {
      if (settings.theme === 'starryNight' && !reducedMotion.matches && !document.hidden) {
        const s = el('span', 'shooting');
        const w = sky.clientWidth;
        const h = sky.clientHeight;
        const x = w * (0.2 + Math.random() * 0.75);
        const y = h * Math.random() * 0.35;
        // Fly down-left at 55° until the head and the whole trail have left the panel.
        const dirX = -Math.cos((55 * Math.PI) / 180);
        const dirY = Math.sin((55 * Math.PI) / 180);
        const dist = Math.min(x / -dirX, (h - y) / dirY) + SHOOTING_TRAIL_PX;
        const seconds = Math.max(1.2, dist / SHOOTING_SPEED_PX_S);
        s.style.setProperty('left', x.toFixed(0) + 'px');
        s.style.setProperty('top', y.toFixed(0) + 'px');
        s.style.setProperty('--dx', (dirX * dist).toFixed(0) + 'px');
        s.style.setProperty('--dy', (dirY * dist).toFixed(0) + 'px');
        s.style.setProperty('--dur', seconds.toFixed(2) + 's');
        s.addEventListener('animationend', () => s.remove());
        sky.append(s);
      }
      scheduleShootingStar();
    }, 2500 + Math.random() * 4500);
  }

  // ---------------------------------------------------------------------------------------------

  /** @returns {HTMLElement} */
  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  setupSky();
  vscode.postMessage({ type: 'ready' });
})();
