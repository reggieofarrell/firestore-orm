/**
 * Strategy: emulator integration tests for QueryBuilder.aggregate() (issue #34 / ADR-0027).
 * Emulator-backed because every claim here is about Firestore's multi-aggregation contract
 * (sparse-field intersection, select()+count legality, max-of-5, agreement with singles) —
 * mocks cannot prove that.
 *
 * Verification points (plan §6.2):
 *  - I-1 / I-2: acceptance — count + total + average in one request (literal + runtime-built spec)
 *  - I-3: each kind alone; empty match → count 0, sum 0, average null
 *  - I-4: T1 sparse-field intersection (emulator contract) + dense K2 half
 *  - I-5: where + orderBy + limit honored
 *  - I-6: dotted nested path and FieldPath both work
 *  - I-7: select()+count-only succeeds; select()+sum / select().sum / select().average throw locally
 *  - I-8: six aggregations reject (backend max 5 — not capped locally)
 *  - I-9: aggregate() agrees with count()/sum()/average() singles
 *  - I-10: collection-group builder inherits aggregate()
 *  - I-11: duplicate aggregations under two aliases
 *  - I-12: non-numerics skipped by sum/average but counted by count
 *
 * Coverage gate: test:coverage:gate:integration (QueryBuilder.ts functions ≥ 95).
 */
