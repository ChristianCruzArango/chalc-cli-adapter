---
name: flutter-state-management
description: Choosing and applying Flutter state management — setState/ValueNotifier for local state, Provider/Riverpod/Bloc for shared state, lifting state up, and avoiding unnecessary rebuilds. Use when deciding where state should live or wiring app-wide/shared state. Triggers on managing app state, sharing data across screens, or fixing over-rebuilding.
metadata:
  source: chalc-authored
  updated: "2026"
---

# Flutter State Management

Pick the smallest tool that fits the scope of the state.

## Decide by scope
- **Ephemeral / local** (a single widget): `setState` or `ValueNotifier`.
- **Shared across widgets/screens**: `Provider`, `Riverpod`, or `Bloc`.
- Lift state up to the lowest common ancestor that needs it; pass data down, send events up via callbacks.

## Local state: setState and ValueNotifier
`ValueNotifier` + `ValueListenableBuilder` rebuilds only the listening subtree, not the whole widget.

```dart
final counter = ValueNotifier<int>(0);

ValueListenableBuilder<int>(
  valueListenable: counter,
  builder: (context, value, child) => Text('$value'),
);

counter.value++; // notifies listeners
// remember to counter.dispose() in State.dispose()
```

## Provider: simple dependency + change notification
```dart
class CartModel extends ChangeNotifier {
  final _items = <Item>[];
  List<Item> get items => List.unmodifiable(_items);
  void add(Item i) { _items.add(i); notifyListeners(); }
}

// Provide above the tree
ChangeNotifierProvider(create: (_) => CartModel(), child: const App());

// Consume selectively to limit rebuilds
final count = context.select<CartModel, int>((m) => m.items.length);
context.read<CartModel>().add(item);   // no rebuild, just an action
```

## Riverpod: compile-safe, testable providers
```dart
final cartProvider = NotifierProvider<CartNotifier, List<Item>>(CartNotifier.new);

class CartNotifier extends Notifier<List<Item>> {
  @override
  List<Item> build() => [];
  void add(Item i) => state = [...state, i];
}

class CartBadge extends ConsumerWidget {
  const CartBadge({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final count = ref.watch(cartProvider.select((items) => items.length));
    return Text('$count');
  }
}
```

## Bloc/Cubit: explicit events and states
Good for complex flows where you want a clear state machine and traceable transitions.

```dart
class CounterCubit extends Cubit<int> {
  CounterCubit() : super(0);
  void increment() => emit(state + 1);
}

BlocBuilder<CounterCubit, int>(
  builder: (context, count) => Text('$count'),
);
context.read<CounterCubit>().increment();
```

## Avoiding unnecessary rebuilds
- Watch the narrowest slice: `select` (Provider/Riverpod), `buildWhen` (Bloc).
- Pass `const` `child` widgets into builders so they are not rebuilt.
- Keep mutable state out of large widgets; isolate it behind a small builder.

## Choosing
- **Provider** — minimal, official, great for small/medium apps.
- **Riverpod** — Provider's successor: no `BuildContext`, compile-safe, easy to test.
- **Bloc** — structured event→state for large apps and clear separation.

## Checklist
- [ ] State lives at the lowest scope that needs it.
- [ ] Local state uses `setState`/`ValueNotifier`; shared uses Provider/Riverpod/Bloc.
- [ ] Rebuilds scoped via `select`/`buildWhen` and `const` children.
- [ ] Notifiers/controllers disposed when owned by a `State`.
