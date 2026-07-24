---
title: 'Trust Boundary & Security'
description:
  'The Admin SDK bypasses Firestore security rules — validate untrusted request data and document
  ids at the boundary.'
---

FirestoreORM runs on the **Firebase Admin SDK**, which executes with full privileges and **bypasses
Firestore security rules entirely**. Rules protect client-SDK access; they do nothing for
server-side Admin access. So on the server, input validation and authorization are entirely your
application's responsibility. This page collects the boundary checks the ORM gives you.

## Validate untrusted write data

Every write through a `withSchema(...)` repository is validated against your Zod schema before it
touches Firestore, and a mismatch throws
[`ValidationError`](/firestore-orm/reference/errors/#validationerror). That is your first line of
defense — keep schemas strict (required fields, enums, string formats) rather than permissive, so a
malformed request body is rejected at the write, not persisted.

For the sentinel surface, keep the default `sentinelPolicy: 'strict'` so a caller can't smuggle an
arbitrary `FieldValue` into a field that shouldn't accept one — see
[Per-Field Sentinel Approval](/firestore-orm/guides/concepts/field-value-sentinels/).

## Validate untrusted document ids

A request-supplied id is untrusted input. Left unchecked, a value containing `/` could escape the
collection boundary and address a different document. Every id-taking method validates its id, and
you can validate explicitly at the edge with `repo.id(raw)`:

```typescript
// Reject a malformed id before it reaches Firestore.
const id = userRepo.id(req.params.id); // throws InvalidDocumentIdError on `/`, `..`, `__x__`, etc.
const user = await userRepo.getById(id);
```

`InvalidDocumentIdError` maps to a `400` in the
[Express middleware](/firestore-orm/guides/integrations/express/#error-handling-middleware) and
carries a machine-readable `reason` — never the raw id. See
[Document Identity](/firestore-orm/guides/concepts/document-identity/) for the full id-validation
rules.

## Validate reads at an external boundary

Reads are casts, not validations — the ORM trusts what is already stored. At a boundary where the
data's provenance is uncertain (a Cloud Function trigger snapshot, data written by another system,
or a collection mid-migration), assert the shape explicitly with `validate` / `safeValidate`:

```typescript
const mapped = event.data && userRepo.fromSnapshot(event.data);
if (!mapped) return;
const user = userRepo.validate(mapped); // throws ValidationError on mismatch

// Non-throwing variant — filter bad documents instead of throwing:
const result = userRepo.safeValidate(mapped);
if (!result.success) {
  console.error(result.error.issues);
  return;
}
```

Both require a schema-configured repository. See
[Cloud Functions & Triggers](/firestore-orm/guides/integrations/cloud-functions/) for the trigger
boundary and [Schema Validation](/firestore-orm/guides/concepts/schema-validation/) for the
read-validation contract.

## Out of scope

The ORM does not manage Firestore security rules, IAM, or authentication — those live in your
Firebase project configuration and your app's auth layer. Design your data model with rules in mind
regardless (see [Data Modeling](/firestore-orm/guides/designing/data-modeling/)); the server-side
checks above complement rules, they do not replace the modeling discipline that makes client-side
rules enforceable.
