/**
 * Strategy: unit tests for the Timestamp <-> millis converter helpers in utils/timestamps.ts.
 * Verifies single-value conversions (both directions), the recursive Timestamp->millis walk over
 * nested objects/arrays with mixed and absent fields, null/undefined safety, that non-Timestamp
 * Firestore value types are left untouched, and that createMillisTimestampConverter converts on
 * fromFirestore (recursive vs fields-scoped) while toFirestore is a pass-through.
 */
import { Timestamp, GeoPoint, FieldValue } from 'firebase-admin/firestore';
import {
  convertTimestampToMillis,
  convertMillisToTimestamp,
  convertTimestampsToMillis,
  createMillisTimestampConverter,
} from '../../utils/timestamps.js';

const MS = Date.parse('2020-01-02T03:04:05.000Z');

/** Builds a QueryDocumentSnapshot-like stub whose data() returns the given object. */
function snapshotOf(data: Record<string, unknown>) {
  return { data: () => data } as unknown as FirebaseFirestore.QueryDocumentSnapshot;
}

describe('timestamp converters', () => {
  describe('convertTimestampToMillis', () => {
    it('converts a Firestore Timestamp to milliseconds', () => {
      expect(convertTimestampToMillis(Timestamp.fromMillis(MS))).toBe(MS);
    });

    it('throws for a value that is not a Timestamp', () => {
      expect(() => convertTimestampToMillis(MS)).toThrow(TypeError);
      expect(() => convertTimestampToMillis(new Date(MS))).toThrow(TypeError);
      expect(() => convertTimestampToMillis(null)).toThrow(TypeError);
    });
  });

  describe('convertMillisToTimestamp', () => {
    it('converts milliseconds to a Firestore Timestamp', () => {
      const ts = convertMillisToTimestamp(MS);
      expect(ts).toBeInstanceOf(Timestamp);
      expect(ts.toMillis()).toBe(MS);
    });

    it('throws for a non-finite number', () => {
      expect(() => convertMillisToTimestamp(Number.NaN)).toThrow(TypeError);
      expect(() => convertMillisToTimestamp(Number.POSITIVE_INFINITY)).toThrow(TypeError);
      expect(() => convertMillisToTimestamp('123' as unknown as number)).toThrow(TypeError);
    });
  });

  describe('convertTimestampsToMillis', () => {
    it('converts a top-level Timestamp', () => {
      expect(convertTimestampsToMillis(Timestamp.fromMillis(MS))).toBe(MS);
    });

    it('recursively converts Timestamps inside nested objects and arrays', () => {
      const input = {
        name: 'event',
        happenedAt: Timestamp.fromMillis(MS),
        meta: { createdAt: Timestamp.fromMillis(MS + 1000), note: 'hi' },
        history: [{ at: Timestamp.fromMillis(MS + 2000) }, { at: Timestamp.fromMillis(MS + 3000) }],
      };

      expect(convertTimestampsToMillis(input)).toEqual({
        name: 'event',
        happenedAt: MS,
        meta: { createdAt: MS + 1000, note: 'hi' },
        history: [{ at: MS + 2000 }, { at: MS + 3000 }],
      });
    });

    it('leaves mixed/absent and scalar fields untouched', () => {
      const input = { count: 5, label: 'x', flag: true, missing: undefined, nothing: null };
      expect(convertTimestampsToMillis(input)).toEqual(input);
    });

    it('is null/undefined safe', () => {
      expect(convertTimestampsToMillis(null)).toBeNull();
      expect(convertTimestampsToMillis(undefined)).toBeUndefined();
    });

    it('does not mutate the input object', () => {
      const ts = Timestamp.fromMillis(MS);
      const input = { at: ts };
      convertTimestampsToMillis(input);
      expect(input.at).toBe(ts);
    });

    it('leaves non-Timestamp Firestore value types untouched', () => {
      const geo = new GeoPoint(1, 2);
      const vector = FieldValue.vector([1, 2, 3]);
      const result = convertTimestampsToMillis({ geo, vector, at: Timestamp.fromMillis(MS) }) as {
        geo: GeoPoint;
        vector: unknown;
        at: number;
      };
      expect(result.geo).toBe(geo);
      expect(result.vector).toBe(vector);
      expect(result.at).toBe(MS);
    });
  });

  describe('createMillisTimestampConverter', () => {
    // The helper returns the `fromFirestore` mapper directly (a `(snapshot) => T` read converter);
    // the repository builds the full FirestoreDataConverter internally, so there is no `toFirestore`.
    it('recursively converts every Timestamp by default', () => {
      const fromFirestore = createMillisTimestampConverter();
      const out = fromFirestore(
        snapshotOf({
          name: 'e',
          at: Timestamp.fromMillis(MS),
          meta: { at: Timestamp.fromMillis(MS + 1) },
        }),
      ) as { name: string; at: number; meta: { at: number } };

      expect(out).toEqual({ name: 'e', at: MS, meta: { at: MS + 1 } });
    });

    it('converts only the named fields when fields are supplied', () => {
      const fromFirestore = createMillisTimestampConverter(['happenedAt']);
      const out = fromFirestore(
        snapshotOf({ happenedAt: Timestamp.fromMillis(MS), other: Timestamp.fromMillis(MS + 5) }),
      ) as { happenedAt: number; other: Timestamp };

      expect(out.happenedAt).toBe(MS);
      // `other` is not in the fields list, so its Timestamp is left intact.
      expect(out.other).toBeInstanceOf(Timestamp);
    });

    it('ignores named fields that are absent from the document', () => {
      const fromFirestore = createMillisTimestampConverter(['missing']);
      const out = fromFirestore(snapshotOf({ name: 'e' })) as Record<string, unknown>;
      expect(out).toEqual({ name: 'e' });
    });
  });
});
