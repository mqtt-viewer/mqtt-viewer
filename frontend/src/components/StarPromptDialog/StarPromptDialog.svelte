<script lang="ts" context="module">
  import { writable } from "svelte/store";

  // Exported so the prompt can be opened or inspected from elsewhere if needed.
  export const starPromptOpen = writable(false);
</script>

<script lang="ts">
  import Dialog from "@/components/Dialog/Dialog.svelte";
  import Button from "@/components/Button/Button.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import { openExternal } from "@/util/external";
  import {
    whatsNewResolved,
    whatsNewOpen,
  } from "@/components/WhatsNewDialog/WhatsNewDialog.svelte";
  import {
    updatePromptResolved,
    updateDialogShown,
  } from "@/components/UpdateDialog/UpdateDialog.svelte";
  import {
    GetAppSettings,
    AcknowledgeStarPrompt,
  } from "bindings/mqtt-viewer/backend/app/app";

  const STARGAZERS_URL = "https://github.com/mqtt-viewer/mqtt-viewer";

  // Only nudge once the app has clearly been used a few times, so a fresh
  // install never sees this on first run.
  const MIN_LAUNCHES = 3;

  /* Night sky ------------------------------------------------------------- */

  // mulberry32, a tiny seeded PRNG. The seed is fixed, so the scatter looks
  // random but is identical on every render and in story snapshots.
  const seeded = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rand = seeded(0x5ea1f00d);
  const between = (min: number, max: number) => min + rand() * (max - min);
  const r = (value: number, places = 2) => Number(value.toFixed(places));

  // Where the copy stops and the button column starts, as a percentage of the
  // panel width.
  const TEXT_EDGE = 58;

  type Twinkle = {
    left: number;
    top: number;
    size: number;
    delay: number;
    duration: number;
    max: number;
  };

  // Forty twinkles over the whole panel, about two thirds of them right of the
  // copy. Candidates landing within 3 units of an existing star are redrawn so
  // nothing clumps. The ones behind the copy stay small and faint rather than
  // being skipped, so the left side is still sky without fighting the text.
  const twinkles: Twinkle[] = [];
  for (let attempt = 0; attempt < 600 && twinkles.length < 40; attempt++) {
    const onRight = rand() < 0.66;
    const left = onRight ? between(TEXT_EDGE, 97) : between(3, TEXT_EDGE - 2);
    const top = between(4, 94);
    if (twinkles.some((t) => Math.hypot(t.left - left, t.top - top) < 3)) {
      continue;
    }
    const behindCopy = !onRight && top > 12 && top < 92;
    twinkles.push({
      left: r(left),
      top: r(top),
      size: r(behindCopy ? between(0.9, 1.5) : between(1, 2.4)),
      delay: r(between(0, 4.2)),
      duration: r(between(2.4, 5.6)),
      max: r(behindCopy ? between(0.16, 0.3) : between(0.3, 0.6)),
    });
  }

  type Streak = {
    x: number;
    y: number;
    angle: number;
    len: number;
    dist: number;
    dur: number;
    delay: number;
  };

  // Every streak falls at the same angle, so the sky reads as one shower
  // rather than a scribble. Only where they start and how long, far and fast
  // they run varies.
  const STREAK_ANGLE = 32;

  // Each streak is a brief flash: --dur is how long it is on screen, and the
  // animation runs on a cycle sixteen times that, so seven of them work out at
  // one streak every two seconds or so with real gaps in between.
  const CYCLE = 16;

  // Five over the right of the panel, around and behind the button.
  const skyStreaks: Streak[] = Array.from({ length: 5 }, () => ({
    x: r(between(38, 86)),
    y: r(between(-6, 26)),
    angle: STREAK_ANGLE,
    len: r(between(34, 66)),
    dist: r(between(60, 120)),
    dur: r(between(0.6, 1)),
    delay: r(between(0, 12)),
  }));

  // Two more skim the strip above the title. The strip clips and fades them,
  // so neither can ever run through the copy.
  const topStreaks: Streak[] = Array.from({ length: 2 }, () => ({
    x: r(between(2, 30)),
    y: r(between(4, 40)),
    angle: STREAK_ANGLE,
    len: r(between(30, 54)),
    dist: r(between(50, 95)),
    dur: r(between(0.7, 1)),
    delay: r(between(0, 12)),
  }));

  const streakStyle = (s: Streak) =>
    `--x:${s.x}%; --y:${s.y}%; --angle:${s.angle}deg; --len:${s.len}px; ` +
    `--dist:${s.dist}px; --dur:${s.dur}s; --delay:${s.delay}s;`;

  /* State ----------------------------------------------------------------- */

  let checked = false;
  let acknowledged = false;
  let wasOpen = false;

  // Decide once, and only after the "What's new" and update dialogs have had
  // their say. If one is showing this launch, hold off rather than stack two
  // prompts. Likewise, an update prompt shown this launch means the nudge
  // waits for a later launch. The seen flag stays unset either way, so it
  // just waits.
  $: if (!checked && $whatsNewResolved && $updatePromptResolved) {
    checked = true;
    if (!$whatsNewOpen && !$updateDialogShown) {
      (async () => {
        try {
          const settings = await GetAppSettings();
          if (
            !settings.hasSeenStarPrompt &&
            settings.launchCount >= MIN_LAUNCHES
          ) {
            starPromptOpen.set(true);
          }
        } catch (e) {
          console.error("Failed to check star prompt state", e);
        }
      })();
    }
  }

  // Acknowledge on any close (button, the X, Escape, overlay click) so it never
  // shows again, whether the user starred or dismissed it.
  $: {
    if ($starPromptOpen) {
      wasOpen = true;
    } else if (wasOpen) {
      wasOpen = false;
      acknowledge();
    }
  }

  const acknowledge = async () => {
    if (acknowledged) return;
    acknowledged = true;
    try {
      await AcknowledgeStarPrompt();
    } catch (e) {
      console.error("Failed to acknowledge star prompt", e);
    }
  };

  const onStar = () => {
    openExternal(STARGAZERS_URL);
    starPromptOpen.set(false);
  };

  const onLater = () => {
    starPromptOpen.set(false);
  };
