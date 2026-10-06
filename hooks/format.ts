const pad = (n: number) => String(n).padStart(2, '0')

// Minutes east of UTC at that moment, as the environment's own clock has it.
export const localOffsetMinutes = (ms: number) => -new Date(ms).getTimezoneOffset()

export const formatClock = (ms: number, offsetMinutes: number) => {
  const d = new Date(ms + offsetMinutes * 60_000)

  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

export const formatElapsed = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60

  if (h > 0) {
    return `${h}h ${pad(m)}m ${pad(s)}s`
  }

  return m > 0 ? `${m}m ${pad(s)}s` : `${s}s`
}

// A short id for a message's text (FNV-1a), for rows whose drawn id is not
// the id they were stored under.
export const textKey = (text: string) => {
  const trimmed = text.trim()
  let hash = 0x811c9dc5

  for (let i = 0; i < trimmed.length; i += 1) {
    hash ^= trimmed.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }

  return `text:${trimmed.length}:${(hash >>> 0).toString(16)}`
}

const LABEL_KEYS = ['description', 'command', 'file_path', 'path', 'pattern', 'url', 'query', 'skill']

export const labelOf = (input: Readonly<Record<string, unknown>>) => {
  for (const key of LABEL_KEYS) {
    const value = input[key]

    if (typeof value === 'string' && value.trim() !== '') {
      const line = value.trim().split('\n')[0] ?? ''

      return line.length > 60 ? `${line.slice(0, 59)}…` : line
    }
  }

  return ''
}

const stringAt = (record: Readonly<Record<string, unknown>>, key: string) => {
  const value = record[key]

  return typeof value === 'string' && value !== '' ? value : undefined
}

// The id of the background task a tool call left running, read from the
// call's result; undefined when the call finished its work itself.
export const backgroundIdOf = (tool: string, result: unknown) => {
  if (typeof result !== 'object' || result === null) {
    return undefined
  }

  const record = result as Readonly<Record<string, unknown>>

  if (record.status === 'async_launched') {
    return stringAt(record, 'agentId')
  }

  if (record.status === 'remote_launched' || tool === 'Monitor' || tool === 'Workflow') {
    return stringAt(record, 'taskId')
  }

  return stringAt(record, 'backgroundTaskId')
}

export type TaskNotification = { taskId?: string; toolUseId?: string; status: string }

const tagOf = (text: string, tag: string) =>
  new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`).exec(text)?.[1] || undefined

// What a background task's notification says of it; undefined for any other
// text, and for a notification that reports no end (it names no status).
export const parseNotification = (text: string): TaskNotification | undefined => {
  if (!text.includes('<task-notification>')) {
    return undefined
  }

  const status = tagOf(text, 'status')

  if (status === undefined) {
    return undefined
  }

  return { taskId: tagOf(text, 'task-id'), toolUseId: tagOf(text, 'tool-use-id'), status }
}
