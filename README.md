# claude-am-mods

Mods for [Claude Code](https://claude.com/claude-code): live UI for the terminal and the desktop app's Code tab, written as plugins of function hooks.

## Mods

| Mod | What it does | Command |
| --- | --- | --- |
| [`am-context-car`](mods/am-context-car) | A context card above the prompt: segmented context bar by category, session (5h) and weekly limits with reset countdowns, model, thinking level, compactions, git branch | `/am-context-car` |

## Install

At the Claude Code prompt:

```
/plugin install am-context-car --marketplace romnycristopher/claude-am-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope makes it active in every session).

## am-context-car

```
◆ context                                        90k of 1M · compacts at 950k
[████ segmented colour bar ███████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]
■ system prompt 4.2k 1%  ■ tools 17k 2%  ■ mcp tools 52k 5%  ■ agents 3.4k 1%
■ memory files 8.6k 1%   ■ skills 5.1k 1%  ■ messages 0 0%   ■ free 897k
session 18.0% · resets 1h 10m   weekly 27.0% · resets 1d 20h 20m
model Opus 5.5   thinking high   ↻ 0 compacted   ⎇ main*
```

- `/am-context-car` toggles the card; `/am-context-car on` and `/am-context-car off` set it. The choice is remembered across sessions.
- On the desktop the bar is drawn as a vector bar; in the terminal, as coloured blocks.
- Session and weekly limits appear on a Claude subscription, once the first response of the session reports them.
- Thinking shows the effort the last main request was sent with (`default` until the first one).

## Developing

Each mod lives in `mods/<name>/` and is listed in [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json).

```sh
claude plugin validate .                     # the marketplace
claude plugin validate mods/am-context-car   # one mod
claude plugin test mods/am-context-car       # its tests
claude --plugin-dir mods/am-context-car      # run a session with it loaded
```

To add a mod: create `mods/<name>/` with its `.claude-plugin/plugin.json`, `hooks/hooks.json` and hooks module, then add an entry to `plugins` in the marketplace file.

## License

[MIT](LICENSE)
