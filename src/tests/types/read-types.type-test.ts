/**
 * Type-level tests for read-mapping methods, checked by `npm run test:types` via tsc (NOT jest —
 * the jest suites run ts-jest with `isolatedModules`, which does not type-check). This file is never
 * run; it exists so the compiler validates the return contract of `fromSnapshot`.
 *
 * Contract asserted: `fromSnapshot(snapshot)` returns `(T & { id: ID }) | null` — the read model
 * (not the write model `W`), and nullable (a non-existent snapshot maps to `null`).
 */
import { z } from 'zod';
import { FirestoreRepository } from '../../index.js';

declare const db: FirebaseFirestore.Firestore;
declare const snapshot: FirebaseFirestore.DocumentSnapshot;

type User = { id: string; name: string };
const userSchema = z.object({ id: z.string(), name: z.string() });
const repo = FirestoreRepository.withSchema<User>(db, 'users', userSchema);

export function fromSnapshotReturnType(): { id: string; name: string } {
  const result = repo.fromSnapshot(snapshot);

  // @ts-expect-error the return is nullable — assigning the union to a non-null type must fail.
  const forcedNonNull: User & { id: string } = result;
  if (!result) return forcedNonNull; // unreachable at runtime; keeps `forcedNonNull` referenced

  // Narrowed to the read model with the overlaid id — both fields are typed as `string`.
  return { id: result.id, name: result.name };
}
