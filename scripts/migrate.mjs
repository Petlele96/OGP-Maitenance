import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!url) {
  console.error("Missing DATABASE_URL (or POSTGRES_URL) environment variable.");
  process.exit(1);
}

const dir = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(dir, "..", "db", "schema.sql");
const schema = readFileSync(schemaPath, "utf8");

const connectionString = url.replace(/([?&])sslmode=[^&]*/, "$1sslmode=no-verify");
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();

const statements = schema
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

for (const statement of statements) {
  await client.query(statement);
  console.log(`OK: ${statement.slice(0, 60).replace(/\s+/g, " ")}...`);
}

await client.end();
console.log("Migration complete.");
