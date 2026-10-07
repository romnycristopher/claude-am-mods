import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { contextBarSvg, formatReset, layoutFrom, legendOf, modelLabel, parseLayout, formatTokens, shortLabel, terminalBar, thresholdsFrom, zoneOf } from '../hooks/register'

const category = (name: string, tokens: number, kind: 'used' | 'free' | 'buffer' | 'deferred' = 'used') => ({
  name,
  tokens,
  color: 'text',
  isDeferred: kind === 'deferred',
  kind,
})

const USAGE = {
  startedAt: 0,
  context: {
    tokens: 90_000,
    window: 1_000_000,
    percent: 9,
    breakdown: {
      categories: [
        category('System prompt', 4_200),
        category('System tools', 17_000),
        category('MCP tools', 52_000),
        category('Messages', 0),
        category('Deferred MCP tools', 9_000, 'deferred'),
        category('Free space', 897_000, 'free'),
      ],
      totalTokens: 90_000,
      maxTokens: 1_000_000,
      rawMaxTokens: 1_000_000,
      autocompactSource: 'auto' as const,
      percentage: 9,
      gridRows: [],
      model: 'Opus 5.5',
      memoryFiles: [],
      mcpTools: [],
      agents: [],
      autoCompactThreshold: 950_000,
      isAutoCompactEnabled: true,
      apiUsage: null,
    },
  },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 18, resetsAt: '2026-10-06T15:00:00Z' },
    { kind: 'seven_day', percentUsed: 27, resetsAt: '2026-10-08T10:00:00Z' },
  ],
}

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 19 },
    view: {},
  },
} as const

test('formats tokens and reset countdowns', async () => {
  expect(formatTokens(4_200)).toBe('4.2k')
  expect(formatTokens(897_000)).toBe('897k')
  expect(formatTokens(1_000_000)).toBe('1M')
  const at = Date.parse('2026-10-06T13:50:00Z')
  expect(formatReset('2026-10-06T15:00:00Z', at)).toBe('1h 10m')
  expect(formatReset('2026-10-08T10:10:00Z', at)).toBe('1d 20h 20m')
})

