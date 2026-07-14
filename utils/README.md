# Utilities

## Kinto on Ubuntu GNOME

Install Kinto from:

- https://github.com/julsemaan/kinto

`utils/kinto.py` in this repo assumes that Kinto variant.

`utils/kinto.py` maps `Cmd+Space` (`RC-Space`) to `Alt+F1`.

On Ubuntu GNOME, make GNOME treat `Alt+F1` as **Show Applications** so `Cmd+Space` opens app grid while Kinto is running:

```bash
gsettings set org.gnome.shell.keybindings toggle-application-view "['<Alt>F1']"
```

Check current value:

```bash
gsettings get org.gnome.shell.keybindings toggle-application-view
```

Why: GNOME shell-level `Super` shortcuts like `Super+A` work from hardware, but are not reliable targets for Kinto/xkeysnail synthetic remaps. Non-`Super` shortcut avoids that limitation.
