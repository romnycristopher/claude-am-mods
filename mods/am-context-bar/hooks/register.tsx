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
  '<style>.t{fill:#EFEDE6}.d{fill:#C86E14;fill-opacity:.16}.h{stroke:#C9C4B6}.k{fill:#B4540A}.m{fill:#1C1B19}' +
  '@media (prefers-color-scheme:dark){.t{fill:#34322D}.d{fill:#F59A52}.h{stroke:#5A574F}.k{fill:#F59A52}.m{fill:#EDEBE4}}</style>'

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

// ── Formatting ─────────────────────────────────────────────────────────────
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
    .replace(/^mcp instructions$/i, 'MCP instr.')

  return s.charAt(0).toUpperCase() + s.slice(1)
}

const longLabel = (name: string): string => name.replace(/^custom /i, '').replace(/^\w/, c => c.toUpperCase())

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

export const contextBarSvg = (parts: Part[], window: number, dumbFrom: number, compactsAt?: number): string => {
  const W = 1000
  const H = 12
  const x = (t: number) => Math.max(0, Math.min(W, (t / Math.max(1, window)) * W))
  let cx = 0
  const rects = parts
    .map(p => {
      const w = x(p.tokens)
      const rect = w > 0 ? `<rect x="${cx.toFixed(2)}" width="${w.toFixed(2)}" height="${H}" fill="${p.color}"/>` : ''
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
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">` +
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
    if (head.exitCode !== 0) return { branch: null, isDirty: false }
    const status = await $.process.run(['git', 'status', '--porcelain', '-uno'], { timeoutMs: 3000 })

    return { branch: head.stdout.trim() || null, isDirty: status.exitCode === 0 && status.stdout.trim() !== '' }
  } catch {
    return { branch: null, isDirty: false }
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
    const parts = used.map(({ segment, color }) => ({ tokens: segment.tokens, color }))
    const free = snap.segments.find(s => s.kind === 'free')?.tokens ?? Math.max(0, window - snap.usedTokens)
    const buffer = snap.segments.find(s => s.kind === 'buffer')?.tokens
    const usedTotal = used.reduce((sum, u) => sum + u.segment.tokens, 0) || snap.usedTokens
    const git = snap.branch === null ? 'no repo' : `${snap.branch}${snap.isDirty ? '*' : ''}`

    // The full-width bar: vector on remote surfaces, glyph cells on the terminal.
    let bar
    if (e.surface === 'terminal') {
      const cells = Math.max(10, (e.props.bodyColumns ?? 80) - 4)
      bar = (
        <Text>
          {terminalBar(cells, parts, window, dumbFrom, snap.compactsAt).map(run => (
            <Text color={run.color} dimColor={run.isDim}>
              {run.text}
            </Text>
          ))}
        </Text>
      )
    } else {
      const { Svg } = $.ui.resolve(e)
      bar = (
        <Svg
          source={contextBarSvg(parts, window, dumbFrom, snap.compactsAt)}
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

    const title = (
      <Box marginRight={2}>
        <Text color="subtle">◔ </Text>
        <Text bold dimColor>
          CONTEXT
        </Text>
      </Box>
    )

    const pill = (
      <Text color={zone.color}>
        ● {zone.label}
      </Text>
    )

    const metaStack = (
      <Box flexDirection="column" alignItems="flex-end" marginRight={1}>
        <Text>
          <Text>{snap.model}</Text>
          <Text dimColor> · thinking </Text>
          <Text>{level}</Text>
        </Text>
        <Text>
          <Text dimColor>compacted </Text>
          <Text>{String(compacted)}</Text>
          <Text dimColor> · git </Text>
          <Text>{git}</Text>
        </Text>
      </Box>
    )

    // ── C · collapsed ──
    if (!expanded) {
      return (
        <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
          <Box justifyContent="space-between" alignItems="center" flexWrap="wrap">
            <Box alignItems="center">
              {title}
              <Text bold color={zone.color}>
                {formatTokens(snap.usedTokens)}
              </Text>
              <Text dimColor>
                {' '}/ {formatTokens(window)} · {Math.round(percent)}%{'  '}
              </Text>
              {pill}
            </Box>
            <Box alignItems="center">
              {metaStack}
              {toggle}
            </Box>
          </Box>
          {bar}
          <Box justifyContent="space-between" flexWrap="wrap">
            <Box flexWrap="wrap">
              {used.map(({ segment, color }, index) => (
                <Box key={`legend-${index}`} marginRight={2}>
                  <Text color={color}>■ </Text>
                  <Text dimColor>{shortLabel(segment.name)} </Text>
                  <Text>{formatTokens(segment.tokens)}</Text>
                </Box>
              ))}
            </Box>
            <Text>
              <Text color="claude">dumb zone {formatTokens(dumbFrom)}</Text>
              {snap.compactsAt !== undefined && <Text dimColor> · compact {formatTokens(snap.compactsAt)}</Text>}
            </Text>
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
          {reset !== null && <Text dimColor> · resets {reset}</Text>}
        </Box>
      )
    }
    const meta = (key: string, label: string, value: string) => (
      <Box key={key} marginRight={3}>
        <Text dimColor>{label} </Text>
        <Text>{value}</Text>
      </Box>
    )
    const largest = used[0]?.segment.tokens ?? 1
    const hasLimits = snap.session !== undefined || snap.weekly !== undefined

    return (
      <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
        <Box justifyContent="space-between" alignItems="center">
          {title}
          <Box alignItems="center">
            <Box marginRight={2}>{pill}</Box>
            {toggle}
          </Box>
        </Box>

        <Box justifyContent="space-between" flexWrap="wrap" marginTop={1}>
          <Text>
            <Text bold color={zone.color}>
              {formatTokens(snap.usedTokens)}
            </Text>
            <Text dimColor>
              {' '}/ {formatTokens(window)} · {Math.round(percent)}% used
            </Text>
          </Text>
          {snap.compactsAt !== undefined && (
            <Text>
              <Text bold>{formatTokens(Math.max(0, snap.compactsAt - snap.usedTokens))}</Text>
              <Text dimColor> left before auto-compact</Text>
            </Text>
          )}
        </Box>

        <Box marginTop={1}>
          <Box width={`${thresholds.dumb}%`}>
            <Text dimColor>0</Text>
          </Box>
          <Box flexGrow={1} justifyContent="space-between">
            <Text color="claude">▏dumb zone from {formatTokens(dumbFrom)}</Text>
            {snap.compactsAt !== undefined && <Text dimColor>auto-compact at {formatTokens(snap.compactsAt)}▕</Text>}
          </Box>
        </Box>
        {bar}
        <Box flexWrap="wrap">
          <Box marginRight={2}>
            <Text>■ </Text>
            <Text dimColor>used </Text>
            <Text>{formatTokens(snap.usedTokens)}</Text>
          </Box>
          <Box marginRight={2}>
            <Text color="subtle">░ </Text>
            <Text dimColor>free </Text>
            <Text>{formatTokens(free)}</Text>
          </Box>
          {buffer !== undefined && (
            <Box marginRight={2}>
              <Text dimColor>╱ reserved buffer </Text>
              <Text>{formatTokens(buffer)}</Text>
            </Box>
          )}
          <Box>
            <Text color="claude" dimColor>
              ░{' '}
            </Text>
            <Text dimColor>dumb zone </Text>
            <Text>{thresholds.dumb}%+</Text>
          </Box>
        </Box>

        <Box marginTop={1}>
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
        {used.map(({ segment, color }, index) => (
          <Box key={`row-${index}`} alignItems="center">
            <Box width={22}>
              <Text color={color}>■ </Text>
              <Text>{longLabel(segment.name)}</Text>
            </Box>
            <Box flexGrow={1} marginX={1}>
              {miniBar(segment.tokens / largest, color)}
            </Box>
            <Box width={8} justifyContent="flex-end">
              <Text>{formatTokens(segment.tokens)}</Text>
            </Box>
            <Box width={7} justifyContent="flex-end">
              <Text dimColor>{share(segment.tokens, usedTotal)}</Text>
            </Box>
          </Box>
        ))}

        {hasLimits && (
          <Box flexWrap="wrap" marginTop={1}>
            {limit('session', 'session', snap.session)}
            {limit('weekly', 'weekly', snap.weekly)}
          </Box>
        )}
        <Box flexWrap="wrap" marginTop={1}>
          {meta('model', 'Model', snap.model)}
          {meta('thinking', 'Thinking', level)}
          {meta('compactions', 'Compacted', String(compacted))}
          {meta('git', 'Git', git)}
        </Box>
      </Box>
    )
  })
}
