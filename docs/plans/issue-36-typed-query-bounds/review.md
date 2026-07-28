# Adversarial review — issue #36

**Reviewer:** independent `generalPurpose` subagent (refute-first) · **Reviewed commit:** `b7964fa`
(plus staged WIP at review time) · **Implementer dispositions:** see `notes.md`

**Original verdict:** needs work  
**Post-fix disposition:** pass with fixes (all load-bearing findings fixed or explicitly not-a-defect)

## Findings (implementer dispositions)

| Id | Severity | Title | Disposition |
| -- | -------- | ----- | ----------- |
| F1 | critical | I-13 `orderByPath`+`limitToLast().get()` fails emulator | **fixed** — local-guard-only assert; score `.get()` kept |
| F2 | critical | `check:format` fails on HEAD | **fixed** — prettier --write |
| F3 | high | Group `select()` flag copy untested | **fixed** — I-13b + U-select-copy (group) |
| F4 | high | ADR claimed foreign pins without tests | **fixed** — I-16/I-17 + ADR wording (F2 = field values) |
| F5 | medium | Stale “whole result set” JSDoc | **fixed** — source JSDoc; ADR-0024 Context left historical |
| F6 | medium | Plan U-select-copy missing | **fixed** — collection + group unit cases |
| F7 | medium | Zero-arg bounds type-legal | **not a defect** — plan §6 overload shape; runtime guard |
| F8 | low | `limitToLast(0)` / `paginateWithCount` untested | **fixed** — I-15 + unit |
| F9 | low | I-14 bare setTimeout | **fixed** — wait on first emission |
| F10 | low | Gate honesty gap | **fixed** — full gate re-run green |

Full reviewer narrative (pre-fix) is summarized in the implementer notes; this file is the durable
disposition record beside the plan.
