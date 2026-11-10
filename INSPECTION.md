# Shuri inspection

Inspected: `o-p.shuri` v0.2.1, installed at `%USERPROFILE%\.vscode\extensions\o-p.shuri-0.2.1`
(source repo listed as github.com/elbaph/shuri). License: **Unlicense** (public domain), so reuse
is allowed. Starlit Lyrics was still written from scratch. Shuri was used only to understand
behavior and APIs, and the README credits it.

## Architecture

| Part | Where | What it does |
| --- | --- | --- |
| Extension host | `out/extension.js` (esbuild bundle, minified) | OAuth, polling, LRClib lookups, timing, message broadcast |
| Sidebar view | `shuri.lyricsView` in the Explorer, `media/lyricsView*` | Webview with lyrics, a "Sync" button and an error line |
| Editor panel | `shuri.lyrics` command, `media/lyrics*` | Same UI in an editor column (near-identical copy of the view files) |
| Sign-in | `media/signIn*` | Client ID field and a hint for the redirect URI |
| Dependencies | `node-fetch`, `lru-cache`, `ts-treemap` | HTTP, track cache, a sorted map for timestamp lookups |

The host broadcasts messages to every open webview: `addLyrics` (the full line list), `pickLyrics`
(the active line id), `clearLyrics` and `syncError`. The webview sends back `ready`, `seekToPosition`
and `signInClicked`.

### Playback state (Spotify Web API)

- OAuth Authorization Code + PKCE, using the user's own Client ID. A local HTTP server listens on
  `127.0.0.1:<shuri.port>/callback` (default 5566). Tokens go in `context.secrets`.
- Scopes: `user-read-currently-playing user-modify-playback-state`.
- Polls `GET /v1/me/player/currently-playing` every 3 s, with exponential backoff up to 10 s on errors.
  A 429 pauses polling for `Retry-After`, and a 401 signs the user out. With `shuri.pauseOnBlur`,
  polling stops while the VS Code window is unfocused.
- Progress is stored host-side as `(progress_ms, Date.now(), is_playing)` and extrapolated.

### Lyrics (LRClib)

- `GET https://lrclib.net/api/get?track_name&artist_name&album_name&duration`. There is no fallback to
  `/api/search`.
- `artist_name` is **all artists joined with ", "** ("A, B"), which often misses LRClib entries
  stored under the primary artist only.
- The User-Agent impersonates another project: `LRCGET v0.2.0 (https://github.com/therepanic/spotilyrics)`.
- LRC parsing uses a regex that accepts only `[mm:ss.xx]` (exactly 2 fraction digits). `[mm:ss.xxx]`,
  `[mm:ss]` and repeated timestamps are dropped, and `[offset:]` is ignored.
- Results are cached in an LRU keyed by `"<title>__<artists>"`, default size 10.

### Sync

- A host-side `setInterval` every **250 ms** runs `floorEntry(position)` on the timestamp tree map
  and posts `pickLyrics` when the active id changes. The active line can therefore lag up to
  ~250 ms plus message latency, and timing stops when the host is busy.
- The webview applies `past`, `current` and `future` classes and calls
  `scrollIntoView({block: 'center'})`.

## Root causes of the three bugs

### 1. Stale lyrics after a song change

In the poll handler (deminified):

```js
let match = (c) => c && (id && c.trackId ? c.trackId === id : c.authors === artists && c.name === title);
if (!match(current)) { const cached = cache.get(key); if (cached) { current = cached; send(cached); } }
if (match(current)) { tick(); }
else {
  const res = await lrclib.getLyrics(title, artists, album, duration);
  if (res && !res.instrumental) { /* build, set current, send addLyrics */ }
  else current ? unpick() : post({ command: 'clearLyrics' });   // <- bug
}
```

- When LRClib has **no lyrics** (404) or the track is **instrumental**, and a previous track exists
  (`current` is set), Shuri only calls `unpick()`. That posts `pickLyrics: -1`, which removes the
  highlight. **The previous song's lyrics stay rendered** while the header and title update to the new
  song. `current` is never reset, so this repeats on every poll.
- Nothing clears the view while the LRClib request for the new track runs, so even when lyrics exist,
  the old ones show until the fetch resolves.
- There is no request tagging or abort. If a slow response for song A arrives after the user skipped to
  B, it still becomes `current` and gets rendered.

