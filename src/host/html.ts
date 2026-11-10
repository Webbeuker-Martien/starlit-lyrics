import * as crypto from 'node:crypto';
import * as vscode from 'vscode';

export function webviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
  return { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')] };
}

export function renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = crypto.randomBytes(16).toString('base64');
  const media = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', file)).toString();
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} https: data:`,
    `style-src ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  // Start in the configured theme so there is no flash before the settings message arrives.
  const theme = vscode.workspace.getConfiguration('starlit').get<string>('theme') === 'matchVsCode' ? 'matchVsCode' : 'starryNight';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="${media('main.css')}">
  <title>Starlit Lyrics</title>
</head>
<body data-theme="${theme}">
  <div id="sky" aria-hidden="true"></div>
  <header id="header" hidden></header>
  <div id="banner" role="status" hidden></div>
  <main id="scroller" tabindex="0">
    <div id="content"></div>
  </main>
  <button id="pill" type="button" class="pill" aria-label="Back to current line" hidden>
    <span class="pill-arrow" aria-hidden="true"></span><span>Back to current line</span>
  </button>
  <script nonce="${nonce}" src="${media('main.js')}"></script>
</body>
</html>`;
}
