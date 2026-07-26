/**
 * Type-level tests for AggregationSpec / AggregationResult (issue #34, ADR-0027).
 * Checked by `npm run test:types` (tsc) — never executed.
 *
 * Pins the three-branch result mapping (literal narrows; widened spec degrades to number | null),
 * NumericFieldPaths on sum/average fields, CountAggregation's field?: never (T6), and the
 * published dashboard example so doc drift is a build failure.
 */
import { FieldPath } from 'firebase-admin/firestore';
import { z } from 'zod';
import { FirestoreRepository, type AggregationResult, type AggregationSpec } from '../../index.js';

declare const db: FirebaseFirestore.Firestore;

const orderSchema = z.object({
  status: z.string(),
  total: z.number(),
  /** Optional numeric — NumericFieldPaths includes it (T1 caveat is docs, not a narrower type). */
  sparse: z.number().optional(),
  nested: z.object({ m: z.number() }),
  label: z.string(),
  meta: z.object({ note: z.string() }),
});
const orderRepo = FirestoreRepository.withSchema(db, 'orders', orderSchema);

/** The exact dashboard example printed in the docs / ADR — must compile verbatim. */
export async function publishedDashboardExample() {
  const stats = await orderRepo
    .query()
    .where('status', '==', 'completed')
    .aggregate({
      orders: { kind: 'count' },
      revenue: { kind: 'sum', field: 'total' },
      avgOrder: { kind: 'average', field: 'total' },
    });
  const orders: number = stats.orders;
  const revenue: number = stats.revenue;
  const avgOrder: number | null = stats.avgOrder;
  // @ts-expect-error average is number | null — must not assign to bare number (ADR-0020)
  const avgNonNull: number = stats.avgOrder;
  return { orders, revenue, avgOrder, avgNonNull };
}

export async function literalSpecNarrowsExactly() {
  const result = await orderRepo.query().aggregate({
    c: { kind: 'count' },
    s: { kind: 'sum', field: 'total' },
    a: { kind: 'average', field: 'total' },
  });
  const c: number = result.c;
  const s: number = result.s;
  const a: number | null = result.a;
  // @ts-expect-error average alias is not a bare number
  const aBad: number = result.a;
  return { c, s, a, aBad };
}

export async function asConstSpecStillNarrows() {
  const spec = {
    orders: { kind: 'count' as const },
    revenue: { kind: 'sum' as const, field: 'total' as const },
    avgOrder: { kind: 'average' as const, field: 'total' as const },
  } as const;
  const result = await orderRepo.query().aggregate(spec);
  const orders: number = result.orders;
  const revenue: number = result.revenue;
  const avgOrder: number | null = result.avgOrder;
  // @ts-expect-error as-const average still nullable
  const avgBad: number = result.avgOrder;
  return { orders, revenue, avgOrder, avgBad };
}

export async function fieldPathTyping() {
  // Accepts required numeric, optional numeric (T1 — type allows sparse fields), nested, FieldPath.
  await orderRepo.query().aggregate({
    a: { kind: 'sum', field: 'total' },
    b: { kind: 'sum', field: 'sparse' },
    c: { kind: 'average', field: 'nested.m' },
    d: { kind: 'sum', field: new FieldPath('nested', 'm') },
  });

  await orderRepo.query().aggregate({
    // @ts-expect-error string field is not numeric
    badStr: { kind: 'sum', field: 'label' },
  });
  await orderRepo.query().aggregate({
    // @ts-expect-error unknown field
    badUnknown: { kind: 'sum', field: 'nope' },
  });
  await orderRepo.query().aggregate({
    // @ts-expect-error map field is not numeric
    badMap: { kind: 'average', field: 'meta' },
  });
}

export async function descriptorShapeErrors() {
  await orderRepo.query().aggregate({
    // @ts-expect-error count must not take a field (T6 — field?: never)
    badCount: { kind: 'count', field: 'total' },
  });
  await orderRepo.query().aggregate({
    // @ts-expect-error sum requires a field
    badSum: { kind: 'sum' },
  });
  await orderRepo.query().aggregate({
    // @ts-expect-error unknown kind
    badKind: { kind: 'median', field: 'total' },
  });
  await orderRepo.query().aggregate({
    // @ts-expect-error non-descriptor value
    badValue: 42,
  });
}

/**
 * A widened AggregationSpec<S> (runtime-built dashboard config) must degrade to number | null —
 * never falsely promise bare number (T3).
 */
export async function widenedSpecDegradesToNullable() {
  const spec: AggregationSpec<z.infer<typeof orderSchema>> = {
    orders: { kind: 'count' },
    revenue: { kind: 'sum', field: 'total' },
    avgOrder: { kind: 'average', field: 'total' },
  };
  const result = await orderRepo.query().aggregate(spec);
  type R = AggregationResult<typeof spec>;
  const sample: R[string] = null;
  const ok: number | null = result.orders;
  // @ts-expect-error widened result aliases are number | null, not bare number
  const bad: number = result.orders;
  return { sample, ok, bad };
}
