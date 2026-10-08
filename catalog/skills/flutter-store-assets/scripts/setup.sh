#!/usr/bin/env bash
# One-time setup for flutter-store-assets, run from the Flutter project root.
# Creates .store-assets/venv with Pillow (nothing global) and ignores it in git.
set -euo pipefail

if [ ! -f pubspec.yaml ]; then
  echo "Run this from the Flutter project root (pubspec.yaml not found)." >&2
  exit 1
fi

if ! command -v flutter >/dev/null 2>&1; then
  echo "Flutter is not on PATH. Install it: https://docs.flutter.dev/get-started/install" >&2
  exit 1
fi

PY=$(command -v python3 || true)
if [ -z "$PY" ]; then
  echo "python3 is required for the banners." >&2
  echo "  macOS:   brew install python   (or xcode-select --install)" >&2
  echo "  Linux:   sudo apt install python3 python3-venv" >&2
  echo "  Windows: https://www.python.org/downloads/" >&2
  exit 1
fi

if [ ! -x .store-assets/venv/bin/python ]; then
  echo "Creating .store-assets/venv …"
  "$PY" -m venv .store-assets/venv
fi
.store-assets/venv/bin/python -m pip install --quiet --upgrade pip
.store-assets/venv/bin/python -m pip install --quiet 'pillow==12.3.0'   # versión fija: reproducible y sin sorpresas
.store-assets/venv/bin/python -c "import PIL; print('Pillow', PIL.__version__, 'ready')"

if [ -f .gitignore ] && ! grep -qxF '.store-assets/' .gitignore; then
  printf '\n# flutter-store-assets local tools\n.store-assets/\n' >> .gitignore
  echo "Added .store-assets/ to .gitignore"
fi

echo "Setup complete. Next: copy scripts/capture_template_test.dart into test/store_assets/."
