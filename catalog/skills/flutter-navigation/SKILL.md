---
name: flutter-navigation
description: Routing in Flutter with go_router (declarative routes, path/query params, redirects, nested routes, deep links) plus Navigator 1.0 basics. Use when adding screens, wiring navigation, passing route arguments, guarding routes, or handling deep links. Triggers on adding routes/navigation or implementing auth redirects/deep linking.
metadata:
  source: chalc-authored
  updated: "2026"
---

# Flutter Navigation (go_router)

`go_router` is the recommended declarative router. It centralizes routes, supports deep links and URL sync, and handles redirects.

## Declarative routes
```dart
final router = GoRouter(
  initialLocation: '/',
  routes: [
    GoRoute(
      path: '/',
      builder: (context, state) => const HomeScreen(),
      routes: [
        // nested -> '/users/:id'
        GoRoute(
          path: 'users/:id',
          builder: (context, state) {
            final id = state.pathParameters['id']!;
            return UserScreen(id: id);
          },
        ),
      ],
    ),
    GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
  ],
);

MaterialApp.router(routerConfig: router);
```

## Navigating
```dart
context.go('/users/42');          // replace the stack (declarative)
context.push('/users/42');        // push onto the stack (returns a Future)
context.pop();                    // pop the top route

// Named routes keep call sites refactor-safe
GoRoute(path: '/users/:id', name: 'user', builder: ...);
context.goNamed('user', pathParameters: {'id': '42'});
```

## Parameters
- Path params: `/users/:id` → `state.pathParameters['id']`.
- Query params: `/search?q=foo` → `state.uri.queryParameters['q']`.
- Complex objects: pass via `extra` (not URL-encoded, lost on web refresh).

```dart
context.go('/checkout', extra: cart);
// builder: (context, state) => CheckoutScreen(cart: state.extra as Cart),
```

## Redirects and route guards
A top-level `redirect` runs on every navigation — ideal for auth.

```dart
GoRouter(
  refreshListenable: authNotifier, // re-evaluate when auth changes
  redirect: (context, state) {
    final loggedIn = authNotifier.isLoggedIn;
    final goingToLogin = state.matchedLocation == '/login';
    if (!loggedIn && !goingToLogin) return '/login';
    if (loggedIn && goingToLogin) return '/';
    return null; // no redirect
  },
  routes: [...],
);
```

## Deep links
`go_router` parses incoming URLs into the same routes automatically. Register the scheme/host in the platform manifests (Android `AndroidManifest.xml` intent filters, iOS associated domains / `Info.plist`), and the matching `GoRoute` handles it — no extra Dart wiring.

## Navigator 1.0 basics
Still useful for quick, local pushes and dialogs:

```dart
final result = await Navigator.of(context).push<bool>(
  MaterialPageRoute(builder: (_) => const EditScreen()),
);
Navigator.of(context).pop(true); // return a value to the awaiter
```

## Checklist
- [ ] Routes defined declaratively in one `GoRouter`.
- [ ] Params via `pathParameters`/`queryParameters`; objects via `extra` with care.
- [ ] Auth handled in `redirect` with a `refreshListenable`.
- [ ] Named routes for refactor-safe navigation.
- [ ] Deep-link schemes registered in platform manifests.
