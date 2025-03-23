<script lang="ts">
  import logo from "../../assets/images/protobuf-logo.png";
  import { twMerge } from "tailwind-merge";

  let className = "";
  export { className as class };
  export let isActive = undefined as boolean | undefined;

  let isHovered = false;
  const onMouseEnter = () => (isHovered = true);
  const onMouseLeave = () => (isHovered = false);
</script>

<div
  class={twMerge("relative w-full h-full", className)}
  on:mouseenter={onMouseEnter}
  on:mouseleave={onMouseLeave}
>
  <img
    src={logo}
    alt="Protobuf Logo"
    class={"block w-full h-auto transition-[filter]"}
    style:filter={isActive || isHovered ? "grayscale(0)" : "grayscale(1)"}
  />
</div>
