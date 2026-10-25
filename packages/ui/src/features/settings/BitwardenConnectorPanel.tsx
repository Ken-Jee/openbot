import type { BitwardenConnectorStatus, BitwardenHostConnectInput } from "@openbot/contracts/ipc";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
  Field,
  Input,
  Lock,
  OctagonX,
  SettingsSection,
  Text,
} from "@openbot/ui";
import { createSignal, Show } from "solid-js";
import { useText } from "../../text";
import { DetailHeader, ReadFailedAlert, UNKNOWN_STATUS } from "./IntegrationLayout";

/** The hosted Bitwarden service. A self-hosted Vaultwarden server replaces it in the form. */
const DEFAULT_SERVER_URL = "https://vault.bitwarden.com";

export interface BitwardenConnectorPanelProps {
  status: BitwardenConnectorStatus;
  busy: boolean;
  onConnect: (sessionKey: string) => void;
  onDisconnect: () => void;
  /**
   * The joined server whose connection this is, or undefined for this computer's. A server signs in
   * with its own CLI, so the page asks for an API key and the master password, not a session key.
   */
  hostName?: string | undefined;
  /** Connects a joined server's Bitwarden. Set together with `hostName`. */
  onConnectHost?: ((input: BitwardenHostConnectInput) => void) | undefined;
  /**
   * Why the last status read failed, when no newer status came. The state is not known: the page
   * shows the reason and Retry, not the session key form of a connection that may be there.
   */
  statusError?: string | null | undefined;
  /** Reads the status again. */
  onRetry?: (() => void) | undefined;
}

/** The status of the connection, as its page header and every list of connectors show it. */
export function bitwardenStatus(props: Pick<BitwardenConnectorPanelProps, "status" | "statusError">) {
  if (props.statusError) return UNKNOWN_STATUS;
  if (props.status.connecting) return { status: "connecting", label: "connector.bitwarden.connecting" } as const;
  return props.status.connected
    ? ({ status: "connected", label: "connector.bitwarden.connected" } as const)
    : ({ status: "idle", label: "connector.bitwarden.disconnected" } as const);
}

