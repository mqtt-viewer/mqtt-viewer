# Writing style

How MQTT Viewer sounds in anything a person reads: the changelog / "What's new"
notes, dialog copy, empty states, tooltips, README, release notes, the
website, and pull request descriptions and comments. The goal is simple. It should read like a real person who built the
app wrote it, because one did. It should never read like it came out of a
template or a language model.

If you are an AI writing copy for this app, this file is the brief. Follow it.

## Two voices, one set of rules

There are two registers. Everything below rule 1 applies to both.

- **Personal.** The changelog, release notes, dialog copy, the README, and
  anything else written as a note from the maintainer. First person singular.
- **Product.** The website (mqttviewer.app) and any page whose job is to
  explain what the app does to someone who has not installed it yet.
  Impersonal, practical, matter-of-fact engineering copy. It describes the
  tool and tells the reader what to do. It does not say "I" or "we".

## Voice in one line

Personal: warm, direct, and a little dry. Talks to one user, not a crowd.

Product: plain engineering English. Says what the thing does, how, and what
it costs, then stops.

## The rules

1. **Person.** In the personal register it's "I", not "we". One person builds
   MQTT Viewer, so feedback "comes straight to me", not "to our team". Address
   the reader as "you". In the product register there is no narrator: write
   about the app ("MQTT Viewer keeps a live tree of every topic") or to the
   reader ("Right-click a topic to copy its path"). Never "we", "our" or "us",
   and no "I" either.

2. **British spelling.** visualise, colour, behaviour, favourite, licence (noun),
   customise, catalogue. Match the rest of the app.

3. **No em dashes. None.** This is the fastest tell that a machine wrote it, and
   it is a hard rule here. Where you reach for one, use a full stop, a comma, a
   colon, or brackets instead. "It's fast, and it stays fast." not "It's
   fast [em dash] and it stays fast." This applies to en dashes used as
   connectors too; a hyphen inside a compound word (built-in, opt-in, pop-out)
   is fine.

4. **No emojis. None.** Standing rule. No emoji in the changelog, dialog copy,
   UI text, or docs. Let the words carry it. If you need to separate or lead
   items, use a heading, a title, or plain punctuation, never a picture.

5. **Concise.** Short sentences. Cut the throat-clearing. Say the thing, then
   stop. If a sentence still works with a word removed, remove it.

6. **Plain words over corporate ones.** No "seamless", "leverage", "elevate",
   "unleash", "robust", "powerful", "revolutionary", "delve", "supercharge",
   "unlock", "empower". Say what it does in the words you'd use out loud.

7. **Concrete, not abstract.** "Tick a numeric field and watch it plot" beats
   "enables real-time data visualisation". Name the button, the payload, the
   actual thing on screen.

8. **A bit of warmth is good, in the personal register.** A wink is fine ("But
   wait, there's more"). Thank people. Admit when something was overdue. Do not
   force jokes and do not gush. Product copy skips the winks: it earns trust by
   being specific, not by being friendly.

9. **No hedging filler.** Drop "simply", "just", "easily", "of course", "in
   order to", "please note that". They add nothing.

10. **Honest, never hype.** Don't oversell. "This should fix it" is more honest
    than "completely eliminates all issues". Milestones are milestones, not
    finish lines.

11. **Kill the other AI tells too.** The em dash is only the most famous one.
    Also banned: "it's not just X, it's Y", tidy lists of three, "Whether
    you're a hobbyist or a professional...", rhetorical questions answered in
    the next sentence, exclamation marks, and titles with a colon ("Charting:
    reimagined"). If a sentence has the rhythm of a keynote, rewrite it flat.

## Website specifics

- Product register throughout. Third person about the app, imperative to the
  reader.
- Every claim must be true of the shipped app today. No roadmap, no "coming
  soon", no version numbers in feature copy (they rot).
- Lead with what the reader can do, then how it works, then the limits.
  Naming a limit ("the retained index only knows what this client has seen")
  reads as competence, not weakness.
- Facts that search engines and answer engines quote (the tagline, meta
  descriptions, FAQ answers, JSON-LD) stay short, literal and self-contained.
  An FAQ answer should make sense lifted out of the page on its own, and
  should not open with "Yes." or "No.".
- Screenshots carry alt text that says what is on screen, in the same voice.

## Changelog specifics

- Dev-changelog terse. Each section is a short title and ONE sentence of body,
  two at most for a big feature. State the change; no scene-setting, no
  explaining why it matters, no example unless the change is unintelligible
  without one. See `frontend/src/changelog.ts`.
- Section titles are benefit-first and plain: "Chart your data, live", not
  "Charting improvements". No emoji or icon on the title.
- Write for someone mid-task who just updated and wants to know what changed.
- Keep the whole entry skimmable. Nobody reads a wall of text in a dialog.

## Pull requests and comments

PR descriptions, PR comments, review comments and issue replies are read by
people, in public. Write them the way you would tell someone across the desk.

- Two or three plain sentences: what changed and why, and the issue it
  answers if there is one. Then stop.
- No headings, no bullet lists, no checklists, no "Summary" or "Test plan"
  sections. If it needs a heading it is too long.
- Nothing about who or what wrote it. No "Generated with", "Written by" or
  "Co-authored" line for a tool, no session links, no tool name.
- Leave out the working. Review findings, test logs and how the change was
  verified belong in the conversation with the maintainer, not in the PR.
  Mention a risk or a thing left undone only if the reader has to act on it.
- A comment answers the person in a sentence or two. Thank them if they
  reported or fixed something; do not restate what they said.
- The other rules still apply: no em dashes, no emojis, British spelling.

This is the length and tone to copy:

> Pinned branches now expand in place in the pinned block (resizable,
> searchable) so you can keep a whole subtree in view, as asked for in #153.
> Also fixes the tree going blank after a collapse and topics named like
> toString, plus some dev tooling.

## Quick before / after

- No: "We've completely revamped the charting experience, unlocking powerful
  new real-time visualisation capabilities."
- Yes: "Quoted numbers like `"24.6"` and bare numeric payloads can now be
  charted."

- No: "Simply click the button in order to seamlessly add your value."
- Yes: "'Add value from payload' now opens the picker straight on the value."
