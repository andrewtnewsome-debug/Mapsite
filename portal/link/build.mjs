// Builds the single-file version of the portal that is published as a claude.ai artifact.
//   node link/build.mjs [output.html]     (run from the portal folder)
// It reuses the app's own form, deal panels, rules and styles; only the page shell in link/src differs.
import { build } from "esbuild";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const portal = resolve(here, "..");
const out = resolve(process.argv[2] ?? join(here, "maplab-portal.html"));
const shim = (name) => join(here, "src", name);

const privateDeals = join(here, "src", "private-deals.json");
if (!existsSync(privateDeals)) writeFileSync(privateDeals, "[]\n");

const result = await build({
  entryPoints: [join(here, "src", "app.tsx")],
  bundle: true, write: false, format: "iife", target: "es2020", minify: true,
  jsx: "transform", jsxFactory: "React.createElement", jsxFragment: "React.Fragment",
  loader: { ".json": "json" },
  alias: {
    portal,
    // The page loads React, jsPDF and docx from a CDN, so imports of them resolve to small shims.
    react: shim("react-shim.ts"),
    "react/jsx-runtime": shim("jsx-runtime-shim.ts"),
    "react/jsx-dev-runtime": shim("jsx-runtime-shim.ts"),
    jspdf: shim("jspdf-shim.ts"),
    docx: shim("jspdf-shim.ts"),
  },
  logLevel: "warning",
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const logo = "data:image/png;base64," + readFileSync(join(portal, "public", "maplab-logo.png")).toString("base64");
const css = readFileSync(join(portal, "app", "globals.css"), "utf8") + "\n" + readFileSync(join(here, "extra.css"), "utf8");
const html = `<title>MAP Lab Capital Portal</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap">
<style>
/* Single light theme by choice: MAP Lab letterhead is white with green and charcoal. */
:root { color-scheme: light; }
${css}
</style>
<div id="root"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script>var LOGO=${JSON.stringify(logo)};</script>
<script>${js}</script>
`;
writeFileSync(out, html);
console.log(`Wrote ${out} (${html.length} bytes)`);