export function BitwardenConnectorPanel(props: BitwardenConnectorPanelProps) {
  const { t, sourceText } = useText();
  const [key, setKey] = createSignal("");
  const [serverUrl, setServerUrl] = createSignal(DEFAULT_SERVER_URL);
  const [clientId, setClientId] = createSignal("");
  const [clientSecret, setClientSecret] = createSignal("");
  const [masterPassword, setMasterPassword] = createSignal("");
  const header = () => bitwardenStatus(props);
  const hostReady = () => Boolean(serverUrl().trim() && clientId().trim() && clientSecret().trim() && masterPassword());
  return (
    <div class="onepassword-connector">
      <DetailHeader
        logo={<Lock />}
        name={t("connector.bitwarden.title")}
        subtitle={
          props.hostName
            ? t("connector.bitwarden.descriptionHost", { host: props.hostName })
            : t("connector.bitwarden.description")
        }
        status={header().status}
        statusLabel={t(header().label)}
      />
      <Show when={props.statusError}>
        {(message) => <ReadFailedAlert message={message()} onRetry={props.onRetry} />}
      </Show>
      <Show when={!props.statusError && props.status.error}>
        {(message) => (
          <Alert tone="danger" role="alert">
            <AlertIcon>
              <OctagonX />
            </AlertIcon>
            <AlertContent>
              <AlertTitle>{t("connector.bitwarden.actionFailed")}</AlertTitle>
              <AlertDescription>{sourceText(message())}</AlertDescription>
            </AlertContent>
          </Alert>
        )}
      </Show>
      <Show when={props.status.connected && props.status.serverUrl}>
        {(server) => (
          <Text variant="body-sm" tone="muted">
            {t("connector.bitwarden.connectedServer", { server: server() })}
          </Text>
        )}
      </Show>
      <Show
        when={props.hostName}
        fallback={
          <>
            <Text variant="body-sm" tone="muted">
              {t("connector.bitwarden.scope")}
            </Text>
            <Text variant="body-sm" tone="muted">
              {t("connector.bitwarden.session")}
            </Text>
          </>
        }
      >
        {(host) => (
          <>
            <Text variant="body-sm" tone="muted">
              {t("connector.bitwarden.scopeHost", { host: host() })}
            </Text>
            <Text variant="body-sm" tone="muted">
              {t("connector.bitwarden.sessionHost", { host: host() })}
            </Text>
          </>
        )}
      </Show>
      {/* With the state not known, the page offers neither the connect form nor Disconnect. */}
      <Show when={!props.statusError}>
        <Show
          when={!props.status.connected}
          fallback={
            <Button type="button" variant="outline" onClick={() => props.onDisconnect()}>
              {t("connector.bitwarden.disconnect")}
            </Button>
          }
        >
          <Show
            when={props.hostName}
            fallback={
              <SettingsSection title={t("connector.bitwarden.connect")} description={t("connector.bitwarden.setup")}>
                <form
                  class="onepassword-connector-token"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const value = key().trim();
                    if (!value || props.busy) return;
                    setKey("");
                    props.onConnect(value);
                  }}
                >
                  <Input
                    type="password"
                    autocomplete="off"
                    spellcheck={false}
                    aria-label={t("connector.bitwarden.sessionKey")}
                    value={key()}
                    onInput={(event) => setKey(event.currentTarget.value)}
                  />
                  <Button type="submit" loading={props.busy} disabled={!key().trim()}>
                    {t("connector.bitwarden.connect")}
                  </Button>
                </form>
                <Show when={props.busy}>
                  <Button type="button" variant="ghost" onClick={() => props.onDisconnect()}>
                    {t("common.cancel")}
                  </Button>
                </Show>
              </SettingsSection>
            }
          >
            {(host) => (
              <SettingsSection
                title={t("connector.bitwarden.connect")}
                description={t("connector.bitwarden.setupHost", { host: host() })}
              >
                <form
                  class="bitwarden-connector-host-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!hostReady() || props.busy || props.status.connecting) return;
                    const input = {
                      serverUrl: serverUrl().trim(),
                      clientId: clientId().trim(),
                      clientSecret: clientSecret().trim(),
                      masterPassword: masterPassword(),
                    };
                    setClientSecret("");
                    setMasterPassword("");
                    props.onConnectHost?.(input);
                  }}
                >
                  <Field label={t("connector.bitwarden.serverUrl")}>
                    <Input
                      type="url"
                      autocomplete="off"
                      spellcheck={false}
                      value={serverUrl()}
                      onInput={(event) => setServerUrl(event.currentTarget.value)}
                    />
                  </Field>
                  <Field label={t("connector.bitwarden.clientId")}>
                    <Input
                      autocomplete="off"
                      spellcheck={false}
                      value={clientId()}
                      onInput={(event) => setClientId(event.currentTarget.value)}
                    />
                  </Field>
                  <Field label={t("connector.bitwarden.clientSecret")}>
                    <Input
                      type="password"
                      autocomplete="off"
                      spellcheck={false}
                      value={clientSecret()}
                      onInput={(event) => setClientSecret(event.currentTarget.value)}
                    />
                  </Field>
                  <Field label={t("connector.bitwarden.masterPassword")}>
                    <Input
                      type="password"
                      autocomplete="off"
                      spellcheck={false}
                      value={masterPassword()}
                      onInput={(event) => setMasterPassword(event.currentTarget.value)}
                    />
                  </Field>
                  <Button
                    type="submit"
                    loading={props.busy || props.status.connecting}
                    disabled={!hostReady() || props.status.connecting}
                  >
                    {t("connector.bitwarden.connect")}
                  </Button>
                </form>
                <Show when={props.status.connecting}>
                  <Button type="button" variant="ghost" onClick={() => props.onDisconnect()}>
                    {t("common.cancel")}
                  </Button>
                </Show>
              </SettingsSection>
            )}
          </Show>
        </Show>
      </Show>
    </div>
  );
}
