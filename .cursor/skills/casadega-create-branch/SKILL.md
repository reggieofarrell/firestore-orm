---
name: casadega-create-branch
description: Choose, validate, and create a repository work branch using a Conventional Commit prefix, an available issue or card identifier, and a descriptive kebab-case slug. Use when starting work on a new branch or correcting a proposed branch name; not for protected or platform-managed branches.
---
# Create a conventionally named work branch

Inspect the repository's current branch, status, commit policy, and task context before creating a
branch. Preserve uncommitted work and do not switch, rename, delete, or rewrite a shared branch when
that would risk unrelated changes.

Build the name in one of these forms:

```text
<type>/<slug>
<type>/<issue-id>-<slug>
```

- Use a Conventional Commit type accepted by the repository. Prefer `feat` for new behavior, `fix`
  for a defect, or the precise `build`, `chore`, `ci`, `docs`, `perf`, `refactor`, `revert`,
  `style`, or `test` category. A release branch uses `chore/release-<version>` unless local policy
  defines a different Conventional Commit type.
- Search the user request and supplied GitHub, Linear, Jira, Trello, or other tracker context for an
  issue or card identifier. Include it immediately after the slash when present; normalize letters
  to lowercase, preserve a meaningful internal hyphen, and never invent an identifier.
- Derive a concise lowercase kebab-case slug from the intended outcome. Exclude agent identity and
  generic suffixes such as `changes`, `work`, or `updates`.

Valid examples include `feat/add-realtime-dashboard`, `fix/1234-reject-invalid-cursor`,
`fix/abcd-1234-preserve-auth-session`, and `chore/release-1.4.0`. Reject names whose leading segment
describes the agent or tool, including `codex/`, `claude/`, and `agent/`.

Create the branch non-destructively with the repository's normal Git workflow. Report the selected
name so the user can confirm that the change category and any available tracker identifier were
preserved. Protected, long-lived, generated dependency-update, and temporary analysis branches are
outside this workflow.
