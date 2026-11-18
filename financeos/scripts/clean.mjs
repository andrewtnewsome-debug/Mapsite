// Removes the Next.js build cache (.next). Safe: it is rebuilt automatically.
// Use it if the page keeps reloading in development mode after an update.
import fs from "node:fs";
fs.rmSync(".next", { recursive: true, force: true });
console.log("Removed the .next build cache.");
