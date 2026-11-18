// Deletes FinanceOS local data (.data folder): QuickBooks tokens and snapshot,
// saved forecasts, follow-ups, invoice drafts, settings and the activity log.
// Works on Windows, macOS and Linux. Does not touch .env.local or your code.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";

const dir = process.env.FINANCEOS_DATA_DIR || path.join(process.cwd(), ".data");
if (!fs.existsSync(dir)) {
  console.log("No local data found. Nothing to delete.");
  process.exit(0);
}
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = process.argv.includes("--yes") ? "yes" : await rl.question(`Delete all FinanceOS local data in ${dir}? Type yes to confirm: `);
rl.close();
if (answer.trim().toLowerCase() !== "yes") {
  console.log("Cancelled.");
  process.exit(0);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log("Local data deleted. QuickBooks will need to be connected again.");
