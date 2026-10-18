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
// The ones that only ever head phases; "step 3" or "part 2" also name things inside one.
const STRONG_WORD = 'phase|fase|étape|etape|etapa|stage|milestone|hito|sprint|iteration|iteración|iteracion'

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

// Words that say a phase is finished: "Phase 1 is done", "La fase 2 está
// terminada", "## Fase 1 — Diseño (hecha)", "Étape 2 terminée", "Phase 3 ✓".
const DONE =
  "done|finished|completed|(?:is|are|now|'s)\\s+complete|wrapped up|terminad[ao]s?|acabad[ao]s?|hech[ao]s?|list[ao]s?|completad[ao]s?|complet[ao]s?|" +
  'finalizad[ao]s?|cerrad[ao]s?|terminée?s?|finie?s?|achevée?s?|fertig|abgeschlossen|erledigt|conclu[ií]d[ao]s?|feit[ao]s?|pront[ao]s?|completat[ao]|finit[ao]'
const DONE_MARK = '(?:✓|✔|✅|☑)\uFE0F?'
// "Finished phase 1", "Terminé la fase 1", "Completamos la etapa 2".
const DONE_BEFORE =
  'finished|completed|wrapped up|terminé|terminamos|acabé|acabamos|completé|completamos|finalicé|finalizamos|concluí|terminei|concluímos|achevé|terminé|abgeschlossen'
const NOT = /(?<![\p{L}])(?:not|no|never|yet|aún|todavía|todavia|pas|nicht|noch|ainda|nog|non)(?![\p{L}])|n't/iu
const EDGE_BEFORE = '(?<![\\p{L}\\d])'
const EDGE_AFTER = '(?![\\p{L}\\d])'
// "Phase 2", "fase B", "P2": a phase named in the conversation.
const MENTION = new RegExp(`${EDGE_BEFORE}(?:(${PHASE_WORD})\\s+(\\d{1,2}|[a-z])|p(\\d{1,2}))${EDGE_AFTER}`, 'giu')
const DONE_AFTER = new RegExp(`^([^.,;\\n]{0,30}?)(?:${EDGE_BEFORE}(?:${DONE})${EDGE_AFTER}|${DONE_MARK})`, 'iu')
const DONE_AHEAD = new RegExp(`${EDGE_BEFORE}(?:${DONE_BEFORE})${EDGE_AFTER}([^.,;:\\n]{0,16})$`, 'iu')
// A heading marked as the phase at work: "## Fase 3: Probar ⏳", "## Phase 2 (in progress)".
const TITLE_AT_WORK = new RegExp(
  `\\s*[(\\[]?\\s*(?:(?:in progress|wip|en curso|en progreso|en marcha|en cours|in arbeit|em andamento|in corso)|(?:⏳|⌛|🔄|🚧|▶)\\uFE0F?)\\s*[)\\]]?\\s*$`,
  'iu',
)
const TITLE_DONE = new RegExp(`\\s*[(\\[]?\\s*(?:(?:${DONE})|${DONE_MARK})\\s*[)\\]]?\\s*$`, 'iu')

const cleanTitle = (raw: string): string =>
  raw
    .replace(/\*\*|__|`/g, '')
    .replace(/^[\s:.)·\-–—]+/, '')
    .replace(TITLE_DONE, '')
    .replace(TITLE_AT_WORK, '')
    .replace(/[\s:.·\-–—]+$/, '')
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

type Mention = { id: string; isStrong: boolean; isDone: boolean }

/** The plan's phases a text names, in order, and whether it says each is done. */
export const phaseMentionsOf = (text: string, known: string[]): Mention[] => {
  const mentions: Mention[] = []
  for (const found of text.matchAll(MENTION)) {
    const id = idOf(found[2] ?? found[3] ?? '')
    if (!known.includes(id)) continue
    const at = found.index ?? 0
    const after = text.slice(at + found[0].length).match(DONE_AFTER)
    const before = text.slice(Math.max(0, at - 60), at).match(DONE_AHEAD)
    const gap = after ? after[1] ?? '' : before ? before[1] ?? '' : null
    mentions.push({ id, isStrong: found[3] !== undefined || new RegExp(`^(?:${STRONG_WORD})$`, 'i').test(found[1] ?? ''), isDone: gap !== null && !NOT.test(gap) })
  }

  return mentions
}

/** The phase a task's subject is tagged with; a letter only when the plan has it ("PR: …" is no phase R). */
export const phaseTagOf = (subject: string, known: string[] = []): string | undefined => {
  const found = subject.match(TAG)
  if (!found) return undefined
  const id = idOf(found[2] ?? '')

  return /^\d+$/.test(id) || known.includes(id) ? id : undefined
}

// ── The list as Claude changes it ──────────────────────────────────────────
const isSamePlan = (plan: Plan, phases: PlanPhase[]) =>
  plan.phases.length === phases.length && plan.phases.every((p, index) => p.id === phases[index]?.id)

const finishedIn = (text: string, known: string[]): string[] =>
  [...new Set(phaseMentionsOf(text, known).filter(m => m.isDone).map(m => m.id))]

// The phases a plan's own headings mark, however long the title before the mark.
const markedIn = (markdown: string, known: string[], mark: RegExp): string[] =>
  markdown
    .split('\n')
    .map(line => line.match(WORD_HEADING))
    .filter(found => found !== null && mark.test((found[3] ?? '').replace(/\*\*|__|`/g, '')))
    .map(found => idOf(found?.[2] ?? ''))
    .filter(id => known.includes(id))

