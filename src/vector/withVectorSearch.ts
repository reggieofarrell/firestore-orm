import { FirestoreRepository, ID } from '../core/FirestoreRepository.js';
import { getQueryRef } from '../core/QueryBuilder.js';
import { assertVectorSearchSupported } from './VectorSearch.js';
import { VectorQueryBuilder } from './VectorQueryBuilder.js';

/**
 * Repository type returned by {@link withVectorSearch}.
 * Identical to {@link FirestoreRepository} except `query()` returns {@link VectorQueryBuilder}.
 */
export type VectorEnabledRepository<T extends { id?: ID }> = Omit<
  FirestoreRepository<T>,
  'query'
> & {
  query(): VectorQueryBuilder<T>;
};

/**
 * Opts a {@link FirestoreRepository} into vector similarity search.
 * All repository methods are proxied; `query()` returns a {@link VectorQueryBuilder}.
 *
 * @param repo - Core repository instance
 * @returns Repository with vector-enabled query builder
 *
 * @example
 * const vectorRepo = withVectorSearch(articleRepo);
 * const neighbors = await vectorRepo.query()
 *   .findNearest({ vectorField: 'embedding', queryVector: [0.1, 0.2], limit: 5, distanceMeasure: 'COSINE' })
 *   .get();
 */
export function withVectorSearch<T extends { id?: ID }>(
  repo: FirestoreRepository<T>,
): VectorEnabledRepository<T> {
  return new Proxy(repo, {
    get(target, property, receiver) {
      if (property === 'query') {
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
  }) as unknown as VectorEnabledRepository<T>;
}
