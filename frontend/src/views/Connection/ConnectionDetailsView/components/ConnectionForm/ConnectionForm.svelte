<script lang="ts">
  import { createForm } from "felte";
  import BaseInput from "@/components/InputFields/BaseInput.svelte";
  import { validator } from "@felte/validator-zod";
  import {
    ConnectionFormValidationSchema,
    type ConnectionFormValues,
  } from "./validation.js";
  import connections, { type Connection } from "@/stores/connections";
  import Select from "@/components/InputFields/Select.svelte";
  import Switch from "@/components/InputFields/Switch.svelte";
  import { ERROR_MESSAGE_CLASS_NO_X_POSITION } from "@/components/InputFields/classes.js";
  import { isEmpty } from "lodash";
  import { twMerge } from "tailwind-merge";
  import ConnectionIdenticon from "@/components/ConnectionIdenticon/ConnectionIdenticon.svelte";
  import FilePathPicker from "@/components/InputFields/FilePathPicker.svelte";
  import { getConnectionIsValidContext } from "@/views/Connection/contexts/connection-is-valid.js";
  import DropdownMenu from "@/components/DropdownMenu/DropdownMenu.svelte";
  import Button from "@/components/Button/Button.svelte";
  import DropdownCloseOnClick from "@/components/DropdownMenu/DropdownCloseOnClick.svelte";
  import ConfirmDeleteConnectionDialog from "../ConfirmDeleteConnectionDialog/ConfirmDeleteConnectionDialog.svelte";
  import { writable } from "svelte/store";
  import Icon from "@/components/Icon/Icon.svelte";
  import IconButton from "@/components/Button/IconButton.svelte";
  import Tooltip from "@/components/Tooltip/Tooltip.svelte";

  export let connection: Connection;
  $: connectionId = connection.connectionDetails.id;
  let connectionIsValid = getConnectionIsValidContext();

  const {
    name,
    protocol,
    websocketPath,
    mqttVersion,
    host,
    port,
    username,
    password,
    hasCustomClientId,
    clientId,
    isCertsEnabled,
    certCa,
    certClient,
    certClientKey,
    customIconSeed,
    skipCertVerification,
  } = connection.connectionDetails;

  const { form, errors, data, isValid, setFields, validate } =
    createForm<ConnectionFormValues>({
      extend: [validator({ schema: ConnectionFormValidationSchema })],
      onSubmit: (values) => {},
      initialValues: {
        customIconSeed,
      },
    });

  const submit = (values: typeof $data) => {
    try {
      connections.updateConnectionDetails({
        ...connection.connectionDetails,
        ...values,
        clientId: values.hasCustomClientId ? values.clientId : undefined,
      });
      if (!values.hasCustomClientId) {
        setFields("clientId", "", true);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const onDeleteClick = () => {
    isConfirmDeleteDialogOpen.set(true);
  };

  const onConfirmDelete = () => {
    try {
      connections.deleteConnection(connectionId);
    } catch (e) {
      console.error(e);
    }
  };

  $: $isValid,
    (async () => {
      await validate();
      connectionIsValid.set($isValid);
    })();

  $: $data,
    (() => {
      const values = $data;
      if ($isValid && !isEmpty(values) && !isAllFieldsDisabled) {
        submit(values);
      }
    })();

  $: isSslTls = $data.protocol === "mqtts" || $data.protocol === "wss";

  $: isAllFieldsDisabled = connection.connectionState !== "disconnected";
  let isConfirmDeleteDialogOpen = writable(false);
</script>

<form use:form class="flex flex-col gap-8 w-full">
  <div class="flex items-center gap-1">
    <span class="text-lg">Connection details</span>
    <DropdownMenu disabled={isAllFieldsDisabled}>
      <div slot="trigger">
        <IconButton disabled={isAllFieldsDisabled}>
          <Icon type="options" size={16} />
        </IconButton>
      </div>
      <div slot="menu-content" class="flex flex-col px-2 py-2 gap-4">
        <div class="flex">
          <div class="size-9 mr-2">
            <ConnectionIdenticon {connection} />
          </div>
          <BaseInput
            class="w-[170px]"
            name="customIconSeed"
            placeholder="Custom Icon Seed"
            bind:value={$data.customIconSeed}
          />
        </div>
        <DropdownCloseOnClick>
          <Button
            variant="text"
            class="mt-2 text-error enabled:hover:text-error-light enabled:group-hover:text-error-light"
            on:click={onDeleteClick}
            ><div class="flex mr-[18px] ml-2">
              <Icon type="delete" size={20} />
            </div>
            <span>Delete Connection</span></Button
          >
        </DropdownCloseOnClick>
      </div>
    </DropdownMenu>
    {#if isAllFieldsDisabled}
      <Tooltip>
        <span slot="tooltip-content"
          >Disconnect if you want to modify connection details</span
        >
        <div class="text-secondary-text flex gap-1 items-center">
          <Icon type="info" size={14} />Disabled while connected
        </div>
      </Tooltip>
    {/if}
  </div>
  <div class="flex w-full gap-3 relative">
    <div class="w-3/4">
      <BaseInput
        disabled={isAllFieldsDisabled}
        name="name"
        label="Name"
        value={name}
        errorMessage={$errors.name?.[0]}
      />
    </div>
    <div class="w-1/4">
      <Select
        disabled={isAllFieldsDisabled}
        onChange={(value) => setFields(`mqttVersion`, value ?? "", true)}
        name={`mqttVersion`}
        defaultValue={mqttVersion}
        label={`Version`}
        getOptionLabel={(option) => {
          if (option === "3") {
            return "3.1/3.11";
          }
          return option;
        }}
        options={["5", "3"]}
      />
    </div>
  </div>

  <div class="flex gap-3 relative">
    <div class="flex relative gap-3 w-3/4">
      <div class="w-1/3">
        <Select
          disabled={isAllFieldsDisabled}
          onChange={(newValue) => {
            setFields(`protocol`, newValue ?? "", true);
          }}
          name={`protocol`}
          defaultValue={protocol}
          label={`Protocol`}
          getOptionLabel={(option) => `${option}`}
          options={["mqtt", "mqtts", "ws", "wss"]}
        />
      </div>
      <div class="w-2/3">
        <BaseInput
          disabled={isAllFieldsDisabled}
          name="host"
          label="Host"
          value={host}
          errorMessage={$errors.host?.[0]}
        />
      </div>
    </div>

    <div class="w-1/4">
      <BaseInput
        disabled={isAllFieldsDisabled}
        name="port"
        type="number"
        label="Port"
        value={`${port}`}
        hasError={!!$errors.port?.[0]}
      />
    </div>
    {#if !!$errors.port?.[0]}
      <span class={twMerge(ERROR_MESSAGE_CLASS_NO_X_POSITION, "right-0")}
        >{$errors.port?.[0]}</span
      >
    {/if}
  </div>
  {#if $data.protocol === "ws" || $data.protocol === "wss"}
    <div class="flex gap-3">
      <div class="w-full">
        <BaseInput
          disabled={isAllFieldsDisabled}
          name="websocketPath"
          label="Websocket Path"
          value={websocketPath}
        />
      </div>
    </div>
  {/if}
  <div class="flex gap-3">
    <div class="w-1/2">
      <BaseInput
        disabled={isAllFieldsDisabled}
        name="username"
        label="Username"
        value={username}
      />
    </div>
    <div class="w-1/2">
      <BaseInput
        disabled={isAllFieldsDisabled}
        type="password"
        name="password"
        label="Password"
        value={password}
      />
    </div>
  </div>
  <Switch
    disabled={isAllFieldsDisabled}
    onChange={(checked) => {
      console.log("setting cid field for conn id", checked, connectionId);
      setFields(`hasCustomClientId`, checked, true);
    }}
    name="hasCustomClientId"
    label="Use custom Client ID"
    defaultChecked={hasCustomClientId}
  />
  {#if $data.hasCustomClientId}
    <BaseInput
      disabled={isAllFieldsDisabled}
      name="clientId"
      label="Client ID"
      value={clientId}
      errorMessage={$errors.clientId?.[0]}
    />
  {/if}
  <div class="flex row gap-4">
    <div style:display={isSslTls ? undefined : "none"}>
      <Switch
        disabled={isAllFieldsDisabled}
        onChange={(checked) => setFields(`isCertsEnabled`, checked, true)}
        name="isCertsEnabled"
        label="Use custom certificates"
        defaultChecked={isCertsEnabled}
      />
    </div>
    <div style:display={$data.isCertsEnabled && isSslTls ? undefined : "none"}>
      <Switch
        onChange={(checked) => setFields(`skipCertVerification`, checked, true)}
        name="skipCertVerification"
        label="Skip certificate validation (insecure)"
        defaultChecked={skipCertVerification}
      />
    </div>
  </div>

  {#if isSslTls}
    {#if $data.isCertsEnabled}
      <div class="-mt-3 space-y-2">
        <FilePathPicker
          disabled={isAllFieldsDisabled}
          variant="certificate"
          actionLabel="Add CA Certificate"
          valueLabel="CA"
          defaultValue={certCa}
          onFileChosen={(filePath) => setFields("certCa", filePath, true)}
          onFileRemoved={() => {
            setFields("certCa", "", true);
          }}
        />
        <FilePathPicker
          disabled={isAllFieldsDisabled}
          variant="certificate"
          actionLabel="Add Client Certificate"
          valueLabel="Client"
          defaultValue={certClient}
          onFileChosen={(filePath) => setFields("certClient", filePath, true)}
          onFileRemoved={() => {
            setFields("certClient", "", true);
          }}
        />
        <FilePathPicker
          disabled={isAllFieldsDisabled}
          variant="certificate"
          actionLabel="Add Client Key"
          valueLabel="Client Key"
          defaultValue={certClientKey}
          onFileChosen={(filePath) =>
            setFields("certClientKey", filePath, true)}
          onFileRemoved={() => {
            setFields("certClientKey", "", true);
          }}
        />
      </div>
    {/if}
  {/if}
</form>
<ConfirmDeleteConnectionDialog
  {connection}
  isOpen={isConfirmDeleteDialogOpen}
  onConfirm={onConfirmDelete}
/>
