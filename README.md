# claude-am-mods

Mods for [Claude Code](https://claude.com/claude-code): live UI for the terminal and the desktop app's Code tab, written as plugins of function hooks.

## Mods

| Mod | What it does | Command |
| --- | --- | --- |
| [`am-context-bar`](mods/am-context-bar) | A context card above the prompt with a collapsed and an expanded view: zone-coloured token count, a context bar that marks the dumb zone and auto-compact, breakdown by category, session and weekly limits, model, thinking, compactions, git | `/am-context-bar` |

## Install

At the Claude Code prompt:

```
/plugin install am-context-bar --marketplace romnycristopher/claude-am-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope makes it active in every session).

## am-context-bar

Collapsed (default):

```
◔ CONTEXT  63.4k / 1M · 6%  ● Plenty of room      Opus 5.5 · thinking default  ▾
                                                   compacted 0 · git main*
██▌░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│╱╱
■ Tools 28k  ■ MCP 19k  ■ Skills 8.5k  ■ Prompt 4.7k   dumb zone 500k · compact 967k
```

Expanded (press `▾`, or `/am-context-bar expand`): the count and what's left before auto-compact, a scale with the dumb zone and auto-compact marked, a legend (used, free, reserved buffer, dumb zone), a "what's using it" table with a bar, tokens and share per category, session and weekly limits, and model, thinking, compactions and git.

**Zones.** The token count and the status pill change colour with how full the window is:

| Zone | Default range | Colour |
| --- | --- | --- |
| Plenty of room | under 35% | success (green) |
| Nearing dumb zone | 35–50% | warning (yellow) |
| Dumb zone | 50–85% | accent (orange) |
| Compact soon | 85% and up | error (red) |

The cut-offs are settings (`nearingAt`, `dumbZoneAt`, `compactSoonAt`, in percent) in `/config`, or under `pluginConfigs` in settings.

- `/am-context-bar` toggles the card; `on` and `off` set it; `expand` and `collapse` pick the view. Both choices are remembered across sessions.
- Text uses theme colours, so it follows light and dark themes. On the desktop the bars are vector drawings that switch palette with the app's colour scheme; in the terminal they are drawn with block characters.
- Session and weekly limits appear on a Claude subscription, once the first response of the session reports them.
- Thinking shows the effort the last main request was sent with (`default` until the first one).

## Developing

Each mod lives in `mods/<name>/` and is listed in [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json).

```sh
claude plugin validate .                     # the marketplace
claude plugin validate mods/am-context-bar   # one mod
claude plugin test mods/am-context-bar       # its tests
claude --plugin-dir mods/am-context-bar      # run a session with it loaded
```

To add a mod: create `mods/<name>/` with its `.claude-plugin/plugin.json`, `hooks/hooks.json` and hooks module, then add an entry to `plugins` in the marketplace file.

## License

[MIT](LICENSE)
