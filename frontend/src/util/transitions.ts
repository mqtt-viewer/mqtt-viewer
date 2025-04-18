// Thanks to MeltUI
// https://github.com/melt-ui/melt-ui/blob/02dc11b2b992e5ebb01508308e1b89c0e616ac55/src/docs/utils/transition.ts
import { styleToString } from "@/util/styles";
import { cubicOut } from "svelte/easing";
import type { TransitionConfig } from "svelte/transition";

const scaleConversion = (
  valueA: number,
  scaleA: [number, number],
  scaleB: [number, number]
) => {
  const [minA, maxA] = scaleA;
  const [minB, maxB] = scaleB;

  const percentage = (valueA - minA) / (maxA - minA);
  const valueB = percentage * (maxB - minB) + minB;

  return valueB;
};

type FlyAndScaleOptions = {
  y: number;
  start: number;
  duration?: number;
};
export const flyAndScale = (
  node: HTMLElement,
  options: FlyAndScaleOptions
): TransitionConfig => {
  const style = getComputedStyle(node);
  const transform = style.transform === "none" ? "" : style.transform;

  return {
    duration: options.duration ?? 150,
    delay: 0,
    css: (t) => {
      const y = scaleConversion(t, [0, 1], [options.y, 0]);
      const scale = scaleConversion(t, [0, 1], [options.start, 1]);

      return styleToString({
        transform: `${transform} translate3d(0, ${y}px, 0) scale(${scale})`,
        opacity: t,
      });
    },
    easing: cubicOut,
  };
};
