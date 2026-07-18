/**
 * Type-level tests for schema-aware query field paths, checked by `npm run test:types` via tsc (NOT
 * jest). This file is never executed; it exists so the compiler validates that `where`/`orderBy`/
 * `select` accept typed nested dot-notation paths (and a `FieldPath` escape hatch) while rejecting
 * typos, arbitrary dynamic strings, array-index paths, and invalid operators.
 *
 * Each `@ts-expect-error` FAILS the type-check if the line below it stops being an error; every
 * un-annotated call must type-check.
 */
import { FieldPath } from 'firebase-admin/firestore';
import { z } from 'zod';
import { FirestoreRepository } from '../../index.js';
import type { FieldPaths, PathValue } from '../../index.js';

declare const db: FirebaseFirestore.Firestore;

const schema = z.object({
  id: z.string(),
  name: z.string(),
  tags: z.array(z.string()),
  createdAt: z.date(),
  address: z.object({ city: z.string(), zip: z.string().optional() }),
  settings: z.object({ notifications: z.object({ email: z.boolean() }) }),
});
type Doc = z.infer<typeof schema>;
const repo = FirestoreRepository.withSchema(db, 'docs', schema);

export function queryFieldPathPositives() {
  repo.query().where('name', '==', 'a');
  repo.query().where('address.city', '==', 'LA'); // nested path
  repo.query().where('settings.notifications.email', '==', true); // deep path
  repo.query().where(new FieldPath('address', 'city'), '==', 'LA'); // FieldPath escape hatch
  repo.query().orderBy('address.city', 'asc'); // nested orderBy (was blocked pre-v3)
  repo.query().orderBy('createdAt');
  repo.query().select('name', 'address.city', 'settings.notifications.email');
  repo.query().select(new FieldPath('address', 'city'));
}

export function queryFieldPathNegatives() {
  // @ts-expect-error typo in a nested path
  repo.query().where('address.citee', '==', 'LA');
  // @ts-expect-error not a field of the schema
  repo.query().where('nope', '==', 1);
  // @ts-expect-error arbitrary dynamic strings are no longer accepted — use a FieldPath
  repo.query().where('some' + 'field', '==', 1);
  // @ts-expect-error array-element paths are not valid field paths
  repo.query().orderBy('tags.0');
  // @ts-expect-error invalid Firestore operator
  repo.query().where('name', '===', 'a');
  // @ts-expect-error unknown field in select
  repo.query().select('nope');
}

// `PathValue` resolves the read-model type at a (possibly dotted) path.
const city: PathValue<Doc, 'address.city'> = 'x'; // string
const email: PathValue<Doc, 'settings.notifications.email'> = true; // boolean
export const _pathValues = { city, email };

// `FieldPaths` includes top-level keys and nested paths, but not array-index paths.
const validPaths: FieldPaths<Doc>[] = [
  'name',
  'address',
  'address.city',
  'address.zip',
  'settings.notifications.email',
  'tags',
  'createdAt',
];
export const _fieldPaths = validPaths;
