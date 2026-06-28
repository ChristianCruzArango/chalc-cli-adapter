---
name: flutter-architecture
description: Structuring Flutter apps with layered/clean architecture — presentation, domain and data layers, feature-first folders, the repository pattern, dependency injection, and keeping business logic out of widgets. Use when starting an app, adding a feature, or untangling logic embedded in widgets. Triggers on structuring a Flutter project or organizing a feature.
metadata:
  source: chalc-authored
  updated: "2026"
---

# Flutter Architecture

Separate concerns so widgets stay thin and logic stays testable. The dependency rule: **outer layers depend on inner; the domain depends on nothing.**

## Layers
- **Presentation** — widgets + state holders (Bloc/Notifier/ViewModel). No business rules, no I/O.
- **Domain** — entities, value objects, use cases, and repository *interfaces*. Pure Dart, framework-agnostic.
- **Data** — repository implementations, data sources (REST, DB), and DTOs/mappers.

Dependencies point inward: Presentation → Domain ← Data.

## Feature-first folders
Group by feature, then by layer, so a feature is self-contained.

```
lib/
  features/
    auth/
      presentation/   # screens, widgets, controllers
      domain/         # entities, repository interfaces, use cases
      data/           # repository impls, data sources, DTOs
  core/               # shared: errors, network, di, theme
  main.dart
```

## Repository pattern
The domain declares the contract; data implements it. Presentation never touches HTTP or DBs directly.

```dart
// domain/repositories/user_repository.dart
abstract interface class UserRepository {
  Future<User> getUser(String id);
}

// data/repositories/user_repository_impl.dart
class UserRepositoryImpl implements UserRepository {
  UserRepositoryImpl(this._api);
  final UserApi _api;

  @override
  Future<User> getUser(String id) async {
    final dto = await _api.fetchUser(id);
    return dto.toDomain(); // map DTO -> domain entity
  }
}
```

## Use cases (optional but clarifying)
A use case is one application action; it keeps controllers slim.

```dart
class GetUser {
  const GetUser(this._repo);
  final UserRepository _repo;
  Future<User> call(String id) => _repo.getUser(id);
}
```

## Dependency injection
Wire concrete implementations to interfaces at the composition root. Two common approaches:

```dart
// Riverpod: providers as the DI graph
final userRepoProvider = Provider<UserRepository>(
  (ref) => UserRepositoryImpl(ref.read(userApiProvider)),
);

// get_it: a service locator registered at startup
final sl = GetIt.instance;
void configureDependencies() {
  sl.registerLazySingleton<UserRepository>(() => UserRepositoryImpl(sl()));
}
```

## Keep logic out of widgets
- Widgets render state and emit intents; they do not call APIs or hold business rules.
- One responsibility per file: entities, interfaces, DTOs and controllers each in their own file.
- Map DTOs to domain entities at the data boundary; never leak DTOs into the UI.

## Checklist
- [ ] Three layers with the dependency rule respected (domain depends on nothing).
- [ ] Feature-first folders; shared code in `core/`.
- [ ] Repository interface in domain, implementation in data.
- [ ] DI at a composition root (Riverpod/get_it); UI depends on interfaces.
- [ ] Widgets free of I/O and business rules; DTOs mapped to entities.
