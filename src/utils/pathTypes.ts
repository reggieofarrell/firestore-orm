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
export type VectorValueLike = { toArray(): number[]; isEqual(other: unknown): boolean };

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

/** `true` for the `string`/`number` index-signature key, `false` for a literal key. */
type IsIndexKey<K extends PropertyKey> = string extends K ? true : number extends K ? true : false;

/** Removes string/number index signatures while retaining explicitly declared properties. */
type LiteralOnly<T> = {
  [K in keyof T as IsIndexKey<K> extends true ? never : K]: T[K];
};

/**
 * The literal string keys of `T` only — index signatures and symbol keys are dropped. The
 * intermediate key-remapped type is load-bearing: `keyof ({ name: string } &
 * Record<string, unknown>)` is only `string`, but key remapping recovers the explicit `name`.
 */
type LiteralKeys<T> = keyof LiteralOnly<T> extends infer K
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
            // Recurse only into the MAP members of the field: drop every leaf member first
            // (`Exclude<…, Leaf>`) so a union like `Timestamp | { legacy }` contributes
            // `${K}.legacy` but never a class method such as `${K}.toMillis`. A field with no map
            // member (all leaves) contributes no dotted child paths.
            | (Exclude<NonNullable<T[K]>, Leaf> extends infer V
                ? [V] extends [never]
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
 * The `T extends unknown` wrapper makes resolution **distributive** over unions, so it agrees with
 * {@link FieldPaths}: a branch-specific key (e.g. `'legacy'` on `Timestamp | { legacy: string }`)
 * resolves against the member that has it and yields that member's value, rather than collapsing to
 * `never` because `keyof` of the whole union only exposes keys common to every member.
 *
 * @example
 * type C = PathValue<{ address: { city: string } }, 'address.city'>; // => string
 */
export type PathValue<T, P extends string> = T extends unknown
  ? P extends `${infer Head}.${infer Rest}`
    ? Head extends keyof T
      ? PathValue<NonNullable<T[Head]>, Rest>
      : never
    : P extends keyof T
      ? T[P]
      : never
  : never;

/**
 * The subset of {@link FieldPaths} whose resolved value is numeric (including optional numeric
 * fields and nested numeric paths). Used to constrain numeric aggregations (`sum`/`average`) to
 * actual number fields rather than any `keyof T`.
 *
 * Both guards run on the **normalized** value `NonNullable<PathValue<T, P>>`. Normalizing first is
 * essential: a field typed exactly `null` / `undefined` / `null | undefined` resolves to a nullish
 * `PathValue` that only collapses to `never` AFTER `NonNullable`. Guarding the raw `PathValue`
 * instead would let such a field slip past `[raw] extends [never]` (a nullish type is not `never`)
 * and then be wrongly admitted by the vacuous `never extends number`. A path that cannot be resolved
 * at all (raw `PathValue` is already `never`) is likewise excluded. The tuple around the number test
 * keeps a mixed `number | string` value from distributing and admitting only its numeric half.
 *
 * @example
 * type N = NumericFieldPaths<{ name: string; score: number; stats: { count: number } }>;
 * //   => 'score' | 'stats.count'
 */
export type NumericFieldPaths<T> = {
  [P in FieldPaths<T>]: [NonNullable<PathValue<T, P>>] extends [never]
    ? never
    : [NonNullable<PathValue<T, P>>] extends [number]
      ? P
      : never;
}[FieldPaths<T>];

/**
 * Recursively-optional version of `T` — the conservative result shape after a projection
 * (`select(...)`). Unlike `Partial<T>`, which makes only the ROOT properties optional, this also
 * makes nested map properties optional, so a dotted projection such as `select('address.city')` does
 * not leave the unselected sibling `address.zip` statically required once `address` is guarded.
 *
 * The leaf test is **distributive**: each member of a union is judged individually, so a field typed
 * `Timestamp | { legacy: string }` preserves the `Timestamp` member whole and recurses only into the
 * map member. Every {@link Leaf} type is preserved so a selected value keeps its real API after the
 * parent is guarded — scalars, `Date`, Firestore value classes (`Timestamp`, `GeoPoint`,
 * `DocumentReference`, `FieldValue`, structural vector values), byte values (`Uint8Array`/`Buffer`),
 * functions, and **arrays** (a Firestore field mask never projects into array elements, so the array
 * is returned whole rather than element-partialized).
 *
 * Limitation: this recurses into **every object not assignable to the `Leaf` set** — there is no
 * plain-map predicate. In particular, an arbitrary class instance produced by a `readConverter` as a
 * *field value* is not a known `Leaf`, so it recurses and its methods type as optional after a
 * projection (conservative: the runtime value is complete). Note that guarding only the field does
 * NOT make such a method callable — `row.value?.method()` still errors because `method` itself is now
 * optional; guard the method too (`row.value?.method?.()`) or, since `Leaf` is private, assert the
 * field back to its class type after a null check (`(row.value as ClassType).method()`). Structural
 * typing cannot distinguish such a class from a plain map that happens to have a method without
 * reintroducing the dotted-sibling unsoundness this type exists to prevent, so if you rely on a
 * class-instance field's methods after `select(...)`, prefer mapping it at the top level with the
 * repository `readConverter` (which itself may not compose with a projection). A first-class opt-in
 * atomic marker/escape hatch could be added in a later minor release.
 */
export type DeepPartial<T> = T extends Leaf
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/**
 * Distributive synthetic-`id` removal for stored/read models. Each union member is handled
 * independently. When a member explicitly declares a literal `id`, the helper omits it; otherwise
 * it returns that member unchanged instead of applying `Omit` needlessly.
 *
 * Plain `Omit<Union, 'id'>` is defined via `keyof`, and `keyof (A | B)` is the key **intersection**,
 * so a discriminated union like `{ kind: 'a'; onlyOnA: string } | { kind: 'b'; onlyOnB: number }`
 * incorrectly yields only `'kind'` as a queryable path. `Omit` also flattens an intersection such
 * as `{ name: string } & Record<string, unknown>` to the index signature alone. Avoiding `Omit` when
 * there is no explicit `id` preserves both the literal key and the index signature. The
 * `S extends unknown` wrapper makes the conditional **distributive**: each union member is processed
 * independently, then re-unioned, so `FieldPaths<OmitId<S>>` agrees with {@link PathValue}'s own
 * distributivity contract.
 *
 * **Inlining does not work** — `FieldPaths<Union extends unknown ? Omit<Union, 'id'> : never>` still
 * resolves to the collapsed key set because distribution requires a naked type parameter at the use
 * site, not inside another type's argument list. Always apply this alias rather than spelling the
 * conditional inline.
 *
 * For a `keyof` position, {@link KeysOf} is required: `keyof OmitId<S>` re-collapses for the same
 * reason plain `keyof (A | B)` does. Compose as `KeysOf<OmitId<S>>`.
 *
 * A model with no explicit `id` is returned exactly; a model that declares `id` still has that
 * property omitted. Index signatures remain available in value positions such as
 * `StoredDataOf<typeof repo>`.
 *
 * @see ADR-0028
 */
export type OmitId<S> = S extends unknown
  ? 'id' extends keyof LiteralOnly<S>
    ? Omit<S, 'id'>
    : S
  : never;

/**
 * Distributive `keyof` — the union of each member's keys rather than their intersection.
 *
 * `keyof (A | B)` yields only keys common to **every** member (`keyof A & keyof B`). For union read
 * models that is too narrow — branch-specific fields disappear from `distinctValues` constraints and
 * any other `keyof` site. This helper distributes over `T` first, then unions the per-member key sets.
 *
 * Typical composition for field-path surfaces that need top-level keys (not dotted paths):
 * `KeysOf<OmitId<S>>`.
 *
 * @see ADR-0028
 */
export type KeysOf<T> = T extends unknown ? keyof T : never;

/**
 * Distributive indexed access — resolves `T[K]` against the union member that actually carries `K`.
 *
 * Once a method widens its key constraint to admit branch-specific keys (via {@link KeysOf} and
 * {@link OmitId}), plain `T[K]` silently degrades to `unknown` because `K` may not exist on every
 * member. That produces **zero compile errors** while returning `unknown[]` from `distinctValues` —
 * the constraint and the return type must move together. This helper mirrors {@link PathValue}'s
 * distributive resolution for top-level keys.
 *
 * @see ADR-0028
 */
export type ValueAtKey<T, K extends PropertyKey> = T extends unknown
  ? K extends keyof T
    ? T[K]
    : never
  : never;
