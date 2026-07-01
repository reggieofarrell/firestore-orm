/**
 * Auto-increment counters for deterministic test document payloads.
 * Call resetTestFactoryCounters() in beforeEach when order matters.
 */
let userCounter = 0;
let hookValidatedUserCounter = 0;

export function resetTestFactoryCounters(): void {
  userCounter = 0;
  hookValidatedUserCounter = 0;
}

export function nextUserCounter(): number {
  userCounter += 1;
  return userCounter;
}

export function nextHookValidatedUserCounter(): number {
  hookValidatedUserCounter += 1;
  return hookValidatedUserCounter;
}
