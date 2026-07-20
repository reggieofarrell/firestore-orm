/**
 * Type-level helpers for schema-aware Firestore field paths.
 *
 * The Admin SDK types `where`/`orderBy`/`select` as `string | FieldPath` with no schema awareness,
 * so this module derives the union of *valid* readable dot-notation paths from a document type `T`
 * (e.g. `'address.city'`). It is purely type-level — there is no runtime code here.
 *
 * Writes reuse the SDK's `UpdateData<T>` (see `UpdateInput` in `../core/Validation.ts`), which
 * generates dot-notation *write* keys; `FieldPaths` covers the read/query side the SDK leaves loose.
 */
import type { Timestamp, GeoPoint, DocumentReference, FieldValue } from 'firebase-admin/firestore';

/**
 * Structural stand-in for `VectorValue`. `firebase-admin/firestore` does not re-export the
 * `VectorValue` class (it lives in `@google-cloud/firestore`), so we model it structurally to avoid
 * coupling to a transitive dependency — consistent with the codebase's structural vector detection
 * (`isVectorWriteValue` in `../core/Validation.ts`).
 */
type VectorValueLike = { toArray(): number[]; isEqual(other: unknown): boolean };

/**
 * Terminal types: values we never descend into and never emit `.<subkey>` paths under. Arrays are
 * terminal on purpose — Firestore has no numeric-index field paths, so `'tags'` is a path but
 * `'tags.0'` is not.
 */
type Leaf =
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined
  | Date
  | Timestamp
  | GeoPoint
  | DocumentReference
  | FieldValue
  | VectorValueLike
  | Uint8Array
  | readonly unknown[]
  | ((...args: any[]) => any);

/** `true` when `V` is a terminal leaf type (wrapped in a tuple to avoid union distribution). */
type IsLeaf<V> = [V] extends [Leaf] ? true : false;

/** `true` for the `string`/`number` index-signature key, `false` for a literal key. */
type IsIndexKey<K extends PropertyKey> = string extends K ? true : number extends K ? true : false;

/**
 * The literal string keys of `T` only — index signatures and symbol keys are dropped. This keeps
 * `FieldPaths` from collapsing to `string` when `T` contains a `Record<string, X>` field (which
 * would destroy typo protection for every sibling field).
 */
type LiteralKeys<T> = keyof T extends infer K
  ? K extends string
    ? IsIndexKey<K> extends true
      ? never
      : K
    : never
  : never;

/** Depth budget, decremented one level per recursion. Bounds instantiation on deep/recursive types. */
type Decr = [never, 0, 1, 2, 3, 4, 5, 6];

/**
 * Union of valid readable Firestore field paths for `T`: every top-level key plus dotted paths into
 * nested plain objects. Depth-bounded (default 6); leaf-stops on scalars, arrays, and Firestore
 * value classes; optional properties are handled via `NonNullable`.
 *
 * @example
 * type P = FieldPaths<{ name: string; address: { city: string; zip?: string } }>;
 * //   => 'name' | 'address' | 'address.city' | 'address.zip'
 */
export type FieldPaths<T, D extends number = 6> = [D] extends [never]
  ? never
  : T extends readonly unknown[]
    ? never
    : T extends object
      ? {
          [K in LiteralKeys<T>]:
            | K
            | (NonNullable<T[K]> extends infer V
                ? IsLeaf<V> extends true
                  ? never
                  : V extends object
                    ? `${K}.${FieldPaths<V, Decr[D]>}`
                    : never
                : never);
        }[LiteralKeys<T>]
      : never;

/**
 * Resolves the type at a (possibly dotted) path `P` within `T`. Returns `never` for paths that do
 * not exist. Exposed for consumers who want to type values against a path; the query builder itself
 * keeps `where` values loose because a `readConverter` can change a field's stored shape vs `T`.
 *
 * @example
 * type C = PathValue<{ address: { city: string } }, 'address.city'>; // => string
 */
export type PathValue<T, P extends string> = P extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? PathValue<NonNullable<T[Head]>, Rest>
    : never
  : P extends keyof T
    ? T[P]
    : never;

/**
 * The subset of {@link FieldPaths} whose resolved value is numeric (including optional numeric
 * fields and nested numeric paths). Used to constrain numeric aggregations (`sum`/`average`) to
 * actual number fields rather than any `keyof T`.
 *
 * @example
 * type N = NumericFieldPaths<{ name: string; score: number; stats: { count: number } }>;
 * //   => 'score' | 'stats.count'
 */
export type NumericFieldPaths<T> = {
  [P in FieldPaths<T>]: NonNullable<PathValue<T, P>> extends number ? P : never;
}[FieldPaths<T>];

/**
 * Recursively-optional version of `T` — the conservative result shape after a projection
 * (`select(...)`). Unlike `Partial<T>`, which makes only the ROOT properties optional, this also
 * makes nested map properties optional, so a dotted projection such as `select('address.city')` does
 * not leave the unselected sibling `address.zip` statically required once `address` is guarded.
 *
 * Only plain (map) objects recurse. Every {@link Leaf} type is preserved whole so a selected value
 * keeps its real API after the parent is guarded — scalars, `Date`, Firestore value classes
 * (`Timestamp`, `GeoPoint`, `DocumentReference`, `FieldValue`, structural vector values), byte values
 * (`Uint8Array`/`Buffer`), functions, and **arrays** (a Firestore field mask never projects into
 * array elements, so the array is returned whole rather than element-partialized).
 */
export type DeepPartial<T> =
  IsLeaf<T> extends true ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;
