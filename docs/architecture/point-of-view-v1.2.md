# Automating decisions you will later have to defend

**v1.2 · for executives and technology leaders.**

> **Which version do you want?**
> [v1.2](./point-of-view-v1.2.md) — executives and technology leaders, plain language, 5 min ·
> [v1.1](./point-of-view.md) — architects, the summary argument ·
> [v1.0](./point-of-view-v1.0.md) — the full technical evidence, every claim traced to a file

---

## The situation

You are automating work that used to be done by people who could explain themselves.

An underwriter who declined a mortgage could tell you why. A claims adjuster could point at the
policy clause. When a regulator, an auditor, or a customer's lawyer asked about one specific case,
someone could open the file and answer.

Automation removes the person. The question does not go away.

---

## The moment that matters

It is eight months from now. Someone asks why loan ML-26-04547 was declined.

Here is what each kind of system can say.

**Traditional RPA (UiPath and similar).** *"The bot ran fourteen steps and clicked Decline."* It can
show you the steps. It cannot tell you why, because it has no idea a decision was made — the rule
and the mouse click are the same thing to it. Your answer to the regulator is a screen recording.

**An AI agent that reads screenshots.** *"The system looked at the page and concluded the credit
score was below the threshold."* That sounds better, and it is — until the follow-up questions:

- *How do we know it read the screen correctly?* You are trusting the AI's account of its own
  reasoning. There is no independent way to check it.
- *Would it decide the same way today?* Possibly not. These systems can reach different conclusions
  on the same input.
- *Is this one of the cases it got wrong?* The vendor will tell you the system is 98% accurate.
  That is a statement about ten thousand loans. It says nothing about this one.
- *Is the software that decided this still the same?* Almost certainly not. The AI model underneath
  has been updated at least twice since. The thing that made the decision no longer exists.

**Orbit.** *"The credit score was 596. The policy floor is 620. 596 is below 620, so the file was
declined — before debt-to-income or loan-to-value were even looked at, because a file below the
floor does not get that far."*

Then, if they push:

- Here is the screenshot of the screen it read.
- Here is the exact rule, in the words your credit policy team wrote and approved.
- Here is the version of the workflow that made this decision. It was published in March and has
  not changed since — it cannot change, by design.
- Run it again right now. You will get the same answer.

Anyone in the room can check the arithmetic themselves. That is the difference.

---

## What we actually built

Two things a spreadsheet cannot do and an AI agent will not do.

**The rule is separate from the screen.** Your policy says "decline below 620." That rule is stored
as a business statement your team approved. Which box on which page holds the credit score is stored
separately. When the vendor redesigns their portal, you fix the pointer — you do not rewrite or
re-approve the policy.

**The system stops instead of guessing.** If the credit score field is missing or shows something
that is not a number, the run halts and tells you. It does not pick a side and carry on. Most
automation is built to keep going; ours is built to stop, because a wrong decision costs more than a
stopped one in this kind of work.

---

## Where AI is used, and where it is not

We are not against AI. We are against AI deciding things a number already settles.

A typical mortgage file goes through five checks in our system:

| Check | How it is decided | Cost |
|---|---|---|
| Credit score below 620? | Compare two numbers | Free, instant, identical every time |
| Debt-to-income over 43%? | Compare two numbers | Free, instant, identical every time |
| Loan-to-value over 80%? | Compare two numbers | Free, instant, identical every time |
| Property in a flood zone? | Compare two values | Free, instant, identical every time |
| *Does this borrower's income need two years of tax returns?* | **AI reads the analyst's note** | Paid, and worth it |

That last one is a paragraph an analyst wrote about a landscaping business with seasonal cash flow.
No threshold settles it. It needs judgment, so we use AI — restricted to choosing among the options
your policy team already defined. It cannot invent a new outcome.

Four free answers, one paid one, and the paid one is the only question that genuinely needed
judgment. A system that sends every screen to an AI pays for judgment it did not need, and gives up
repeatability to get it.

---

## What this costs you

Be clear-eyed about this.

**Setting up a workflow is real work.** Someone demonstrates the process once, a reviewer checks it,
and it gets published. Hours, not minutes. That effort only pays back on work you run often — hundreds
or thousands of times. **For an occasional or one-off process, do not buy this.** An AI agent will
serve you better and cost less.

**We break when a vendor redesigns their screens.** We stop and tell you exactly what changed and
what we think it became, and a person approves the fix. An AI agent often carries on without
noticing. Whether that is better or worse depends entirely on whether you would rather find out.

**It reads today; it does not yet write.** The system opens files, reads values, applies your rules,
and records decisions. It does not yet submit or update records in your systems. That is the next
step of work, not something available now.

**It is not yet secured for production.** There is no login, no separation between teams, and the
guarantee that a published workflow cannot be altered is enforced in our application rather than in
the database itself. That has to close before this handles regulated work. We would rather tell you
now than have you discover it in a security review.

---

## When to choose what

| Choose | When |
|---|---|
| **An AI browser agent** | The work varies, happens occasionally, and nobody will be asked to justify the result |
| **Traditional RPA** | High volume, very stable screens, low stakes, and you already own the licences |
| **Orbit** | Someone with authority will eventually ask why a specific decision was made — and you need to answer with more than "the system is usually right" |

Underwriting, claims, eligibility, KYC, benefits adjudication, anything examined. If your automation
never gets audited, we are more discipline than you need.

---

## How to test this in one day

Do not take our word for it. Two tests you can run against us and any competitor:

**1. The consistency test.** Take one file. Run it twenty times through each system. Count how many
times each one reaches the identical decision, with the identical explanation. We will be twenty for
twenty. Any variance at all in another system is the finding — because the same file decided two
different ways is the thing you cannot defend to a regulator.

**2. The audit test.** Pick one completed run from three months ago. Ask each vendor to show, from
their records, why that decision was made — and whether the software that made it still exists in
the same form. Watch how long the answer takes.

Those two questions separate these approaches faster than any architecture discussion.

---

## The short version

Automating a task and automating a *decision* are different problems. The first is about getting
work done. The second is about being able to explain, months later, why a specific answer was given
— and to show it would be given again.

Most automation tools solve the first and hope the second never comes up. We built for the second,
and accepted real limitations to get there.

If nobody ever asks you to justify an automated decision, we are the wrong choice. If someone will,
that question is worth designing for before it is asked rather than after.
