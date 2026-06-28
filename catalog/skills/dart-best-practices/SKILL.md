---
name: dart-best-practices
description: Effective Dart for modern Dart 3.x with sound null safety, immutability, records, pattern matching, sealed classes and idiomatic collections. Use when writing or reviewing Dart code, answering null-safety questions, or modeling data. Triggers on writing Dart classes/functions, null-safety errors, or refactoring data models.
metadata:
  source: chalc-authored
  updated: "2026"
---

# Effective Dart (Dart 3.x)

Idiomatic, null-safe Dart for production Flutter and pure-Dart code.

## Sound null safety
- Non-nullable by default. Add `?` only when `null` is a real, valid value.
- Prefer giving a value over making a type nullable. Use `late` for fields initialized after construction but always before use.
- Avoid the null-assertion `!` except at boundaries you have proven non-null.

```dart
String greet(String? name) => 'Hi, ${name ?? 'guest'}';

int? parseAge(String raw) => int.tryParse(raw); // returns null on failure

// Null-aware access and assignment
user?.address?.city;
config ??= loadDefaults();
```

## Immutability: final and const
- Default to `final` for locals and fields; only use `var` when reassignment is intended.
- `const` for compile-time constants and constant constructors — they are canonicalized and cheaper.

```dart
const pi = 3.14159;            // compile-time constant
final now = DateTime.now();    // runtime, never reassigned

class Point {
  final double x, y;
  const Point(this.x, this.y); // const constructor -> const Point(0, 0)
}
```

## Records: lightweight grouped values
Use records to return multiple values without a class.

```dart
(int, int) minMax(List<int> xs) => (xs.reduce(min), xs.reduce(max));

final (lo, hi) = minMax([3, 1, 9]);       // positional destructuring

// Named fields read clearly at call sites
({String name, int age}) parse(String s) => (name: 'Ada', age: 36);
final person = parse('...');
print(person.name);
```

## Pattern matching and sealed classes
Model closed hierarchies with `sealed`; the compiler enforces exhaustive `switch`.

```dart
sealed class Result<T> {}
class Ok<T> extends Result<T> { final T value; Ok(this.value); }
class Err<T> extends Result<T> { final Object error; Err(this.error); }

String describe(Result<int> r) => switch (r) {
  Ok(value: final v) => 'ok: $v',
  Err(error: final e) => 'error: $e',
}; // no default needed: sealed + exhaustive

// if-case for a single shape
if (json case {'id': int id, 'name': String name}) {
  print('$id -> $name');
}
```

## Idiomatic collections
- Use collection literals and spread/`if`/`for` elements instead of imperative building.

```dart
final ids = [for (final u in users) u.id];
final menu = <String>[
  'home',
  if (isAdmin) 'admin',
  ...extraItems,
];
final byId = {for (final u in users) u.id: u}; // Map from iterable
```

## Naming and structure (Effective Dart)
- `UpperCamelCase` for types/enums/extensions; `lowerCamelCase` for members and variables; `lowercase_with_underscores` for files and directories.
- One public class per file when it carries weight; keep DTOs, enums and interfaces in their own files.
- Prefer expression bodies (`=>`) for one-liners; document public APIs with `///`.

## Checklist
- [ ] Nullable types only where `null` is valid; no stray `!`.
- [ ] `final`/`const` by default; `const` constructors where possible.
- [ ] Records for ad-hoc multi-values; sealed classes for closed unions.
- [ ] Exhaustive `switch` on sealed types (no `default`).
- [ ] Collection literals + spread/`if`/`for`; idiomatic naming.
