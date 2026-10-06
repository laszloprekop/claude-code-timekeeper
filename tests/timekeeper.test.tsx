import { expect, mock, test } from 'claude-code/testing'

import { formatClock, formatElapsed, labelOf, textKey } from '../hooks/format'

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

test('a stored message is drawn with the time it was stored', async ($, on) => {
  mock.clock(on, { now: START })

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
  expect(drawn).toBe(`All done.\n\n*${stamp}*`)

  // A row drawn under another id is found by its text.
  await $.ui.render({
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'another-id',
    props: { text: 'All done.', isFirstOfReply: true },
  })
  expect(drawn).toBe(`All done.\n\n*${stamp}*`)

  await $.ui.render({
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'row-2',
    props: { text: 'Never stored.', isFirstOfReply: true },
  })
  expect(drawn).toBe('Never stored.')
})
