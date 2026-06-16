---
name: python-best-practices
description: Modern Python best practices for writing, reviewing and refactoring production code (Python 3.12+). Use for project setup, dependency management with uv, linting/formatting with Ruff, type hints and static type checking, pyproject.toml configuration, and idiomatic structure. Triggers when creating a Python project, adding dependencies, configuring tooling, adding type hints, or refactoring Python modules.
metadata:
  source: chalc-authored
  updated: "2026"
---

# Python Best Practices (2026)

Modern, production-grade Python. Default toolchain consolidates around **uv + Ruff + mypy + pytest**.

## Toolchain (the 2026 default)
- **uv** — installs Python, manages venvs, dependencies, lockfile and task running. Replaces `pip` + `venv` + `poetry`.
  - `uv init`, `uv add <pkg>`, `uv run <cmd>`, `uv sync`. Commit `uv.lock`.
- **Ruff** — linter **and** formatter. Replaces `black` + `flake8` + `isort`. `ruff check --fix` and `ruff format`.
- **mypy** (or Astral's `ty`) — static type checking.
- **pytest** — tests (see the `python-testing` skill).

`pyproject.toml` is the **single source of truth** for config and dependencies. Do not use `requirements.txt` or `setup.py` for new projects.

## Project structure (src layout)
```
myproject/
├── pyproject.toml
├── uv.lock
├── README.md
├── src/myproject/__init__.py
└── tests/
    ├── unit/
    └── integration/
```
Use the `src/` layout so tests run against the installed package, not the working dir.

## Type hints
- Annotate all public function signatures and dataclass fields.
- Use modern syntax: `list[int]`, `dict[str, int]`, `str | None` (not `Optional`/`List` from `typing`).
- Prefer `@dataclass` (or `pydantic` for validation/IO boundaries) over ad-hoc dicts.
- Run mypy in CI; treat type errors as failures.

## Idioms
- Prefer pure functions and explicit dependencies over global state.
- Context managers (`with`) for resources; `pathlib.Path` over `os.path`.
- f-strings for formatting; comprehensions over manual loops when readable.
- Raise specific exceptions; never `except:` bare. Fail loud, early.
- Keep modules cohesive — **one responsibility per module**; split large files.

## pyproject.toml (minimal)
```toml
[project]
name = "myproject"
requires-python = ">=3.12"
dependencies = []

[tool.ruff]
line-length = 100

[tool.mypy]
strict = true
```

## Checklist
- [ ] `uv` for deps; `uv.lock` committed.
- [ ] `ruff check` and `ruff format` clean.
- [ ] Public APIs fully type-hinted; `mypy --strict` passes.
- [ ] `src/` layout; tests in `tests/`.
- [ ] No bare `except`, no mutable default args.
