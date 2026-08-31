import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Missing DATABASE_URL environment variable.");
  process.exit(1);
}

const dir = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(dir, "..", "db", "schema.sql");
const schema = readFileSync(schemaPath, "utf8");

const sql = neon(url);

const statements = schema
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

for (const statement of statements) {
  await sql(statement);
  console.log(`OK: ${statement.slice(0, 60).replace(/\s+/g, " ")}...`);
}

console.log("Migration complete.");
