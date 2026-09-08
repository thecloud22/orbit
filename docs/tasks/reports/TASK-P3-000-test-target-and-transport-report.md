# TASK-P3-000 — Test target and transport spike (sub-phase 3.0)

**Status:** Complete. Report only; no production code. **Gate A — read and redirect if you disagree.**

**Branch:** `phase-3-task-0-test-target-spike`

## What was asked

`docs/tasks/phase-3-execution-surfaces.md` set three questions: choose an **independent** 3270 test
target the suite can run against forever, evaluate Node TN3270E client libraries against writing the
data-stream parser directly, and decide a transport.

The independence requirement was the point. A hand-rolled fake would validate a 3270 implementation
against its own author's reading of the spec — a closed loop in which a misread of the data stream
leaves fake and executor agreeing with each other and both wrong, with a green suite either way.

## Headline

**Orbit should not write a TN3270E parser at all.** Drive `x3270` as a subprocess, exactly as
`@orbit/executor-playwright` drives Chromium.

That is not a compromise for lack of a library. It dissolves the risk the spike existed to manage:
if Orbit never implements the protocol, there is no implementation of Orbit's that can silently
disagree with the world.

## Findings

### 1. The npm ecosystem cannot carry this

Every candidate on the registry, with last-month download counts:

| Package | Version | Published | Downloads/mo | Assessment |
|---|---|---|---|---|
| `tn3270e_library` | 1.0.1 | 2026-04 | 21 | **Reject.** `repository.url` is literally `github.com/YOUR_USERNAME/node-tn3270e.git` — an unedited scaffold placeholder shipped to the registry |
| `tnz3270-node` | 0.2.0 | 2026-03 | 50 | Typed, real repo, single maintainer, 0.2.0. Too young to depend on |
| `tn3270` | 0.0.12 | 2019 | 82 | Pure-TS emulation, but 0.0.x, unmaintained 7 years, pinned to `rxjs@6`/`chalk@2` |
| `tstermz` | 0.5.0 | 2023 | 7 | EPL-2.0, genuine z/OS-community provenance (TSTerminal/TSTerm). Browser-oriented, 7 downloads/mo |
| `tn3270-server` | 0.1.5 | 2025 | 7523 | A 3270 *server*. Download count is implausible for the category and unexplained; ISC, single maintainer |

Single-maintainer, low-adoption, mostly stale or brand new. Adopting any of them means owning a
protocol implementation with no upstream — which is writing the parser, with extra steps.

### 2. x3270 is the reference implementation and it is alive

`brew install x3270` → **v4.5ga6, built 2026-07-27**, BSD-3-Clause, prebuilt arm64 bottle, 5.5 MB.
Paul Mattes' x3270 has existed since 1993. It ships:

- `s3270` — scripting interface over stdin/stdout
- `b3270` — **a back-end emulator speaking structured JSON**, built for programmatic drivers
- TLS via OpenSSL 3.6.4
- 32 SBCS host code pages and 9 DBCS pages (cp037, cp1047, cp930 Japanese, cp937 Traditional Chinese, …)

Three items on that list — TLS to the LPAR, LU negotiation, EBCDIC code pages — are things the Phase
3 risk register listed as gaps "no test host reproduces faithfully." They are not gaps in x3270.

### 3. The full round trip was verified, both directions

A minimal TN3270 host was written for the experiment (~60 lines of Python: telnet negotiation, then
one hand-built 3270 data stream). **It is a byte emitter, not a 3270 implementation** — s3270 does
all the interpreting, so the experiment tests the author's understanding *against* the reference
rather than against itself.

**Outbound** — `ReadBuffer(Ascii)` returned exact field structure:

```
SF(c0=f8) 4f 52 42 49 54 ...   protected + intensified — "ORBIT TEST HOST"
SF(c0=e0) 55 53 45 52 49 44    protected             — "USERID   ===>"
SF(c0=c0) 20 20 20 20 ...      unprotected           — the userid input field
SF(c0=cc) 20 20 20 20 ...      unprotected NON-DISPLAY — the password field
```

Status line `U F U C(127.0.0.1) I 2 24 80 3 18 0x0` gave connection state, 24x80 geometry, and the
cursor at row 3 col 18 — exactly where the Insert Cursor order placed it.

**Inbound** — `String("HERC01")`, `Tab()`, `String("SECRET99")`, `Enter()` produced a correct 3270
inbound data stream. Decoded at the host:

```
INBOUND aid=0x7d (Enter)
   field @ row 3 col 18 = 'HERC01  '
   field @ row 5 col 18 = 'SECRET99'
```

**`b3270 -json`** produced structured events rather than text to scrape: `screen` updates carrying
`cursor` and `rows[].changes[]` with `column`/`text`/`gr`/`count` run-length deltas; `oia` events
reporting keyboard-lock state (`lock: field`, `lock: not-connected`); and `run-result` per action
with `{success, time, text[]}`.

