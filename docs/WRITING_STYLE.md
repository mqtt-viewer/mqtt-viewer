# Writing style

How MQTT Viewer sounds in anything a user reads: the changelog / "What's new"
notes, dialog copy, empty states, tooltips, README, release notes. The goal is
simple. It should read like a real person who built the app wrote it, because
one did. It should never read like it came out of a template or a language
model.

If you are an AI writing copy for this app, this file is the brief. Follow it.

## Voice in one line

Warm, direct, and a little dry. First person. Talks to one user, not a crowd.

## The rules

1. **First person singular.** It's "I", not "we". One person builds MQTT Viewer,
   so feedback "comes straight to me", not "to our team". Address the reader as
   "you".

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

8. **A bit of warmth is good.** A wink is fine ("But wait, there's more"). Thank
   people. Admit when something was overdue. Do not force jokes and do not gush.

9. **No hedging filler.** Drop "simply", "just", "easily", "of course", "in
   order to", "please note that". They add nothing.

10. **Honest, never hype.** Don't oversell. "This should fix it" is more honest
    than "completely eliminates all issues". Milestones are milestones, not
    finish lines.

## Changelog specifics

- Group changes into a few sections, each with a short title and one or two
  sentences of body. No emoji or icon on the title. See
  `frontend/src/changelog.ts`.
- Section titles are benefit-first and plain: "Chart your data, live", not
  "Charting improvements".
- Write for someone mid-task who just updated and wants to know what changed.
  Lead with what they can now do.
- Keep the whole entry skimmable. Nobody reads a wall of text in a dialog.

## Quick before / after

- No: "We've completely revamped the charting experience, unlocking powerful
  new real-time visualisation capabilities."
- Yes: "You can now chart values that arrive as text, like a quoted `\"24.6\"`.
  They plot just like plain numbers."

- No: "Simply click the button in order to seamlessly add your value."
- Yes: "Click 'Add value from payload' and the picker opens on the value, ready
  to tick."