**Fix in Starlit:** `LyricsSession` (`src/core/session.ts`) switches the view to `loading` for the
new track synchronously on track-id change, aborts the previous fetch and tags each fetch with a
generation number plus the track id. Late results are dropped. Every view message carries its
track, and the webview also ignores timing ticks for any other track id. Instrumental and none have
their own views. Covered by `test/session.test.ts`.

### 2. Sync button floats halfway down the lyrics

`lyricsViewStyle.css`: the button is a sibling after `.box`, with `position: sticky; bottom: 8px`.
`html, body { height: 100% }` and `.box { height: 100% }` make the body exactly one viewport tall,
while the lyrics overflow it, and the document scrolls. A sticky element can't leave its containing
block (`body`), so once you scroll past the first screen, the button stays pinned to the bottom edge
of `body`. That edge is ~1 viewport down the document, so the button appears halfway through the
lyrics. It also uses `margin: 8px auto` on an inline-flex element, which doesn't center it.

**Fix in Starlit:** lyrics scroll inside their own `#scroller` element. The pill is
`position: fixed; right: 12px; bottom: 12px` outside it, so the scroll position can't move it.
It shows only after real user input (wheel, touch, scroll keys, scrollbar drag) turns follow mode
off, and it hides again when following resumes. If the user scrolls back to the active line, follow
resumes automatically. The arrow points toward the active line.

### 3. Plain styling

Plain list, `editor.selectionBackground` highlight on the current line, no artwork in the view
(only in the panel tab icon, using the smallest 64 px image), no visual hierarchy. Starlit adds the
header with round art and a ring, scaled and glowing active line, dimmed past lines, word-level
highlight, a progress hairline and the Starry Night theme.

### Smaller issues found along the way

- The sidebar view's title is set to the placeholder "Gunko" in `resolveWebviewView`, and stays that
  way until the first poll replaces it.
- The "lyrics not found" message is random each time and gives no track name.
- Two copies of the webview HTML, JS and CSS (`lyrics*` and `lyricsView*`) that differ only in naming.
- Episodes and ads aren't distinguished. A 204 or `item: null` covers both.

## Optional Windows media-session source (evaluated, not built)

Since 11 Feb 2026, Spotify's Development Mode requires the app owner to have **Premium**. A
fallback that reads Windows' **Global System Media Transport Controls** (GSMTC) session would avoid
the Spotify API entirely.

**Spike:** `tools/media-session-spike.ps1` loads `GlobalSystemMediaTransportControlsSessionManager`
from Windows PowerShell 5.1 via the WinRT projection, without errors. Spotify wasn't running during
the spike, so its timeline accuracy hasn't been measured yet. Run the script while a song plays to
check.

| | Spotify Web API (built) | Windows media session (proposed) |
| --- | --- | --- |
| Account | Own developer app, Premium required since Feb 2026 | Nothing: no app, no OAuth, no Premium |
| Rate limits | Yes (429 handling built in) | None, it's local |
| Platforms | Any OS | Windows only (macOS/Linux would each need their own source) |
| Track identity | Stable Spotify id, album, duration, art URL | Title, artist, album; duration from `EndTime`. No id, so match on text. Art comes as a thumbnail stream, not a URL. |
| Position accuracy | `progress_ms` every poll, interpolated | `Position` + `LastUpdatedTime`. Spotify historically updates it only on play, pause and seek events, so you extrapolate from the last event. Accuracy needs measuring. |
| Seek (click a line) | Yes (Premium) | `TryChangePlaybackPositionAsync`. Spotify may ignore it. |
| Ads, podcasts | `currently_playing_type` says which | Heuristics only (ads show as "Advertisement" or "Spotify") |
| Implementation | Pure TypeScript | Needs a native bridge: a long-running PowerShell helper printing JSON lines (no build step, ~1 s startup), a small bundled .exe, or a native Node addon (per-Electron-version builds) |
| Other players | Spotify only | Any player that publishes a media session, so filtering by `SourceAppUserModelId` is needed |

**Recommendation:** worth building as `starlit.playbackSource: "auto" | "spotifyApi" |
"windowsMediaSession"`. Use a PowerShell helper process for the bridge, and have `auto` fall back to
it on the Premium 403 or when no Spotify app is configured. The `Playback` type in
`src/core/types.ts` is already source-agnostic, so the new source only has to emit the same
snapshots. Before building, run the spike during playback, and skip and seek a few times to confirm
that Spotify's timeline data is good enough for ~200 ms sync.
