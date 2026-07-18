/**
 * Type-level tests for read-mapping methods, checked by `npm run test:types` via tsc (NOT jest —
 * the jest suites run ts-jest with `isolatedModules`, which does not type-check). This file is never
 * run; it exists so the compiler validates the return contract of `fromSnapshot`.
 *
 * Contract asserted: `fromSnapshot(snapshot)` returns `(T & { id: ID }) | null` — the read model
 * (not the write model `W`), and nullable (a non-existent snapshot maps to `null`). The read model
 * is `z.infer<readSchema>` and never leaks a `writeSchema` overlay.
 */
import { z } from 'zod';
import { FirestoreRepository, zDateWrite } from '../../index.js';

declare const db: FirebaseFirestore.Firestore;
declare const snapshot: FirebaseFirestore.DocumentSnapshot;

const userSchema = z.object({ id: z.string(), name: z.string() });
const repo = FirestoreRepository.withSchema(db, 'users', userSchema);

export function fromSnapshotReturnType(): { id: string; name: string } {
  const result = repo.fromSnapshot(snapshot);

  // @ts-expect-error the return is nullable — assigning the union to a non-null type must fail.
  const forcedNonNull: { id: string; name: string } = result;
  if (!result) return forcedNonNull; // unreachable at runtime; keeps `forcedNonNull` referenced

  // Narrowed to the read model with the overlaid id — both fields are typed as `string`.
  return { id: result.id, name: result.name };
}

// The read type tracks `z.infer<readSchema>` and ignores the write overlay: `happenedAt` is `Date`,
// NOT `Date | FieldValue`. If the write overlay leaked into the read type, `const d: Date` fails.
const eventRead = z.object({ id: z.string(), happenedAt: z.date() });
const eventWrite = z.object({ id: z.string(), happenedAt: zDateWrite() });
const eventRepo = FirestoreRepository.withSchema(db, 'events', eventRead, {
  writeSchema: eventWrite,
});

export function readTypeDecoupledFromWrite(): { id: string; happenedAt: Date } {
  const r = eventRepo.fromSnapshot(snapshot);
  if (!r) throw new Error('unreachable');
  const d: Date = r.happenedAt; // fails if the read type leaked the write overlay (Date | FieldValue)
  return { id: r.id, happenedAt: d };
}
