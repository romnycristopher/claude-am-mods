import type { Plan, PlanPhase, PlanTask, TaskStatus } from '../types'

// ── Plan progress ──────────────────────────────────────────────────────────
// The approved plan gives the phases; Claude's task list gives the work. A
// task belongs to a phase by the tag that opens its subject ("P2: …"), which
// the mod asks Claude for itself, so nobody has to set anything up.

export const EMPTY_PLAN: Plan = { title: null, phases: [], tasks: [] }

// Words plans head their phases with, in the languages people plan in.
const PHASE_WORD =
  'phase|fase|étape|etape|etapa|stage|milestone|hito|part|parte|partie|step|paso|passo|sprint|iteration|iteración|iteracion|wave|ola|schritt|stufe|teil'
const PUNCT = '[:.)·\\-–—]'

// "## Phase 1 — Setup", "### Fase 0: infraestructura", "## **Stage B** Rollout";
// not "### 1.1 …", a step inside a phase.
const WORD_HEADING = new RegExp(`^(#{2,4})\\s+(?:\\*\\*)?(?:${PHASE_WORD})\\s+(\\d{1,2}|[a-z])(?!\\.\\d|\\d|[a-z])\\s*(?:\\*\\*)?\\s*${PUNCT}?\\s*(.*)$`, 'i')
// "## 1. Dictionary", "### 2) Rollout", "## 3 — Docs".
const NUMBERED_HEADING = /^(#{2,4})\s+(?:\*\*)?(\d{1,2})(?:[.)]|\s*[:\-–—])\s+(.*)$/

// "P2: …", "P2.3: …", "F1 — …", "Phase B: …", "Fase 2: …", "§3: …", "[P1] …".
const TAG = new RegExp(
  `^\\s*(\\[)?(?:(?:${PHASE_WORD})\\s*|[pf]|§\\s*)(\\d{1,2}|[a-z])(?:\\.\\d+)*(?:\\]\\s*${PUNCT}?|\\s*${PUNCT})`,
  'i',
)

const idOf = (raw: string): string => (/^\d+$/.test(raw) ? String(Number(raw)) : raw.toUpperCase())

const cleanTitle = (raw: string): string =>
  raw
    .replace(/\*\*|__|`/g, '')
    .replace(/^[\s:.)·\-–—]+/, '')
    .trim()

/** The plan's title and phases: two or more, or none. */
export const phasesOfPlan = (markdown: string): { title: string | null; phases: PlanPhase[] } => {
  let title: string | null = null
  let isFenced = false
  const worded: { level: number; phase: PlanPhase }[] = []
  const numbered: { level: number; phase: PlanPhase }[] = []
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) isFenced = !isFenced
    if (isFenced) continue
    const top = line.match(/^#\s+(.+)$/)
    if (top && title === null) title = cleanTitle(top[1] ?? '').replace(/^plan\s*[:—–-]\s*/i, '') || null
    const word = line.match(WORD_HEADING)
    if (word) {
      worded.push({ level: word[1]?.length ?? 2, phase: { id: idOf(word[2] ?? ''), title: cleanTitle(word[3] ?? '') } })
      continue
    }
    const number = line.match(NUMBERED_HEADING)
    if (number) numbered.push({ level: number[1]?.length ?? 2, phase: { id: idOf(number[2] ?? ''), title: cleanTitle(number[3] ?? '') } })
  }
  // Phases named as phases win; else numbered headings, at the shallowest
  // level that has two or more.
  const pick = (found: { level: number; phase: PlanPhase }[]): PlanPhase[] => {
    for (const level of [2, 3, 4]) {
      const phases: PlanPhase[] = []
      for (const f of found) if (f.level === level && !phases.some(p => p.id === f.phase.id)) phases.push(f.phase)
      if (phases.length >= 2) return phases
    }

    return []
  }
  const phases = pick(worded)

  return { title, phases: phases.length > 0 ? phases : pick(numbered) }
}

/** The phase a task's subject is tagged with; a letter only when the plan has it ("PR: …" is no phase R). */
export const phaseTagOf = (subject: string, known: string[] = []): string | undefined => {
  const found = subject.match(TAG)
  if (!found) return undefined
  const id = idOf(found[2] ?? '')

  return /^\d+$/.test(id) || known.includes(id) ? id : undefined
}

// ── The list as Claude changes it ──────────────────────────────────────────
export const withPlan = (plan: Plan, markdown: string): Plan => {
  const { title, phases } = phasesOfPlan(markdown)

  // A new plan keeps the tasks still open; the finished ones were the last plan's.
  return { title, phases, tasks: plan.tasks.filter(t => t.status !== 'completed') }
}

export const withTaskCreated = (plan: Plan, id: string, subject: string, phase?: unknown): Plan => {
  const task: PlanTask = { id, subject, status: 'pending', ...(typeof phase === 'string' || typeof phase === 'number' ? { phase: idOf(String(phase).replace(/^[pf]/i, '')) } : {}) }

  return { ...plan, tasks: [...plan.tasks.filter(t => t.id !== id), task] }
}

export const withTaskUpdated = (plan: Plan, id: string, change: { status?: string; subject?: string }): Plan => {
  if (change.status === 'deleted') return { ...plan, tasks: plan.tasks.filter(t => t.id !== id) }
  const status = isStatus(change.status) ? change.status : undefined

  return {
    ...plan,
    tasks: plan.tasks.map(t =>
      t.id === id ? { ...t, ...(status ? { status } : {}), ...(change.subject ? { subject: change.subject } : {}) } : t,
    ),
  }
}

// TodoWrite sends the whole list each time; its items have no ids of their own.
export const withTodos = (plan: Plan, todos: readonly { content: string; status: string }[]): Plan => ({
  ...plan,
  tasks: [
    ...plan.tasks.filter(t => !t.id.startsWith('todo:')),
    ...todos.map((todo, index) => ({ id: `todo:${index}`, subject: todo.content, status: isStatus(todo.status) ? todo.status : 'pending' })),
  ],
})

const isStatus = (value: unknown): value is TaskStatus => value === 'pending' || value === 'in_progress' || value === 'completed'

type ToolUse = { tool: string; input: Record<string, unknown>; result?: unknown; isError?: true }

/** The plan and list a transcript holds, for a session the mod meets midway. */
export const planFromMessages = (messages: readonly { toolUses?: readonly ToolUse[] }[]): Plan => {
  let plan = EMPTY_PLAN
  for (const message of messages) {
    for (const use of message.toolUses ?? []) {
      if (use.isError) continue
      const result = (use.result ?? {}) as Record<string, unknown>
      if (use.tool === 'ExitPlanMode' && typeof result.plan === 'string') plan = withPlan(plan, result.plan)
      if (use.tool === 'TaskCreate') {
        const task = result.task as { id?: unknown } | undefined
        const metadata = use.input.metadata as Record<string, unknown> | undefined
        if (typeof task?.id === 'string') plan = withTaskCreated(plan, task.id, String(use.input.subject ?? ''), metadata?.phase)
      }
      if (use.tool === 'TaskUpdate' && typeof use.input.taskId === 'string') {
        plan = withTaskUpdated(plan, use.input.taskId, use.input as { status?: string; subject?: string })
      }
      if (use.tool === 'TodoWrite' && Array.isArray(use.input.todos)) plan = withTodos(plan, use.input.todos as { content: string; status: string }[])
    }
  }

  return plan
}

// ── Progress ───────────────────────────────────────────────────────────────
export type PhaseState = 'done' | 'active' | 'todo' | 'empty'
export type PhaseProgress = PlanPhase & { done: number; open: number; state: PhaseState; isBehind: boolean }
export type Progress = {
  title: string | null
  phases: PhaseProgress[]
  /** The phase being worked on, or next up once the one before is done. */
  current: number
  /** Phases before the current one with tasks still open. */
  behind: PhaseProgress[]
  done: number
  open: number
  untagged: { done: number; open: number }
  /** Whether any task carries a phase tag; without one only the totals are known. */
  isTagged: boolean
  isDone: boolean
}

export const planProgress = (plan: Plan): Progress | null => {
  const known = plan.phases.map(p => p.id)
  const tagged = plan.tasks.map(task => ({ task, phase: task.phase ?? phaseTagOf(task.subject, known) }))
  const isTagged = tagged.some(t => t.phase !== undefined)
  if (plan.phases.length < 2 && !isTagged) return null

  // Tags the plan doesn't name still count, after its own phases.
  const extra = [...new Set(tagged.map(t => t.phase).filter((id): id is string => id !== undefined && !known.includes(id)))]
    .sort((a, b) => (/^\d+$/.test(a) && /^\d+$/.test(b) ? Number(a) - Number(b) : a.localeCompare(b)))
  const phases: PhaseProgress[] = [...plan.phases, ...extra.map(id => ({ id, title: '' }))].map(phase => {
    const tasks = tagged.filter(t => t.phase === phase.id).map(t => t.task)
    const done = tasks.filter(t => t.status === 'completed').length
    const open = tasks.length - done
    const state: PhaseState =
      tasks.length === 0 ? 'empty' : open === 0 ? 'done' : done > 0 || tasks.some(t => t.status === 'in_progress') ? 'active' : 'todo'

    return { ...phase, done, open, state, isBehind: false }
  })
  let last = -1
  phases.forEach((p, index) => {
    if (p.state === 'done' || p.state === 'active') last = index
  })
  const current = last === -1 ? 0 : phases[last]?.state === 'done' && last + 1 < phases.length ? last + 1 : last
  phases.forEach((p, index) => {
    p.isBehind = index < current && p.open > 0
  })
  const untagged = tagged.filter(t => t.phase === undefined).map(t => t.task)
  const untaggedDone = untagged.filter(t => t.status === 'completed').length
  const done = plan.tasks.filter(t => t.status === 'completed').length
  const open = plan.tasks.length - done

  return {
    title: plan.title,
    phases,
    current,
    behind: phases.filter(p => p.isBehind),
    done,
    open,
    untagged: { done: untaggedDone, open: untagged.length - untaggedDone },
    isTagged,
    isDone: plan.tasks.length > 0 && open === 0 && (!isTagged || phases.every(p => p.state === 'done')),
  }
}

// ── What the mod tells Claude ──────────────────────────────────────────────
// Added to the task tools' descriptions: the convention, always at hand.
export const TAG_GUIDE =
  'Phase tags: when the tasks carry out a plan split into phases (Phase 1, Fase 2, Stage A…), ' +
  'start each one with its phase tag, P<phase>: — for example "P2: Add the migration", or "P2.3: …" for step 2.3. ' +
  "The person's context card counts progress per phase from these tags."

// Added to an approved plan's result: the tags this plan's phases take.
export const planBrief = (phases: PlanPhase[]): string =>
  `This plan has ${phases.length} phases: ${phases.map(p => (p.title ? `P${p.id} ${p.title}` : `P${p.id}`)).join('; ')}. ` +
  `Start the subject of every task you create for it with its phase tag ("P${phases[0]?.id ?? 1}: …"), ` +
  "so the person's context card counts it under its phase. If you move on while tasks of an earlier phase are still open, say so."
