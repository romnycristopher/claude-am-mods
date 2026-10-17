import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { EMPTY_PLAN, phaseTagOf, phasesOfPlan, planFromMessages, planProgress, withPlan, withTaskCreated, withTaskUpdated, withTodos } from '../hooks/plan'
import { fitExpanded, isOptionOn } from '../hooks/register'
import type { Plan } from '../types'

const PLAN = [
  '# Plan: from the plugin to the API and the app',
  '',
  '## Context',
  'Why this.',
  '',
  '## Fase 1 — Fix the plugin before the cutover',
  '### 1.1 Version integrity',
  '### 1.2 Bad data',
  '',
  '## Fase 2 — Rules in PHP',
  '```md',
  '## Fase 9 — inside a fence, not a phase',
  '```',
  '## Fase 3: API, notifications and app',
  '## Verification',
].join('\n')

test('reads the phases of a plan, in any language and shape', async () => {
  expect(phasesOfPlan(PLAN)).toEqual({
    title: 'from the plugin to the API and the app',
    phases: [
      { id: '1', title: 'Fix the plugin before the cutover' },
      { id: '2', title: 'Rules in PHP' },
      { id: '3', title: 'API, notifications and app' },
    ],
  })
  expect(phasesOfPlan('# X\n## Phase 0: infra\n## Phase 1: budgets').phases.map(p => p.id)).toEqual(['0', '1'])
  expect(phasesOfPlan('## **Stage A** Pilot\n## **Stage B** Rollout').phases).toEqual([
    { id: 'A', title: 'Pilot' },
    { id: 'B', title: 'Rollout' },
  ])
  expect(phasesOfPlan('## Étape 1. Préparer\n## Étape 2. Livrer').phases.map(p => p.title)).toEqual(['Préparer', 'Livrer'])
  // Numbered headings when no phase is named, at the shallowest level with two.
  expect(phasesOfPlan('## Design\n### 1. Dictionary\n### 1.1 Words\n### 2. Class\n## Files').phases).toEqual([
    { id: '1', title: 'Dictionary' },
    { id: '2', title: 'Class' },
  ])
  // One phase, or none, is no plan to follow.
  expect(phasesOfPlan('# Plan\n## Phase 1 — All of it\n## Verification').phases).toEqual([])
  expect(phasesOfPlan('# Plan\n## Context\n## Step by step').phases).toEqual([])
})

test('reads the phase tag a task opens with', async () => {
  expect(phaseTagOf('P2: Add the migration')).toBe('2')
  expect(phaseTagOf('P2.3: Wire the client')).toBe('2')
  expect(phaseTagOf('F1 — Fix versions')).toBe('1')
  expect(phaseTagOf('Fase 02: Reglas')).toBe('2')
  expect(phaseTagOf('[P1] Ship it')).toBe('1')
  expect(phaseTagOf('§3: real query error')).toBe('3')
  expect(phaseTagOf('Phase B: verify', ['A', 'B'])).toBe('B')
  expect(phaseTagOf('PB: verify', ['A', 'B'])).toBe('B')
  // A letter the plan doesn't have is a word, not a phase.
  expect(phaseTagOf('PR: open it', ['1', '2'])).toBeUndefined()
  expect(phaseTagOf('Fix: the build')).toBeUndefined()
  expect(phaseTagOf('Phase A migration 1: money columns')).toBeUndefined()
  expect(phaseTagOf('P1 without a colon')).toBeUndefined()
})

const planWith = (tasks: [string, Plan['tasks'][number]['status']][]): Plan =>
  tasks.reduce<Plan>(
    (plan, [subject, status], index) => withTaskUpdated(withTaskCreated(plan, String(index + 1), subject), String(index + 1), { status }),
    withPlan(EMPTY_PLAN, PLAN),
  )

