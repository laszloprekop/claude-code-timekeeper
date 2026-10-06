export type RunningTool = {
  id: string
  tool: string
  label: string
  startedAt: number
  isSubagent: boolean
}

declare module 'claude-code' {
  interface PluginState {
    timekeeper: {
      stamps: StateFamily<number | null>
      running: RunningTool[]
      now: number
    }
  }
}
