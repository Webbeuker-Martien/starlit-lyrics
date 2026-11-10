# Starlit Lyrics

Synced Spotify lyrics in VS Code. Inspired by
[Shuri](https://marketplace.visualstudio.com/items?itemName=o-p.shuri) and the StarryNight theme
from [Spicetify](https://spicetify.app).

<p>
  <img src="docs/screenshots/starry-synced.png" width="260" alt="Synced lyrics in the Starry Night theme">
  <img src="docs/screenshots/starry-away.png" width="260" alt="Back to current line pill after scrolling away">
  <img src="docs/screenshots/vscode-synced.png" width="260" alt="Synced lyrics in the Match VS Code theme">
</p>

## Features

- **Synced lyrics from LRClib**: exact lookup on title, artist, album and duration, with a fuzzy-search
  fallback. Results are cached per track.
- **Never stale.** On a track change the view clears instantly, and late results for an old track are
  thrown away.
- **Clear states** for signed out, nothing playing, paused, ad, podcast, loading, no lyrics,
  instrumental and plain (unsynced) lyrics.
- **Smooth timing.** Spotify is polled every 3 s while playing (and right when a song should end). Position is
  interpolated locally with `requestAnimationFrame`, so the active line stays within ~200 ms.
- **Follow mode.** The active line glides to about 40% from the top. Scroll away and a
  *Back to current line* pill appears at the bottom-right.
- **Click a line to seek** (needs Spotify Premium).
- **Word-level highlight** when LRClib has enhanced `<mm:ss.xx>` timestamps.
- **Two themes.** *Starry Night* (StarryNight Spicetify colors, twinkling stars and the odd shooting
  star) or *Match VS Code* (your editor theme's colors only). `prefers-reduced-motion` is respected.

<p>
  <img src="docs/screenshots/starry-none.png" width="260" alt="No synced lyrics state">
  <img src="docs/screenshots/starry-plain.png" width="260" alt="Plain lyrics fallback">
  <img src="docs/screenshots/starry-signin.png" width="260" alt="Sign-in view">
</p>

## Setup

1. **Install** the `.vsix`: Extensions view → `…` → *Install from VSIX…*, or run
   `code --install-extension starlit-lyrics-0.1.0.vsix`.
2. **Create a Spotify app** at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard):
   - Redirect URI: `http://127.0.0.1:5566/callback` (or your `starlit.port`).
   - API: *Web API*.
   - Under *User Management*, add the email of the Spotify account you listen with.
   - You can reuse the app you made for Shuri if it already has this redirect URI.
3. Open the **Explorer** sidebar, expand **Lyrics**, paste the app's **Client ID** and click *Sign in*.
   Approve in the browser.
4. Play something in Spotify. To get lyrics in an editor column instead, run
   **Starlit Lyrics: Open Lyrics in Editor**.

> Since 11 Feb 2026, Spotify's Development Mode needs the app owner to have **Spotify Premium**.
> Without it, Spotify refuses the requests and the view says so. See INSPECTION.md for an evaluated
> fallback that reads the Windows media session instead.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `starlit.theme` | `starryNight` | `starryNight` or `matchVsCode` |
| `starlit.lyricOffsetMs` | `0` | Positive shows lines earlier, negative later (±5000) |
| `starlit.fontSize` | `16` | Lyrics font size in px |
| `starlit.followCurrentLine` | `true` | Auto-scroll to the active line |
| `starlit.port` | `5566` | Port for the sign-in callback |

Commands (prefix *Starlit Lyrics:*): Open Lyrics in Editor, Sign in to Spotify, Sign out of Spotify,
Show Lyrics 100 ms Earlier / Later, Toggle Follow Current Line, Switch Theme.

## Development and releases

The full flow, from a fresh clone to a published release. You need [Node.js](https://nodejs.org)
(LTS), [Git](https://git-scm.com) and VS Code.

### 1. Clone and install

```sh
git clone https://github.com/Webbeuker-Martien/starlit-lyrics.git
cd starlit-lyrics
npm install
```

### 2. Make and test changes

1. Open the folder in VS Code and press **F5**. A second window (the Extension Development Host)
   runs your version of the extension. After editing, press **Ctrl+R** in that window to reload.
2. To check the panel's look without Spotify, open `preview/index.html?state=synced` in Chrome.
   Other states: `none`, `plain`, `loading`, `signedOut`, `instrumental`, `podcast`, `ad`, `nothing`,
   `error`. You can add `&theme=matchVsCode`, `&paused=1` or `&away=1`.
3. Run the type check and unit tests:

   ```sh
   npm run check
   ```

### 3. Try the real package

```sh
npx @vscode/vsce package
code --install-extension starlit-lyrics-<version>.vsix --force
```

Then run **Developer: Reload Window** (Ctrl+Shift+P) in your normal VS Code.

### 4. Commit

1. Add a section at the top of `CHANGELOG.md` for the next version, e.g. `## 0.1.2`, with one line
   per change.
2. Commit everything:

   ```sh
   git add -A
   git commit -m "Describe the change"
   ```

### 5. Publish the release

One-time setup per PC (skip if done): log in with a Marketplace personal access token. Create it at
dev.azure.com → User settings → Personal access tokens, with **Organization: All accessible
organizations** and scope **Marketplace → Manage**.

```sh
npx @vscode/vsce login MartienVogel
```

Then publish, choosing the version bump that fits the change:

```sh
npx @vscode/vsce publish patch     # bug fix or small tweak:   0.1.1 → 0.1.2
npx @vscode/vsce publish minor     # new feature or setting:   0.1.2 → 0.2.0
npx @vscode/vsce publish major     # big or breaking change:   0.2.0 → 1.0.0
```

This raises `version` in `package.json` and commits it with a `v<version>` tag. Then it runs the
checks and the production build, and uploads. Finally, push the code and the tag:

```sh
git push --follow-tags
```

The Marketplace page updates within a few minutes, and installed copies update automatically.

| Problem | Fix |
| --- | --- |
| 401 or "unauthorized" | The token expired or has the wrong settings: make a new one and run `vsce login` again. |
| "Git working directory not clean" | Commit your changes first (step 4). |
| "version already exists" | Use `publish patch` instead of plain `publish`. |
| Changes don't show after installing a `.vsix` | Run **Developer: Reload Window**. |

More detail, including creating a brand-new extension, is in
[docs/EXTENSION-PLAYBOOK.md](docs/EXTENSION-PLAYBOOK.md).

### Project layout

- `src/core/` holds pure logic with unit tests: LRC parser, LRClib client, the track-change session
  with its stale-fetch guard, and the Spotify response mapper.
- `src/spotify/` has PKCE sign-in and API calls. `src/host/` has polling and webview wiring.
- `media/` is the webview (plain JS and CSS, no build step).
- `preview/index.html` renders the real webview in a browser with fake data, and
  `bash preview/shoot.sh` regenerates the screenshots with headless Chrome.

## Credits

Built after studying [Shuri](https://github.com/elbaph/shuri) by o-p (Unlicense). Lyrics come from
[LRClib](https://lrclib.net), and playback comes from the
[Spotify Web API](https://developer.spotify.com/documentation/web-api). The Starry Night palette
comes from the StarryNight theme for [Spicetify](https://spicetify.app).

## License

Unlicense (public domain), same as Shuri.
