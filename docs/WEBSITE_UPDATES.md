# Pending website updates

Running list of changes mqttviewer.app needs. Every feature spec must
add an entry here when the feature merges (see the "Website" section in
each spec). Clear entries once the site is updated.

Format: date merged, feature, what the site needs (page, section, copy
angle). Keep copy angles factual; final wording follows
docs/WRITING_STYLE.md.

## Pending

- Stateful Sparkplug B decode (fill in merge date when the PR lands).
  Add to features list; dedicated Sparkplug use-case page; screenshot
  or short clip of the Sparkplug view. Copy angle (verified against
  desktop competitors 2026-07-17, re-verify briefly before
  publishing): connect and watch, aliases resolved to real metric
  names, sequence gaps and rebirth storms flagged, live group to
  metric tree, without becoming a host application or disturbing the
  primary SCADA. Benefit phrase: "see the metric names, not the
  aliases".

## Done

- 2026-09-04. Feature pages for everything on develop after 1.0.0, plus
  broker status v2 (#125), written and screenshotted in the website PR
  "Feature pages and style pass". README feature table refreshed in the
  same pass, and the install section now covers Flatpak, Nix and Windows
  ARM64.
- 2026-07-16. Broker status window ($SYS metrics) merged (#118). Covered
  by the broker status feature page and the README table above.
- The "free, open-source" mislabelling issue resolved itself: the licence
  is GPL-3.0 since 0.7.0, so the description is now correct.
