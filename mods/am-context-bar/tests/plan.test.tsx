import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { EMPTY_PLAN, namesPlan, phaseMentionsOf, planInRead, phaseTagOf, phasesOfPlan, planFromMessages, planProgress, withAnswer, withPlan, withPrompt, withTaskCreated, withTaskUpdated, withTodos } from '../hooks/plan'
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

// A plan Claude wrote in the chat, as in a real session: no plan mode, no tasks.
const CHAT_PLAN = [
  '# Plan: a function that sums numbers',
  '',
  'The project directory is empty, so I\'ve assumed **Python**.',
  '',
  '## Phase 1: Design the interface',
  '- **Name and signature:** `sum_numbers(*numbers, unique=False)`',
  '## Phase 2: Implement',
  '## Phase 3: Test and verify',
].join('\n')

test('names a phase, and says whether it is done, in any language', async () => {
  const known = ['1', '2', '3']
  const said = (text: string) => phaseMentionsOf(text, known).map(m => `${m.id}${m.isDone ? ' done' : ''}`)
  expect(said('sí, sigue con la fase 2')).toEqual(['2'])
  expect(said('Go ahead and implement phase 1')).toEqual(['1'])
  expect(said('do P3')).toEqual(['3'])
  expect(said('Phase 1 is done. Writing the actual logic is Phase 2.')).toEqual(['1 done', '2'])
  expect(said('La Fase 2 está terminada y la función ya funciona.')).toEqual(['2 done'])
  expect(said('Terminé la fase 1, ahora la fase 2')).toEqual(['1 done', '2'])
  expect(said('Étape 3 terminée ✓')).toEqual(['3 done'])
  expect(said('## Fase 1 — Diseñar la interfaz (hecha)')).toEqual(['1 done'])
  // Not done, and not a phase.
  expect(said("Phase 2 isn't done yet")).toEqual(['2'])
  expect(said('La fase 2 no está terminada')).toEqual(['2'])
  expect(said('Phase 1 is done, and Phase 2 is next')).toEqual(['1 done', '2'])
  expect(said('phase 7, chapter 2, mp3')).toEqual([])
  // A done mark comes off a heading's title.
  expect(phasesOfPlan('## Fase 1 — Diseñar (hecha)\n## Fase 2 — Implementar ✓\n## Fase 3 — Probar').phases.map(p => p.title)).toEqual([
    'Diseñar',
    'Implementar',
    'Probar',
  ])
})

test('without plan mode or tasks, the conversation tells the phase', async () => {
  // The plan only written in the answer is still the plan.
  let plan = withAnswer(EMPTY_PLAN, CHAT_PLAN)
  expect(plan.phases.map(p => p.title)).toEqual(['Design the interface', 'Implement', 'Test and verify'])
  expect(planProgress(plan)?.isFollowed).toBe(false)

  plan = withPrompt(plan, 'Go ahead en implement phase 1')
  let p = planProgress(plan)
  expect(p?.current).toBe(0)
  expect(p?.phases[0]?.state).toBe('active')

  plan = withAnswer(plan, 'Phase 1 is done. I created `sum_numbers.py`. Writing the actual logic is Phase 2.')
  p = planProgress(plan)
  expect(p?.phases.map(ph => ph.state)).toEqual(['done', 'empty', 'empty'])
  expect(p?.current).toBe(1)

  plan = withPrompt(plan, 'sí, sigue con la fase 2')
  expect(planProgress(plan)?.phases.map(ph => ph.state)).toEqual(['done', 'active', 'empty'])
  plan = withAnswer(plan, 'La Fase 2 está terminada y la función ya funciona.')
  p = planProgress(plan)
  expect(p?.current).toBe(2)
  expect(p?.isDone).toBe(false)
  plan = withAnswer(withPrompt(plan, 'now phase 3'), 'Phase 3 is complete: every test passes.')
  expect(planProgress(plan)?.isDone).toBe(true)

  // Going back to a finished phase puts it in hand again.
  const back = planProgress(withPrompt(plan, 'vuelve a la fase 1, hay un bug'))
  expect(back?.current).toBe(0)
  expect(back?.phases[0]?.state).toBe('active')
  expect(back?.isDone).toBe(false)

  // A phase word wins over a step word.
  expect(withPrompt(plan, 'In phase 2, step 3 fails').focus).toBe('2')
  // Approving the same plan keeps what was done; another plan starts over.
  const approved = withPlan(withAnswer(withAnswer(EMPTY_PLAN, CHAT_PLAN), 'Phase 1 is done.'), '# Plan\n## Fase 1 — Diseño\n## Fase 2 — Código\n## Fase 3 — Pruebas')
  expect(approved.finished).toEqual(['1'])
  expect(approved.phases[1]?.title).toBe('Código')
  expect(withPlan(approved, '## Stage A\n## Stage B').finished).toBeUndefined()
  // A recap of the same phases, or numbered headings, is no new plan.
  expect(withAnswer(approved, '## Phase 1 ✓\n## Phase 2\n## Phase 3').phases[1]?.title).toBe('Código')
  expect(withAnswer(approved, '## 1. Install\n## 2. Run').phases).toHaveLength(3)
})

