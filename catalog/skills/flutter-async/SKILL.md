---
name: flutter-async
description: Asynchronous Dart in Flutter — Futures, Streams, async/await, FutureBuilder/StreamBuilder, modeling loading/error/data states, and cancellation. Use when fetching network/data, building reactive streams, or rendering UI that depends on async results. Triggers on network calls, async data loading, or reactive stream handling.
metadata:
  source: chalc-authored
  updated: "2026"
---

# Flutter Async (Futures & Streams)

Dart is single-threaded with an event loop. Use `Future` for a single async value and `Stream` for a sequence over time.

## async / await
```dart
Future<User> fetchUser(String id) async {
  final res = await http.get(Uri.parse('https://api.example.com/users/$id'));
  if (res.statusCode != 200) throw HttpException('Failed: ${res.statusCode}');
  return User.fromJson(jsonDecode(res.body) as Map<String, dynamic>);
}

// Run independent futures concurrently
final results = await Future.wait([fetchUser('1'), fetchUser('2')]);
```
- Always wrap awaited calls that can fail in `try/catch`.
- Guard `BuildContext` with `if (!context.mounted) return;` after an `await`.

## FutureBuilder: render a one-shot async result
Create the future once (in `initState` or a field), not inside `build`, or it refires on every rebuild.

```dart
late final Future<User> _userFuture = fetchUser(widget.id);

@override
Widget build(BuildContext context) => FutureBuilder<User>(
      future: _userFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const CircularProgressIndicator();
        }
        if (snapshot.hasError) return Text('Error: ${snapshot.error}');
        final user = snapshot.requireData;
        return Text(user.name);
      },
    );
```

## Streams and StreamBuilder
```dart
Stream<int> ticker() async* {
  for (var i = 1; i <= 5; i++) {
    await Future.delayed(const Duration(seconds: 1));
    yield i; // emit a value
  }
}

StreamBuilder<int>(
  stream: ticker(),
  initialData: 0,
  builder: (context, snapshot) => Text('Tick ${snapshot.data}'),
);
```
- Transform with `map`, `where`, `asyncMap`; broadcast with `.asBroadcastStream()` for multiple listeners.

## Explicit loading / error / data states
Model the async lifecycle as a sealed type so the UI is exhaustive and never ambiguous.

```dart
sealed class AsyncState<T> {}
class Loading<T> extends AsyncState<T> {}
class Data<T> extends AsyncState<T> { final T value; Data(this.value); }
class Failure<T> extends AsyncState<T> { final Object error; Failure(this.error); }

Widget render(AsyncState<User> s) => switch (s) {
  Loading() => const CircularProgressIndicator(),
  Data(value: final u) => Text(u.name),
  Failure(error: final e) => Text('Error: $e'),
};
```

## Cancellation and cleanup
- Cancel `StreamSubscription`s in `dispose()`.
- Use a flag/token to ignore late results, or `package:async`'s `CancelableOperation` for cancelable futures.

```dart
StreamSubscription<int>? _sub;

@override
void initState() {
  super.initState();
  _sub = ticker().listen((v) => setState(() => _tick = v));
}

@override
void dispose() {
  _sub?.cancel();
  super.dispose();
}
```

## Checklist
- [ ] Awaited failable calls are wrapped in `try/catch`.
- [ ] Futures for `FutureBuilder` are created once, not in `build`.
- [ ] UI covers loading, error and data states explicitly.
- [ ] `context.mounted` checked after every `await`.
- [ ] Stream subscriptions cancelled in `dispose()`.
