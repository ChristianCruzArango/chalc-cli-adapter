---
name: python-testing
description: Testing Python code with pytest. Use for writing unit and integration tests, fixtures, parametrization, mocking, and coverage. Triggers when adding tests, setting up pytest, following TDD (write the failing test first), or testing Python functions and classes.
metadata:
  source: chalc-authored
  updated: "2026"
---

# Python Testing with pytest

pytest is the default. Pairs with Test-First / TDD: write the failing test, then the code.

## Layout
```
tests/
├── conftest.py        # shared fixtures
├── unit/
└── integration/
```
Run: `uv run pytest` · coverage: `uv run pytest --cov=myproject`.

## Test anatomy (Arrange–Act–Assert)
```python
def test_discount_applies_to_total():
    cart = Cart(items=[Item(price=100)])      # Arrange
    total = cart.total(discount=0.1)          # Act
    assert total == 90                        # Assert
```
- One behavior per test. Name tests by behavior: `test_<thing>_<expected>`.
- Assert on outcomes, not implementation details.

## Fixtures
```python
import pytest

@pytest.fixture
def cart():
    return Cart(items=[Item(price=100)])
```
Use fixtures for setup/teardown and shared data. Scope them (`function`/`module`/`session`) deliberately.

## Parametrize (table-driven)
```python
@pytest.mark.parametrize("discount, expected", [(0, 100), (0.1, 90), (1, 0)])
def test_total(cart, discount, expected):
    assert cart.total(discount) == expected
```

## Mocking
- Prefer real objects; mock only at boundaries (network, DB, clock).
- `monkeypatch` for env/attrs; `unittest.mock`/`pytest-mock` for objects.
- Inject dependencies so tests don't need to patch internals.

## Errors & async
- `with pytest.raises(ValueError): ...` for expected exceptions.
- `pytest.mark.asyncio` (via `pytest-asyncio`) for `async def` tests.

## TDD loop (with the SDD method)
1. Write the test from the acceptance criterion → run it → confirm it **FAILS** (Red).
2. Write the minimum code to pass (Green).
3. Refactor; keep tests green.
4. Run mutation testing and strengthen tests until the mutants are killed.

## Mutation testing (test quality)
A passing test isn't enough — it must catch bugs. Run **mutmut**:
```bash
mutmut run                                          # mutates the code; your tests must kill the mutants
mutmut junitxml > reports/mutation/mutmut.xml       # the report the quality gate parses
mutmut results                                      # same thing, readable — for you, not for the gate
```
The gate (`.chalc/gate.mjs`) reads the **XML file**, never the stdout, so the run always has to end
with `mutmut junitxml`. Without that file the mutation stage blocks. Target ≥ 80% killed on critical
logic (`mutation.threshold` in `.chalc/gate.json`); wire it into CI on changed modules.

## Checklist
- [ ] Mutation score ≥ 80% (mutmut) on critical logic, verified by `node .chalc/gate.mjs`.
- [ ] Tests in `tests/`, fast and isolated.
- [ ] AAA structure, behavior-named.
- [ ] Boundaries mocked, internals not.
- [ ] Coverage on critical paths; edge cases parametrized.
