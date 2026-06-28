---
name: flutter-widgets
description: Composing Flutter UI with StatelessWidget vs StatefulWidget, extracting widgets instead of helper methods, const constructors, keys and BuildContext. Use when building or refactoring UI, deciding how to split a widget tree, or fixing rebuild/state-loss bugs. Triggers on creating screens/components or reorganizing widget trees.
metadata:
  source: chalc-authored
  updated: "2026"
---

# Flutter Widgets

Everything in the UI is a widget. Compose small, focused widgets into trees.

## Stateless vs Stateful
- `StatelessWidget`: pure function of its inputs. Prefer it by default.
- `StatefulWidget`: only when the widget owns mutable state that changes over its lifetime (animations, form fields, toggles).

```dart
class Greeting extends StatelessWidget {
  const Greeting({super.key, required this.name});
  final String name;

  @override
  Widget build(BuildContext context) => Text('Hello, $name');
}

class Counter extends StatefulWidget {
  const Counter({super.key});
  @override
  State<Counter> createState() => _CounterState();
}

class _CounterState extends State<Counter> {
  int _count = 0;
  void _increment() => setState(() => _count++);

  @override
  Widget build(BuildContext context) => TextButton(
        onPressed: _increment,
        child: Text('Count: $_count'),
      );
}
```

## Extract widgets, not helper methods
A `Widget _buildHeader()` method rebuilds with the whole parent and cannot be `const`. A separate widget class gets its own build scope, can be `const`, and only rebuilds when its inputs change.

```dart
// Avoid: helper method rebuilds with parent, never const
Widget _buildBadge() => const Chip(label: Text('New'));

// Prefer: a real widget — isolated rebuilds, const-constructible
class Badge extends StatelessWidget {
  const Badge({super.key});
  @override
  Widget build(BuildContext context) => const Chip(label: Text('New'));
}
```

## const widgets
Mark widgets `const` whenever their entire subtree is constant. Flutter skips rebuilding `const` widgets, which trims work in `build()`.

```dart
@override
Widget build(BuildContext context) => Column(
      children: const [
        Text('Title'),
        SizedBox(height: 8),
        Icon(Icons.star),
      ],
    );
```

## Keys
Keys preserve element/state identity when widgets of the same type move or reorder. Use them in dynamic lists where items hold state.

```dart
ListView(
  children: [
    for (final item in items)
      TodoTile(key: ValueKey(item.id), item: item),
  ],
);
```
- `ValueKey`/`ObjectKey` for stable item identity, `GlobalKey` for cross-tree access (sparingly — it is expensive).

## BuildContext
`context` locates a widget in the tree. Use it to read inherited data (`Theme.of`, `MediaQuery.of`, `Navigator.of`) — but never store it or use a `context` after `await` without checking `mounted`.

```dart
final color = Theme.of(context).colorScheme.primary;

Future<void> _save() async {
  await repository.save();
  if (!context.mounted) return; // guard after async gaps
  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Saved')));
}
```

## Layout building blocks
- Structure with `Column`/`Row`/`Stack`; constrain with `Expanded`/`Flexible`/`SizedBox`.
- `Padding`, `Align`, `Center` for positioning; `LayoutBuilder` for size-dependent UI.

## Checklist
- [ ] Stateless unless mutable lifetime state is truly owned.
- [ ] Extract reusable subtrees into widget classes, not methods.
- [ ] `const` constructors and `const` widgets wherever possible.
- [ ] Keys on stateful items in dynamic lists.
- [ ] Guard `context` with `mounted` after `await`.
