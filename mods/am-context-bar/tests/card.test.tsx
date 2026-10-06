import { expect, mock, test } from 'claude-code/testing'

import { formatReset, formatTokens } from '../hooks/register'

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

test('/am-context-bar toggles the card on every surface', async ($, on) => {
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
  on('process.run', () => ({
    value: { exitCode: 0, stdout: 'main\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
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
    expect(await hidden.find({ type: 'Text', text: 'context' })).toBeUndefined()
    expect(await hidden.find({ type: 'Text', text: 'engine' })).toBeDefined()
    await hidden.unmount()
  }

  expect((await run('on')).text).toMatch(/shown/)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'am-context-bar', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: 'context' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'mcp tools ' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '52k' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /deferred/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'Opus 5.5' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '18.0%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' · resets 1h 10m' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'main' })).toBeDefined()
    await ui.unmount()
  }

  expect((await run('off')).text).toMatch(/hidden/)
})