test('shortens model ids to family and version', async () => {
  expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelLabel('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
  expect(modelLabel('claude-3-5-haiku-20241022')).toBe('Haiku 3.5')
  expect(modelLabel('claude-opus-4-1')).toBe('Opus 4.1')
  expect(modelLabel('us.anthropic.claude-opus-4-1-20250805-v1:0')).toBe('Opus 4.1')
  expect(modelLabel('claude-sonnet-4-5@20250929')).toBe('Sonnet 4.5')
  expect(modelLabel('claude-opus-4-6[1m]')).toBe('Opus 4.6')
  expect(modelLabel('opus')).toBe('Opus')
  expect(modelLabel('Opus 5.5')).toBe('Opus 5.5')
  expect(modelLabel('gpt-something')).toBe('gpt-something')
})

test('zones follow the thresholds', async () => {
  expect(zoneOf(6).label).toBe('Plenty of room')
  expect(zoneOf(42).label).toBe('Nearing dumb zone')
  expect(zoneOf(50).label).toBe('Dumb zone')
  expect(zoneOf(64).color).toBe('claude')
  expect(zoneOf(91).label).toBe('Compact soon')
  const t = thresholdsFrom({ nearingAt: 20, dumbZoneAt: 40, compactSoonAt: 70 })
  expect(zoneOf(45, t).label).toBe('Dumb zone')
  // Out-of-order settings fall back to the defaults.
  expect(thresholdsFrom({ nearingAt: 60, dumbZoneAt: 40 }).dumb).toBe(50)
})

test('formats labels and bars', async () => {
  expect(formatTokens(63_400)).toBe('63.4k')
  expect(shortLabel('System tools')).toBe('Tools')
  expect(shortLabel('MCP tools')).toBe('MCP')
  expect(shortLabel('Memory files')).toBe('Memory')
  expect(shortLabel('MCP server instructions')).toBe('MCP instr.')
  const runs = terminalBar(20, [{ tokens: 100_000, color: '#2F9C8F' }], 1_000_000, 500_000, 950_000)
  expect(runs.map(r => r.text).join('')).toHaveLength(20)
  expect(runs[0]).toEqual({ text: '██', color: '#2F9C8F' })
  expect(runs.some(r => r.color === 'claude' && r.text === '│')).toBe(true)
  const svg = contextBarSvg([{ tokens: 100_000, color: '#2F9C8F' }], 1_000_000, 500_000, 950_000)
  expect(svg).toMatch(/prefers-color-scheme:dark/)
  expect(contextBarSvg([{ tokens: 640_000, color: 'zone:dumb' }], 1_000_000, 500_000)).toMatch(/<rect x="0.00" width="640.00" height="12" class="z-dumb"\/>/)
  expect(svg).toMatch(/class="d" x="500.00"/)
  expect(svg).toMatch(/viewBox="0 0 1000 12"/)
  // Padding adds clear space above and below without moving the bar.
  expect(contextBarSvg([{ tokens: 100_000, color: '#2F9C8F' }], 1_000_000, 500_000, 950_000, 0.75)).toMatch(/height="30" viewBox="0 -9 1000 30"/)
})

test('the collapsed legend groups, drops small parts and pins Messages last', async () => {
  const used = (name: string, tokens: number) => ({ name, tokens, kind: 'used' as const })
  const legend = legendOf([
    used('System prompt', 3_900),
    used('System tools', 27_700),
    used('MCP server instructions', 1_800),
    used('MCP tools', 807),
    used('Messages', 488),
    used('Memory files', 46),
    used('Skills', 8_400),
    { name: 'Free space', tokens: 900_000, kind: 'free' },
  ])
  expect(legend.shown.map(i => `${i.label} ${i.tokens}`)).toEqual(['Tools 27700', 'Skills 8400', 'System 3946', 'MCP 2607'])
  expect(legend.shown.find(i => i.label === 'MCP')?.color).toBe('#8467D7')
  expect(legend.hidden).toEqual([])
  expect(legend.messages).toEqual({ label: 'Messages', tokens: 488, color: '#8C877C' })

  // A small fixed part leaves the legend; Messages stays however small.
  const small = legendOf([used('System tools', 50_000), used('Skills', 900), used('Messages', 0)])
  expect(small.shown.map(i => i.label)).toEqual(['Tools'])
  expect(small.hidden.map(i => i.label)).toEqual(['Skills'])
  expect(small.messages?.tokens).toBe(0)
})

test('/am-context-bar shows the card, collapsed then expanded, on every surface', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-06T13:50:00Z') })
  mock.store(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.model', () => ({ value: 'Opus 5.5' }))
  on('process.run', ($, e) => ({
    value: {
      exitCode: 0,
      stdout: e.argv.includes('status') ? ' M hooks/register.tsx\n?? notes.md\n' : 'main\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })

  const run = (args: string) =>
    $.command.run({
      command: 'am-context-bar',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 100 },
    })

  for (const surface of ['terminal', 'desktop'] as const) {
    const hidden = await $.ui.mount({ plugin: 'am-context-bar', surface, ...BAND })
    expect(await hidden.find({ type: 'Text', text: '◔' })).toBeUndefined()
    expect(await hidden.find({ type: 'Text', text: 'engine' })).toBeDefined()
    await hidden.unmount()
  }

  expect((await run('on')).text).toMatch(/shown/)

  for (const surface of ['terminal', 'desktop'] as const) {
    await run('collapse')
    const ui = await $.ui.mount({ plugin: 'am-context-bar', surface, ...BAND })
    // Collapsed (C): zone-coloured count, zone pill, short legend, meta, toggle.
    expect(await ui.find({ type: 'Text', text: '◔' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'CONTEXT' })).toBeUndefined()
    expect((await ui.find({ type: 'Box' }))?.props?.backgroundColor).toBe(surface === 'terminal' ? undefined : 'inverseText')
    expect((await ui.findAll({ type: 'Text', text: '90k' })).some(t => t.props?.color === 'success')).toBe(true)
    expect(await ui.find({ type: 'Text', text: /Plenty of room/ })).toBeDefined()
    const pct = (await ui.findAll({ type: 'Text', text: '9%' })).find(t => t.props?.bold === true)
    expect(pct?.props?.color).toBe('suggestion')
    expect(await ui.find({ type: 'Text', text: 'MCP ' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Messages ' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '│' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'main' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /2 uncommitted changes/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '1h 10m' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /dumb zone/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /deferred/i })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: "WHAT'S USING IT" })).toBeUndefined()

    // The toggle expands it (A): breakdown table, limits, meta chips.
    await ui.press({ key: 'toggle' })
    expect(await ui.find({ type: 'Text', text: "WHAT'S USING IT" })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'MCP tools' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '52k' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '18.0%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' · resets 1h 10m' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Opus 5.5' })).toBeDefined()

    await ui.press({ key: 'toggle' })
    expect(await ui.find({ type: 'Text', text: "WHAT'S USING IT" })).toBeUndefined()
    await ui.unmount()
  }

  expect((await run('off')).text).toMatch(/hidden/)
})

const startCard = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1]) => {
  mock.clock(on, { now: Date.parse('2026-10-06T13:50:00Z') })
  mock.store(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('process.run', ($, e) => ({
    value: {
      exitCode: 0,
      stdout: e.argv.includes('status') ? '' : 'main\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await $.command.run({
    command: 'am-context-bar',
    args: 'on',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })
}

test('layout names', async () => {
  expect(parseLayout('v2')).toBe('two-rows')
  expect(parseLayout(' V3 ')).toBe('one-row')
  expect(parseLayout('three-rows')).toBe('three-rows')
  expect(parseLayout('big')).toBeUndefined()
  expect(layoutFrom({})).toBe('three-rows')
  expect(layoutFrom({ layout: 'one-row' })).toBe('one-row')
})

test('two-rows puts a short bar beside the count', { options: { layout: 'two-rows' } }, async ($, on) => {
  await startCard($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'am-context-bar', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: 'Opus 5.5' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'MCP ' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '✓ Nothing to commit' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '1h 10m' })).toBeDefined()
    if (surface === 'desktop') expect((await ui.find({ type: 'Svg' }))?.props?.width).toBe(260)
    // V2 splits its bar by category, with matching legend squares.
    if (surface === 'desktop') expect(String((await ui.find({ type: 'Svg' }))?.props?.source)).toMatch(/fill="#8467D7"/)
    expect((await ui.findAll({ type: 'Text', text: '■ ' })).length).toBeGreaterThan(0)
    await ui.unmount()
  }
})

test('one-row drops the legend and keeps a short git mark', { options: { layout: 'one-row' } }, async ($, on) => {
  await startCard($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'am-context-bar', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /Plenty of room/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'MCP ' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '1h 10m' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '✓' })).toBeDefined()
    if (surface === 'desktop') expect((await ui.find({ type: 'Svg' }))?.props?.width).toBe(220)
    // V3 keeps a single fill in the zone's colour.
    if (surface === 'desktop') expect(String((await ui.find({ type: 'Svg' }))?.props?.source)).toMatch(/class="z-clear"/)
    await ui.unmount()
  }
})
