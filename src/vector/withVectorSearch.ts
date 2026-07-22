import { FirestoreRepository } from '../core/FirestoreRepository.js';
import { getQueryRef } from '../core/QueryBuilder.js';
import { assertVectorSearchSupported } from './VectorSearch.js';
import { VectorQueryBuilder } from './VectorQueryBuilder.js';

/**
 * Repository type returned by {@link withVectorSearch}.
 *
 * Identical to {@link FirestoreRepository}, plus a `vectorQuery()` entry point returning a
 * {@link VectorQueryBuilder}. `query()` is left intact and returns the normal query builder — the
 * capability wrapper *adds* vector search rather than replacing core query behavior (ADR-0021, D4).
 */
export type VectorEnabledRepository<
  T extends object,
  W extends object = T,
  S extends object = T,
  WO extends object = W,
> = FirestoreRepository<T, W, S, WO> & {
  vectorQuery(): VectorQueryBuilder<T, S>;
};

/**
 * Opts a {@link FirestoreRepository} into vector similarity search.
 *
 * All core repository methods are proxied unchanged — including `query()`, which still returns the
 * normal {@link FirestoreQueryBuilder}. The wrapper adds a `vectorQuery()` entry point that returns
 * a {@link VectorQueryBuilder} for `findNearest` searches (ADR-0021, D4).
 *
 * @param repo - Core repository instance
 * @returns The repository with an added `vectorQuery()` entry point
 *
 * @example
 * const vectorRepo = withVectorSearch(articleRepo);
 * const neighbors = await vectorRepo.vectorQuery()
 *   .findNearest({ vectorField: 'embedding', queryVector: [0.1, 0.2], limit: 5, distanceMeasure: 'COSINE' })
 *   .get();
 *
 * @example
 * // query() is unchanged — normal filtering, pagination, and aggregation still work.
 * const active = await vectorRepo.query().where('status', '==', 'active').get();
 */
export function withVectorSearch<
  T extends object,
  W extends object = T,
  S extends object = T,
  WO extends object = W,
>(repo: FirestoreRepository<T, W, S, WO>): VectorEnabledRepository<T, W, S, WO> {
  return new Proxy(repo, {
    get(target, property, receiver) {
      if (property === 'vectorQuery') {
        return () => {
          const coreBuilder = target.query();
          assertVectorSearchSupported(getQueryRef(coreBuilder));
          return new VectorQueryBuilder(coreBuilder);
        };
      }

      const value = Reflect.get(target, property, receiver);
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    },
  }) as unknown as VectorEnabledRepository<T, W, S, WO>;
}
