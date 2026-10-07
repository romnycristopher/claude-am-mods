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

declare module 'claude-code' {
  interface PluginState {
    'am-context-bar': {
      isVisible: boolean
      isExpanded: boolean
      snapshot: Snapshot | null
      effort: string | null
      compactions: number
      now: number
    }
  }
}
