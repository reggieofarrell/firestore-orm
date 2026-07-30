/**
 * Lifecycle hook event names and the typed {@link HookContext} every callback receives.
 *
 * Owned in this module (rather than {@link FirestoreRepository}) so {@link WriteOutcomeError} can
 * reference hook context without a type cycle between the repository and {@link Errors}.
 */

/**
 * Every lifecycle hook event the repository can register. Single-document and bulk variants share
 * the same delivery rules: registration order, sequential await, and fail-fast on the first throw.
 */
export type HookEvent =
  | 'beforeCreate'
  | 'afterCreate'
  | 'beforeUpdate'
  | 'afterUpdate'
  | 'beforeDelete'
  | 'afterDelete'
  | 'beforeBulkCreate'
  | 'afterBulkCreate'
  | 'beforeBulkUpdate'
  | 'afterBulkUpdate'
  | 'beforeBulkDelete'
  | 'afterBulkDelete';

/**
 * The `before*` subset of {@link HookEvent}. Only these events may run inside a transaction
 * callback, so only their contexts admit `execution: 'transaction'`.
 */
type BeforeHookEvent = Extract<HookEvent, `before${string}`>;

/**
 * Discriminated context passed as the second argument to every lifecycle hook.
 *
 * The `event` field duplicates the registration key so a shared multi-event handler can log or
 * narrow without closing over the registration site. Execution is correlated with the event:
 *
 * - **direct** — the write is a normal repository / query-builder method. Never retried by the ORM.
 * - **transaction** — only available on `before*` events when the write is one of the public
 *   `*InTransaction` helpers. The Admin SDK may re-run the callback (and therefore these hooks)
 *   under contention.
 *
 * `attempt` is a 1-based count of how many times the ORM's `runInTransaction` wrapper has entered
 * the Admin SDK callback for this logical call, or `null` when the caller owns a raw Admin SDK
 * transaction and the ORM cannot observe the outer attempt. It is **diagnostic only** — never use
 * it as an idempotency or deduplication key. Key side effects by a business / write identity stored
 * atomically with the data.
 *
 * After-hook contexts are typed as direct-only: there is no transaction branch for `after*`.
 *
 * @typeParam E - The specific hook event; defaults to the full {@link HookEvent} union.
 */
export type HookContext<E extends HookEvent = HookEvent> =
  | {
      readonly event: E;
      readonly execution: 'direct';
      readonly retryable: false;
    }
  | (E extends BeforeHookEvent
      ? {
          readonly event: E;
          readonly execution: 'transaction';
          readonly retryable: true;
          /**
           * 1-based ORM-observed callback entry count for `runInTransaction`, or `null` when the
           * caller manages a raw Admin SDK transaction. Diagnostic only — not an idempotency key.
           */
          readonly attempt: number | null;
        }
      : never);

/**
 * Execution mode the hook dispatcher receives from write call sites.
 *
 * Defaults to `direct`. Only the four `*InTransaction` helpers pass `transaction` with the
 * per-invocation attempt (number or `null`).
 */
export type HookExecution =
  { readonly kind: 'direct' } | { readonly kind: 'transaction'; readonly attempt: number | null };

/**
 * Build an event-correlated {@link HookContext} from the dispatcher event and execution mode.
 *
 * WHY a helper rather than inline object literals at every call site: the transaction branch is
 * only legal for `before*` events. Centralizing the construction keeps after-hook call sites from
 * accidentally admitting a transaction context at the type level.
 */
export function buildHookContext<E extends HookEvent>(
  event: E,
  execution: HookExecution = { kind: 'direct' },
): HookContext<E> {
  if (execution.kind === 'transaction') {
    // Runtime guard (T10): transaction execution is only legal for before* events. Call sites
    // already enforce this; the check keeps a future mis-call from emitting after+transaction
    // metadata into WriteOutcomeError.
    if (!event.startsWith('before')) {
      throw new Error(
        `HookContext: transaction execution is only valid for before* events (got '${event}')`,
      );
    }
    return {
      event,
      execution: 'transaction',
      retryable: true,
      attempt: execution.attempt,
    } as HookContext<E>;
  }

  return {
    event,
    execution: 'direct',
    retryable: false,
  };
}
