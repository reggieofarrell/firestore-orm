/**
 * Issue #82 investigation probe. It compares path-only normalization with a broader `OmitId`
 * refinement that preserves declared properties and reconstructs index signatures.
 */
import type { FieldPaths, OmitId, PathValue } from '../../../../src/utils/pathTypes.js';

type IsIndexKey<K extends PropertyKey> = string extends K ? true : number extends K ? true : false;
type LiteralOnly<T> = {
  [K in keyof T as IsIndexKey<K> extends true ? never : K]: T[K];
};

/** Path-only candidate: removes `id` and every index signature while keeping declared properties. */
type OmitIdForPaths<S> = S extends unknown
  ? {
      [K in keyof S as K extends 'id'
        ? never
        : IsIndexKey<K> extends true
          ? never
          : K]: S[K];
    }
  : never;

type StringIndex<T> = string extends keyof T ? Pick<T, string> : unknown;
type NumberIndex<T> = number extends keyof T ? Pick<T, number> : unknown;
type IndexOnly<T> = StringIndex<T> & NumberIndex<T>;

/**
 * Broader candidate: omit the declared `id`, retain every other declared key, and reconstruct the
 * original index signatures so value-position aliases stay dynamically indexable.
 */
type PreservingOmitId<S> = S extends unknown
  ? 'id' extends keyof LiteralOnly<S>
    ? Omit<LiteralOnly<S>, 'id'> & IndexOnly<S>
    : S
  : never;

export type ExplicitIdIndex = {
  id: string;
  name: string;
  score: number;
  nested: { label: string; count: number } & Record<string, unknown>;
} & Record<string, unknown>;
export type PlainExplicitId = { id: string; name: string };
export type NoIdIndex = { name: string } & Record<string, unknown>;
export type UnionWithExplicitIdIndex =
  | ({ id: string; kind: 'indexed'; indexedName: string } & Record<string, unknown>)
  | { id: string; kind: 'plain'; plainName: string };
export type NumberIndexed = { id: string; name: string; 0: boolean } & Record<number, unknown>;
export type ReadonlyIndexed = {
  id: string;
  name: string;
  readonly [key: string]: unknown;
};
export type SymbolIndexed = {
  id: string;
  name: string;
  [key: symbol]: unknown;
};

export type P1BaselinePaths = FieldPaths<OmitId<ExplicitIdIndex>>;
export type P2BaselineStored = OmitId<ExplicitIdIndex>;
export type P3BaselineName = PathValue<OmitId<ExplicitIdIndex>, 'name'>;

export type P4PathOnlyPaths = FieldPaths<OmitIdForPaths<ExplicitIdIndex>>;
export type P5PathOnlyStored = OmitIdForPaths<ExplicitIdIndex>;

export type P6PreservingPaths = FieldPaths<PreservingOmitId<ExplicitIdIndex>>;
export type P7PreservingStored = PreservingOmitId<ExplicitIdIndex>;
export type P8PreservingName = PathValue<PreservingOmitId<ExplicitIdIndex>, 'name'>;
export type P9PreservingDynamic = PreservingOmitId<ExplicitIdIndex>['arbitrary'];
export type P10PreservingId = PreservingOmitId<ExplicitIdIndex>['id'];
export type P11PreservingPlainPaths = FieldPaths<PreservingOmitId<PlainExplicitId>>;
export type P12PreservingNoIdPaths = FieldPaths<PreservingOmitId<NoIdIndex>>;
export type P13PreservingUnionPaths = FieldPaths<PreservingOmitId<UnionWithExplicitIdIndex>>;
export type P14PreservingNumberIndexPaths = FieldPaths<PreservingOmitId<NumberIndexed>>;
export type P15PreservingNumberIndexValue = PreservingOmitId<NumberIndexed>[123];

export type P16PathOnlyId = PathValue<OmitIdForPaths<ExplicitIdIndex>, 'id'>;
export type P17PreservingIdPath = Extract<'id', FieldPaths<PreservingOmitId<ExplicitIdIndex>>>;
export type P18ReadonlyStored = PreservingOmitId<ReadonlyIndexed>;
export type P19ReadonlyName = PathValue<PreservingOmitId<ReadonlyIndexed>, 'name'>;
export type P20Never = PreservingOmitId<never>;
export type P21Unknown = PreservingOmitId<unknown>;
export type P22Any = PreservingOmitId<any>;

declare const readonlyStored: PreservingOmitId<ReadonlyIndexed>;
export function p23ReadonlyIndexRemainsReadonly() {
  // @ts-expect-error the reconstructed index signature preserves its readonly modifier
  readonlyStored['dynamic'] = 1;
}
export type P24SymbolIndexPaths = FieldPaths<PreservingOmitId<SymbolIndexed>>;
export type P25SymbolIndexValue = PreservingOmitId<SymbolIndexed>[symbol];
