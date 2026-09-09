# Open questions

Things noticed in passing, verified enough to be worth writing down, and deliberately
not fixed at the time. Each says what was observed, what is actually going on, and what
a fix would have to decide. Delete an entry when it is closed.

---

## A workflow reads as "Draft" while it is live

**Observed.** `Underwrite a mortgage file (rules only)` shows `Revision 2 · Draft` in
Studio and `Live · 0.1.0` beside it, at the same time. In the Documents list it read as
plain "Draft" until publication was added to that view.

**What is actually true.** Both, and they describe different objects:

| | |
|---|---|
| `sopdoc_01M23N6ZKGHCQPYYCC2MPA0JZK` rev 1 | `superseded` — compiled and published as version 0.1.0 |
| rev 2 | `draft`, parent rev 1, provenance `edited` |
| current candidate | points at **rev 1**, state `approved` |

A document's status is derived from its newest non-superseded revision. Publication is a
fact about a *version*, compiled from a revision that may be several revisions back. So
"the revision I am looking at is a draft" and "something compiled from an older revision
is running" are both true, and a document that has been revised since publishing will
always show them together (ADR-036 makes this the normal case rather than an edge one).

**So it is not a bug.** It is a vocabulary problem: "Draft" is scoped to the revision and
reads as though it were scoped to the workflow. The review page already says this well
("Running as version 0.1.0 · Revision 2 has not been published"). The list and the
compact header say it badly, by putting two words side by side with nothing explaining
that they are about different things.

**What a fix has to decide:** whether the status chip is about the *revision* (then it
needs a label saying so) or about the *workflow* (then a live-and-revised document reads
as "Live, with unpublished changes" and the revision's own state moves elsewhere). Worth
settling before more surfaces render this pair.

---

## A revision records that it was edited, but not by whom or why

**Noticed while investigating the above.** Revision 2 of that document carries
`provenance: {"kind": "edited"}` — no note, no actor, no timestamp beyond the row's own
`createdAt`. Something edited a published workflow at 18:02:24 and the record cannot say
what or why.

`supersedeWith` (`revision-service.ts`) accepts an optional `note` and every edit route
threads one through, so the field exists and is simply empty when a caller omits it. The
step editor asks "What you changed, and why" and sends it; other paths — declaring an
input, reordering, a rule accepted from a draft — do not always.

**Why it matters here more than elsewhere.** This codebase is otherwise careful that
provenance stays answerable: `sourceText` has no update path so "what did the user
originally write?" survives, and generated revisions record model, provider and prompt
version. An `edited` revision is the one kind that loses its own history, and it is the
kind a reviewer is most likely to ask about.

**What a fix has to decide:** whether `note` becomes required for an edit (and what the
non-interactive callers write), and whether provenance should carry an actor at all
before there is authentication to name one.
