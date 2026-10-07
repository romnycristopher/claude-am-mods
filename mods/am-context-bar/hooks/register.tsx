import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, PluginOptions, Register } from 'claude-code'

import type { Limit, Segment, Snapshot } from '../types'

const COMMAND = 'am-context-bar'

const isVisible = atom({ plugin: 'am-context-bar', key: 'isVisible' } as const, false)
const isExpanded = atom({ plugin: 'am-context-bar', key: 'isExpanded' } as const, false)
const snapshot = atom({ plugin: 'am-context-bar', key: 'snapshot' } as const, null)
const effort = atom({ plugin: 'am-context-bar', key: 'effort' } as const, null)
const compactions = atom({ plugin: 'am-context-bar', key: 'compactions' } as const, 0)
const now = atom({ plugin: 'am-context-bar', key: 'now' } as const, 0)

// ── Palette ────────────────────────────────────────────────────────────────
// Category colours are mid-tones that read on light and dark alike. Everything
// else uses theme keys, so the card follows the person's theme on its own.
const CATEGORY: [RegExp, string][] = [
  [/system prompt/i, '#4F7FD9'],
  [/mcp.*instruction/i, '#A895E8'],
  [/mcp/i, '#8467D7'],
  [/tool/i, '#2F9C8F'],
  [/skill/i, '#D4704D'],
  [/agent/i, '#4E9F5A'],
  [/memory/i, '#C99A2E'],
  [/message/i, '#8C877C'],
]
const FALLBACK = ['#5A9BD5', '#C46FA3', '#7FA650', '#B5838D', '#6C8EBF']

const colorOf = (segment: Segment, index: number): string => {
  const found = CATEGORY.find(([pattern]) => pattern.test(segment.name))

  return found ? found[1] : (FALLBACK[index % FALLBACK.length] ?? '#888888')
}

// The SVG bars can't read theme keys, so they carry both palettes and pick by
// the colour scheme the desktop draws in.
const SVG_STYLE =
  '<style>.t{fill:#EFEDE6}.d{fill:#C86E14;fill-opacity:.10}.h{stroke:#C9C4B6}.k{fill:#B4540A}.m{fill:#1C1B19}' +
  '.z-clear{fill:#3FA34D}.z-nearing{fill:#D4A72C}.z-dumb{fill:#E07020}.z-compact{fill:#D63A2C}' +
  '@media (prefers-color-scheme:dark){.t{fill:#34322D}.d{fill:#F59A52}.h{stroke:#5A574F}.k{fill:#F59A52}.m{fill:#EDEBE4}' +
  '.z-clear{fill:#5CC172}.z-nearing{fill:#E3B341}.z-dumb{fill:#F08A3C}.z-compact{fill:#F0584A}}</style>'

// The bar fills with the zone's colour, so it turns from green to red as the
// window fills. In the SVG a part's colour "zone:<id>" is the class z-<id>
// (light and dark); on the terminal the zone's theme key is used directly.
// The usage percentage: bold, in the theme's calm blue (a periwinkle in the
// default themes), the same in every zone so it is always easy to find.
const PERCENT: Color = 'suggestion'

export const zonePaint = (id: ZoneId): string => `zone:${id}`

// V1's rows sit apart on the desktop: clear space above and below its bar,
// in bar heights (0.75 of the 8px bar is 6px). The terminal can only space
// by whole rows, so it keeps them together.
const ROW_GAP = 0.75

// ── Zones ──────────────────────────────────────────────────────────────────
export type ZoneId = 'clear' | 'nearing' | 'dumb' | 'compact'
export type Zone = { id: ZoneId; label: string; color: Color }
export type Thresholds = { nearing: number; dumb: number; compact: number }

export const DEFAULT_THRESHOLDS: Thresholds = { nearing: 35, dumb: 50, compact: 85 }

const ZONES: Record<ZoneId, Zone> = {
  clear: { id: 'clear', label: 'Plenty of room', color: 'success' },
  nearing: { id: 'nearing', label: 'Nearing dumb zone', color: 'warning' },
  dumb: { id: 'dumb', label: 'Dumb zone', color: 'claude' },
  compact: { id: 'compact', label: 'Compact soon', color: 'error' },
}

export const zoneOf = (percent: number, t: Thresholds = DEFAULT_THRESHOLDS): Zone => {
  if (percent >= t.compact) return ZONES.compact
  if (percent >= t.dumb) return ZONES.dumb
  if (percent >= t.nearing) return ZONES.nearing

  return ZONES.clear
}

