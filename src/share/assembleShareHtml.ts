// ---------------------------------------------------------------------------
// Baut die selbstenthaltene Share-HTML zusammen: das base64-Payload + das
// vorgebaute IIFE-Viewer-Bundle in EINE Datei, die offline von file:// laeuft.
//
// Reine String-Funktion → headless test-bar. Der eigentliche Render wird im
// Browser (file://) geprueft.
//
// Layout:
//   <script>window.__TRAXEL_PAYLOAD__ = "<base64>"</script>   (zuerst gesetzt)
//   <script>(function(){ … Viewer-IIFE … })()</script>        (liest die Payload)
//
// Sicherheit: das Viewer-Bundle koennte theoretisch den Teilstring "</script>"
// in einem String-Literal enthalten und damit das <script>-Element vorzeitig
// schliessen → defensiv maskieren. Die base64-Payload enthaelt nur
// [A-Za-z0-9+/=], also keine HTML-Sonderzeichen.
// ---------------------------------------------------------------------------

export interface ShareHtmlParts {
  /** Vorgebautes IIFE-Bundle des Share-Viewers (klassisches Script, kein Modul). */
  viewerJs: string;
  /** base64 des encodePayload-Pakets. */
  payloadB64: string;
  /** Dokumenttitel (i.d.R. Track-Name). */
  title?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Maskiert "</script" (case-insensitiv), damit eingebetteter JS-Code das
 *  umschliessende <script>-Element nicht vorzeitig schliesst. */
function neutralizeScriptClose(js: string): string {
  return js.replace(/<\/script/gi, "<\\/script");
}

export function assembleShareHtml({
  viewerJs,
  payloadB64,
  title = "Traxel",
}: ShareHtmlParts): string {
  const safeTitle = escapeHtml(title);
  const safeJs = neutralizeScriptClose(viewerJs);
  // JSON.stringify liefert ein sauber gequotetes JS-String-Literal.
  const payloadLiteral = JSON.stringify(payloadB64);

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>html,body,#root{height:100%;margin:0}body{background:#0b0b0f;color:#ddd;font-family:system-ui,sans-serif}</style>
</head>
<body>
<div id="root"></div>
<script>window.__TRAXEL_PAYLOAD__=${payloadLiteral}</script>
<script>${safeJs}</script>
</body>
</html>
`;
}
