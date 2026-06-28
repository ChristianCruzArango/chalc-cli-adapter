---
name: flutter-testing
description: Testing Flutter with flutter_test — unit tests, widget tests (testWidgets, find, pump/pumpAndSettle), integration tests, mocking with mocktail, and golden tests. Use when writing or strengthening tests for Dart logic or widgets, or setting up test mocks. Triggers on adding/improving tests or stubbing dependencies. Use the separate mutation-testing skill to verify test strength.
metadata:
  source: chalc-authored
  updated: "2026"
---

# Flutter Testing

Three layers: **unit** (logic), **widget** (a widget in isolation), **integration** (full app on a device/emulator). Tests live in `test/`; integration tests in `integration_test/`.

## Unit tests
```dart
import 'package:test/test.dart';

void main() {
  group('Cart', () {
    test('total sums item prices', () {
      final cart = Cart()..add(Item(price: 10))..add(Item(price: 5));
      expect(cart.total, 15);
    });

    test('throws on negative quantity', () {
      expect(() => Cart().setQuantity(-1), throwsArgumentError);
    });
  });
}
```

## Widget tests
`testWidgets` pumps a widget into a test harness. `find` locates widgets; `pump` advances frames.

```dart
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('counter increments on tap', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Counter()));

    expect(find.text('Count: 0'), findsOneWidget);

    await tester.tap(find.byType(TextButton));
    await tester.pump();               // rebuild after setState

    expect(find.text('Count: 1'), findsOneWidget);
  });
}
```
- `find.text`, `find.byType`, `find.byKey`, `find.byIcon` to locate.
- `pump()` advances one frame; `pumpAndSettle()` waits for animations/async to finish.
- Wrap widgets needing inherited config in `MaterialApp`/`Scaffold`.

## Mocking with mocktail
`mocktail` needs no codegen — subclass `Mock` and stub with `when`.

```dart
import 'package:mocktail/mocktail.dart';

class MockUserRepository extends Mock implements UserRepository {}

void main() {
  late MockUserRepository repo;
  setUp(() => repo = MockUserRepository());

  test('loads user from repository', () async {
    when(() => repo.fetch('42'))
        .thenAnswer((_) async => const User(id: '42', name: 'Ada'));

    final vm = ProfileViewModel(repo);
    await vm.load('42');

    expect(vm.user?.name, 'Ada');
    verify(() => repo.fetch('42')).called(1);
  });
}
```
- Register fallbacks for custom types with `registerFallbackValue(...)` in `setUpAll`.

## Golden tests
Pixel-compare a widget against a stored reference image.

```dart
testWidgets('button matches golden', (tester) async {
  await tester.pumpWidget(const MaterialApp(home: PrimaryButton()));
  await expectLater(
    find.byType(PrimaryButton),
    matchesGoldenFile('goldens/primary_button.png'),
  );
});
// Generate/update with: flutter test --update-goldens
```

## Integration tests
```dart
import 'package:integration_test/integration_test.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('end-to-end checkout', (tester) async {
    await tester.pumpWidget(const MyApp());
    await tester.tap(find.byKey(const Key('checkout')));
    await tester.pumpAndSettle();
    expect(find.text('Order placed'), findsOneWidget);
  });
}
// Run: flutter test integration_test/
```

## Checklist
- [ ] Pure logic covered by fast unit tests.
- [ ] Widget tests assert with `find` and `pump`/`pumpAndSettle`.
- [ ] Dependencies mocked with `mocktail`; interactions `verify`-ied.
- [ ] Golden tests for critical visuals; integration tests for key flows.
- [ ] Test strength validated via the mutation-testing skill.
