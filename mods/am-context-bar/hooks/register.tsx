import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Limit, Segment, Snapshot } from '../types'

const COMMAND = 'am-context-bar'

const isVisible = atom({ plugin: 'am-context-bar', key: 'isVisible' } as const, false)
const snapshot = atom({ plugin: 'am-context-bar', key: 'snapshot' } as const, null)
const effort = atom({ plugin: 'am-context-bar', key: 'effort' } as const, null)
const compactions = atom({ plugin: 'am-context-bar', key: 'compactions' } as const, 0)
const now = atom({ plugin: 'am-context-bar', key: 'now' } as const, 0)

// The desktop context card's palette, keyed by the breakdown row's name.
const COLORS: [RegExp, string][] = [
  [/system prompt/i, '#6b8fd6'],
  [/mcp/i, '#9b7cf0'],
  [/tool/i, '#5fb8c2'],
  [/agent/i, '#7cc26b'],
  [/memory/i, '#e2bb55'],
  [/skill/i, '#ef8fb8'],
  [/message/i, '#e0704a'],
]
const FALLBACK = ['#c792ea', '#82aaff', '#f78c6c', '#89ddff', '#c3e88d']
const FREE = '#343a4b'
const BUFFER = '#4a4f5e'
const ACCENT = '#e0704a'
const BORDER = '#2d3240'

const colorOf = (segment: Segment, index: number): string => {
  if (segment.kind === 'free') return FREE
  if (segment.kind === 'buffer') return BUFFER
  const found = COLORS.find(([pattern]) => pattern.test(segment.name))

  return found ? found[1] : (FALLBACK[index % FALLBACK.length] ?? '#888888')
}

const labelOf = (segment: Segment): string => {
  if (segment.kind === 'free') return 'free'
  if (segment.kind === 'buffer') return 'buffer'

  return segment.name.toLowerCase().replace(/^custom /, '')
}

export const formatTokens = (n: number): string => {
  if (n < 1000) return String(Math.round(n))
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`

  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

const share = (tokens: number, of: number): string => {
  if (tokens <= 0 || of <= 0) return '0%'

  return `${Math.max(1, Math.round((tokens / of) * 100))}%`
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

const levelColor = (percent: number): string =>
  percent >= 80 ? '#ef5f5f' : percent >= 50 ? '#e2bb55' : '#7cc26b'

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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Toggle the context card above the prompt (on | off)',
    })
    const stored = await $.store.get('isVisible')
    if (typeof stored === 'boolean') await update($, isVisible, () => stored)

    // Keep reset countdowns current between turns.
    $.clock.every(60_000, () => {
      void $.clock.now().then(at => update($, now, () => at))
    })
    void refresh($)

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
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
    const level = await read($, effort)
    const compacted = await read($, compactions)
    const at = (await read($, now)) || snap.takenAt

    const { Box, Text } = $.ui.resolve(e)
    const total = snap.segments.reduce((sum, s) => sum + s.tokens, 0) || snap.windowTokens || 1
    const colored = snap.segments.map((segment, index) => ({ segment, color: colorOf(segment, index) }))

    let bar
    if (e.surface === 'terminal') {
      const cells = Math.max(10, (e.props.bodyColumns ?? 80) - 4)
      let used = 0
      bar = (
        <Text>
          {colored.map(({ segment, color }, index) => {
            const width =
              index === colored.length - 1
                ? Math.max(0, cells - used)
                : Math.round((segment.tokens / total) * cells)
            used += width

            return width > 0 ? <Text color={color}>{'█'.repeat(width)}</Text> : null
          })}
        </Text>
      )
    } else {
      const { Svg } = $.ui.resolve(e)
      let x = 0
      const rects = colored
        .map(({ segment, color }) => {
          const width = (segment.tokens / total) * 1000
          const rect = `<rect x="${x.toFixed(2)}" y="0" width="${width.toFixed(2)}" height="12" fill="${color}"/>`
          x += width

          return width > 0 ? rect : ''
        })
        .join('')
      const source =
        `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="12" viewBox="0 0 1000 12" preserveAspectRatio="none">` +
        `<clipPath id="r"><rect width="1000" height="12" rx="3"/></clipPath>` +
        `<g clip-path="url(#r)"><rect width="1000" height="12" fill="${FREE}"/>${rects}</g></svg>`
      bar = <Svg source={source} alt={`Context ${formatTokens(snap.usedTokens)} of ${formatTokens(snap.windowTokens)}`} />
    }

    const chip = (key: string, color: string, label: string, value: string, note?: string, isMuted = false) => (
      <Box key={key} marginRight={2}>
        <Text color={color}>■ </Text>
        <Text dimColor={isMuted}>{label} </Text>
        <Text bold={!isMuted} dimColor={isMuted}>{value}</Text>
        {note !== undefined && <Text dimColor> {note}</Text>}
      </Box>
    )

    const limit = (key: string, label: string, color: string, value: Limit | undefined) => {
      if (value === undefined) return null
      const reset = formatReset(value.resetsAt, at)

      return (
        <Box key={key} marginRight={2}>
          <Text color={color}>{label} </Text>
          <Text bold color={levelColor(value.percent)}>{value.percent.toFixed(1)}%</Text>
          {reset !== null && <Text dimColor> · resets {reset}</Text>}
        </Box>
      )
    }

    const header = (
      <Box justifyContent="space-between">
        <Box>
          <Text color={ACCENT}>◆ </Text>
          <Text bold>context</Text>
        </Box>
        <Box>
          <Text bold>{formatTokens(snap.usedTokens)}</Text>
          <Text dimColor> of {formatTokens(snap.windowTokens)}</Text>
          {snap.compactsAt !== undefined && <Text dimColor> · compacts at {formatTokens(snap.compactsAt)}</Text>}
        </Box>
      </Box>
    )

    return (
      <Box flexDirection="column" borderStyle="round" borderColor={BORDER} paddingX={1}>
        {header}
        {bar}
        <Box flexWrap="wrap">
          {colored.map(({ segment, color }, index) => {
            const isMuted = segment.kind === 'free' || segment.kind === 'buffer'

            return chip(
              `seg-${index}`,
              color,
              labelOf(segment),
              formatTokens(segment.tokens),
              isMuted ? undefined : share(segment.tokens, snap.windowTokens),
              isMuted,
            )
          })}
        </Box>
        <Box flexWrap="wrap">
          {limit('session', 'session', '#6b8fd6', snap.session)}
          {limit('weekly', 'weekly', '#9b7cf0', snap.weekly)}
          <Box key="model" marginRight={2}>
            <Text color="#e2bb55">model </Text>
            <Text bold>{snap.model}</Text>
          </Box>
          <Box key="thinking" marginRight={2}>
            <Text color="#ef5f5f">thinking </Text>
            <Text bold>{level ?? 'default'}</Text>
          </Box>
          <Box key="compactions" marginRight={2}>
            <Text color="#5fb8c2">↻ </Text>
            <Text bold>{compacted}</Text>
            <Text dimColor> compacted</Text>
          </Box>
          <Box key="git">
            <Text color="#7cc26b">⎇ </Text>
            <Text bold={snap.branch !== null} dimColor={snap.branch === null}>
              {snap.branch === null ? 'no git' : `${snap.branch}${snap.isDirty ? '*' : ''}`}
            </Text>
          </Box>
        </Box>
      </Box>
    )
  })
}