import { FieldPath, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { FirestoreRepository } from '../../core/FirestoreRepository.js';
import type { AggregationSpec } from '../../core/QueryBuilder.js';
import { getIntegrationDb } from './helpers/firestoreIntegrationHarness.js';

const orderSchema = z.object({
  status: z.string(),
  total: z.number(),
  /** Dense numeric present on every seeded doc in the T1 dense half. */
  n: z.number().optional(),
  /** Sparse numeric — only some docs carry it (T1 intersection). */
  sparse: z.number().optional(),
  nested: z.object({ m: z.number() }).optional(),
  /** May be a string on some docs to probe non-numeric skip behavior (I-12). */
  label: z.union([z.string(), z.number()]).optional(),
  rank: z.number().optional(),
});
type Order = z.infer<typeof orderSchema>;

const RUN = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const COLLECTION = `agg_orders_${RUN}`;
/** Separate group id so I-10 cannot race the single-collection suite or other group tests. */
const GROUP_ID = `agg_group_${RUN}`;
const GROUP_PARENTS = `agg_parents_${RUN}`;

describe('QueryBuilder.aggregate() multi-aggregation (issue #34)', () => {
  const db: Firestore = getIntegrationDb();
  const orderRepo = FirestoreRepository.withSchema(db, COLLECTION, orderSchema);
  const groupRepo = FirestoreRepository.withSchema(
    db,
    `${GROUP_PARENTS}/p1/${GROUP_ID}`,
    orderSchema,
  );
  const orderGroup = groupRepo.collectionGroup();

  const seededIds: string[] = [];
  const seededGroupPaths: string[] = [];

  async function seed(data: Order): Promise<string> {
    const created = await orderRepo.create(data, { returnDoc: true });
    seededIds.push(created.id);
    return created.id;
  }

  beforeAll(async () => {
    // Shared completed-order set for acceptance / agreement / duplicate-alias tests.
    await seed({ status: 'completed', total: 10, n: 1, nested: { m: 1 }, rank: 1 });
    await seed({ status: 'completed', total: 20, n: 2, nested: { m: 2 }, rank: 2 });
    await seed({ status: 'completed', total: 30, n: 3, nested: { m: 3 }, rank: 3 });
    await seed({ status: 'cancelled', total: 999, n: 99, nested: { m: 99 }, rank: 99 });

    // Collection-group seed: two parents, same collection id.
    const g1 = `${GROUP_PARENTS}/p1/${GROUP_ID}/g1`;
    const g2 = `${GROUP_PARENTS}/p2/${GROUP_ID}/g2`;
    await db.doc(g1).set({ status: 'completed', total: 5, n: 5 });
    await db.doc(g2).set({ status: 'completed', total: 7, n: 7 });
    seededGroupPaths.push(g1, g2);
  });

  afterAll(async () => {
    if (seededIds.length > 0) {
      await orderRepo.bulkDelete(seededIds);
    }
    const batch = db.batch();
    seededGroupPaths.forEach(path => batch.delete(db.doc(path)));
    await batch.commit();
  });

  // ── Acceptance criteria (issue #34) — first in the file ──────────────────────────────────────

  it('I-1: count + total + average in a single request with typed aliases', async () => {
    const stats = await orderRepo
      .query()
      .where('status', '==', 'completed')
      .aggregate({
        orders: { kind: 'count' },
        revenue: { kind: 'sum', field: 'total' },
        avgOrder: { kind: 'average', field: 'total' },
      });

    expect(stats.orders).toBe(3);
    expect(stats.revenue).toBe(60);
    expect(stats.avgOrder).toBe(20);
  });

  it('I-2: same via a runtime-built (widened) AggregationSpec', async () => {
    // Dashboard-config case (D1): spec assembled from a variable typed as AggregationSpec.
    const spec: AggregationSpec<Order> = {
      orders: { kind: 'count' },
      revenue: { kind: 'sum', field: 'total' },
      avgOrder: { kind: 'average', field: 'total' },
    };
    const stats = await orderRepo.query().where('status', '==', 'completed').aggregate(spec);
    expect(stats.orders).toBe(3);
    expect(stats.revenue).toBe(60);
    expect(stats.avgOrder).toBe(20);
  });

  // ── Per-kind empty set + singles ─────────────────────────────────────────────────────────────

  it('I-3: each kind alone; empty match → count 0, sum 0, average null', async () => {
    const empty = orderRepo.query().where('status', '==', 'does-not-exist');
    expect(await empty.aggregate({ c: { kind: 'count' } })).toEqual({ c: 0 });
    expect(await empty.aggregate({ s: { kind: 'sum', field: 'total' } })).toEqual({ s: 0 });
    expect(await empty.aggregate({ a: { kind: 'average', field: 'total' } })).toEqual({ a: null });
  });

  it('I-4: T1 sparse-field intersection (emulator contract) + dense half', async () => {
    // Isolated collection so sparse/dense docs cannot pollute the shared completed set.
    const sparseRepo = FirestoreRepository.withSchema(db, `agg_sparse_${RUN}`, orderSchema);
    const sparseIds: string[] = [];
    try {
      // Four docs with dense n (1+2+3+4=10); only the first carries sparse: 100.
      for (const [n, sparse] of [
        [1, 100],
        [2, undefined],
        [3, undefined],
        [4, undefined],
      ] as const) {
        const created = await sparseRepo.create(
          {
            status: 'open',
            total: n,
            n,
            ...(sparse !== undefined ? { sparse } : {}),
          },
          { returnDoc: true },
        );
        sparseIds.push(created.id);
      }

      // Emulator-observed contract (plan T1 / K3): a field-referencing aggregation collapses the
      // document set for the WHOLE request to docs that have that field. Production parity is
      // UNVERIFIED — see ADR-0027. This assertion pins the emulator contract so an SDK/backend
      // change is caught rather than silently altering user results.
      const sparseResult = await sparseRepo.query().aggregate({
        c: { kind: 'count' },
        s: { kind: 'sum', field: 'sparse' },
      });
      expect(sparseResult).toEqual({ c: 1, s: 100 });

      // Dense half (K2): every matching doc has `n` → count and sum are intuitive.
      const denseResult = await sparseRepo.query().aggregate({
        c: { kind: 'count' },
        s: { kind: 'sum', field: 'n' },
      });
      expect(denseResult).toEqual({ c: 4, s: 10 });
    } finally {
      if (sparseIds.length > 0) await sparseRepo.bulkDelete(sparseIds);
    }
  });

  it('I-5: where + orderBy + limit are honored by a multi-aggregation', async () => {
    // Top 2 completed by rank asc → totals 10 + 20 = 30, count 2.
    const stats = await orderRepo
      .query()
      .where('status', '==', 'completed')
      .orderBy('rank', 'asc')
      .limit(2)
      .aggregate({
        c: { kind: 'count' },
        s: { kind: 'sum', field: 'total' },
      });
    expect(stats).toEqual({ c: 2, s: 30 });
  });

  it('I-6: dotted nested path and FieldPath both work', async () => {
    const byDot = await orderRepo
      .query()
      .where('status', '==', 'completed')
      .aggregate({ m: { kind: 'sum', field: 'nested.m' } });
    const byPath = await orderRepo
      .query()
      .where('status', '==', 'completed')
      .aggregate({ m: { kind: 'sum', field: new FieldPath('nested', 'm') } });
    expect(byDot.m).toBe(6);
    expect(byPath.m).toBe(6);
  });

  it('I-7: select() kind-aware guard — count-only ok; sum/average throw locally', async () => {
    const projected = orderRepo.query().where('status', '==', 'completed').select('total');

    // Count-only after select is legal (M1/M5/M6).
    await expect(projected.aggregate({ c: { kind: 'count' } })).resolves.toEqual({ c: 3 });

    // Assert on OUR message fragments — never on Firestore server text (#33 plan T3 rule).
    await expect(projected.aggregate({ s: { kind: 'sum', field: 'total' } })).rejects.toThrow(
      /not supported after select/,
    );
    await expect(projected.sum('total')).rejects.toThrow(/not supported after select/);
    await expect(projected.average('total')).rejects.toThrow(/not supported after select/);
  });

  it('I-8: six aggregations reject (backend max 5 — not capped locally)', async () => {
    // Deliberately no local max-of-5 guard: the backend rejects with an actionable message, and a
    // hard-coded cap would silently go stale if Google raises the limit (plan A1.6 / anti-instructions).
    await expect(
      orderRepo.query().aggregate({
        a: { kind: 'count' },
        b: { kind: 'count' },
        c: { kind: 'count' },
        d: { kind: 'count' },
        e: { kind: 'count' },
        f: { kind: 'count' },
      }),
    ).rejects.toThrow();
  });

  it('I-9: aggregate() agrees with count()/sum()/average() singles', async () => {
    const q = () => orderRepo.query().where('status', '==', 'completed');
    const multi = await q().aggregate({
      c: { kind: 'count' },
      s: { kind: 'sum', field: 'total' },
      a: { kind: 'average', field: 'total' },
    });
    expect(multi.c).toBe(await q().count());
    expect(multi.s).toBe(await q().sum('total'));
    expect(multi.a).toBe(await q().average('total'));
  });

  it('I-10: collection-group query builder inherits aggregate()', async () => {
    const stats = await orderGroup
      .query()
      .where('status', '==', 'completed')
      .aggregate({
        c: { kind: 'count' },
        s: { kind: 'sum', field: 'total' },
      });
    expect(stats).toEqual({ c: 2, s: 12 });
  });

  it('I-11: duplicate aggregations under two aliases both resolve', async () => {
    const stats = await orderRepo
      .query()
      .where('status', '==', 'completed')
      .aggregate({
        c1: { kind: 'count' },
        c2: { kind: 'count' },
        s1: { kind: 'sum', field: 'total' },
        s2: { kind: 'sum', field: 'total' },
      });
    expect(stats).toEqual({ c1: 3, c2: 3, s1: 60, s2: 60 });
  });

  it('I-12: non-numeric values skipped by sum/average but counted by count', async () => {
    const mixedRepo = FirestoreRepository.withSchema(db, `agg_mixed_${RUN}`, orderSchema);
    const ids: string[] = [];
    try {
      // Two numeric labels (10, 20) and one string label — count=3, sum=30, average=15 ≠ 30/3.
      for (const label of [10, 20, 'skip-me'] as const) {
        const created = await mixedRepo.create(
          { status: 'mixed', total: 1, label },
          { returnDoc: true },
        );
        ids.push(created.id);
      }
      const stats = await mixedRepo.query().aggregate({
        c: { kind: 'count' },
        s: { kind: 'sum', field: 'label' },
        a: { kind: 'average', field: 'label' },
      });
      expect(stats.c).toBe(3);
      expect(stats.s).toBe(30);
      expect(stats.a).toBe(15);
      expect(stats.a).not.toBe(stats.s / stats.c);
    } finally {
      if (ids.length > 0) await mixedRepo.bulkDelete(ids);
    }
  });
});