const numberOption = (value: unknown, fallback: number): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN

  return Number.isFinite(n) && n > 0 && n < 100 ? n : fallback
}

export const thresholdsFrom = (options: PluginOptions | undefined): Thresholds => {
  const t = {
    nearing: numberOption(options?.nearingAt, DEFAULT_THRESHOLDS.nearing),
    dumb: numberOption(options?.dumbZoneAt, DEFAULT_THRESHOLDS.dumb),
    compact: numberOption(options?.compactSoonAt, DEFAULT_THRESHOLDS.compact),
  }

  return t.nearing < t.dumb && t.dumb < t.compact ? t : DEFAULT_THRESHOLDS
}

// ── Layouts ────────────────────────────────────────────────────────────────
// The collapsed card comes in three shapes, picked in /config (Layout) or with
// /am-context-bar layout <name>: V1 three rows with a full-width bar, V2 two
// rows with a short bar beside the count, V3 one row.
export type Layout = 'three-rows' | 'two-rows' | 'one-row'
export const LAYOUTS: Layout[] = ['three-rows', 'two-rows', 'one-row']
const LAYOUT_NAMES: Record<string, Layout> = {
  'three-rows': 'three-rows',
  v1: 'three-rows',
  'two-rows': 'two-rows',
  v2: 'two-rows',
  'one-row': 'one-row',
  v3: 'one-row',
}
export const parseLayout = (value: unknown): Layout | undefined =>
  typeof value === 'string' ? LAYOUT_NAMES[value.trim().toLowerCase()] : undefined
export const layoutFrom = (options: PluginOptions | undefined): Layout => parseLayout(options?.layout) ?? 'three-rows'
const LAYOUT_LABEL: Record<Layout, string> = { 'three-rows': 'three rows', 'two-rows': 'two rows', 'one-row': 'one row' }

// The expanded card fits the band's rows rather than scroll: its two spacer
// lines go first, then the blank line above it, then the smallest categories
// fold into one "Other" row.
export type ExpandedFit = { margin: number; gap: number; rows: number }

export const fitExpanded = (maxRows: number, categories: number, hasLimits: boolean): ExpandedFit => {
  // Two borders, the count, the bar, its legend, the table's head, the meta
  // row, and the limits row when there are limits.
  const room = maxRows - (7 + (hasLimits ? 1 : 0))
  if (room >= categories + 3) return { margin: 1, gap: 1, rows: categories }
  if (room >= categories + 1) return { margin: 1, gap: 0, rows: categories }
  if (room >= categories) return { margin: 0, gap: 0, rows: categories }

  // Shown categories, then the Other row.
  return { margin: 0, gap: 0, rows: Math.min(categories, Math.max(1, room - 1)) }
}

// ── Formatting ─────────────────────────────────────────────────────────────
// "claude-opus-5-5", "claude-sonnet-4-5-20250929", "claude-3-5-haiku-20241022",
// "us.anthropic.claude-opus-4-1-20250805-v1:0", "claude-sonnet-4-5@20250929" and
// "opus[1m]" all read as the family and version: "Opus 5.5", "Haiku 3.5".
export const modelLabel = (raw: string): string => {
  const id = raw
    .trim()
    .toLowerCase()
    .replace(/\[[^\]]*\]$/, '')
    .replace(/^.*?claude-/, '')
    .replace(/@.*$/, '')
    .replace(/-v\d+(:\d+)?$/, '')
    .replace(/-(\d{8}|latest)$/, '')
  const family = id.match(/opus|sonnet|haiku/)?.[0]
  if (family === undefined) return raw
  const version = id
    .split(/[-_.\s]+/)
    .filter(part => /^\d{1,2}$/.test(part))
    .join('.')
  const name = family.charAt(0).toUpperCase() + family.slice(1)

  return version === '' ? name : `${name} ${version}`
}

