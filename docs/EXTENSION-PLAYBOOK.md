# VS Code Extension Playbook

Nov 10, 2026 · Martien Vogel

## 1. Overview

To ship a change to a published extension: edit, test, bump the version, write a changelog line, then run `npx @vscode/vsce publish patch`. To make a new extension, copy the Starlit Lyrics layout and follow sections 3 and 4.

The one-time accounts are already done:

| What | Value | Where to manage it |
| --- | --- | --- |
| Marketplace publisher ID | `MartienVogel` | [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage) |
| Azure DevOps organization (for the token) | `martienvogel` | [dev.azure.com/martienvogel/_usersSettings/tokens](https://dev.azure.com/martienvogel/_usersSettings/tokens) |
| GitHub account | `Webbeuker-Martien` | [github.com/Webbeuker-Martien](https://github.com/Webbeuker-Martien) |
| Example project | `C:\Users\webbe\starlit-lyrics` | [github.com/Webbeuker-Martien/starlit-lyrics](https://github.com/Webbeuker-Martien/starlit-lyrics) |

The publish token expires on the date you picked when you made it (one year at most). When `vsce` says 401 or "unauthorized", it has expired: make a new one (section 2) and run `vsce login` again.

## 2. One-time setup

You only redo this on a new computer, or when the token expires.

**Tools on your PC.** Install [Node.js](https://nodejs.org) (LTS), [Git](https://git-scm.com) and VS Code. Check with `node -v` and `git --version` in a terminal.

**Marketplace publisher** (done: `MartienVogel`).

1. Go to [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage) and sign in with your Microsoft account.
2. Click **Create publisher**. Fill in **Name** (shown to users, editable later) and **ID** (permanent, part of every extension's address).
3. Everything under *Verified domain* and *About you* is optional.

**Personal access token** (lets `vsce` publish as you).

1. Open [dev.azure.com/martienvogel/_usersSettings/tokens](https://dev.azure.com/martienvogel/_usersSettings/tokens). Or in Azure DevOps, click the person-with-gear icon (top right) → **Personal access tokens**. You don't need to create a project.
2. Click **+ New Token**.
3. **Name:** `vsce-publish`. **Organization:** **All accessible organizations** (otherwise login fails with 401). **Expiration:** up to one year.
4. **Scopes:** **Custom defined** → **Show all scopes** → **Marketplace** → tick **Manage**.
5. Click **Create** and copy the token straight away; it's shown only once. Treat it like a password.
6. In a terminal, run `npx @vscode/vsce login MartienVogel` and paste the token. It stays invisible while you paste.

**GitHub repo** (one per extension).

1. Go to [github.com/new](https://github.com/new). Name it after the extension, set it to **Public**, and leave README, .gitignore and license unticked.
2. Connect your local folder and push:

```
git remote add origin https://github.com/Webbeuker-Martien/<name>.git
git branch -M main
git push -u origin main
```

## 3. Creating a new extension

The quickest start is to copy Starlit Lyrics' setup files. The official generator (`npx --package yo --package generator-code -- yo code`) works too.

**Folder layout** (as in Starlit Lyrics):

| Path | Purpose |
| --- | --- |
| `package.json` | Name, publisher, version, settings, commands, views, scripts |
| `src/extension.ts` | Entry point: `activate()` registers commands and views |
| `src/core/` | Logic without `vscode` imports, so it can be unit tested |
| `test/*.test.ts` | Unit tests, run with Node's built-in runner |
| `media/` | Icon (`icon.png`, 128×128) and webview HTML/CSS/JS |
| `esbuild.mjs` | Bundles `src/` into `dist/extension.js` |
| `.vscodeignore` | What stays out of the package (keep it small) |
| `README.md`, `CHANGELOG.md`, `LICENSE` | Shown on the Marketplace page |

**Fields in `package.json` that must be right:**

- `name`: lowercase, no spaces (`starlit-lyrics`). Together with `publisher` it forms the ID `MartienVogel.starlit-lyrics`.
- `displayName`: the title users see. It must be unique on the Marketplace.
- `publisher`: `MartienVogel`.
- `version`: start at `0.1.0`.
- `engines.vscode`: the oldest VS Code version you support, e.g. `^1.90.0`.
- `main`: `./dist/extension.js`.
- `icon`, `repository`, `license`, `categories`, `keywords`.
- `contributes`: commands, settings (`configuration`), views.

**Daily work loop:**

1. Run `npm install` once after cloning or copying.
2. Open the folder in VS Code and press **F5**. A second VS Code window (the Extension Development Host) runs your extension. After changes, press Ctrl+R in that window to reload.
3. `npm run check` runs the type check and the tests.
4. `npx @vscode/vsce package` builds a `.vsix` file.
5. Try the real package in your own VS Code: `code --install-extension <name>-<version>.vsix --force`, then **Developer: Reload Window**.
6. Commit in small steps: `git add -A`, then `git commit -m "What changed"`.

## 4. Publishing the first version

The first publish takes three commands, once the repo is public and `package.json` has your publisher and repo.

1. Check `package.json`: `publisher` must be `MartienVogel`, and `repository` must point to the public GitHub repo. Without `repository`, README images with relative paths break on the Marketplace.
2. Search the Marketplace for your display name to make sure it isn't taken.
3. Push the latest code: `git push`.
4. Publish from the project folder:

   ```
   cd C:\Users\webbe\<project-folder>
   npx @vscode/vsce login MartienVogel
   npx @vscode/vsce publish
   ```

   `login` is only needed the first time on a PC, or after a new token. `publish` runs the type check, tests and production build before uploading.
5. Wait a few minutes for the Marketplace check. The page appears at `marketplace.visualstudio.com/items?itemName=MartienVogel.<name>`, and anyone can find it in VS Code's Extensions search.
6. Optional, for VSCodium and Cursor users: make an account and token at [open-vsx.org](https://open-vsx.org), then run `npx ovsx publish <name>-<version>.vsix -p <token>`.

To pull a broken release, go to [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage), open the extension's **…** menu and choose **Unpublish**. Usually it's simpler to publish a fixed patch version.

## 5. Updating after changes

Every release needs a higher version number; the Marketplace refuses the same version twice.

| Change | Command | Example |
| --- | --- | --- |
| Bug fix or small tweak | `npx @vscode/vsce publish patch` | 0.1.0 → 0.1.1 |
| New feature or setting | `npx @vscode/vsce publish minor` | 0.1.1 → 0.2.0 |
| Big or breaking change | `npx @vscode/vsce publish major` | 0.2.0 → 1.0.0 |

`publish patch` (or minor, major) raises `version` in `package.json`, makes a git commit and tag, and uploads, all in one step.

**Release checklist:**

- [ ] Make the change and try it with F5 or a local `.vsix` install.
- [ ] `npm run check` passes (type check + tests).
- [ ] Add a section at the top of `CHANGELOG.md`, e.g. `## 0.1.1`, with one line per change.
- [ ] Commit everything: `git add -A`, then `git commit -m "Describe the change"`. `vsce publish patch` stops if there are uncommitted changes.
- [ ] Run `npx @vscode/vsce publish patch` (or minor, major).
- [ ] Push the code and the new version tag: `git push --follow-tags`.
- [ ] After a few minutes, check the Marketplace page. Users get the update automatically.

## 6. Starlit Lyrics specifics

Most visual changes happen in `media/main.css`, and logic changes in `src/`.

| To change… | Edit |
| --- | --- |
| Colors, spacing, header, stars, pill | `media/main.css` |
| What each state shows, scrolling, shooting-star timing | `media/main.js` |
| Polling speed, Spotify errors, messages to the panel | `src/host/controller.ts` |
| Lyrics lookup (LRClib) | `src/core/lrclib.ts` |
| Track-change and stale-lyrics logic | `src/core/session.ts` |
| Spotify sign-in | `src/spotify/auth.ts` |
| Settings and commands users see | `contributes` in `package.json` |

**Preview without Spotify.** Open `preview/index.html?state=synced` in Chrome to see the real panel with fake lyrics.
- Other states: `none`, `plain`, `loading`, `signedOut`, `instrumental`, `podcast`, `ad`, `nothing`, `error`.
- Add `&theme=matchVsCode`, `&paused=1` or `&away=1` (`away` shows the Back to current line button).

**New README screenshots.** Run `bash preview/shoot.sh`, then copy the images you want from `preview/out/` to `docs/screenshots/` with the same file names.

**Background docs in the repo:** `INSPECTION.md` (how Shuri worked, its bugs, and the Windows media-session idea for non-Premium users) and `README.md` (user setup).

## 7. Quick reference

```
npm install                                   # once per project
npm run check                                 # type check + tests
npx @vscode/vsce package                      # build a .vsix
code --install-extension <file>.vsix --force  # try it in your own VS Code
npx @vscode/vsce login MartienVogel           # first time on a PC / new token
npx @vscode/vsce publish patch                # release a fix (minor / major for bigger)
git push --follow-tags                        # push code + version tag
```

| Error | Fix |
| --- | --- |
| 401 or "unauthorized" on login/publish | The token expired or has the wrong settings. Make a new one with **All accessible organizations** + **Marketplace → Manage**, then run `vsce login` again. |
| "Git working directory not clean" | Commit your changes first, then publish. |
| "version already exists" | Use `publish patch` (or raise `version` by hand). |
| "display name already taken" | Change `displayName` in `package.json`. |
| README images broken on the Marketplace | `repository` is missing in `package.json`, or the repo is private or not pushed. |
| Changes don't show after installing a `.vsix` | Run **Developer: Reload Window** (Ctrl+Shift+P). |