export const withPlan = (plan: Plan, markdown: string): Plan => {
  const { title, phases } = phasesOfPlan(markdown)
  const known = phases.map(p => p.id)
  const marked = new Set([...finishedIn(markdown, known), ...markedIn(markdown, known, TITLE_DONE)])
  const finished = known.filter(id => marked.has(id))
  const atWork = markedIn(markdown, known, TITLE_AT_WORK).at(-1)
  // The same phases again (the plan written in the chat, then approved): what
  // was done and in hand still is.
  if (isSamePlan(plan, phases)) {
    const focus = atWork ?? plan.focus
    return { ...plan, title: title ?? plan.title, phases, ...(focus !== undefined ? { focus } : {}), finished: [...new Set([...(plan.finished ?? []), ...finished])] }
  }

  // A new plan keeps the tasks still open; the finished ones were the last plan's.
  return {
    title,
    phases,
    tasks: plan.tasks.filter(t => t.status !== 'completed'),
    ...(atWork !== undefined ? { focus: atWork } : {}),
    ...(finished.length > 0 ? { finished } : {}),
  }
}

// A plan Claude wrote in its answer instead of plan mode: two or more
// headings that name phases as phases. Numbered headings alone are any answer.
const STRONG_HEADING = new RegExp(`^#{1,4}\\s+(?:\\*\\*)?(?:${STRONG_WORD})\\s+(?:\\d{1,2}|[a-z])${EDGE_AFTER}`, 'imu')
const isPlanText = (text: string): boolean => text.split('\n').filter(line => STRONG_HEADING.test(line)).length >= 2

// ── Plans Claude reads ─────────────────────────────────────────────────────
// A plan kept in a file or a doc counts once Claude reads it, however it got
// there: Read, cat, a docs tool, or an @file in the prompt. With no plan yet,
// any read with phase headings is one. Over a plan already followed, only a
// read the person asked for, or one that calls itself a plan, replaces it.
const PLAN_WORD = new RegExp(
  `${EDGE_BEFORE}(?:plan|plans|planes|planning|planificaci[oó]n|plano|planos|piano|roadmap|hoja de ruta|feuille de route|fahrplan|` +
    `phases|fases|etapas|étapes|stages|milestones|hitos)${EDGE_AFTER}`,
  'iu',
)
// "lee este documento completo", "read the doc", "revisa el archivo".
const READ_WORD = new RegExp(
  `${EDGE_BEFORE}(?:read|reread|review|lee|leer|léelo|lea|leelo|revisa|revisar|lire|lis|relis|lies|leggi|` +
    `document|documents|documento|documentos|doc|docs|archivo|archivos|fichero|file|files|fichier|datei|arquivo)${EDGE_AFTER}`,
  'iu',
)

/** Whether a prompt or a file's name speaks of a plan. */
export const namesPlan = (text: string): boolean => PLAN_WORD.test(text.replace(/[_\-.]+/g, ' '))

/** Whether a prompt asks Claude to read a plan or a document. */
export const asksToRead = (text: string): boolean => namesPlan(text) || READ_WORD.test(text) || mentionedFiles(text).length > 0

