---
name: flutter-store-assets
description: Generates App Store and Google Play images for a Flutter app — real screenshots at exact store sizes (captured from the widget tree with flutter_test, real fonts, seeded demo data) and landscape banners (App Store product page header 5244×2950 / 3840×1646, Google Play feature graphic 1024×500) composed from those screenshots with Pillow. Use when the user asks for store screenshots, store banners/headers/feature graphic, or an upload failed with "invalid dimensions". Always asks first which store(s) and assets are needed. Includes setup, ready-to-adapt scripts and a size/alpha checker.
metadata:
  source: chalc-authored
  updated: "2026-10"
---

# Flutter Store Assets

## 0. Ask first — never guess the store

Before generating anything, ask the user (one short message, options listed):

1. **Store(s):** App Store (iOS), Google Play (Android), or both?
2. **Assets:** screenshots, App Store header banners, Google Play feature graphic, icon?
3. **Devices:** does the app support iPad? Android tablets/Chromebook?
4. **Languages:** which locales need their own screenshots (each needs the app in that language)?
5. **Where to save:** default `build/store_assets/`, or a folder they name (e.g. `~/Desktop/<App>_Store/`).

Generate only what was asked, and name output folders by store and slot.

## 1. Official sizes (checked Oct 2026 — re-check the console, they change)

### App Store (iOS) — JPG/PNG, **no transparency**, 1–10 per size
| Slot | Portrait px | Device preset | Required? |
|---|---|---|---|
| iPhone, Dynamic Island **medium** (17 Pro, 16 Pro, 15 Pro…) | **1206 × 2622** (or 1179 × 2556) | `iphone` | **Yes** — the one required iPhone set |
| iPhone, Dynamic Island large (17 Pro Max…) | 1260 × 2736 | `iphone_large` | Optional |
| iPhone, Face ID large (14 Plus, 11 Pro Max…) | 1284 × 2778 / 1242 × 2688 | — | Only if the console asks |
| iPad 13" | **2064 × 2752** (or 2048 × 2732) | `ipad13` | Yes, only if the app supports iPad |
| Product page **header** component | **5244 × 2950** or **3840 × 1646** (landscape) | banner | Optional. Portrait screenshots here fail with "dimensions are not valid" |

App Store Connect scales the required size down for smaller devices when the UI is the same.

### Google Play (Android) — JPG or 24-bit PNG, **no alpha** (except the icon)
| Slot | Size px | Device preset | Rules |
|---|---|---|---|
| Phone screenshots | **1080 × 1920** (9:16) | `android` | 2–8; sides 320–3840 and long side ≤ 2× short side (so 1080 × 2400 is **invalid**). 4+ at ≥1080 px and 9:16 for promotion |
| 7"/10" tablet + Chromebook | **1440 × 2560** (9:16) | `android_tablet` | 4+; sides 1080–7680 |
| Feature graphic | **1024 × 500** | banner | Required. Keep key elements centered; no pure white/dark-gray background |
| App icon | **512 × 512** | — | 32-bit PNG with alpha, ≤ 1 MB |
| Android TV banner | 1280 × 720 | banner | Only for TV apps |

## 2. Setup (once per project)

```sh
bash <skill-dir>/scripts/setup.sh
```

Checks `flutter` and `python3`, creates `.store-assets/venv` with Pillow (nothing global) and adds `.store-assets/` to `.gitignore`. Missing Python: macOS `brew install python` (or `xcode-select --install`); Linux `sudo apt install python3 python3-venv`; Windows python.org.

## 3. Screenshots

1. Copy `scripts/capture_template_test.dart` to `test/store_assets/store_screenshots_test.dart`.
2. Fill the TODOs:
   - `fonts`: every family from `pubspec.yaml` (without it flutter_test draws boxes).
   - `buildApp()`: the app root wired with in-memory fakes (storage, auth, clock); reuse the project test harness.
   - seed believable demo data in the user's language/currency — never real personal data.
   - `steps`: navigate and `shot('01_home')`… in store order.
3. Run once per device preset the user needs (skipped unless `STORE_ASSETS=1`, so the normal suite never writes files):

```sh
STORE_ASSETS=1 STORE_DEVICE=iphone flutter test test/store_assets/store_screenshots_test.dart
STORE_ASSETS=1 STORE_DEVICE=android flutter test test/store_assets/store_screenshots_test.dart
```

Output: `build/store_assets/screenshots/<preset>/` (override with `STORE_ASSETS_OUT`).

4. **Open every image** and re-take any with a half-scrolled section, an animation mid-way or overflow stripes.

### Rules that avoid broken captures
- Wrap the app in `RepaintBoundary(key: rootKey)` and capture it: dialogs and sheets are included.
- Precache images inside `tester.runAsync` before `toImage`, or they come out blank.
- With looping animations never `pumpAndSettle`; pump fixed frames (`settle(tester, 25)`).
- `tester.view.physicalSize` + `devicePixelRatio` = preset; `toImage(pixelRatio: dpr)` gives the exact size.
- Scroll so sections start at the top; hide debug banners; skip lock/onboarding with fakes.

## 4. Banners

```sh
.store-assets/venv/bin/python <skill-dir>/scripts/compose_banner.py \
  --shots build/store_assets/screenshots/iphone \
  --center 01_home.png --left 02_wallet.png --right 03_chat.png \
  --logo assets/icon/logo.png --font assets/fonts/YourFont.ttf \
  --brand "myapp" --title "Clear money.\nCalm life." --subtitle "One short promise." \
  --colors "#F5F3F8,#E3DFF0,#DDEBE0" --ink "#302C47" --muted "#6F6A86" \
  --size 5244x2950 --size 3840x1646 --out build/store_assets/banners/app_store
```

- Google Play feature graphic: same command with `--shots build/store_assets/screenshots/android --size 1024x500 --out build/store_assets/banners/google_play` (short canvases use two phones).
- Take colors from the app theme and the font from `pubspec.yaml`. Look at each output; shorten the subtitle if it wraps into the phones.
- Rendering banners inside flutter_test can hang at these sizes — use this script.

## 5. Verify and fix before uploading

```sh
.store-assets/venv/bin/python <skill-dir>/scripts/verify_sizes.py build/store_assets --fix
```

Lists every image with the slots it fits, removes transparency (both stores reject it in screenshots/banners) and exits 1 if something fits no slot.

## 6. Deliver

- Folders per store and slot, e.g. `app_store/iphone`, `app_store/header`, `google_play/phone`, `google_play/feature_graphic`.
- Tell the user exactly which folder goes into which console field.
- Keep the project's capture test and banner command in the repo so assets can be regenerated when the UI changes.
