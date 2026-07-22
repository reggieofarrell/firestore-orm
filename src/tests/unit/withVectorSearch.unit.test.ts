/**
 * Strategy: unit tests for withVectorSearch proxy delegation and SDK guardrails.
 */
import { FirestoreRepository } from '../../core/FirestoreRepository.js';
import { withVectorSearch } from '../../vector/withVectorSearch.js';

function createMockRepo(queryRef: Record<string, unknown>) {
  const coreBuilder = {
    getUnderlyingQuery: jest.fn(() => queryRef),
    where: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
  };

  return {
    query: jest.fn(() => coreBuilder),
    create: jest.fn(async (data: unknown) => ({ id: 'doc-1', ...(data as object) })),
  } as unknown as FirestoreRepository<{ id?: string; name: string }>;
}

describe('withVectorSearch', () => {
  it('should proxy create() to the underlying repository', async () => {
    const repo = createMockRepo({ findNearest: jest.fn() });
    const wrapped = withVectorSearch(repo);

    const created = await wrapped.create({ name: 'proxied' });

    expect(repo.create).toHaveBeenCalledWith({ name: 'proxied' });
    expect(created).toEqual({ id: 'doc-1', name: 'proxied' });
  });

  it('should throw from vectorQuery() when the Firestore SDK does not support findNearest', () => {
    const repo = createMockRepo({});

    expect(() => withVectorSearch(repo).vectorQuery()).toThrow(/not available/i);
  });

  it('should leave query() as the normal builder — no SDK guard, delegates to the core repo (D4)', () => {
    // query() is not overridden by the wrapper, so it returns the underlying core builder and does
    // NOT run the vector-support guard even when the SDK lacks findNearest (ADR-0021, D4).
    const repo = createMockRepo({});
    const wrapped = withVectorSearch(repo);

    expect(() => wrapped.query()).not.toThrow();
    expect(repo.query).toHaveBeenCalledTimes(1);
  });

  it('should proxy non-function repository properties', () => {
    const repo = {
      ...createMockRepo({ findNearest: jest.fn() }),
      collectionName: 'articles',
    } as FirestoreRepository<{ id?: string; name: string }> & { collectionName: string };

    const wrapped = withVectorSearch(repo);
    expect(wrapped.collectionName).toBe('articles');
  });
});