/** The files a prompt names with @ ("@PLAN.md", "@\"docs/my plan.md\"", "@src/a.ts#L5-9"). */
export const mentionedFiles = (text: string): string[] =>
  [...text.matchAll(/(?:^|\s)@(?:"([^"]+)"|([^\s"]+))/g)]
    .map(found => (found[1] ?? found[2] ?? '').replace(/#L?\d.*$/, '').replace(/[,.;:!?)]+$/, ''))
    .filter(path => path !== '' && !/^[a-z][\w-]*:/i.test(path))

/** Whether a text has a phase heading at all: worth reading the rest of a file it began. */
export const hasPhaseHeading = (text: string): boolean => text.split('\n').some(line => STRONG_HEADING.test(line.replace(/^ *\d+(?:\t|→)/, '')))

/** The plan a read gave Claude, when it holds one: the text less any line numbers (`cat -n`, Read). */
export const planInRead = (text: string): string | null => {
  if (text.length > 400_000) return null
  const plain = text.replace(/^ *\d+(?:\t|→)/gm, '')

  return isPlanText(plain) ? plain : null
}

/** A read Claude made: `name` is the file's, `isAsked` whether the person's prompt asked for a read. */
export const withRead = (plan: Plan, text: string, name: string, isAsked: boolean): Plan => {
  const markdown = planInRead(text)
  if (markdown === null) return plan
  const title = markdown.match(/^#\s+(.+)$/m)?.[1] ?? ''
  if (plan.phases.length > 0 && !isAsked && !namesPlan(name) && !namesPlan(title)) return plan

  return withPlan(plan, markdown)
}

/** The person's prompt: the phase it puts in hand, and any it says is done. */
export const withPrompt = (plan: Plan, text: string): Plan => {
  const mentions = phaseMentionsOf(text, plan.phases.map(p => p.id))
  if (mentions.length === 0) return plan
  const done = mentions.filter(m => m.isDone).map(m => m.id)
  const asked = mentions.filter(m => !m.isDone && !done.includes(m.id))
  // "In phase 1, step 3 fails" is about phase 1: a phase word over a step word.
  const focus = (asked.filter(m => m.isStrong).at(-1) ?? asked.at(-1))?.id ?? plan.focus
  const finished = [...new Set([...(plan.finished ?? []), ...done])].filter(id => id !== focus || done.includes(id))

  return { ...plan, ...(focus !== undefined ? { focus } : {}), finished }
}

/** Claude's answer: a plan written out in the chat, and the phases it says are done. */
export const withAnswer = (plan: Plan, text: string): Plan => {
  if (isPlanText(text)) {
    const { phases } = phasesOfPlan(text)
    // The plan's phases again is a recap of it, not a new plan.
    if (phases.length >= 2 && !isSamePlan(plan, phases)) return withPlan(plan, text)
  }
  const done = finishedIn(text, plan.phases.map(p => p.id))

  return done.length === 0 ? plan : { ...plan, finished: [...new Set([...(plan.finished ?? []), ...done])] }
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

type ToolUse = { tool: string; input: Record<string, unknown>; result?: unknown; text?: string; isError?: true }

/** The tools the plan is followed through by name; any other may read one. */
export const PLAN_TOOLS: readonly string[] = ['ExitPlanMode', 'TaskCreate', 'TaskUpdate', 'TodoWrite', 'Write', 'Edit']

/** The plan and list a transcript holds, for a session the mod meets midway. */
export const planFromMessages = (messages: readonly { role?: 'user' | 'assistant'; text?: string; toolUses?: readonly ToolUse[] }[]): Plan => {
  let plan = EMPTY_PLAN
  let isAsked = false
  for (const message of messages) {
    if (message.role === 'user' && message.text) {
      plan = withPrompt(plan, message.text)
      isAsked = asksToRead(message.text)
    }
    if (message.role === 'assistant' && message.text) plan = withAnswer(plan, message.text)
    for (const use of message.toolUses ?? []) {
      if (use.isError) continue
      const result = (use.result ?? {}) as Record<string, unknown>
      if (!PLAN_TOOLS.includes(use.tool)) {
        const path = typeof use.input.file_path === 'string' ? use.input.file_path : ''
        const file = result.file as { content?: unknown } | undefined
        const read = typeof file?.content === 'string' ? file.content : use.text
        if (read !== undefined) plan = withRead(plan, read, path.split('/').at(-1) ?? '', isAsked)
      }
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
  /** Whether the phase at hand is known: from tags, or from what the conversation said. */
  isFollowed: boolean
  isDone: boolean
}

export const planProgress = (plan: Plan): Progress | null => {
  const known = plan.phases.map(p => p.id)
  const finished = (plan.finished ?? []).filter(id => known.includes(id))
  const focus = plan.focus !== undefined && known.includes(plan.focus) ? plan.focus : undefined
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
    // Tasks say how a phase is going; without any, what the conversation said.
    const state: PhaseState =
      tasks.length === 0
        ? finished.includes(phase.id) ? 'done' : phase.id === focus ? 'active' : 'empty'
        : open === 0 ? 'done' : done > 0 || tasks.some(t => t.status === 'in_progress') || phase.id === focus ? 'active' : 'todo'

    return { ...phase, done, open, state, isBehind: false }
  })
  let last = -1
  phases.forEach((p, index) => {
    if (p.state === 'done' || p.state === 'active') last = index
  })
  // The phase asked for, until it's done; then the one after the last at work.
  const asked = phases.findIndex(p => p.id === focus)
  const current =
    asked !== -1 && phases[asked]?.state !== 'done'
      ? asked
      : last === -1 ? 0 : phases[last]?.state === 'done' && last + 1 < phases.length ? last + 1 : last
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
    isFollowed: isTagged || finished.length > 0 || focus !== undefined,
    isDone: open === 0 && (isTagged || finished.length > 0 || focus !== undefined ? phases.every(p => p.state === 'done') : plan.tasks.length > 0),
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
  "so the person's context card counts it under its phase. When you finish a phase, say so naming it (\"Phase 1 is done\"). " +
  'If you move on while tasks of an earlier phase are still open, say so.'
