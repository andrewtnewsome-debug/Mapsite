// Builds a single-file page published as a claude.ai artifact (run from the portal folder):
//   node link/build.mjs [output.html]               the applicant portal with its team view
//   node link/build.mjs --app=tool [output.html]    Capital Match, the internal CIM-to-lenders tool
// Both reuse the app's own rules and styles; only the page shells in link/src differ.
import { build } from "esbuild";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const portal = resolve(here, "..");
const args = process.argv.slice(2);
const tool = args.includes("--app=tool");
const app = tool
  ? { entry: join(here, "src", "tool", "app.tsx"), css: "tool.css", title: "MAPlab Capital Match", file: "capital-match.html" }
  : { entry: join(here, "src", "app.tsx"), css: "extra.css", title: "MAP Lab Capital Portal", file: "maplab-portal.html" };
const out = resolve(args.find((a) => !a.startsWith("--")) ?? join(here, app.file));
const shim = (name) => join(here, "src", name);

const privateDeals = join(here, "src", "private-deals.json");
if (!existsSync(privateDeals)) writeFileSync(privateDeals, "[]\n");

const result = await build({
  entryPoints: [app.entry],
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
const css = readFileSync(join(portal, "app", "globals.css"), "utf8") + "\n" + readFileSync(join(here, app.css), "utf8");
const html = `<title>${app.title}</title>
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
