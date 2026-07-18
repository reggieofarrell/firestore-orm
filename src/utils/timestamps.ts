/**
 * Helpers for the "store a Firestore `Timestamp`, read a milliseconds-since-epoch `number`"
 * pattern.
 *
 * firestore-orm has no read/after-find lifecycle hook (hooks are write-only), so a repository's
 * `readConverter` (the `fromFirestore` half of a `FirestoreDataConverter`) is the single
 * read-transform seam. Repository converters are read-only — writes go through a raw ref — so the
 * recommended write path is to write native temporal values (a `Date` or
 * `FieldValue.serverTimestamp()`, both of which the Admin SDK stores as a `Timestamp` on every write
 * path) and to convert `Timestamp -> number` only on read. {@link createMillisTimestampConverter}
 * packages exactly that: a recursive `fromFirestore` read mapper, ready to pass as `readConverter`.
 */
import { Timestamp } from 'firebase-admin/firestore';
import type { FirestoreDataConverter } from 'firebase-admin/firestore';

/**
 * Structural (duck-typed) check for a Firestore `Timestamp`. We test for a callable `toMillis`
 * rather than `instanceof Timestamp` so the recursive walk below stays free of any
 * `firebase-admin` value reference and is safe to reuse in shared/browser code. A `VectorValue`
 * (`{ _values }`, no `toMillis`), a `GeoPoint`, and a `DocumentReference` are all left untouched.
 */
function isTimestampLike(value: unknown): value is { toMillis: () => number } {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { toMillis?: unknown }).toMillis === 'function'
  );
}

/**
 * True only for plain data objects (prototype `Object.prototype` or `null`). Class instances such
 * as `Timestamp`, `GeoPoint`, `DocumentReference`, and `VectorValue` are intentionally excluded so
 * the recursive walk never rebuilds them into bare objects and strips their behavior.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Recursively converts every Firestore `Timestamp` found inside plain objects and arrays to a
 * milliseconds-since-epoch `number`. Non-plain objects (other Firestore value types) and scalars
 * pass through untouched. Returns a converted copy; the input is not mutated.
 */
function convertValue(value: unknown): unknown {
  if (isTimestampLike(value)) {
    return value.toMillis();
  }
  if (Array.isArray(value)) {
    return value.map(convertValue);
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = convertValue(entry);
    }
    return out;
  }
  return value;
}

/**
 * Converts a single Firestore `Timestamp` to milliseconds-since-epoch.
 * @throws {TypeError} if the value is not a `Timestamp` (has no `toMillis`).
 */
export function convertTimestampToMillis(value: unknown): number {
  if (!isTimestampLike(value)) {
    throw new TypeError('convertTimestampToMillis expected a Firestore Timestamp');
  }
  return value.toMillis();
}

/**
 * Converts a milliseconds-since-epoch `number` to a Firestore `Timestamp`. Imports `Timestamp`
 * from `firebase-admin/firestore` so callers do not pass the class in.
 * @throws {TypeError} if the value is not a finite number.
 */
export function convertMillisToTimestamp(ms: number): Timestamp {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) {
    throw new TypeError('convertMillisToTimestamp expected a millisecond number');
  }
  return Timestamp.fromMillis(ms);
}

/**
 * Recursively converts every Firestore `Timestamp` inside a value (walking plain objects and
 * arrays) to a milliseconds-since-epoch `number`, returning a converted copy. Uses a structural
 * `toMillis` duck-check and never references `firebase-admin`, so the implementation is safe to
 * reuse in shared/browser code. Values without a `toMillis` (including a `VectorValue`) are left
 * untouched.
 */
export function convertTimestampsToMillis<T = unknown>(data: unknown): T {
  return convertValue(data) as T;
}

/**
 * Builds a read-only converter (the `fromFirestore` half of a `FirestoreDataConverter`) that
 * converts stored `Timestamp`s to milliseconds-since-epoch `number`s on read. Pass the result as a
 * repository's `readConverter`; the repository builds the full converter internally and applies it
 * to reads only.
 *
 * Write native temporal values (`Date` / `FieldValue.serverTimestamp()`) — the Admin SDK stores
 * those as a `Timestamp` on every write path — and let this mapper convert `Timestamp -> number` on
 * read. The repository overlays the document `id` itself, so the returned data omits `id`.
 *
 * @param fields - When provided, only these top-level fields are converted (each recursively);
 *   omit to convert the entire document recursively.
 */
export function createMillisTimestampConverter<T>(
  fields?: string[],
): FirestoreDataConverter<T>['fromFirestore'] {
  return snapshot => {
    const data = snapshot.data();
    if (!fields) {
      return convertTimestampsToMillis<T>(data);
    }
    const out: Record<string, unknown> = { ...data };
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(out, field)) {
        out[field] = convertTimestampsToMillis(out[field]);
      }
    }
    return out as T;
  };
}
