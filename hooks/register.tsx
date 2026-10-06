import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { RunningTool } from '../types'
import {
  backgroundIdOf,
  formatClock,
  formatElapsed,
  labelOf,
  localOffsetMinutes,
  parseNotification,
  textKey,
} from './format'
import type { TaskNotification } from './format'

// A tool call shows in the band once it has run this long.
const SHOW_AFTER_MS = 3_000
// A turn at least this long ends with a toast.
const TOAST_AFTER_MS = 30_000

const STAMPS = { plugin: 'timekeeper', key: 'stamps' } as const
const stamps = atom(STAMPS, null)
const running = atom({ plugin: 'timekeeper', key: 'running' } as const, [])
const now = atom({ plugin: 'timekeeper', key: 'now' } as const, 0)
const lastRow = atom({ plugin: 'timekeeper', key: 'lastRow' } as const, null)

const clock = (ms: number) => formatClock(ms, localOffsetMinutes(ms))
// Where a turn's closing block is marked: under its row id and its text's key.
const finalKey = (id: string) => `final:${id}`

// Marks the main loop's latest reply block as the one that closed its turn.
async function markFinal($: EngineInterface) {
  const row = await read($, lastRow)

  if (row !== null) {
    const at = await $.clock.now()
    await $.state.set({ ...STAMPS, id: finalKey(row.uuid) }, at)
    await $.state.set({ ...STAMPS, id: finalKey(row.key) }, at)
    await update($, lastRow, () => null)
  }
}

// Takes a background task that ended out of the band and says how it ended.
async function settle($: EngineInterface, note: TaskNotification) {
  const ended = (await read($, running)).find(
    t => t.isBackground && (t.id === note.taskId || t.callId === note.toolUseId),
  )

  if (ended === undefined) {
    return
  }

  await update($, running, list => list.filter(t => t.id !== ended.id))

  const at = await $.clock.now()
  const what = ended.label === '' ? ended.tool : `${ended.tool} ${ended.label}`
  $.ui.toast(`Background ${what}: ${note.status} after ${formatElapsed(at - ended.startedAt)}`, {
    timeoutMs: 8000,
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Foreground calls left over from before a reload are no longer tracked;
    // background tasks run on, and their notifications still end them.
    await update($, running, list => list.filter(t => t.isBackground === true))
    // A reload lands when a turn ends, and may be what saw that turn's end.
    await markFinal($).catch(() => {})

    $.clock.every(1000, async () => {
      if ((await read($, running)).length > 0) {
        const at = await $.clock.now()
        await update($, now, () => at)
      }
    })

    return next(e)
  })

  // Messages carry no time of their own: note when each row is stored, under
  // its id and under its text.
  on('session.append', async ($, e, next) => {
    try {
      const { type, isMeta, content } = e.message
      const isMessage = (type === 'user' || type === 'assistant') && isMeta !== true
      const texts = content.flatMap(block =>
        block.type === 'text' && typeof block.text === 'string' ? [block.text] : [],
      )

      // A background task's end reaches the conversation as a notification row.
      if (type !== 'assistant' && e.agentId === undefined) {
        for (const text of texts) {
          const note = parseNotification(text)

          if (note !== undefined) {
            await settle($, note)
          }
        }
      }

      if (isMessage && e.agentId === undefined) {
        if (texts.length > 0) {
          const at = await $.clock.now()
          await $.state.set({ ...STAMPS, id: e.uuid }, at)

          for (const text of texts) {
            await $.state.set({ ...STAMPS, id: textKey(text) }, at)
          }

          const last = texts.at(-1)

          if (type === 'assistant' && last !== undefined) {
            await update($, lastRow, () => ({ uuid: e.uuid, key: textKey(last) }))
          }
        }
      }
    } catch {
      // A row is stored whether or not its time was noted.
    }

    return next(e)
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const at =
      (await read($, memberOf(stamps, e))) ??
      (await $.state.get({ ...STAMPS, id: textKey(e.props.text) })).value

    if (typeof at !== 'number' || e.props.text.trim() === '') {
      return next(e)
    }

    return next({ ...e, props: { ...e.props, text: `${e.props.text}  ▶ ${clock(at)}` } })
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const at =
      (await read($, memberOf(stamps, e))) ??
      (await $.state.get({ ...STAMPS, id: textKey(e.props.text) })).value

    if (typeof at !== 'number' || e.props.text.trim() === '') {
      return next(e)
    }

    // The block that closed its turn carries the stop mark.
    const isFinal =
      (await $.state.get({ ...STAMPS, id: finalKey(e.requestId) })).value != null ||
      (await $.state.get({ ...STAMPS, id: finalKey(textKey(e.props.text)) })).value != null
    const stamp = isFinal ? `■ ${clock(at)}` : clock(at)

    return next({ ...e, props: { ...e.props, text: `${e.props.text}\n\n${stamp}` } })
  })

  on('tool.call', async ($, e, next) => {
    try {
      const startedAt = await $.clock.now()
      const entry: RunningTool = {
        id: e.tool_use_id,
        callId: e.tool_use_id,
        tool: e.tool,
        label: labelOf(e),
        startedAt,
        isSubagent: e.agentId !== undefined,
        isBackground: false,
      }

      await update($, running, list => [...list.filter(t => t.id !== entry.id), entry])
      await update($, now, () => startedAt)
    } catch {
      // The call runs whether or not it is tracked.
    }

    // A call that handed its work to the background stays in the band under
    // the task's id, until the task's notification ends it.
    let taskId: string | undefined
    let stopped: string | undefined

    try {
      const ran = await next(e)

      if (ran.deny === undefined && ran.isError !== true) {
        taskId = backgroundIdOf(e.tool, ran.result)
        stopped = e.tool === 'TaskStop' ? (e.task_id ?? e.shell_id) : undefined
      }

      return ran
    } finally {
      await update($, running, list =>
        list.flatMap(t => {
          if (t.id === stopped) {
            return []
          }

          if (t.id !== e.tool_use_id) {
            return [t]
          }

          return taskId === undefined ? [] : [{ ...t, id: taskId, isBackground: true }]
        }),
      ).catch(() => {})
    }
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      try {
        // The main loop's calls have all settled by now.
        await update($, running, list => list.filter(t => t.isSubagent || t.isBackground))
        await markFinal($)

        if (e.durationMs >= TOAST_AFTER_MS && !e.isAborted) {
          const at = await $.clock.now()
          $.ui.toast(`Finished ${clock(at)}, took ${formatElapsed(e.durationMs)}`, { timeoutMs: 8000 })
        }
      } catch {
        // The turn ends either way.
      }
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const at = await read($, now)
    const shown = (await read($, running)).filter(
      t => t.isBackground || at - t.startedAt >= SHOW_AFTER_MS,
    )

    if (shown.length === 0) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {shown.map(t => (
          <Text wrap="truncate-end">
            <Text color="warning">{formatElapsed(at - t.startedAt)}</Text>
            <Text bold> {t.tool}</Text>
            <Text>{t.label === '' ? '' : ` ${t.label}`}</Text>
            <Text dimColor>
              {' '}
              ({t.isBackground ? 'background, ' : ''}since {clock(t.startedAt)}
              {t.isSubagent ? ', subagent' : ''})
            </Text>
          </Text>
        ))}
        {shown.some(t => t.isBackground) ? (
          <Button
            key="clear-background"
            label="clear background rows"
            plain
            dimColor
            onPress={() => update($, running, list => list.filter(t => !t.isBackground))}
          />
        ) : (
          ''
        )}
      </Box>
    )
  })
}