`oia` matters more than it looks: it is the protocol's own "input inhibited" signal, which is how the
executor will know a screen has settled — the green-screen equivalent of waiting for a page load,
available as a fact rather than a timeout heuristic.

### 4. A finding that improves secret handling

On 3270, non-display is a **field attribute** (`SF(c0=cc)`, and a graphic-rendition in b3270's JSON),
not a heuristic. The recorder can identify a password field structurally from the protocol.

That is strictly better than the browser surface, where `decisions.md:791` records the standing
accepted risk that "secrets are not detected, only password fields are." The terminal recorder should
drive redaction off the non-display attribute directly, and sub-phase 3.7 should state it as a
protocol-derived guarantee rather than a heuristic.

Note the converse, which is inherent to 3270 and must be handled: a non-display field still
**transmits in clear** in the inbound stream (`SECRET99` above). Evidence capture must redact from
the field attribute; the wire does not do it.

### 5. Hercules is viable for the heavy layer

`brew install hercules` → **4.9.1-SDL, built 2025-12-07**, native arm64, 12.8 MB. The TK5 turnkey
MVS 3.8j distribution is reachable (HTTP 200), and pre-built Docker images exist
(`rattydave/docker-ubuntu-hercules-mvs`, `fjankowski77/hercules-mvs-tk5`).

**Not verified:** MVS was not booted. That needs a ~1 GB download and a multi-minute IPL, which is
disproportionate to the question the spike had to answer. What is verified is that the emulator runs
on this architecture and the distribution is obtainable.

## Recommendation

### Transport: drive x3270, do not implement the protocol

A new `@orbit/executor-x3270` spawns `b3270 -json` per session and speaks its JSON protocol. This is
**the same architectural shape as the browser surface**, which already depends on an external engine
binary driven as a subprocess. ADR-008 put Playwright behind an executor boundary precisely so the
runtime depends on the interface rather than the engine; this reuses that decision rather than
inventing anything.

Consequences to accept openly:

- An external binary dependency, installed and version-pinned like Playwright's browsers.
- Process lifecycle management per session — which `BrowserExecutorFactory.open()` already models.
- x3270's BSD-3-Clause license is permissive; **Hercules is QPL-1.0**, which is acceptable because
  it is a test fixture that is run, never linked or distributed with Orbit. Worth a line in the ADR.

### Test target: three layers, only the top one is heavy

| Layer | Target | Purpose | Speed |
|---|---|---|---|
| L1 unit | Golden captured data streams replayed as bytes | Screen model, addressing, fingerprint (3.5) | Instant, offline |
| L2 integration | The byte-emitter host from this spike + `b3270` | Orbit's `Screen` model agrees with the reference decoder | ~1s, offline |
| L3 end-to-end | Hercules + TK5 (Docker, pinned) | Real MVS screens; regenerates L1 captures | Minutes, on demand |

L1 and L2 run in CI on every commit; **the suite never needs a mainframe**. L3 runs on demand and
nightly, and is the only layer that can produce new golden captures — so the fixtures the fast tests
rely on always originate from a real MVS, never from someone's idea of one.

## What this changes in the Phase 3 plan

- **3.6 is smaller and much less risky.** It becomes a subprocess driver and a JSON protocol client,
  not a data-stream parser and EBCDIC implementation. The plan's "expect to write more of the parser
  than you'd like" no longer applies.
- **3.5 is unchanged.** The `Screen` model, closed addressing vocabulary and fingerprint were
  specified independently of transport, which is what let this spike change the transport without
  invalidating anything.
- **3.6 needs its own ADR** for the external-binary dependency and the layered test strategy.
- **3.7 gains a protocol-derived redaction rule** (finding 4).
- The Phase 3 risk *"protocol correctness rests on the independence of 3.0's peer"* is largely
  retired. The residual risk is narrower: Orbit's mapping from b3270 output to the `Screen` model,
  which is exactly what L2 tests.

## What was not verified

- MVS was never booted; L3 is designed, not proven.
- No TN3270**E** session (LU binding, structured fields) was exercised — the fake host negotiates
  base TN3270 only. TK5 will exercise it at L3.
- No TLS session, and no DBCS code page.
- `b3270`'s JSON schema was observed empirically from one session, not read from its documentation.

## Open question for Gate A

None blocking. One worth a sentence if you disagree: this trades *implementing a protocol* for
*depending on a binary*. The precedent is Playwright, and the alternative is owning an unmaintained
TN3270E implementation with no upstream — but it is your call, and reversing it later means writing
the parser after all.

## Reproducing

```
brew install x3270 hercules
python3 docs/tasks/reports/task-p3-000-fakehost.py &   # the byte-emitter host
printf 'Ascii()\nReadBuffer(Ascii)\nQuit()\n' | s3270 -model 3279-2 127.0.0.1:3271
```
