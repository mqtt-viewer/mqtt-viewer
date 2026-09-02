<script lang="ts" context="module">
  import { writable } from "svelte/store";

  // Exported so the prompt can be opened or inspected from elsewhere if needed.
  export const starPromptOpen = writable(false);
</script>

<script lang="ts">
  import Dialog from "@/components/Dialog/Dialog.svelte";
  import Button from "@/components/Button/Button.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import { Browser } from "@wailsio/runtime";
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

  const STARGAZERS_URL = "https://github.com/mqtt-viewer/mqtt-viewer/stargazers";

  // Only nudge once the app has clearly been used a few times, so a fresh
  // install never sees this on first run.
  const MIN_LAUNCHES = 3;

  // Deterministic scatter of faint twinkling stars across the panel. Kept
  // small and dim so the copy stays readable over them. Derived from the index
  // (no randomness) so the layout is stable across renders and story snapshots.
  // Candidates landing under the text and buttons (right of the sky panel and
  // below the top strip) are skipped so no star reads as stray punctuation;
  // extra candidates keep the count at 36.
  const twinkles = Array.from({ length: 100 }, (_, i) => ({
    left: (i * 47 + 13) % 100,
    top: (i * 71 + 7) % 100,
    size: (i % 3) * 0.6 + 1,
    delay: ((i * 13) % 40) / 10,
    duration: 2.4 + ((i * 7) % 30) / 10,
    max: 0.5 + ((i * 5) % 5) / 10,
  }))
    .filter((t) => !(t.left > 36 && t.top > 9))
    .slice(0, 36);

  // Five shooting stars, staggered, confined to the sky panel on the left.
  const shootingStars = [0, 1, 2, 3, 4];

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
    Browser.OpenURL(STARGAZERS_URL);
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

    <!-- Shooting stars streaking through the open space on the left. -->
    <div class="sky" aria-hidden="true">
      <div class="night">
        {#each shootingStars as i}
          <div class="shooting-star" style="--i:{i};"></div>
        {/each}
      </div>
    </div>

    <button type="button" class="close" aria-label="close" on:click={onLater}>
      <Icon type="close" size={16} />
    </button>

    <div class="content">
      <h2 class="title">Like the app?</h2>
      <p class="copy">
        Starring the project on GitHub is an easy way to help out. It helps more
        people find MQTT Viewer, and it's a real boost for me to see. Thanks for
        using it.
      </p>

      <div class="actions">
        <Button variant="text" class="later-button" on:click={onLater}
          >Maybe later</Button
        >
        <Button
          variant="primary"
          iconType="github"
          iconSize={18}
          class="star-button !bg-white/10 !border-white/25 !text-white enabled:hover:!bg-white/20 enabled:hover:!text-white backdrop-blur-sm"
          on:click={onStar}
        >
          Star on GitHub
        </Button>
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
    /* Deep night sky, a touch brighter toward the top-left where the stars
       streak, settling to near-black under the text. */
    background:
      radial-gradient(
        130% 120% at 18% 8%,
        #262a5a 0%,
        #171a40 42%,
        #0c0d24 100%
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
    box-shadow: 0 0 4px rgba(255, 255, 255, 0.8);
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
  .sky {
    position: absolute;
    inset: 0 auto 0 0;
    width: 190px;
    overflow: hidden;
    pointer-events: none;
    /* Fade the streaks out before they reach the copy. */
    -webkit-mask-image: linear-gradient(
      to right,
      #000 55%,
      transparent 100%
    );
    mask-image: linear-gradient(to right, #000 55%, transparent 100%);
  }
  .night {
    position: absolute;
    inset: 0;
    transform: rotateZ(38deg);
  }
  .shooting-star {
    position: absolute;
    top: calc(-10px + var(--i) * 30px);
    left: calc(-40px + var(--i) * 14px);
    height: 2px;
    width: 0;
    background: linear-gradient(-45deg, #fff, rgba(120, 150, 255, 0));
    border-radius: 999px;
    filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.9));
    animation:
      tail 3200ms ease-in-out infinite,
      falling 3200ms ease-in-out infinite;
    animation-delay: calc(var(--i) * 640ms);
  }
  .shooting-star::before,
  .shooting-star::after {
    content: "";
    position: absolute;
    top: calc(50% - 1px);
    right: 0;
    height: 2px;
    width: 0;
    background: linear-gradient(
      -45deg,
      rgba(120, 150, 255, 0),
      #fff,
      rgba(120, 150, 255, 0)
    );
    border-radius: 100%;
    transform: translateX(50%) rotateZ(45deg);
    animation: shining 3200ms ease-in-out infinite;
    animation-delay: calc(var(--i) * 640ms);
  }
  .shooting-star::after {
    transform: translateX(50%) rotateZ(-45deg);
  }
  @keyframes tail {
    0% {
      width: 0;
    }
    28% {
      width: 66px;
    }
    100% {
      width: 0;
    }
  }
  @keyframes shining {
    0% {
      width: 0;
    }
    50% {
      width: 26px;
    }
    100% {
      width: 0;
    }
  }
  @keyframes falling {
    0% {
      transform: translateX(0);
    }
    100% {
      transform: translateX(160px);
    }
  }

  /* Content --------------------------------------------------------------- */
  .content {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 1.15rem;
    padding: 1.6rem 1.6rem 1.5rem;
    padding-left: 172px;
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
    color: rgba(226, 228, 245, 0.8);
  }
  .actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.75rem;
  }
  /* Button colour treatments live here with the rest of the night-sky
     palette rather than as raw values in class attributes. !important is
     needed to beat the Button component's own variant utilities. */
  .star-prompt :global(.later-button) {
    color: rgba(226, 228, 245, 0.72) !important;
  }
  .star-prompt :global(.later-button:enabled:hover) {
    color: #ffffff !important;
  }
  .star-prompt :global(.star-button) {
    box-shadow: 0 0 18px -6px rgba(160, 180, 255, 0.8);
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
    transition: color 120ms ease, background-color 120ms ease;
  }
  .close:hover {
    color: #ffffff;
    background-color: rgba(255, 255, 255, 0.1);
  }

  /* Respect reduced-motion: hold the scene still rather than emptying it.
     Twinkles freeze at their own peak brightness, and three streaks get a
     faint static tail at staggered points along the diagonal so the left
     side keeps its composition. */
  @media (prefers-reduced-motion: reduce) {
    .twinkles span,
    .shooting-star,
    .shooting-star::before,
    .shooting-star::after {
      animation: none;
    }
    .twinkles span {
      opacity: var(--max);
    }
    .shooting-star:nth-child(1),
    .shooting-star:nth-child(3),
    .shooting-star:nth-child(5) {
      width: 66px;
      opacity: 0.5;
      transform: translateX(calc(30px + var(--i) * 28px));
    }
  }
</style>