</script>

<!-- openFocus lands initial focus on the dialog panel itself (melt gives it
     tabindex="-1") so no focus ring shows on open; Tab still reaches the
     close button and actions as normal. -->
<Dialog
  isOpen={starPromptOpen}
  startEmpty
  ariaLabel="Like the app?"
  openFocus="[data-melt-dialog-content]"
>
  <div class="star-prompt">
    <!-- Night sky: faint twinkling stars scattered across the panel. -->
    <div class="twinkles" aria-hidden="true">
      {#each twinkles as t}
        <span
          style="left:{t.left}%; top:{t.top}%; width:{t.size}px; height:{t.size}px; --max:{t.max}; animation-delay:{t.delay}s; animation-duration:{t.duration}s;"
        ></span>
      {/each}
    </div>

    <!-- Shooting stars, mostly crossing the right of the panel. -->
    <div class="streaks" aria-hidden="true">
      {#each skyStreaks as s}
        <span class="streak" style={streakStyle(s)}>
          <span class="streak-body"></span>
        </span>
      {/each}
    </div>

    <!-- And a couple in the strip above the title. -->
    <div class="streaks streaks-top" aria-hidden="true">
      {#each topStreaks as s}
        <span class="streak" style={streakStyle(s)}>
          <span class="streak-body"></span>
        </span>
      {/each}
    </div>

    <button type="button" class="close" aria-label="close" on:click={onLater}>
      <Icon type="close" size={16} />
    </button>

    <div class="content">
      <div class="text">
        <h2 class="title">Like the app?</h2>
        <p class="copy">
          Starring the project on GitHub is an easy way to help out.
        </p>
        <p class="copy">Thanks for using MQTT Viewer.</p>
      </div>

      <div class="action">
        <Button
          variant="primary"
          iconType="github"
          iconSize={18}
          class="star-button !bg-white/10 !border-white/25 !text-white enabled:hover:!bg-white/20 enabled:hover:!text-white backdrop-blur-sm"
          on:click={onStar}
        >
          Star on GitHub
        </Button>
        <!-- Zero height, so "Maybe later" hangs under the button without
             pulling the button itself off centre. -->
        <div class="later-slot">
          <Button variant="text" class="later-button" on:click={onLater}
            >Maybe later</Button
          >
        </div>
      </div>
    </div>
  </div>
</Dialog>

<style>
  .star-prompt {
    position: relative;
    width: 460px;
    max-width: 100%;
    overflow: hidden;
    border-radius: inherit;
    /* Deep night sky, dimmed down so it sits behind the copy rather than
       competing with it, then graded across: darkest under the text on the
       left, lifting toward the button on the right. */
    background: linear-gradient(
        90deg,
        rgba(6, 7, 20, 0.58) 0%,
        rgba(6, 7, 20, 0.36) 38%,
        rgba(6, 7, 20, 0.06) 74%,
        rgba(120, 140, 235, 0.07) 100%
      ),
      radial-gradient(
        125% 130% at 84% 16%,
        #1e2148 0%,
        #14163a 46%,
        #090a1e 100%
      );
    isolation: isolate;
  }

  /* Twinkling field ------------------------------------------------------- */
  .twinkles {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .twinkles span {
    position: absolute;
    border-radius: 999px;
    background: #ffffff;
    box-shadow: 0 0 3px rgba(255, 255, 255, 0.65);
    animation-name: twinkle;
    animation-iteration-count: infinite;
    animation-timing-function: ease-in-out;
  }
  @keyframes twinkle {
    0%,
    100% {
      opacity: calc(var(--max) * 0.25);
      transform: scale(0.7);
    }
    50% {
      opacity: var(--max);
      transform: scale(1);
    }
  }

  /* Shooting stars -------------------------------------------------------- */
  .streaks {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    /* Anything drifting toward the copy fades out before it gets there. */
    -webkit-mask-image: linear-gradient(
      to right,
      transparent 0%,
      rgba(0, 0, 0, 0.12) 34%,
      #000 62%
    );
    mask-image: linear-gradient(
      to right,
      transparent 0%,
      rgba(0, 0, 0, 0.12) 34%,
      #000 62%
    );
  }
  /* The strip above the title, left side. Clipped and faded at the bottom so
     these streaks stop short of the heading. */
  .streaks-top {
    inset: 0 auto auto 0;
    width: 62%;
    height: 32px;
    -webkit-mask-image: linear-gradient(to bottom, #000 40%, transparent 94%);
    mask-image: linear-gradient(to bottom, #000 40%, transparent 94%);
  }
  .streak {
    position: absolute;
    left: var(--x);
    top: var(--y);
    transform: rotate(var(--angle));
    transform-origin: 0 50%;
  }
  .streak-body {
    display: block;
    position: relative;
    height: 1px;
    width: 0;
    opacity: 0;
    /* A 1px core that fades out along its own length. */
    background: linear-gradient(
      -90deg,
      #ffffff 0%,
      rgba(198, 212, 255, 0.7) 22%,
      rgba(140, 165, 255, 0) 100%
    );
    border-radius: 999px;
    filter: drop-shadow(0 0 3px rgba(255, 255, 255, 0.55));
    /* --dur is the flash itself; the cycle is sixteen times that, so each
       streak rests unseen for a good while before its next one. The keyframe
       percentages below are all inside that first 6.25%. */
    animation:
      tail calc(var(--dur) * 16) ease-out var(--delay) infinite,
      falling calc(var(--dur) * 16) ease-out var(--delay) infinite,
      burning calc(var(--dur) * 16) linear var(--delay) infinite;
  }
  @keyframes tail {
    0% {
      width: 0;
    }
    1.6%,
    6.25% {
      width: var(--len);
    }
    6.26%,
    100% {
      width: 0;
    }
  }
  /* Snaps in, holds for a beat, then eases out while it is still travelling,
     so the eye catches a streak rather than watching one slide past. */
  @keyframes burning {
    0% {
      opacity: 0;
      animation-timing-function: ease-in;
    }
    0.9% {
      opacity: 1;
      animation-timing-function: linear;
    }
    2.6% {
      opacity: 1;
      animation-timing-function: ease-out;
    }
    6.25%,
    100% {
      opacity: 0;
    }
  }
  @keyframes falling {
    0% {
      transform: translateX(0);
    }
    6.25%,
    100% {
      transform: translateX(var(--dist));
    }
  }

  /* Content --------------------------------------------------------------- */
  .content {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: stretch;
    gap: 0.9rem;
    padding: 1.75rem 1.5rem 1.65rem 1.7rem;
  }
  .text {
    flex: 0 1 62%;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .title {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 600;
    color: #ffffff;
    letter-spacing: -0.01em;
  }
  .copy {
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.5;
    color: rgba(226, 228, 245, 0.82);
  }
  .copy + .copy {
    margin-top: 0.6rem;
  }
  .action {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .later-slot {
    height: 0;
    display: flex;
    justify-content: center;
    /* flex-start, so the button keeps its own height inside a zero-height row
       instead of being stretched flat. */
    align-items: flex-start;
    overflow: visible;
  }
  /* Button colour treatments live here with the rest of the night-sky
     palette rather than as raw values in class attributes. !important is
     needed to beat the Button component's own variant utilities. */
  .star-prompt :global(.star-button) {
    white-space: nowrap;
    box-shadow: 0 0 16px -6px rgba(160, 180, 255, 0.75);
  }
  .star-prompt :global(.later-button) {
    margin-top: 0.55rem;
    font-size: 0.85rem;
    color: rgba(226, 228, 245, 0.6) !important;
  }
  .star-prompt :global(.later-button:enabled:hover) {
    color: #ffffff !important;
  }
  .close {
    position: absolute;
    top: 14px;
    right: 14px;
    z-index: 2;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 6px;
    color: rgba(226, 228, 245, 0.6);
    transition:
      color 120ms ease,
      background-color 120ms ease;
  }
  .close:hover {
    color: #ffffff;
    background-color: rgba(255, 255, 255, 0.1);
  }

  /* Respect reduced-motion: drop the shooting stars altogether and hold the
     twinkles at a steady mid brightness. */
  @media (prefers-reduced-motion: reduce) {
    .streaks {
      display: none;
    }
    .twinkles span {
      animation: none;
      opacity: calc(var(--max) * 0.75);
    }
  }
</style>
