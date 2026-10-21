### Fixed

- OpenBot now keeps your sign-in, API keys and other secrets on Linux desktops such as Hyprland,
  Sway, i3 and LXQt when a Secret Service (such as GNOME Keyring) runs. Before, it asked you to sign
  in on every start, and it could not save a pasted API key.
