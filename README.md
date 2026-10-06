# timekeeper

A mod for Claude Code that shows when things happened and how long they are taking.

- **Timestamps.** Each prompt ends with `[14:32:07]`, and each block of a reply ends with the
  time in italics. Times are in the local time zone.
- **Progress band.** A tool call that has run for 3 seconds or more gets a row above the prompt,
  for example `1m 12s Bash Run the tests (since 14:32:07)`. It updates every second and
  disappears when the call ends.
- **Toast.** A turn that takes 30 seconds or longer ends with a notice such as
  `Finished 14:35:10, took 2m 4s`.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install timekeeper --marketplace laszloprekop/claude-code-timekeeper
```

Answer `y` to add the marketplace, then choose a scope.

## Limits

- Messages stored before the mod loaded have no timestamp.
- The band shows elapsed time, not a percentage.
- Commands started in the background return at once, so the band does not time them.
- The mod API is early access and may change between Claude Code releases. Built against 2.1.292.

## Develop

```
claude --plugin-dir .        # run the mod from this folder
claude plugin validate .     # check the manifest and the hooks module
claude plugin test .         # run tests/
```

The two thresholds (`SHOW_AFTER_MS`, `TOAST_AFTER_MS`) are constants at the top of
`hooks/register.tsx`.