export const formatTokens = (n: number): string => {
  if (n < 1000) return String(Math.round(n))
  if (n < 100_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`

  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

const percentOf = (tokens: number, of: number): number => (of > 0 ? (tokens / of) * 100 : 0)

const share = (tokens: number, of: number): string => {
  if (tokens <= 0 || of <= 0) return '0%'

  return `${Math.max(1, Math.round(percentOf(tokens, of)))}%`
}

export const shortLabel = (name: string): string => {
  const s = name
    .replace(/^custom /i, '')
    .replace(/^system /i, '')
    .replace(/ files$/i, '')
    .replace(/^mcp tools$/i, 'MCP')
    .replace(/^mcp (server )?instructions$/i, 'MCP instr.')

  return s.charAt(0).toUpperCase() + s.slice(1)
}

const longLabel = (name: string): string => name.replace(/^custom /i, '').replace(/^\w/, c => c.toUpperCase())

// ── Collapsed legend ───────────────────────────────────────────────────────
// The collapsed legend folds related categories together and leaves out the
// small fixed ones (they stay in the bar), so it fits on one line. Messages is
// the part that grows turn by turn, so it always shows, last, after a divider.
export type LegendItem = { label: string; tokens: number; color: string }

const GROUPS: [RegExp, string, string][] = [
  [/mcp/i, 'MCP', '#8467D7'],
  [/system prompt|memory/i, 'System', '#4F7FD9'],
]
const MIN_SHARE = 3

export const legendOf = (segments: Segment[]) => {
  const items: LegendItem[] = []
  segments
    .filter(s => s.kind === 'used' && s.tokens > 0)
    .forEach((segment, index) => {
      if (/message/i.test(segment.name)) return
      const group = GROUPS.find(([pattern]) => pattern.test(segment.name))
      const label = group ? group[1] : shortLabel(segment.name)
      const existing = items.find(item => item.label === label)
      if (existing) existing.tokens += segment.tokens
      else items.push({ label, tokens: segment.tokens, color: group ? group[2] : colorOf(segment, index) })
    })
  items.sort((a, b) => b.tokens - a.tokens)

  const found = segments.find(s => s.kind === 'used' && /message/i.test(s.name))
  const messages = found && { label: 'Messages', tokens: found.tokens, color: colorOf(found, 0) }
  const total = items.reduce((sum, item) => sum + item.tokens, 0) + (messages?.tokens ?? 0)
  const shown = items.filter((item, index) => index === 0 || percentOf(item.tokens, total) >= MIN_SHARE)
  const hidden = items.filter(item => !shown.includes(item))

  return { shown, hidden, messages }
}

export const formatReset = (resetsAt: string | undefined, at: number): string | null => {
  if (!resetsAt) return null
  const ms = Date.parse(resetsAt) - at
  if (!Number.isFinite(ms)) return null
  if (ms <= 0) return 'now'
  const minutes = Math.floor(ms / 60_000)
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`

  return `${m}m`
}

// ── Bars ───────────────────────────────────────────────────────────────────
type Part = { tokens: number; color: string }

// `pad` is clear space above and below the bar, in bar heights.
export const contextBarSvg = (parts: Part[], window: number, dumbFrom: number, compactsAt?: number, pad = 0): string => {
  const W = 1000
  const H = 12
  const P = H * pad
  const x = (t: number) => Math.max(0, Math.min(W, (t / Math.max(1, window)) * W))
  let cx = 0
  const rects = parts
    .map(p => {
      const w = x(p.tokens)
      const paint = p.color.startsWith('zone:') ? `class="z-${p.color.slice(5)}"` : `fill="${p.color}"`
      const rect = w > 0 ? `<rect x="${cx.toFixed(2)}" width="${w.toFixed(2)}" height="${H}" ${paint}/>` : ''
      cx += w

      return rect
    })
    .join('')
  const dz0 = x(dumbFrom)
  const dz1 = compactsAt === undefined ? W : x(compactsAt)
  const tint = dz1 > dz0 ? `<rect class="d" x="${dz0.toFixed(2)}" width="${(dz1 - dz0).toFixed(2)}" height="${H}"/>` : ''
  const buffer = compactsAt === undefined ? '' : `<rect x="${dz1.toFixed(2)}" width="${(W - dz1).toFixed(2)}" height="${H}" fill="url(#h)"/>`
  const ticks =
    `<rect class="k" x="${(dz0 - 1.5).toFixed(2)}" width="3" height="${H}"/>` +
    (compactsAt === undefined ? '' : `<rect class="m" x="${(dz1 - 1.5).toFixed(2)}" width="3" height="${H}"/>`)

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + 2 * P}" viewBox="0 ${-P} ${W} ${H + 2 * P}" preserveAspectRatio="none">` +
    SVG_STYLE +
    `<defs><clipPath id="r"><rect width="${W}" height="${H}" rx="6"/></clipPath>` +
    `<pattern id="h" width="6" height="${H}" patternUnits="userSpaceOnUse"><path d="M0 ${H} L6 0" class="h" stroke-width="1.5"/></pattern></defs>` +
    `<g clip-path="url(#r)"><rect class="t" width="${W}" height="${H}"/>${tint}${buffer}${rects}</g>${ticks}</svg>`
  )
}

