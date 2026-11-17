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

// One-off renames run before the schema file, each guarded so re-running is harmless. (The schema file is split on
// semicolons, so a guarded DO block cannot live in it.) block -> phase: Platinum Village is laid out in phases.
await client.query(`
  do $$
  begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'signups' and column_name = 'block')
       and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'signups' and column_name = 'phase') then
      alter table signups rename column block to phase;
    end if;
  end $$
`);
console.log("OK: signups.block renamed to phase (if it still had the old name)");

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
