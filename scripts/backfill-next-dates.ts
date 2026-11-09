/**
 * One-off cut-over: gives every active/booked recurring client their next service date, taken from the day the
 * old fixed schedule would next have visited them (following any move or "Can't do" already on record), and
 * starts date-based routing for them from today. Past days are never touched - they keep being rebuilt from
 * the old slot - so existing outstanding days stay exactly as they are.
 *
 *   npx tsx scripts/backfill-next-dates.ts            dry run - reads only, prints what it would do
 *   npx tsx scripts/backfill-next-dates.ts --apply    writes, in one transaction
 *
 * Reads DATABASE_URL from the environment. Safe to re-run: clients that already have a date are left alone.
 * Prints counts only, never customer details.
 */
import { Pool } from "pg";
import { nextOccurrenceForSlot, nowInJohannesburg, toDateKey } from "../lib/schedule";

interface Row {
  id: string;
  service_slot: number;
}

const apply = process.argv.includes("--apply");

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url.replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]supa=[^&]*/g, "");
}

async function main() {
  const pool = new Pool({ connectionString: connectionString(), max: 1, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    const today = nowInJohannesburg();
    const todayKey = toDateKey(today);
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);

    const { rows: clients } = await client.query<Row>(
      `select id, service_slot from signups
       where payment_status in ('active', 'booked') and plan <> 'once-off' and paused_at is null
         and service_slot is not null`
    );
    const { rows: moves } = await client.query<{ signup_id: string; original_date: string; rescheduled_date: string }>(
      "select signup_id, original_date::text, rescheduled_date::text from skipped_visits where original_date >= $1::date or rescheduled_date >= $1::date",
      [todayKey]
    );
    const { rows: visits } = await client.query<{ signup_id: string; service_date: string }>(
      "select signup_id, service_date::text from service_visits where service_date >= $1::date",
      [todayKey]
    );

    const movedFrom = new Map<string, string>(); // `${signup}|${original}` -> rescheduled
    const movedOnto = new Map<string, string[]>(); // signup -> rescheduled dates still ahead
    for (const m of moves) {
      movedFrom.set(`${m.signup_id}|${m.original_date}`, m.rescheduled_date);
      if (m.rescheduled_date >= todayKey) movedOnto.set(m.signup_id, [...(movedOnto.get(m.signup_id) ?? []), m.rescheduled_date]);
    }
    const visited = new Set(visits.map((v) => `${v.signup_id}|${v.service_date}`));

    const plan: { id: string; next: string }[] = [];
    for (const c of clients) {
      let candidate = nextOccurrenceForSlot(c.service_slot, yesterday);
      for (let i = 0; i < 8; i++) {
        const key = toDateKey(candidate);
        if (visited.has(`${c.id}|${key}`)) {
          candidate = nextOccurrenceForSlot(c.service_slot, candidate);
          continue;
        }
        const moved = movedFrom.get(`${c.id}|${key}`);
        if (!moved) break;
        candidate = new Date(`${moved}T00:00:00`);
        if (visited.has(`${c.id}|${moved}`)) candidate = nextOccurrenceForSlot(c.service_slot, candidate);
        else break;
      }
      let next = toDateKey(candidate);
      for (const r of movedOnto.get(c.id) ?? []) if (r < next && !visited.has(`${c.id}|${r}`)) next = r;
      plan.push({ id: c.id, next });
    }

    const week = toDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7));
    console.log(`today (Johannesburg): ${todayKey}`);
    console.log(`clients to give a next date: ${plan.length}`);
    console.log(`  due today: ${plan.filter((p) => p.next === todayKey).length}`);
    console.log(`  due in the next 7 days (after today): ${plan.filter((p) => p.next > todayKey && p.next <= week).length}`);
    console.log(`  due later: ${plan.filter((p) => p.next > week).length}`);
    console.log(`  in the past (should be 0): ${plan.filter((p) => p.next < todayKey).length}`);

    if (!apply) {
      console.log("DRY RUN - nothing written. Re-run with --apply to write.");
      return;
    }

    await client.query("begin");
    let written = 0;
    for (const p of plan) {
      const res = await client.query(
        `update signups set next_service_date = $2::date, next_service_date_manual = false, routing_from = $3::date, updated_at = now()
         where id = $1 and next_service_date is null and routing_from is null`,
        [p.id, p.next, todayKey]
      );
      written += res.rowCount ?? 0;
    }
    await client.query("commit");
    console.log(`written: ${written}`);
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
