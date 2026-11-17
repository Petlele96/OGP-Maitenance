export const MIN_PHASE = 1;
export const MAX_PHASE = 5;
/** Platinum Village is laid out in five phases. */
export const PHASES = [1, 2, 3, 4, 5] as const;

export function isValidPhase(phase: number): boolean {
  return Number.isInteger(phase) && phase >= MIN_PHASE && phase <= MAX_PHASE;
}

/**
 * Numeric-aware comparison so "2" sorts before "10" - a plain string sort would put
 * "10" before "2", which is the opposite of walking down a street in order.
 * Falls back to a case-insensitive string compare for non-numeric or mixed values
 * (e.g. "12A" vs "12B").
 */
export function compareHouseNumbers(a: string, b: string): number {
  const parse = (value: string) => {
    const match = value.trim().match(/^(\d+)(.*)$/);
    if (!match) return { num: null as number | null, rest: value.trim().toLowerCase() };
    return { num: Number.parseInt(match[1], 10), rest: match[2].trim().toLowerCase() };
  };

  const pa = parse(a);
  const pb = parse(b);

  if (pa.num !== null && pb.num !== null) {
    if (pa.num !== pb.num) return pa.num - pb.num;
    return pa.rest.localeCompare(pb.rest);
  }
  if (pa.num !== null) return -1;
  if (pb.num !== null) return 1;
  return pa.rest.localeCompare(pb.rest);
}

export interface PhaseGroup<T> {
  phase: number | null;
  customers: T[];
}

/**
 * Groups by phase (1-5, ascending), sorted by house number within each group.
 * Customers with no phase are grouped under `phase: null`, listed last.
 */
export function groupByPhase<T extends { phase: number | null; houseNumber: string }>(
  customers: T[]
): PhaseGroup<T>[] {
  const byPhase = new Map<number | null, T[]>();
  for (const customer of customers) {
    const key = customer.phase;
    const list = byPhase.get(key) ?? [];
    list.push(customer);
    byPhase.set(key, list);
  }

  const phases = Array.from(byPhase.keys()).sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
  });

  return phases.map((phase) => ({
    phase,
    customers: [...(byPhase.get(phase) ?? [])].sort((a, b) => compareHouseNumbers(a.houseNumber, b.houseNumber)),
  }));
}
