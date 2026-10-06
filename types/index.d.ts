// The main loop's latest reply block: its row id and its text's key.
export type LastRow = { uuid: string; key: string }

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
      lastRow: LastRow | null
    }
  }
}
