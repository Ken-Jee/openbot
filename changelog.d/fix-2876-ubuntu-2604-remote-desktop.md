### Changed

- The Linux docs and the Linux download page on openbot.run now name Ubuntu 26.04 LTS. OpenBot
  0.48.1 runs on Ubuntu 26.04 with the Electron sandbox on.

### Fixed

- The x64 remote desktop runtime now starts on Ubuntu 26.04 LTS. Before, it needed
  `libminiupnpc.so.17` and `libicuuc.so.74`, which Ubuntu 26.04 does not have, and the Docker image
  with `BASE=ubuntu:26.04` did not build.
- Remote desktop now starts in the Docker image on Ubuntu 24.04. Before, Sunshine stopped because
  `libnuma1` was not installed. The server install now also installs it.
