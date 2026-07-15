/**
 * Minimal Firestore Admin SDK stubs for unit tests.
 * Mock factories hold spies (jest.fn()) — do not reimplement Firestore behavior.
 */

export type MockCollectionRef = {
  withConverter: jest.Mock;
  doc: jest.Mock;
};

/**
 * Creates a chainable mock Firestore database with a single collection stub.
 */
export function createMockFirestoreDb(collectionRef?: MockCollectionRef) {
  const col =
    collectionRef ??
    ({
      withConverter: jest.fn(),
      doc: jest.fn(),
    } as MockCollectionRef);

  const db = {
    collection: jest.fn().mockReturnValue(col),
  };

  return { db: db as any, collectionRef: col };
}