test('progress: the phase at hand, what is open, and phases left behind', async () => {
  const p = planProgress(
    planWith([
      ['P1: Versions', 'completed'],
      ['P1: Bad data', 'pending'],
      ['P2: Rules class', 'in_progress'],
      ['P2: Parity test', 'pending'],
      ['Update the README', 'completed'],
    ]),
  )
  expect(p?.current).toBe(1)
  expect(p?.phases.map(ph => `${ph.id} ${ph.state} ${ph.done}/${ph.done + ph.open}`)).toEqual(['1 active 1/2', '2 active 0/2', '3 empty 0/0'])
  expect(p?.behind.map(b => `${b.id}:${b.open}`)).toEqual(['1:1'])
  expect(p?.open).toBe(3)
  expect(p?.untagged).toEqual({ done: 1, open: 0 })
  expect(p?.isDone).toBe(false)

  // A finished phase moves the card on to the next one.
  expect(planProgress(planWith([['P1: Versions', 'completed']]))?.current).toBe(1)
  // Nothing started yet: the first phase.
  expect(planProgress(planWith([['P1: Versions', 'pending']]))?.current).toBe(0)

  // Every phase done.
  const done = planProgress(planWith([['P1: a', 'completed'], ['P2: b', 'completed'], ['P3: c', 'completed']]))
  expect(done?.isDone).toBe(true)
  expect(done?.behind).toEqual([])

  // No tags: only the totals.
  const untagged = planProgress(planWith([['Versions', 'completed'], ['Rules', 'pending']]))
  expect(untagged?.isTagged).toBe(false)
  expect(untagged?.untagged).toEqual({ done: 1, open: 1 })

  // No plan and no tags: nothing to show; tags alone are enough.
  expect(planProgress(withTaskCreated(EMPTY_PLAN, '1', 'Fix it'))).toBeNull()
  expect(planProgress(withTaskCreated(EMPTY_PLAN, '1', 'P1: Fix it'))?.phases.map(p => p.id)).toEqual(['1'])
})

test('the list follows TaskCreate, TaskUpdate and TodoWrite', async () => {
  let plan = withTaskCreated(EMPTY_PLAN, '1', 'P1: a')
  plan = withTaskCreated(plan, '2', 'b', 'P2')
  expect(plan.tasks[1]?.phase).toBe('2')
  plan = withTaskUpdated(plan, '1', { status: 'completed', subject: 'P1: a, renamed' })
  expect(plan.tasks[0]).toEqual({ id: '1', subject: 'P1: a, renamed', status: 'completed' })
  expect(withTaskUpdated(plan, '2', { status: 'deleted' }).tasks.map(t => t.id)).toEqual(['1'])
  // TodoWrite replaces its own items and leaves the tasks alone.
  plan = withTodos(plan, [{ content: 'P1: c', status: 'in_progress' }])
  plan = withTodos(plan, [{ content: 'P1: c', status: 'completed' }, { content: 'P2: d', status: 'pending' }])
  expect(plan.tasks.map(t => `${t.id} ${t.status}`)).toEqual(['1 completed', '2 pending', 'todo:0 completed', 'todo:1 pending'])
  // A new plan keeps only the open tasks.
  expect(withPlan(plan, PLAN).tasks.map(t => t.id)).toEqual(['2', 'todo:1'])
})

test('a transcript gives back the plan and the list', async () => {
  const plan = planFromMessages([
    { toolUses: [{ tool: 'ExitPlanMode', input: {}, result: { plan: PLAN, isAgent: false } }] },
    { toolUses: [{ tool: 'TaskCreate', input: { subject: 'P1: a' }, result: { task: { id: '1', subject: 'P1: a' } } }] },
    { toolUses: [{ tool: 'TaskCreate', input: { subject: 'P2: b' }, result: { task: { id: '2', subject: 'P2: b' } } }] },
    { toolUses: [{ tool: 'TaskUpdate', input: { taskId: '1', status: 'completed' }, result: { success: true } }] },
    { toolUses: [{ tool: 'TaskUpdate', input: { taskId: '2', status: 'completed' }, isError: true }] },
  ])
  expect(plan.phases).toHaveLength(3)
  expect(plan.tasks.map(t => `${t.id} ${t.status}`)).toEqual(['1 completed', '2 pending'])
})

test('the expanded card shrinks the plan to one line before folding categories', async () => {
  // Plan of 4 rows: 8 fixed rows, 3 categories.
  expect(fitExpanded(Infinity, 3, true, 4)).toEqual({ margin: 1, gap: 1, rows: 3, planRows: 4 })
  expect(fitExpanded(19, 3, true, 4)).toEqual({ margin: 1, gap: 1, rows: 3, planRows: 4 })
  expect(fitExpanded(15, 3, true, 4)).toEqual({ margin: 0, gap: 0, rows: 3, planRows: 4 })
  expect(fitExpanded(14, 3, true, 4)).toEqual({ margin: 1, gap: 0, rows: 3, planRows: 1 })
  expect(fitExpanded(11, 3, true, 4)).toEqual({ margin: 0, gap: 0, rows: 1, planRows: 1 })
  expect(isOptionOn(undefined)).toBe(true)
  expect(isOptionOn('false')).toBe(false)
})

