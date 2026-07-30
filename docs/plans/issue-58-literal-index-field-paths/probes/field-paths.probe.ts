/**
 * Issue #58 investigation probe. It asks what the current implementation and the proposed
 * path-only normalization resolve to; it does not stand in for the permanent type regression tests.
 */
import type {
  FieldPaths,
  NumericFieldPaths,
  OmitId,
  PathValue,
} from '../../../../src/utils/pathTypes.js';

type IsIndexKey<K extends PropertyKey> = string extends K ? true : number extends K ? true : false;

/**
 * Candidate private helper: distribute over unions, remove synthetic `id`, retain explicit
 * properties, and discard index signatures. It must receive the original model: applying `OmitId`
 * first irreversibly flattens the intersection.
 */
type OmitIdForPaths<S> = S extends unknown
  ? {
      [K in keyof S as K extends 'id'
        ? never
        : IsIndexKey<K> extends true
          ? never
          : K]: S[K];
    }
  : never;

type LiteralOnly<T> = {
  [K in keyof T as IsIndexKey<K> extends true ? never : K]: T[K];
};

/**
 * Alternative candidate: avoid applying `Omit` when no explicit literal `id` exists. This preserves
 * the original intersection and its index signature in both path and value positions.
 */
type OmitExplicitId<S> = S extends unknown
  ? 'id' extends keyof LiteralOnly<S>
    ? Omit<S, 'id'>
    : S
  : never;

/** Candidate replacement for `LiteralKeys`, so the recovery also applies at recursive levels. */
type CandidateLiteralKeys<T> = Extract<keyof LiteralOnly<T>, string>;
type Decr = [never, 0, 1, 2, 3, 4, 5, 6];
type Leaf =
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined
  | Date
  | FirebaseFirestore.Timestamp
  | FirebaseFirestore.GeoPoint
  | FirebaseFirestore.DocumentReference
  | FirebaseFirestore.FieldValue
  | Uint8Array
  | readonly unknown[]
  | ((...args: any[]) => any);

/** Candidate spelling for `FieldPaths`; only literal-key discovery changes from the baseline. */
type CandidateFieldPaths<T, D extends number = 6> = [D] extends [never]
  ? never
  : T extends readonly unknown[]
    ? never
    : T extends object
      ? {
          [K in CandidateLiteralKeys<T>]:
            | K
            | (Exclude<NonNullable<T[K]>, Leaf> extends infer V
                ? [V] extends [never]
                  ? never
                  : V extends object
                    ? `${K}.${CandidateFieldPaths<V, Decr[D]>}`
                    : never
                : never);
        }[CandidateLiteralKeys<T>]
      : never;

type CandidateNumericFieldPaths<T> = {
  [P in CandidateFieldPaths<T>]: [NonNullable<PathValue<T, P>>] extends [never]
    ? never
    : [NonNullable<PathValue<T, P>>] extends [number]
      ? P
      : never;
}[CandidateFieldPaths<T>];

export type IndexIntersect = {
  name: string;
  score: number;
  nested: { deep: string };
} & Record<string, unknown>;
export type PureRecord = Record<string, unknown>;
export type NestedIntersect = {
  fixed: {
    label: string;
    count: number;
  } & Record<string, unknown>;
};
export type UnionWithIntersect =
  | ({ kind: 'indexed'; indexedName: string } & Record<string, unknown>)
  | { kind: 'plain'; plainName: string };
export type NumberIndex = { 0: string; name: string } & Record<number, unknown>;
export type SymbolAndLiteral = { [Symbol.iterator](): Iterator<unknown>; name: string };

export type P1BaselinePaths = FieldPaths<OmitId<IndexIntersect>>;
export type P2CandidatePaths = CandidateFieldPaths<OmitIdForPaths<IndexIntersect>>;
export type P3CandidateNumericPaths = CandidateNumericFieldPaths<OmitIdForPaths<IndexIntersect>>;
export type P4CandidateNestedPaths = CandidateFieldPaths<OmitIdForPaths<NestedIntersect>>;
export type P5CandidateUnionPaths = CandidateFieldPaths<OmitIdForPaths<UnionWithIntersect>>;
export type P6CandidatePureRecordPaths = CandidateFieldPaths<OmitIdForPaths<PureRecord>>;
export type P7CandidateNumberIndexPaths = CandidateFieldPaths<OmitIdForPaths<NumberIndex>>;
export type P8CandidateSymbolPaths = CandidateFieldPaths<OmitIdForPaths<SymbolAndLiteral>>;
export type P9BaselineStoredShape = OmitId<IndexIntersect>;
export type P10CandidatePathShape = OmitIdForPaths<IndexIntersect>;
export type P11DynamicValue = OmitId<IndexIntersect>['arbitrary'];
export type P12NameValue = PathValue<OmitId<IndexIntersect>, 'name'>;
export type P13CandidateStripsId = CandidateFieldPaths<
  OmitIdForPaths<{ id: string; name: string }>
>;
export type P14PreservingOmitPaths = CandidateFieldPaths<OmitExplicitId<IndexIntersect>>;
export type P15PreservingOmitStoredShape = OmitExplicitId<IndexIntersect>;
export type P16PreservingOmitDynamicValue = OmitExplicitId<IndexIntersect>['arbitrary'];
export type P17PreservingOmitUnionPaths = CandidateFieldPaths<
  OmitExplicitId<UnionWithIntersect>
>;
export type P18PreservingOmitStripsId = CandidateFieldPaths<
  OmitExplicitId<{ id: string; name: string }>
>;
export type P19ExplicitIdIntersectionPaths = CandidateFieldPaths<
  OmitExplicitId<{ id: string; name: string } & Record<string, unknown>>
>;
export type P20Never = OmitExplicitId<never>;
export type P21Unknown = OmitExplicitId<unknown>;
export type P22Any = OmitExplicitId<any>;
export type P23PlainNoId = OmitExplicitId<{ name: string }>;
export type P24OptionalIdPaths = CandidateFieldPaths<
  OmitExplicitId<{ id?: string; name: string }>
>;
export type P25ReadonlyIdPaths = CandidateFieldPaths<
  OmitExplicitId<{ readonly id: string; name: string }>
>;