test('a transcript gives back a plan from the chat and the phase it reached', async () => {
  const plan = planFromMessages([
    { role: 'user', text: 'Create a plan with 3 phases', toolUses: [] },
    { role: 'assistant', text: CHAT_PLAN, toolUses: [] },
    { role: 'user', text: 'implement phase 1', toolUses: [] },
    { role: 'assistant', text: 'Phase 1 is done.', toolUses: [] },
    { role: 'user', text: 'sigue con la fase 2', toolUses: [] },
  ])
  expect(plan.finished).toEqual(['1'])
  expect(plan.focus).toBe('2')
})

const DOC_PLAN = ['# Roadmap: la tienda', '## Fase 1 — Catálogo', '## Fase 2 — Carrito', '## Fase 3 — Pagos'].join('\n')

test('a plan Claude reads counts when the person asked for one, or the file says it is one', async () => {
  expect(namesPlan('lee el plan completo')).toBe(true)
  expect(namesPlan('read the planning doc')).toBe(true)
  expect(namesPlan('revisa las fases del documento')).toBe(true)
  expect(namesPlan('implementation_plan.md')).toBe(true)
  expect(namesPlan('planet.ts')).toBe(false)
  expect(namesPlan('fix the build')).toBe(false)
  // Read's and cat -n's line numbers come off.
  expect(planInRead('     1\t# Roadmap\n     2\t## Phase 1 — A\n     3\t## Phase 2 — B')).toBe('# Roadmap\n## Phase 1 — A\n## Phase 2 — B')
  expect(planInRead('## 1. Install\n## 2. Run')).toBeNull()

  const read = { tool: 'Read', input: { file_path: '/repo/docs/tienda.md' }, result: { type: 'text', file: { filePath: '/repo/docs/tienda.md', content: DOC_PLAN } } }
  const asked = planFromMessages([{ role: 'user', text: 'lee el plan completo en docs/tienda.md', toolUses: [] }, { role: 'assistant', text: '', toolUses: [read] }])
  expect(asked.phases.map(p => p.title)).toEqual(['Catálogo', 'Carrito', 'Pagos'])
  // Claude reading a file with phases on its own isn't taken for the plan.
  expect(planFromMessages([{ role: 'user', text: 'fix the build', toolUses: [] }, { role: 'assistant', text: '', toolUses: [read] }]).phases).toEqual([])
  const named = { ...read, input: { file_path: '/repo/PLAN.md' } }
  expect(planFromMessages([{ role: 'user', text: 'go on', toolUses: [] }, { role: 'assistant', text: '', toolUses: [named] }]).phases).toHaveLength(3)
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
    if (e.tool === 'Read') {
      const content = DOC_PLAN.split('\n').slice(0, 2).join('\n')

      return { result: { type: 'text', file: { filePath: e.file_path, content, numLines: 2, startLine: 1, totalLines: 4 } }, text: `     1\t${content}` }
    }

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

test('the card follows a chat plan through the phases the conversation names', async ($, on) => {
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  await startCard($, on)
  const turn = { durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const
  await $.turn.complete({ ...turn, answer: CHAT_PLAN })
  const ui = await $.ui.mount({ plugin: 'am-context-bar', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: '3 phases' })).toBeDefined()

  const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as const
  await $.prompt.submit(typed('Go ahead and implement phase 1'))
  await $.turn.complete({ ...turn, answer: 'Phase 1 is done.' })
  // A task's notification is no word of the person's.
  await $.prompt.submit({ text: 'phase 3 is done', wait: false, origin: { kind: 'task-notification' } })
  await $.prompt.submit(typed('sí, sigue con la fase 2'))
  expect(await ui.find({ type: 'Text', text: 'Phase 2/3' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' Implement' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'in progress' })).toBeDefined()

  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Text', text: '1/3 phases done' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'done' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'now' })).toBeDefined()

  await $.turn.complete({ ...turn, answer: 'La Fase 2 está terminada.' })
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Text', text: 'Phase 3/3' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'up next' })).toBeDefined()
  await ui.unmount()
})

test('a plan in a document Claude reads shows on the card, whole', async ($, on) => {
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('fs.read', () => ({ value: DOC_PLAN }))
  await startCard($, on)
  const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as const
  const ui = await $.ui.mount({ plugin: 'am-context-bar', surface: 'terminal', ...BAND })

  // Not asked about a plan: a file with phases is just a file.
  await $.prompt.submit(typed('fix the build'))
  expect((await $.tool.call({ tool: 'Read', file_path: '/repo/docs/tienda.md' })).context).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '3 phases' })).toBeUndefined()

  await $.prompt.submit(typed('lee el plan completo en docs/tienda.md'))
  // One page of it was read; the card takes the whole file, and Claude its tags.
  const read = await $.tool.call({ tool: 'Read', file_path: '/repo/docs/tienda.md' })
  expect(read.context?.join('\n')).toMatch(/3 phases: P1 Catálogo; P2 Carrito; P3 Pagos/)
  expect(await ui.find({ type: 'Text', text: '3 phases' })).toBeDefined()
  await $.prompt.submit(typed('empieza la fase 1'))
  expect(await ui.find({ type: 'Text', text: 'Phase 1/3' })).toBeDefined()
  // Read again, the same plan keeps its place and tells Claude nothing new.
  expect((await $.tool.call({ tool: 'Read', file_path: '/repo/docs/tienda.md' })).context).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Phase 1/3' })).toBeDefined()
  await ui.unmount()
})