// ── The card, driven by tool calls ─────────────────────────────────────────
const USAGE = {
  startedAt: 0,
  context: {
    tokens: 90_000,
    window: 1_000_000,
    percent: 9,
    breakdown: {
      categories: [
        { name: 'System prompt', tokens: 4_200, color: 'text', isDeferred: false, kind: 'used' as const },
        { name: 'Messages', tokens: 0, color: 'text', isDeferred: false, kind: 'used' as const },
        { name: 'Free space', tokens: 897_000, color: 'text', isDeferred: false, kind: 'free' as const },
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
  rateLimits: [],
}

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 40, bodyColumns: 100, scroll: { offset: 0, bodyRows: 39 }, view: {} },
} as const

const startCard = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1]) => {
  mock.clock(on, { now: Date.parse('2026-10-06T13:50:00Z') })
  mock.store(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.messages', () => ({ value: [] }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'main\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  let nextId = 0
  on('tool.call', ($, e) => {
    if (e.tool === 'ExitPlanMode') return { result: { plan: PLAN, isAgent: false, filePath: '/plans/p.md' } }
    if (e.tool === 'TaskCreate') return { result: { task: { id: String(++nextId), subject: e.subject } } }
    if (e.tool === 'TaskUpdate') return { result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }

    return { deny: 'not in this test' }
  })
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'am-context-bar', args: 'on', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
}

const work = async ($: Parameters<TestBody>[0]) => {
  for (const subject of ['P1: Versions', 'P1: Bad data', 'P2: Rules class', 'P2: Parity test']) {
    await $.tool.call({ tool: 'TaskCreate', subject, description: subject })
  }
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '3', status: 'in_progress' })
}

test('an approved plan and its tasks show on the card, collapsed and expanded', async ($, on) => {
  await startCard($, on)
  const approved = await $.tool.call({ tool: 'ExitPlanMode' })
  // Claude is told the tags this plan's phases take.
  expect(approved.context?.join('\n')).toMatch(/3 phases: P1 Fix the plugin before the cutover; P2 Rules in PHP; P3 API/)
  await work($)

  for (const surface of ['terminal', 'desktop'] as const) {
    await $.command.run({ command: 'am-context-bar', args: 'collapse', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
    const ui = await $.ui.mount({ plugin: 'am-context-bar', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: 'Phase 2/3' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' Rules in PHP' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '3 open' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '⚠ P1: 1 left' })).toBeDefined()

    await ui.press({ key: 'toggle' })
    expect(await ui.find({ type: 'Text', text: 'PLAN' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' · from the plugin to the API and the app' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Fix the plugin before the cutover' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: '⚠' }))?.props?.color).toBe('warning')
    expect(await ui.find({ type: 'Text', text: '1/2' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '0/2' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '—' })).toBeDefined()
    await ui.unmount()
  }

  // A short terminal band keeps the plan as its one-line summary.
  const short = await $.ui.mount({ plugin: 'am-context-bar', surface: 'terminal', ...BAND, props: { ...BAND.props, maxRows: 11 } })
  expect(await short.find({ type: 'Text', text: 'PLAN' })).toBeUndefined()
  expect(await short.find({ type: 'Text', text: 'Phase 2/3' })).toBeDefined()
  await short.unmount()
})

test('one-row keeps a short plan mark', { options: { layout: 'one-row' } }, async ($, on) => {
  await startCard($, on)
  await $.tool.call({ tool: 'ExitPlanMode' })
  await work($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'am-context-bar', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: '2/3' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' ⚠1' })).toBeDefined()
    await ui.unmount()
  }
})

test('/clear forgets the plan', async ($, on) => {
  on('classic.SessionStart', () => ({}))
  await startCard($, on)
  await $.tool.call({ tool: 'ExitPlanMode' })
  await work($)
  const ui = await $.ui.mount({ plugin: 'am-context-bar', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: 'Phase 2/3' })).toBeDefined()
  await $.classic.SessionStart({ source: 'clear' })
  expect(await ui.find({ type: 'Text', text: 'Phase 2/3' })).toBeUndefined()
  await ui.unmount()
})

test('Plan progress off leaves plans and tasks alone', { options: { planProgress: false } }, async ($, on) => {
  await startCard($, on)
  const approved = await $.tool.call({ tool: 'ExitPlanMode' })
  expect(approved.context).toBeUndefined()
  await work($)
  const ui = await $.ui.mount({ plugin: 'am-context-bar', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: 'Phase 2/3' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '◔' })).toBeDefined()
  await ui.unmount()
})
