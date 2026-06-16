---
name: dotnet-best-practices
description: Modern .NET and C# best practices (.NET 8/9, C# 12/13) for writing, reviewing and refactoring code. Use for project structure, nullable reference types, async/await, dependency injection, records, and idiomatic modern C#. Triggers when creating a .NET project, writing C# classes/services, configuring DI, or refactoring C# code.
metadata:
  source: chalc-authored
  updated: "2026"
---

# .NET & C# Best Practices (.NET 9 / C# 13)

Modern, idiomatic C# for production .NET.

## Project setup
- Target the current LTS or latest (`net8.0` LTS, `net9.0` latest). Use `<Nullable>enable</Nullable>` and `<ImplicitUsings>enable</ImplicitUsings>` in the `.csproj`.
- One solution (`.sln`), feature/layered projects (e.g. `Domain`, `Application`, `Infrastructure`, `Api`).
- **One type per file**; file name matches the type. File-scoped namespaces.

```csharp
namespace MyApp.Domain;   // file-scoped

public sealed record Money(decimal Amount, string Currency);
```

## Nullable reference types
- Keep `<Nullable>enable</Nullable>` on. Treat warnings as errors.
- Express intent: `string?` only when null is valid. Avoid `!` (null-forgiving) except at proven boundaries.

## Modern language features
- `record` for immutable data/DTOs; `record struct` for small value types.
- Primary constructors, collection expressions (`[1, 2, 3]`), pattern matching, `switch` expressions.
- `required` members; target-typed `new()`.

## Async
- `async`/`await` end to end; never `.Result`/`.Wait()` (deadlocks).
- Return `Task`/`Task<T>` (or `ValueTask` on hot paths). Suffix async methods with `Async`.
- Accept and pass `CancellationToken`. Use `await foreach` for async streams.

## Dependency injection
- Use the built-in `IServiceCollection`. Register by lifetime: `Singleton` (stateless/shared), `Scoped` (per request), `Transient` (lightweight).
- Depend on interfaces, inject via constructor. No service locator / `new`-ing dependencies.
- Bind config with the options pattern (`IOptions<T>`).

## Errors & structure
- Throw specific exceptions; don't swallow. Use `Result`/exceptions consistently per layer.
- Keep classes small and single-responsibility; prefer composition.
- `ILogger<T>` for structured logging — no `Console.WriteLine`.

## Checklist
- [ ] Nullable enabled, warnings-as-errors.
- [ ] One type per file, file-scoped namespaces.
- [ ] async all the way + `CancellationToken`; no `.Result`.
- [ ] Constructor DI against interfaces; correct lifetimes.
- [ ] Records for immutable data; modern C# syntax.
