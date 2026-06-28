---
name: flutter-performance
description: Improving Flutter runtime performance — const constructors, minimizing rebuilds, lazy lists (ListView.builder), RepaintBoundary, image caching, and keeping expensive work out of build(). Use when diagnosing jank, dropped frames, or slow scrolling, or proactively tuning a UI. Triggers on performance problems or optimizing rebuild/scroll/render cost.
metadata:
  source: chalc-authored
  updated: "2026"
---

# Flutter Performance

Most jank comes from doing too much work per frame: rebuilding too widely, building offscreen items, or repainting unchanged pixels.

## const constructors
`const` widgets are canonicalized and skipped during rebuilds. Use them everywhere a subtree is constant.

```dart
const SizedBox(height: 16);
const Icon(Icons.search);
// Enforce with the lint: prefer_const_constructors
```

## Minimize rebuild scope
- Rebuild the smallest subtree: `ValueListenableBuilder`, `Selector`/`select`, `BlocBuilder(buildWhen:)`.
- Pass a `const child` into builders so it is built once and reused.
- Split large `build` methods into separate widgets so unrelated parts do not rebuild together.

```dart
ValueListenableBuilder<int>(
  valueListenable: counter,
  builder: (context, value, child) => Row(
    children: [Text('$value'), child!],
  ),
  child: const ExpensiveStaticWidget(), // built once, not on each tick
);
```

## Lazy lists
Never put a long list inside `Column`/`ListView(children: [...])` — that builds every item up front. Use builders that create items lazily as they scroll into view.

```dart
ListView.builder(
  itemCount: items.length,
  itemBuilder: (context, i) => ItemTile(item: items[i]),
);

// 2D grids and slivers
GridView.builder(...);
CustomScrollView(slivers: [SliverList.builder(...)]);
```

## RepaintBoundary
Isolate frequently repainting widgets (animations, progress) so they do not force neighbors to repaint.

```dart
RepaintBoundary(
  child: SpinningLogo(), // repaints in its own layer
);
```
Use sparingly — each boundary adds a layer; profile to confirm it helps.

## Image caching and sizing
- `Image.network` caches in memory by default; use `cacheWidth`/`cacheHeight` to decode at display size.
- For disk caching and placeholders use `cached_network_image`.

```dart
Image.network(url, cacheWidth: 320); // decode smaller -> less memory
```

## Keep work out of build()
`build` can run many times per second — it must be cheap and side-effect-free.

```dart
// Bad: allocates/parses on every build
Widget build(BuildContext context) {
  final sorted = items.toList()..sort(); // recomputed each frame
  ...
}

// Good: compute once, cache, or move into a state holder / memoized provider
late final List<Item> _sorted = items.toList()..sort();
```
- No network calls, heavy loops, or `DateTime.now()`-driven logic in `build`.
- Offload heavy CPU work to an isolate via `compute(...)`.

## Profiling
Run in **profile mode** (`flutter run --profile`) and use DevTools: the Performance view for frame timing, the "Rebuild stats" / Repaint rainbow to find over-rebuilding and over-painting.

## Checklist
- [ ] `const` constructors used throughout; `prefer_const_constructors` lint on.
- [ ] Rebuilds scoped with builders/`select`; static children passed as `const`.
- [ ] Long lists use `ListView.builder`/slivers, never eager children.
- [ ] `RepaintBoundary` around hot-repainting widgets (profiled).
- [ ] Images decoded at display size / cached; no heavy work in `build`.
