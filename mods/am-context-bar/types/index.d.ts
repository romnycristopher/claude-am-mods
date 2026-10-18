export type Segment = {
  name: string
  tokens: number
  kind: 'used' | 'free' | 'buffer' | 'deferred'
}

export type Limit = { percent: number; resetsAt?: string }

export type Snapshot = {
  segments: Segment[]
  usedTokens: number
  windowTokens: number
  compactsAt?: number
  session?: Limit
  weekly?: Limit
  /** The last reading of the limits, kept across sessions, for before a response reports them. */
  lastLimits?: { session?: Limit; weekly?: Limit }
  model: string
  branch: string | null
  isDirty: boolean
  /** Files git would list for a commit (staged, unstaged, untracked). */
  changes?: number
  /** Commits ahead of and behind the upstream; absent without one. */
  ahead?: number
  behind?: number
  takenAt: number
}

/** The context fill at the last turn, and how much each recent turn added. */
export type Growth = { lastTokens: number | null; deltas: number[] }

export type TaskStatus = 'pending' | 'in_progress' | 'completed'

/** One task of Claude's list; `phase` is the plan phase its tag names. */
export type PlanTask = { id: string; subject: string; status: TaskStatus; phase?: string }

/** One phase of the approved plan: its id ("1", "B") and its heading. */
export type PlanPhase = { id: string; title: string }

/**
 * The plan's phases and the task list, as Claude last left it. `focus` is the
 * phase the conversation last put in hand ("go on with phase 2"), `finished`
 * the phases it said were done; both count for phases with no tagged tasks.
 */
export type Plan = { title: string | null; phases: PlanPhase[]; tasks: PlanTask[]; focus?: string; finished?: string[] }

declare module 'claude-code' {
  interface PluginState {
    'am-context-bar': {
      isVisible: boolean
      isExpanded: boolean
      snapshot: Snapshot | null
      effort: string | null
      compactions: number
      now: number
      growth: Growth
      plan: Plan
    }
  }
}
