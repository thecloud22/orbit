# TASK-P3-006 — Terminal executor and steps (sub-phase 3.6)

**Status:** Complete. Non-blocking.

**Branch:** `phase-3-task-6-terminal-executor`.

## What exists now

Orbit can execute a green-screen workflow end to end against a real emulator. Five step types, a
permission section, a host allowlist, an executor, and screen-text evidence.

**Orbit does not implement the 3270 protocol.** `@orbit/executor-x3270` drives `b3270` — the JSON
back end of Paul Mattes' x3270 — as a subprocess, the same relationship `@orbit/executor-playwright`
has with Chromium, authorised by the same ADR-008 boundary. TASK-P3-000 established why: reimplementing
it would mean owning a protocol whose correctness nothing could check.

## Step types

| Step | Does |
|---|---|
| `terminal.connect` | Opens a session against a host in `permissions.terminal.allowedHosts` |
| `terminal.type` | Types into a field. **Does not transmit** |
| `terminal.press` | Sends an AID key. **This is where something happens** |
| `terminal.read` | Reads named fields into declared variables |
| `terminal.expect_screen` | Asserts the host is showing the expected screen |

The type/press split is the protocol's, not an invention: a 3270 keyboard fills a local buffer and
nothing reaches the host until an AID key is sent. That makes `terminal.type` structurally safe in a
way `browser.fill` is not, and concentrates every consequence in one step type.

`AidKey` is a closed enum of 29 values, not a string. Which key is pressed is the most consequential
single value in a terminal workflow — `PF3` backs out where `Enter` commits — and a free-text key
name would put that behind a typo.

## The design decision that shapes the executor

**The executor reports the screen; the runtime decides what it means.** There is no
`typeIntoFieldAfterLabel`. `TerminalExecutor.screen()` hands back a `Screen`, the runtime resolves the
step's closed `ScreenAddress` against it, and only then says where to type. Nothing on the interface
takes a `ScreenAddress`, so there is no way to ask the executor to find anything.

Address resolution is workflow semantics, so it lives where drift checking lives — exactly the
reasoning that made `describeElement` read-only in ADR-018.

## Containment

- **`permissions.terminal.allowedHosts`**, exact-match, checked at publish (`HOST_NOT_PERMITTED`) and
  again by `assertTerminalHost` before the socket opens. The same two-gate shape ADR-022 gave
  navigation, and a mainframe LPAR is a more consequential thing to reach by accident than a page.
- **New error codes** rather than reused ones: `TERMINAL_TIMEOUT`, `TERMINAL_CONNECT_FAILED`,
  `FIELD_NOT_FOUND`, `UNEXPECTED_SCREEN`. `BROWSER_TIMEOUT` and `LOCATOR_NOT_FOUND` keep their names
  forever because `errorCode` sits inside published immutable versions.
- **The emulator's own error text is never persisted** on a failed connect — it can carry host banner
  content. The Orbit-declared host is reported instead.

## Evidence, and a redaction Orbit has not had before

The terminal's run-scoped evidence is the screen as **text** — diffable, greppable, small. Better
evidence than a screenshot rather than a poorer substitute.

Non-display fields are masked from **the field attribute**, not from a guess about the label. The host
declares that a field is not to be displayed; that is how password fields are marked. This is
strictly better than the browser recorder's standing limitation (`decisions.md:791`: only password
*inputs* are detected). A non-display field still transmits in clear, so the masking is Orbit's job —
the wire does not do it.

`terminal.type` also withholds `valueLength` for a non-display field, not only for a credential
reference: the attribute says the value is a secret whatever its source.

## Verification

| Check | Result |
|---|---|
| `tsc --noEmit` per package (21) | clean |
| `eslint .` / `prettier --check .` | clean |
| `vitest run` | **1441 passed** (135 files), up from 1437 |
| `test:db` | **331 passed** |

### Tested against the real emulator, not a double

Two cases drive actual `b3270` against the byte-emitter host from TASK-P3-000 — the harness that
encodes one data stream and interprets nothing. That asymmetry is the point: if both sides were
Orbit's code, a misreading of the data stream would leave them agreeing with each other and both
wrong, green either way. Here the decoding is x3270's.

They assert that a caption and its input parse as separate fields, that the input is unprotected,
that **the password field reports `nonDisplay` from the host**, and that a typed secret does not
appear in the evidence. `describe.skipIf` skips them where `b3270` is absent rather than failing.

The fake host was changed to serve repeatedly rather than once — a host accepting one connection made
the second test look like a protocol failure.

**One flake observed and not reproduced.** A single full-suite run showed `drift.test.ts` failing
while the suite was being edited mid-run; three consecutive clean runs since. Recorded rather than
dismissed, in case it recurs.

## Database change

Migration `0011` widens the `run_events` CHECK constraint for the four `terminal.*` event types.
Purely additive — no existing row is invalidated. Two guards caught the omission before it shipped:
`@orbit/db`'s duplicated vocabulary test and the contracts count assertion, both of which exist so
that adding an event type is a deliberate edit in every place that knows about them.

## Known limitations

- **No authoring.** Nothing records a terminal workflow, so an Agent IR must be hand-written. That is
  3.7. `named_field` addressing consequently still resolves nothing.
- **No terminal evidence in Watchtower.** The artifact is stored and labelled; rendering a screen and
  the one-timeline-across-surfaces view is 3.8.
- **Base TN3270 only.** No TN3270E LU binding, no TLS, no DBCS. `x3270` supports all three; Orbit does
  not configure them yet.
- **No unsolicited-screen handling**, no session pooling, no model pinning in the binding. These are
  the named-but-unscheduled hardening task, and they cannot honestly be built without a real system.
- `terminal.read` trims field text. A fixed-width field whose trailing spaces are significant would
  lose them.
