// Deletes the local database so the next page load re-creates it from data/seed.json.
import { rmSync } from "node:fs";
import { join } from "node:path";

rmSync(join(process.cwd(), "data", "db.json"), { force: true });
console.log("Local data reset. Restart or refresh the app to reload the sample data.");
