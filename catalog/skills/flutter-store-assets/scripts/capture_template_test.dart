// Store screenshot capture — template from the flutter-store-assets skill.
// Copy to test/store_assets/store_screenshots_test.dart and fill the TODOs.
// Skipped unless STORE_ASSETS=1, so the normal test suite never writes images:
//   STORE_ASSETS=1 STORE_DEVICE=iphone flutter test test/store_assets/store_screenshots_test.dart
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// TODO(1): every font family from pubspec.yaml → its asset file.
const fonts = <(String, String)>[
  // ('Inter', 'assets/fonts/Inter.ttf'),
];

/// TODO(2): the app's root widget wired with in-memory fakes (no real
/// storage, network or auth). Reuse the project's test harness if any.
Future<Widget> buildApp() async {
  throw UnimplementedError('Return your app root widget here');
}

/// TODO(3): navigate to each screen and call [shot] — order is store order.
Future<void> steps(WidgetTester tester) async {
  await shot(tester, '01_home');
  // await tester.tap(find.text('Settings'));
  // await settle(tester);
  // await shot(tester, '02_settings');
}

/// Store sizes (portrait). Check SKILL.md for which slot each one fills.
const devices = {
  // App Store — iPhone with Dynamic Island, medium (REQUIRED): 17 Pro, 16 Pro…
  'iphone': (Size(1206, 2622), 3.0),
  // App Store — iPhone with Dynamic Island, large (optional): 17 Pro Max…
  'iphone_large': (Size(1260, 2736), 3.0),
  // App Store — iPad 13" (required only if the app supports iPad).
  'ipad13': (Size(2064, 2752), 2.0),
  // Google Play — phone, 9:16, eligible for promotion.
  'android': (Size(1080, 1920), 2.625),
  // Google Play — 7"/10" tablets and Chromebook, 9:16.
  'android_tablet': (Size(1440, 2560), 2.0),
};

final rootKey = GlobalKey();
final env = Platform.environment;
final device = devices[env['STORE_DEVICE'] ?? 'iphone']!;
Size get deviceSize => device.$1;
double get dpr => device.$2;
final outDir =
    env['STORE_ASSETS_OUT'] ??
    'build/store_assets/screenshots/${env['STORE_DEVICE'] ?? 'iphone'}';

Future<void> loadFonts() async {
  for (final (family, path) in fonts) {
    final bytes = ByteData.sublistView(File(path).readAsBytesSync());
    await (FontLoader(family)..addFont(Future.value(bytes))).load();
  }
}

/// Pumps fixed frames; safe with looping animations (pumpAndSettle is not).
Future<void> settle(WidgetTester tester, [int frames = 25]) async {
  for (var i = 0; i < frames; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

/// Saves the whole app (dialogs and sheets included) as `<outDir>/<name>.png`.
/// The PNG still has an alpha channel: run verify_sizes.py --fix afterwards,
/// because both stores reject transparency in screenshots.
Future<void> shot(WidgetTester tester, String name) async {
  await tester.runAsync(() async {
    for (final element in find.byType(Image).evaluate()) {
      await precacheImage((element.widget as Image).image, element);
    }
  });
  await tester.pump();
  final boundary =
      rootKey.currentContext!.findRenderObject()! as RenderRepaintBoundary;
  final image = await tester.runAsync(() => boundary.toImage(pixelRatio: dpr));
  final png = await tester.runAsync(
    () => image!.toByteData(format: ui.ImageByteFormat.png),
  );
  Directory(outDir).createSync(recursive: true);
  File('$outDir/$name.png').writeAsBytesSync(png!.buffer.asUint8List());
}

void main() {
  testWidgets(
    'store screenshots',
    (tester) async {
      await loadFonts();
      tester.view.physicalSize = deviceSize;
      tester.view.devicePixelRatio = dpr;
      addTearDown(tester.view.reset);
      final app = (await tester.runAsync(buildApp))!;
      await tester.pumpWidget(RepaintBoundary(key: rootKey, child: app));
      await settle(tester);
      await steps(tester);
    },
    skip: env['STORE_ASSETS'] != '1',
  );
}
