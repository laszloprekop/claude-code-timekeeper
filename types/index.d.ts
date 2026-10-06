// The main loop's latest reply block: its row id and its text's key.
export type LastRow = { uuid: string; key: string }

// `id` is the call's tool_use_id while it runs in the foreground, and the
// background task's id once the call handed its work to the background.
export type RunningTool = {
  id: string
  callId: string
  tool: string
  label: string
  startedAt: number
  isSubagent: boolean
  isBackground: boolean
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
