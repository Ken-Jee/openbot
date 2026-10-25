### Fixed

- On Linux, closing the AppImage no longer makes the desktop report a crash of `chrome_crashpad_handler`.
  The AppImage does not start the crash reporter, because its helper still ran from the AppImage after
  OpenBot quit.
