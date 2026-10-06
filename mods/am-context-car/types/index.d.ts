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
  takenAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'am-context-car': {
      isVisible: boolean
      snapshot: Snapshot | null
      effort: string | null
      compactions: number
      now: number
    }
  }
}
