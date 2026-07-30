/**
 * Type-level tests for HookContext / WriteOutcome (issue #46), checked by `npm run test:types`
 * via tsc (NOT jest). This file is never executed.
 *
 * Pins:
 * - after-hook contexts are direct-only (no transaction branch);
 * - transaction narrowing exposes attempt; direct narrowing does not;
 * - one-argument hooks still register (T12);
 * - two-argument hooks can narrow by event/execution;
 * - WriteOutcome exhaustive switching correlates count/hook fields;
 * - root public module exports HookContext, HookEvent, WriteOutcome, WriteOutcomeError.
 */
import type { HookContext, HookEvent, WriteOutcome, WriteOutcomeError } from '../../index.js';
import { FirestoreRepository } from '../../index.js';

declare const db: FirebaseFirestore.Firestore;
declare const repo: FirestoreRepository<{ name: string }>;
void db;

// ---------------------------------------------------------------------------
// After-hook contexts are direct-only (transaction branch is `never`)
// ---------------------------------------------------------------------------

type AfterCreateExecution = HookContext<'afterCreate'>['execution'];
type _AfterCreateIsDirectOnly = AfterCreateExecution extends 'direct'
  ? 'direct' extends AfterCreateExecution
    ? true
    : false
  : false;
const _afterCreateOnlyDirect: _AfterCreateIsDirectOnly = true;
void _afterCreateOnlyDirect;

type AfterCreateTransactionBranch = Extract<
  HookContext<'afterCreate'>,
  { execution: 'transaction' }
>;
type _AfterCreateHasNoTransaction = [AfterCreateTransactionBranch] extends [never] ? true : false;
const _noAfterTransaction: _AfterCreateHasNoTransaction = true;
void _noAfterTransaction;

// ---------------------------------------------------------------------------
// Transaction narrowing exposes attempt; direct narrowing does not
// ---------------------------------------------------------------------------

export function narrowHookContext(ctx: HookContext<'beforeUpdate'>): number | null | undefined {
  if (ctx.execution === 'transaction') {
    return ctx.attempt;
  }
  // @ts-expect-error direct branch has no attempt field
  return ctx.attempt;
}

// ---------------------------------------------------------------------------
// One-argument hooks still register (T12)
// ---------------------------------------------------------------------------

export function oneArgHooksStillRegister() {
  repo.on('beforeCreate', _data => {
    // intentionally ignore context
  });
  repo.on('afterDelete', _doc => {
    // intentionally ignore context
  });
}

// ---------------------------------------------------------------------------
// Two-argument hooks can narrow by event/execution
// ---------------------------------------------------------------------------

export function twoArgHooksNarrow() {
  repo.on('beforeCreate', (_data, ctx) => {
    if (ctx.execution === 'transaction') {
      const attempt: number | null = ctx.attempt;
      void attempt;
    }
  });
  repo.on('beforeUpdate', (_data, ctx) => {
    if (ctx.execution === 'direct') {
      // @ts-expect-error direct beforeUpdate has no attempt
      return ctx.attempt;
    }
    return undefined;
  });
}

// ---------------------------------------------------------------------------
// WriteOutcome exhaustive switching
// ---------------------------------------------------------------------------

export function exhaustWriteOutcome(outcome: WriteOutcome): number | string {
  switch (outcome.state) {
    case 'not-committed':
      return outcome.hook.event;
    case 'partially-committed':
      return outcome.committedWrites + outcome.totalWrites;
    case 'committed':
      if (outcome.phase === 'after-hook') return outcome.hook.event;
      return 'read-back';
  }
}

// ---------------------------------------------------------------------------
// Root exports are importable as types
// ---------------------------------------------------------------------------

type _Exports = {
  hookEvent: HookEvent;
  hookContext: HookContext;
  writeOutcome: WriteOutcome;
  writeOutcomeError: WriteOutcomeError;
};
const _exportsOk: _Exports | undefined = undefined;
void _exportsOk;
