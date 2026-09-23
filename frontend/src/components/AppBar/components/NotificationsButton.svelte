<script lang="ts">
  import Button from "@/components/Button/Button.svelte";
  import IconButton from "@/components/Button/IconButton.svelte";
  import DropdownMenu from "@/components/DropdownMenu/DropdownMenu.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import notifications from "@/stores/notifications";

  // The list keeps showing dismissed entries, quietly; only unseen ones ping.
  $: hasNotifications = $notifications.notifications.length > 0;
  $: unseenCount = $notifications.notifications.filter((n) => !n.seen).length;
</script>

<DropdownMenu>
  <div slot="trigger" class="relative">
    <IconButton class={""} on:click={() => {}}>
      <Icon type="notification" />
    </IconButton>
    {#if unseenCount > 0}
      <span class="absolute flex size-2 top-0 right-0">
        <span
          class="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75"
        ></span>
        <span class="relative inline-flex rounded-full size-2 bg-secondary"
        ></span>
      </span>
    {/if}
  </div>
  <div slot="menu-content" class="w-[320px]">
    {#if !hasNotifications}
      <div class="flex items-center justify-center p-2">
        <span class="text-secondary-text"
          >You don't have any notifications.</span
        >
      </div>
    {/if}
    {#if hasNotifications}
      {#each $notifications.notifications as n}
        <div class="relative">
          <Button
            on:click={() => n.onClick?.()}
            class="h-fit w-full text-left py-1 {n.seen ? 'opacity-60' : ''}"
          >
            <div class="flex items-center justify-center py-1">
              <div class="flex gap-3 w-full h-full">
                <div class="h-full flex items-center">
                  <Icon type={n.icon ?? "notification"} size={34} />
                </div>
                <div class="flex-grow">
                  <p>{n.title}</p>
                  <p class="text-sm text-secondary-text">
                    {n.message}
                  </p>
                </div>
              </div>
            </div>
          </Button>
          <div class="absolute top-0 right-0">
            <IconButton
              tooltipText="Dismiss"
              onClick={(e) => {
                e.stopPropagation();
                n.onDismiss?.();
                notifications.markNotificationAsSeen(n.id);
              }}
            >
              <Icon type="close" size={14} />
            </IconButton>
          </div>
        </div>
      {/each}
    {/if}
  </div>
</DropdownMenu>
