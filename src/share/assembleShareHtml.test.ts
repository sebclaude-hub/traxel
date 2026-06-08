import { describe, expect, it } from "vitest";

import { assembleShareHtml } from "./assembleShareHtml";

describe("assembleShareHtml", () => {
  const base = { viewerJs: "console.log(1)", payloadB64: "AAAA++//==" };

  it("bettet Payload und Viewer-JS ein, mit Root-Div", () => {
    const html = assembleShareHtml(base);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('window.__TRAXEL_PAYLOAD__="AAAA++//=="');
    expect(html).toContain("console.log(1)");
    // Payload-Script steht VOR dem Viewer-Script (Viewer liest die globale Var).
    expect(html.indexOf("__TRAXEL_PAYLOAD__")).toBeLessThan(html.indexOf("console.log(1)"));
  });

  it("maskiert </script> im Viewer-JS, damit das Script nicht vorzeitig schließt", () => {
    const html = assembleShareHtml({
      ...base,
      viewerJs: 'var s="</script>"',
    });
    expect(html).not.toContain('"</script>"');
    expect(html).toContain('<\\/script>');
  });

  it("escaped den Titel", () => {
    const html = assembleShareHtml({ ...base, title: 'Flug <b>"A" & B</b>' });
    expect(html).toContain("<title>Flug &lt;b&gt;&quot;A&quot; &amp; B&lt;/b&gt;</title>");
    expect(html).not.toContain("<title>Flug <b>");
  });

  it("nutzt Default-Titel wenn keiner angegeben", () => {
    expect(assembleShareHtml(base)).toContain("<title>Traxel</title>");
  });
});
