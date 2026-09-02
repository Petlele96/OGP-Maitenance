export const MIN_BLOCK = 1;
export const MAX_BLOCK = 6;

export function isValidBlock(block: number): boolean {
  return Number.isInteger(block) && block >= MIN_BLOCK && block <= MAX_BLOCK;
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

export interface BlockGroup<T> {
  block: number | null;
  customers: T[];
}

/**
 * Groups by block (1-6, ascending), sorted by house number within each group.
 * Customers with no block are grouped under `block: null`, listed last.
 */
export function groupByBlock<T extends { block: number | null; houseNumber: string }>(
  customers: T[]
): BlockGroup<T>[] {
  const byBlock = new Map<number | null, T[]>();
  for (const customer of customers) {
    const key = customer.block;
    const list = byBlock.get(key) ?? [];
    list.push(customer);
    byBlock.set(key, list);
  }

  const blocks = Array.from(byBlock.keys()).sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
  });

  return blocks.map((block) => ({
    block,
    customers: [...(byBlock.get(block) ?? [])].sort((a, b) => compareHouseNumbers(a.houseNumber, b.houseNumber)),
  }));
}