const miniBarSvg = (fraction: number, color: string): string => {
  const w = Math.max(0, Math.min(1, fraction)) * 1000

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="6" viewBox="0 0 1000 6" preserveAspectRatio="none">` +
    SVG_STYLE +
    `<rect class="t" width="1000" height="6" rx="3"/>` +
    (w > 0 ? `<rect width="${w.toFixed(2)}" height="6" rx="3" fill="${color}"/>` : '') +
    `</svg>`
  )
}

export type Run = { text: string; color?: Color; isDim?: boolean }

// The terminal bar: one glyph per cell, merged into runs of the same style.
export const terminalBar = (
  cells: number,
  parts: Part[],
  window: number,
  dumbFrom: number,
  compactsAt?: number,
): Run[] => {
  const bounds: { end: number; color: string }[] = []
  let usedEnd = 0
  for (const p of parts) {
    usedEnd += p.tokens
    bounds.push({ end: usedEnd, color: p.color })
  }
  const cellOf = (t: number) => Math.min(cells - 1, Math.floor((t / Math.max(1, window)) * cells))
  const dumbCell = cellOf(dumbFrom)
  const compactCell = compactsAt === undefined ? -1 : cellOf(compactsAt)
  const runs: Run[] = []
  for (let i = 0; i < cells; i++) {
    const mid = ((i + 0.5) / cells) * window
    let cell: Run
    if (mid < usedEnd) cell = { text: '█', color: bounds.find(b => mid < b.end)?.color }
    else if (i === 0 && usedEnd > 0) cell = { text: '▌', color: bounds[0]?.color }
    else if (i === compactCell) cell = { text: '│', color: 'text' }
    else if (i === dumbCell) cell = { text: '│', color: 'claude' }
    else if (compactsAt !== undefined && mid >= compactsAt) cell = { text: '╱', isDim: true }
    else if (mid >= dumbFrom) cell = { text: '░', color: 'claude', isDim: true }
    else cell = { text: '░', color: 'subtle' }
    const last = runs[runs.length - 1]
    if (last && last.color === cell.color && last.isDim === cell.isDim) last.text += cell.text
    else runs.push(cell)
  }

  return runs
}

// ── Data ───────────────────────────────────────────────────────────────────
async function readGit($: EngineInterface) {
  try {
    const head = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 3000 })
    if (head.exitCode !== 0) return { branch: null, isDirty: false, changes: 0 }
    // Every file git would list for a commit: staged, unstaged and untracked.
    const status = await $.process.run(['git', 'status', '--porcelain'], { timeoutMs: 3000 })
    const changes = status.exitCode === 0 ? status.stdout.split('\n').filter(line => line.trim() !== '').length : 0

    return { branch: head.stdout.trim() || null, isDirty: changes > 0, changes }
  } catch {
    return { branch: null, isDirty: false, changes: 0 }
  }
}

let isRefreshing = false
let isPending = false

// One refresh at a time; a request that lands mid-refresh runs once after it.
async function refresh($: EngineInterface): Promise<void> {
  if (isRefreshing) {
    isPending = true
    return
  }
  if (!(await read($, isVisible))) return
  isRefreshing = true
  try {
    const [usage, model, git, at] = await Promise.all([
      $.session.usage({ breakdown: 'summary' }),
      $.session.model(),
      readGit($),
      $.clock.now(),
    ])
    const breakdown = usage.context.breakdown
    const segments: Segment[] = (breakdown?.categories ?? [])
      .filter(row => row.kind !== 'deferred')
      .map(row => ({ name: row.name, tokens: row.tokens, kind: row.kind }))
    const limitOf = (kind: string): Limit | undefined => {
      const found = usage.rateLimits.find(limit => limit.kind === kind)

      return found ? { percent: found.percentUsed, resetsAt: found.resetsAt } : undefined
    }
    const next: Snapshot = {
      segments,
      usedTokens: breakdown?.totalTokens ?? usage.context.tokens ?? 0,
      windowTokens: breakdown?.rawMaxTokens ?? usage.context.window,
      compactsAt: breakdown?.isAutoCompactEnabled ? breakdown.autoCompactThreshold : undefined,
      session: limitOf('five_hour'),
      weekly: limitOf('seven_day'),
      model,
      branch: git.branch,
      isDirty: git.isDirty,
      changes: git.changes,
      takenAt: at,
    }
    await update($, snapshot, () => next)
    await update($, now, () => at)
  } finally {
    isRefreshing = false
  }
  if (isPending) {
    isPending = false
    await refresh($)
  }
}

async function setExpanded($: EngineInterface, value: boolean): Promise<void> {
  await update($, isExpanded, () => value)
  await $.store.set('isExpanded', value)
}

// ── Hooks ──────────────────────────────────────────────────────────────────
export const register: Register = (on, options) => {
  const thresholds = thresholdsFrom(options)
  const layout = layoutFrom(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Context card above the prompt (on | off | expand | collapse)',
    })
    const storedVisible = await $.store.get('isVisible')
    if (typeof storedVisible === 'boolean') await update($, isVisible, () => storedVisible)
    const storedExpanded = await $.store.get('isExpanded')
    if (typeof storedExpanded === 'boolean') await update($, isExpanded, () => storedExpanded)

    // Keep reset countdowns current between turns.
    $.clock.every(60_000, () => {
      void $.clock.now().then(at => update($, now, () => at))
    })
    void refresh($)

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'layout' || arg.startsWith('layout ')) {
      const wanted = parseLayout(arg.slice('layout'.length))
      if (wanted === undefined) {
        return { text: `Layout is ${LAYOUT_LABEL[layout]}. Pick one: /am-context-bar layout v1 | v2 | v3 (three-rows, two-rows, one-row).` }
      }
      // Stored as the plugin's setting, the same one /config shows; the module
      // reloads with it.
      const result = await $.config.set({ key: 'am-context-bar.layout', value: wanted })
      if ('deny' in result && result.deny !== undefined) return { text: `Couldn't change the layout: ${result.deny}` }

      return { text: `Context card layout: ${LAYOUT_LABEL[wanted]}.` }
    }
    if (arg === 'expand' || arg === 'collapse') {
      await setExpanded($, arg === 'expand')
      await update($, isVisible, () => true)
      await $.store.set('isVisible', true)
      await refresh($)

      return { text: arg === 'expand' ? 'Context card expanded.' : 'Context card collapsed.' }
    }
    const current = await read($, isVisible)
    const target = arg === 'on' ? true : arg === 'off' ? false : !current
    await update($, isVisible, () => target)
    await $.store.set('isVisible', target)
    if (target) await refresh($)

    return { text: target ? 'Context card shown above the prompt.' : 'Context card hidden.' }
  })

  on('session.measure', async ($, e, next) => {
    void refresh($)

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const level = e.effort === undefined ? null : String(e.effort)
      if ((await read($, effort)) !== level) await update($, effort, () => level)
    }

    return yield* next(e)
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.trigger !== 'precompute' && e.agentId === undefined && result.messages !== undefined) {
      await update($, compactions, n => n + 1)
      void refresh($)
    }

    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isVisible))) return next(e)
    const snap = await read($, snapshot)
    if (snap === null) return next(e)
    const expanded = await read($, isExpanded)
    const level = (await read($, effort)) ?? 'default'
    const compacted = await read($, compactions)
    const at = (await read($, now)) || snap.takenAt

    const { Box, Text, Button } = $.ui.resolve(e)
    const window = snap.windowTokens || 1
    const percent = percentOf(snap.usedTokens, window)
    const zone = zoneOf(percent, thresholds)
    const dumbFrom = (window * thresholds.dumb) / 100
    const used = snap.segments
      .filter(s => s.kind === 'used' && s.tokens > 0)
      .map((segment, index) => ({ segment, color: colorOf(segment, index) }))
      .sort((a, b) => b.segment.tokens - a.segment.tokens)
    const free = snap.segments.find(s => s.kind === 'free')?.tokens ?? Math.max(0, window - snap.usedTokens)
    const buffer = snap.segments.find(s => s.kind === 'buffer')?.tokens
    const usedTotal = used.reduce((sum, u) => sum + u.segment.tokens, 0) || snap.usedTokens
    // V1 and V2 split the bar by the legend's groups, in its colours; V3 has
    // room only for one fill, in the zone's colour. Expanded splits it by
    // category, like its table.
    const legendParts = legendOf(snap.segments)
    const composed = [...legendParts.shown, ...legendParts.hidden, ...(legendParts.messages ? [legendParts.messages] : [])]
      .filter(item => item.tokens > 0)
      .map(({ tokens, color }) => ({ tokens, color }))
    const detailed = used.map(({ segment, color }) => ({ tokens: segment.tokens, color }))
    // A white card in a light theme, the theme's darkest in a dark one: the
    // theme's inverse-text colour is its page background. The terminal keeps
    // its own background.
    const card = e.surface === 'terminal' ? {} : { backgroundColor: 'inverseText' as const }
    const changes = snap.changes ?? (snap.isDirty ? 1 : 0)
    const gitStatus =
      snap.branch === null ? (
        <Text dimColor>No git repo</Text>
      ) : (
        <Text>
          <Text dimColor>⎇ </Text>
          <Text>{snap.branch === 'HEAD' ? 'detached' : snap.branch}</Text>
          <Text dimColor> · </Text>
          {changes === 0 ? (
            <Text color="success">✓ Nothing to commit</Text>
          ) : (
            <Text color="warning">
              ● {changes} uncommitted {changes === 1 ? 'change' : 'changes'}
            </Text>
          )}
        </Text>
      )

    // The full-width bar: vector on remote surfaces, glyph cells on the terminal.
    const fullBar = (parts: { tokens: number; color: string }[], pad = 0) => {
      if (e.surface === 'terminal') {
        const cells = Math.max(10, (e.props.bodyColumns ?? 80) - 4)

        return (
          <Text>
            {terminalBar(cells, parts, window, dumbFrom, snap.compactsAt).map(run => (
              <Text color={run.color} dimColor={run.isDim}>
                {run.text}
              </Text>
            ))}
          </Text>
        )
      }
      const { Svg } = $.ui.resolve(e)

      return (
        <Svg
          height={8 * (1 + 2 * pad)}
          source={contextBarSvg(parts, window, dumbFrom, snap.compactsAt, pad)}
          alt={`Context ${formatTokens(snap.usedTokens)} of ${formatTokens(window)}, ${zone.label}`}
        />
      )
    }

    const miniBar = (fraction: number, color: string) => {
      if (e.surface === 'terminal') {
        const cells = 16
        const filled = Math.max(fraction > 0 ? 1 : 0, Math.round(fraction * cells))

        return (
          <Text>
            <Text color={color}>{'━'.repeat(filled)}</Text>
            <Text color="subtle">{'─'.repeat(cells - filled)}</Text>
          </Text>
        )
      }
      const { Svg } = $.ui.resolve(e)

      return <Svg source={miniBarSvg(fraction, color)} alt={`${Math.round(fraction * 100)}% of the largest`} />
    }

    const toggle = (
      <Button
        key="toggle"
        plain
        dimColor
        label={expanded ? '▴' : '▾'}
        onPress={() => void setExpanded($, !expanded)}
      />
    )

    // The card is labelled by its glyph alone.
    const icon = (
      <Box marginRight={1}>
        <Text color="subtle">◔</Text>
      </Box>
    )

    const pill = (
      <Text color={zone.color}>
        ● {zone.label}
      </Text>
    )

    // When the session limit resets, beside the thinking level.
    const resetIn = formatReset(snap.session?.resetsAt, at)
    const sessionReset =
      resetIn === null ? null : (
        <Text>
          <Text dimColor> · Resets </Text>
          <Text>{resetIn}</Text>
        </Text>
      )

    const metaStack = (
      <Box marginRight={1}>
        <Text>
          <Text>{modelLabel(snap.model)}</Text>
          <Text dimColor> · Thinking </Text>
          <Text>{level}</Text>
          {sessionReset}
          <Text dimColor> · ↻ </Text>
          <Text>{String(compacted)}</Text>
        </Text>
      </Box>
    )

    // A short bar that sits in a row (V2, V3): fixed width on the desktop, a
    // fixed number of cells on the terminal.
    const inlineBar = (px: number, cells: number, isComposed: boolean) => {
      const zoneFill = (paint: string) => [{ tokens: usedTotal, color: paint }]
      if (e.surface === 'terminal') {
        return (
          <Text>
            {terminalBar(cells, isComposed ? composed : zoneFill(zone.color), window, dumbFrom, snap.compactsAt).map(run => (
              <Text color={run.color} dimColor={run.isDim}>
                {run.text}
              </Text>
            ))}
          </Text>
        )
      }
      const { Svg } = $.ui.resolve(e)

      return (
        <Svg
          width={px}
          height={8}
          source={contextBarSvg(isComposed ? composed : zoneFill(zonePaint(zone.id)), window, dumbFrom, snap.compactsAt)}
          alt={`Context ${formatTokens(snap.usedTokens)} of ${formatTokens(window)}, ${zone.label}`}
        />
      )
    }

    const count = (
      <Text>
        <Text bold color={zone.color}>
          {formatTokens(snap.usedTokens)}
        </Text>
        <Text dimColor> / {formatTokens(window)} · </Text>
        <Text bold color={PERCENT}>
          {Math.round(percent)}%
        </Text>
      </Text>
    )

    const legendItem = (item: LegendItem, key: string) => (
      <Box key={key} marginRight={2}>
        <Text color={item.color}>■ </Text>
        <Text dimColor>{item.label} </Text>
        <Text>{formatTokens(item.tokens)}</Text>
      </Box>
    )
    const legend = (
      <Box flexWrap="wrap">
        {legendParts.shown.map((item, index) => legendItem(item, `legend-${index}`))}
        {legendParts.messages !== undefined && (
          <Box key="legend-messages">
            {legendParts.shown.length > 0 && (
              <Box marginRight={2}>
                <Text color="subtle">│</Text>
              </Box>
            )}
            {legendItem(legendParts.messages, 'messages')}
          </Box>
        )}
      </Box>
    )

    // V3's git note: the branch and a mark, no words.
    const gitShort =
      snap.branch === null ? null : (
        <Text>
          <Text dimColor> · ⎇ </Text>
          <Text>{snap.branch === 'HEAD' ? 'detached' : snap.branch} </Text>
          {changes === 0 ? <Text color="success">✓</Text> : <Text color="warning">● {changes}</Text>}
        </Text>
      )

    // ── C · collapsed ──
    if (!expanded) {
      if (layout === 'one-row') {
        return (
          <Box justifyContent="space-between" alignItems="center" flexWrap="wrap" borderStyle="round" borderColor="subtle" marginTop={1} paddingX={1} {...card}>
            <Box alignItems="center">
              {icon}
              {count}
              <Box marginX={2}>{inlineBar(220, 20, false)}</Box>
              {pill}
            </Box>
            <Box alignItems="center">
              <Box marginRight={1}>
                <Text>
                  <Text>{modelLabel(snap.model)}</Text>
                  <Text dimColor> · Thinking </Text>
                  <Text>{level}</Text>
                  {sessionReset}
                  <Text dimColor> · ↻ </Text>
                  <Text>{String(compacted)}</Text>
                  {gitShort}
                </Text>
              </Box>
              {toggle}
            </Box>
          </Box>
        )
      }

      if (layout === 'two-rows') {
        return (
          <Box flexDirection="column" borderStyle="round" borderColor="subtle" marginTop={1} paddingX={1} {...card}>
            <Box justifyContent="space-between" alignItems="center" flexWrap="wrap">
              <Box alignItems="center">
                {icon}
                {count}
                <Box marginX={2}>{inlineBar(260, 24, true)}</Box>
                {pill}
              </Box>
              <Box alignItems="center">
                {metaStack}
                {toggle}
              </Box>
            </Box>
            <Box justifyContent="space-between" flexWrap="wrap">
              {legend}
              {gitStatus}
            </Box>
          </Box>
        )
      }

      return (
        <Box flexDirection="column" borderStyle="round" borderColor="subtle" marginTop={1} paddingX={1} {...card}>
          <Box justifyContent="space-between" alignItems="center" flexWrap="wrap">
            <Box alignItems="center">
              {icon}
              {count}
              <Text>{'  '}</Text>
              {pill}
            </Box>
            <Box alignItems="center">
              {metaStack}
              {toggle}
            </Box>
          </Box>
          {fullBar(composed, ROW_GAP)}
          <Box justifyContent="space-between" flexWrap="wrap">
            {legend}
            {gitStatus}
          </Box>
        </Box>
      )
    }

    // ── A · expanded ──
    const limit = (key: string, label: string, value: Limit | undefined) => {
      if (value === undefined) return null
      const reset = formatReset(value.resetsAt, at)

      return (
        <Box key={key} marginRight={3}>
          <Text dimColor>{label} </Text>
          <Text bold color={zoneOf(value.percent, { nearing: 50, dumb: 80, compact: 95 }).color}>
            {value.percent.toFixed(1)}%
          </Text>
          {reset !== null && <Text dimColor> · Resets {reset}</Text>}
        </Box>
      )
    }
    const meta = (key: string, label: string, value: string) => (
      <Box key={key} marginRight={3}>
        <Text dimColor>{label} </Text>
        <Text>{value}</Text>
      </Box>
    )
    const dumbLow = Math.max(0, thresholds.dumb - 10)
    const largest = used[0]?.segment.tokens ?? 1
    const hasLimits = snap.session !== undefined || snap.weekly !== undefined
    const fit = fitExpanded(e.props.maxRows > 0 ? e.props.maxRows : Infinity, used.length, hasLimits)
    const rows = used.slice(0, fit.rows)
    const folded = used.slice(fit.rows)
    const other = folded.reduce((sum, u) => sum + u.segment.tokens, 0)
    const tableRow = (key: string, label: string, color: string, tokens: number) => (
      <Box key={key} alignItems="center">
        <Box width={22}>
          <Text color={color}>■ </Text>
          <Text>{label}</Text>
        </Box>
        <Box flexGrow={1} marginX={1}>
          {miniBar(tokens / largest, color)}
        </Box>
        <Box width={8} justifyContent="flex-end">
          <Text>{formatTokens(tokens)}</Text>
        </Box>
        <Box width={7} justifyContent="flex-end">
          <Text dimColor>{share(tokens, usedTotal)}</Text>
        </Box>
      </Box>
    )

    return (
      <Box flexDirection="column" borderStyle="round" borderColor="subtle" marginTop={fit.margin} paddingX={1} {...card}>
        <Box justifyContent="space-between" alignItems="center">
          <Box alignItems="center">
            {icon}
            {count}
            <Box marginLeft={2}>{pill}</Box>
          </Box>
          <Box alignItems="center">
            {snap.compactsAt !== undefined && (
              <Box marginRight={1}>
                <Text>
                  <Text bold>{formatTokens(Math.max(0, snap.compactsAt - snap.usedTokens))}</Text>
                  <Text dimColor> until auto-compact</Text>
                </Text>
              </Box>
            )}
            {toggle}
          </Box>
        </Box>
        {fullBar(detailed)}
        <Box flexWrap="wrap">
          <Box marginRight={2}>
            <Text>■ </Text>
            <Text dimColor>Used </Text>
            <Text>{formatTokens(snap.usedTokens)}</Text>
          </Box>
          <Box marginRight={2}>
            <Text color="subtle">░ </Text>
            <Text dimColor>Free </Text>
            <Text>{formatTokens(free)}</Text>
          </Box>
          <Box marginRight={2}>
            <Text color="claude" dimColor>
              ░{' '}
            </Text>
            <Text dimColor>Dumb zone starts around </Text>
            <Text>
              {dumbLow}–{thresholds.dumb}%
            </Text>
            <Text dimColor>
              {' '}
              ({formatTokens((window * dumbLow) / 100)}–{formatTokens(dumbFrom)})
            </Text>
          </Box>
          {buffer !== undefined && (
            <Box>
              <Text dimColor>╱ Buffer </Text>
              <Text>{formatTokens(buffer)}</Text>
            </Box>
          )}
        </Box>

        <Box marginTop={fit.gap}>
          <Box width={22}>
            <Text bold dimColor>
              WHAT'S USING IT
            </Text>
          </Box>
          <Box flexGrow={1} />
          <Box width={8} justifyContent="flex-end">
            <Text bold dimColor>
              TOKENS
            </Text>
          </Box>
          <Box width={7} justifyContent="flex-end">
            <Text bold dimColor>
              SHARE
            </Text>
          </Box>
        </Box>
        {rows.map(({ segment, color }, index) => tableRow(`row-${index}`, longLabel(segment.name), color, segment.tokens))}
        {folded.length > 0 && tableRow('row-other', `Other (${folded.length})`, 'subtle', other)}

        {hasLimits && (
          <Box flexWrap="wrap" marginTop={fit.gap}>
            {limit('session', 'Session', snap.session)}
            {limit('weekly', 'Weekly', snap.weekly)}
          </Box>
        )}
        <Box justifyContent="space-between" flexWrap="wrap" marginTop={hasLimits ? 0 : fit.gap}>
          <Box flexWrap="wrap">
            {meta('model', 'Model', modelLabel(snap.model))}
            {meta('thinking', 'Thinking', level)}
            {meta('compactions', 'Compacted', String(compacted))}
          </Box>
          {gitStatus}
        </Box>
      </Box>
    )
  })
}
