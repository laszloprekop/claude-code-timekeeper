import { expect, mock, test } from 'claude-code/testing'

import {
  backgroundIdOf,
  formatClock,
  formatElapsed,
  labelOf,
  parseNotification,
  textKey,
} from '../hooks/format'

const START = Date.UTC(2026, 9, 6, 12, 32, 7)

const BAND = {
  plugin: 'timekeeper',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

test('formats clock times and elapsed times', () => {
  expect(formatClock(START, 120)).toBe('14:32:07')
  expect(formatClock(START, 0)).toBe('12:32:07')
  expect(formatElapsed(900)).toBe('0s')
  expect(formatElapsed(72_000)).toBe('1m 12s')
  expect(formatElapsed(3_725_000)).toBe('1h 02m 05s')
})

test('labels a call by its description, then its command', () => {
  expect(labelOf({ command: 'npm test', description: 'Run the tests' })).toBe('Run the tests')
  expect(labelOf({ command: 'npm test\necho done' })).toBe('npm test')
  expect(labelOf({ limit: 3 })).toBe('')
  expect(textKey(' hello ')).toBe(textKey('hello'))
})

test('the band shows a long-running call with its elapsed time, then clears', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  let finish = () => {}
  const gate = new Promise<void>(resolve => {
    finish = resolve
  })

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', { component: 'AbovePrompt' }, (engine, e) => {
    const { Text } = engine.ui.resolve(e)

    return <Text>empty</Text>
  })
  on('tool.call', async () => {
    await gate

    return { result: { stdout: '', stderr: '' } } as never
  })

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const call = $.tool.call({
    tool: 'Bash',
    tool_use_id: 'call-1',
    command: 'sleep 90',
    description: 'Wait for the build',
  })

  await clock.advance(1_000)
  const early = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await early.find({ type: 'Text', text: /Bash/ })).toBeUndefined()
  await early.unmount()

  await clock.advance(71_000)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const row = await band.find({ type: 'Text', text: /Wait for the build/ })
  expect(row?.text).toContain('1m 12s')
  expect(row?.text).toContain('Bash')
  await band.unmount()

  finish()
  await call
  await clock.advance(1_000)

  const after = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await after.find({ type: 'Text', text: /Bash/ })).toBeUndefined()
  await after.unmount()
})

test('reads a background task from a result and its end from a notification', () => {
  expect(backgroundIdOf('Bash', { stdout: '', backgroundTaskId: 'bg-1' })).toBe('bg-1')
  expect(backgroundIdOf('Bash', { stdout: 'done' })).toBeUndefined()
  expect(backgroundIdOf('Agent', { status: 'async_launched', agentId: 'a1' })).toBe('a1')
  expect(backgroundIdOf('Agent', { status: 'completed', agentId: 'a1' })).toBeUndefined()
  expect(backgroundIdOf('Monitor', { taskId: 'm1', timeoutMs: 0 })).toBe('m1')
  expect(backgroundIdOf('TaskGet', { taskId: 't1' })).toBeUndefined()

  expect(
    parseNotification(
      '<task-notification>\n<task-id>bg-1</task-id>\n<tool-use-id>call-1</tool-use-id>\n<status>completed</status>\n</task-notification>',
    ),
  ).toEqual({ taskId: 'bg-1', toolUseId: 'call-1', status: 'completed' })
  expect(parseNotification('<task-notification><task-id>m1</task-id></task-notification>')).toBeUndefined()
  expect(parseNotification('hello')).toBeUndefined()
})

test('the band follows a background task until its notification', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  const toasts: string[] = []

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.render', { component: 'AbovePrompt' }, (engine, e) => {
    const { Text } = engine.ui.resolve(e)

    return <Text>empty</Text>
  })
  on('tool.call', () => ({ result: { stdout: '', stderr: '', backgroundTaskId: 'bg-1' } }) as never)

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'Bash',
    tool_use_id: 'call-1',
    command: 'npm run dev',
    description: 'Start the dev server',
    run_in_background: true,
  })

  // The turn that started it ends; the task runs on.
  await $.turn.complete({
    answer: 'Started.',
    durationMs: 1_000,
    isAborted: false,
    turnId: 'turn-1',
    reason: 'answer',
  })
  await clock.advance(125_000)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const row = await band.find({ type: 'Text', text: /Start the dev server/ })
  expect(row?.text).toContain('2m 05s')
  expect(row?.text).toContain('background')
  await band.unmount()

  // The kit has no store beneath the plugins, so the append itself rejects.
  await $.session
    .append({
      message: {
        type: 'user',
        role: 'user',
        isMeta: true,
        content: [
          {
            type: 'text',
            text: '<task-notification>\n<task-id>bg-1</task-id>\n<status>completed</status>\n</task-notification>',
          },
        ],
      },
      door: 'delivery',
      origin: { kind: 'task-notification' },
      uuid: 'row-9',
    })
    .catch(() => {})

  const after = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await after.find({ type: 'Text', text: /Start the dev server/ })).toBeUndefined()
  await after.unmount()
  expect(toasts.join(' ')).toContain('completed after 2m 05s')
})

test('a stored message is drawn with the time it was stored', async ($, on) => {
  mock.clock(on, { now: START })

  on('turn.complete', (_, e) => ({ text: e.answer }))

  let drawn = ''
  on('ui.render', { component: 'AssistantMessage' }, (engine, e) => {
    const { Text } = engine.ui.resolve(e)
    drawn = e.props.text

    return <Text>{e.props.text}</Text>
  })

  // The kit has no store beneath the plugins, so the append itself rejects;
  // the mod notes the time before it hands the row on.
  await $.session
    .append({
      message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'All done.' }] },
      door: 'response',
      origin: { kind: 'model', model: 'test' },
      uuid: 'row-1',
    })
    .catch(() => {})

  const stamp = formatClock(START, -new Date(START).getTimezoneOffset())

  await $.ui.render({
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'row-1',
    props: { text: 'All done.', isFirstOfReply: true },
  })
  expect(drawn).toBe(`All done.\n\n${stamp}`)

  // A row drawn under another id is found by its text.
  await $.ui.render({
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'another-id',
    props: { text: 'All done.', isFirstOfReply: true },
  })
  expect(drawn).toBe(`All done.\n\n${stamp}`)

  // Once its turn has ended, the closing block carries the stop mark.
  await $.turn.complete({
    answer: 'A summary worded unlike the block.',
    durationMs: 1_000,
    isAborted: false,
    turnId: 'turn-1',
    reason: 'answer',
  })
  await $.ui.render({
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'row-1',
    props: { text: 'All done.', isFirstOfReply: true },
  })
  expect(drawn).toBe(`All done.\n\n■ ${stamp}`)

  await $.ui.render({
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'row-2',
    props: { text: 'Never stored.', isFirstOfReply: true },
  })
  expect(drawn).toBe('Never stored.')
})
