---
name: dotnet-testing
description: Testing .NET code with xUnit. Use for unit and integration tests, the Arrange-Act-Assert pattern, fixtures, mocking with NSubstitute/Moq, and ASP.NET Core integration testing. Triggers when adding tests, setting up xUnit, following TDD, or testing C# classes and services.
metadata:
  source: chalc-authored
  updated: "2026"
---

# .NET Testing with xUnit

xUnit is the de-facto standard. Pairs with Test-First / TDD.

## Layout
- A test project per production project: `MyApp.Domain.Tests`, `MyApp.Api.Tests`.
- Reference `xunit`, `xunit.runner.visualstudio`, and a mocking lib (`NSubstitute` preferred, or `Moq`).
- Run: `dotnet test`.

## Test anatomy (Arrange–Act–Assert)
```csharp
[Fact]
public void Total_AppliesDiscount()
{
    var cart = new Cart([new Item(100)]);   // Arrange
    var total = cart.Total(discount: 0.1m); // Act
    Assert.Equal(90m, total);               // Assert
}
```
- `[Fact]` for a single case; `[Theory]` + `[InlineData]` for table-driven.
- One behavior per test; name `Method_State_Expected`.

## Theory (parametrized)
```csharp
[Theory]
[InlineData(0, 100)]
[InlineData(0.1, 90)]
public void Total_Discounts(decimal discount, decimal expected) =>
    Assert.Equal(expected, new Cart([new Item(100)]).Total(discount));
```

## Fixtures & lifetime
- Constructor = setup, `IDisposable.Dispose` = teardown (new instance per test).
- Shared expensive setup: `IClassFixture<T>` (per class) / `ICollectionFixture<T>` (per collection).

## Mocking (NSubstitute)
```csharp
var repo = Substitute.For<IUserRepository>();
repo.GetAsync(1).Returns(new User(1, "Ana"));
```
- Mock only boundaries (DB, HTTP, clock). Inject via constructor so you don't patch internals.

## Async & exceptions
- `await` async code under test; assert with `await Assert.ThrowsAsync<T>(...)`.

## Integration (ASP.NET Core)
- Use `WebApplicationFactory<TProgram>` for in-memory host + `HttpClient` against real endpoints.

## TDD loop (with the SDD method)
1. Write the test from the acceptance criterion → `dotnet test` → confirm it **FAILS** (Red).
2. Minimum code to pass (Green) → refactor.
3. Run mutation testing and strengthen tests until the mutants are killed.

## Mutation testing (test quality)
A green test isn't enough — it must catch bugs. Run **Stryker.NET**, installed **project-local** so the
version is pinned and reproducible in CI:
```bash
dotnet new tool-manifest                  # once per repo; commit .config/dotnet-tools.json
dotnet tool install dotnet-stryker        # project-local, never global
dotnet stryker                            # surviving mutants = weak tests → strengthen them
```
Stryker.NET writes its report to `StrykerOutput/<timestamp>/reports/mutation-report.json`; that file is
what the quality gate (`.chalc/gate.mjs`) parses, so don't delete it before closing the task. Target
≥ 80% mutation score on critical logic (`mutation.threshold` in `.chalc/gate.json`); add it to CI.

## Checklist
- [ ] Mutation score ≥ 80% (Stryker.NET) on critical logic, verified by `node .chalc/gate.mjs`.
- [ ] Test project per prod project; `dotnet test` green.
- [ ] AAA, `Method_State_Expected` names.
- [ ] `[Theory]` for edge cases.
- [ ] Boundaries mocked; constructor injection.
- [ ] Async tests `await`ed; exceptions via `ThrowsAsync`.
