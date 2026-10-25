import { AppLogo, type AppLogoVariant, ProviderLogo } from "@openbot/brand";
import {
  Bot,
  Button,
  CalendarClock,
  ChartArea,
  ListChecks,
  MotionTooltip,
  Settings,
  Store,
  Workflow,
} from "@openbot/ui";
import { AccountUsageDetails } from "@openbot/ui/features/account/AccountUsageDetails";
import { type AccountUsageProviderRow, accountUsageRowKey } from "@openbot/ui/features/account/account-usage-view";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

/** One rail button. Its name shows as a tooltip, unless it has a `card`: the card shows instead. */
function RailButton(props: {
  label: string;
  /** Renders the card while it is open. */
  card?: () => JSX.Element;
  current?: boolean;
  class?: string;
  onClick: (button: HTMLElement) => void;
  children: JSX.Element;
}) {
  const button = () => (
    <Button
      variant="ghost"
      type="button"
      class={props.class ? `window-rail-button ${props.class}` : "window-rail-button"}
      aria-label={props.label}
      aria-current={props.current ? "page" : undefined}
      onClick={(event) => props.onClick(event.currentTarget)}
    >
      {props.children}
    </Button>
  );
  return (
    <Show when={props.card} fallback={<MotionTooltip content={props.label}>{button()}</MotionTooltip>}>
      {(card) => (
        <MotionTooltip
          content={card()()}
          class="ui-popover-menu-surface account-usage-popover window-rail-usage-card"
          placement="right-end"
          openDelay={250}
          closeDelay={75}
        >
          {button()}
        </MotionTooltip>
      )}
    </Show>
  );
}

/** Two tracks in a 34px box, with 4.5px between their centers. */
const RING = { size: 34, stroke: 2.25, spacing: 4.5 };

/**
 * The limits of one provider as concentric rings: the outer ring is the longest window, the inner
 * ring the shortest. Each arc shows how much is left, in the tone of that window. The hover card
 * shows the windows with their reset times.
 */
function UsageRings(props: { row: AccountUsageProviderRow; onOpen: (button: HTMLElement) => void }) {
  const { t } = useText();
  const label = () =>
    t("app.rail.usageRings", {
      name: props.row.name,
      windows: props.row.windows
        .map((window) => t("account.usage.row.window", { window: window.label, percent: window.remainingPercent }))
        .join(", "),
    });
  const windows = () => [...props.row.ringWindows].reverse().slice(0, 2);
  const outerRadius = (RING.size - RING.stroke) / 2;
  return (
    <RailButton
      label={label()}
      card={() => (
        <AccountUsageDetails
          rows={[props.row]}
          loading={false}
          error={null}
          refreshActive={false}
          refreshDisabled
          onRefresh={() => undefined}
          title={<h2 class="account-usage-popover-title">{t("account.usage.title")}</h2>}
        />
      )}
      class="window-rail-usage"
      onClick={props.onOpen}
    >
      <svg class="window-rail-usage-ring" viewBox={`0 0 ${RING.size} ${RING.size}`} fill="none" aria-hidden="true">
        <For each={windows()} keyed={false}>
          {(window, index) => (
            <g>
              <circle
                class="window-rail-usage-track"
                cx={RING.size / 2}
                cy={RING.size / 2}
                r={outerRadius - index * RING.spacing}
                stroke-width={RING.stroke}
              />
              <Show when={window().remainingPercent > 0}>
                <circle
                  class="window-rail-usage-arc"
                  data-usage-tone={window().tone}
                  cx={RING.size / 2}
                  cy={RING.size / 2}
                  r={outerRadius - index * RING.spacing}
                  stroke-width={RING.stroke}
                  stroke-linecap="round"
                  pathLength={100}
                  stroke-dasharray={`${window().remainingPercent} 100`}
                />
              </Show>
            </g>
          )}
        </For>
      </svg>
      <ProviderLogo provider={props.row.provider} class="window-rail-usage-logo" />
    </RailButton>
  );
}

/** The answer of one custom agent to its usage prompt. OpenBot cannot read a percent from it. */
export interface CustomAgentUsageRailRow {
  id: string;
  name: string;
  text: string;
}

/**
 * The plan usage of one custom agent: the agent logo, with no ring. The hover card shows the answer
 * as the agent wrote it.
 */
function CustomAgentUsageButton(props: { row: CustomAgentUsageRailRow; onOpen: (button: HTMLElement) => void }) {
  const { t } = useText();
  return (
    <RailButton
      label={t("app.rail.customAgentUsage", { name: props.row.name })}
      card={() => (
        <div class="window-rail-agent-usage">
          <h2 class="account-usage-popover-title">{props.row.name}</h2>
          <p class="window-rail-agent-usage-text">{props.row.text}</p>
        </div>
      )}
      class="window-rail-usage"
      onClick={props.onOpen}
    >
      <ProviderLogo provider="acp" class="window-rail-usage-logo window-rail-agent-usage-logo" />
    </RailButton>
  );
}

/** The rail pages. Agents and Routines show the same page with a different sidebar list. */
export type PageRailPage = "agents" | "routines" | "tasks" | "schedule" | "usage" | "marketplace" | "settings";

export interface PageRailProps {
  hidden: boolean;
  /** The page in the card, or `null` while a page that the rail does not open shows. */
  current: PageRailPage | null;
  /** The plan limits of each provider account. Each one with a reported window shows as rings. */
  usageRows: readonly AccountUsageProviderRow[];
  /** The answers of the custom agents on this computer that have a usage prompt. Absent on the web. */
  customAgentUsage?: readonly CustomAgentUsageRailRow[] | undefined;
  onAgents: () => void;
  /** Absent when the server has no routines. */
  onRoutines?: (() => void) | undefined;
  /** Absent where the server keeps no tasks. */
  onTasks?: ((button: HTMLElement) => void) | undefined;
  /** Absent where there is no schedule page. */
  onSchedule?: ((button: HTMLElement) => void) | undefined;
  onUsage: (button: HTMLElement) => void;
  /** Absent while Marketplace cannot open. */
  onMarketplace?: (() => void) | undefined;
  onSettings: (button: HTMLElement) => void;
  /** A notice for the Settings button, such as an update, when no other place shows it. A dot marks it. */
  settingsNotice?: string | undefined;
  /** The Help menu, between Marketplace and Settings. */
  help: JSX.Element;
  /**
   * The OpenBot logo in the top row, for a window that has no macOS window buttons there. With
   * `href`, the logo is a link to the OpenBot site.
   */
  logo?: { variant: AppLogoVariant; href?: string | undefined } | undefined;
}

/** The logo in the top row of the rail, in line with the icons of the rail and the server logo of the sidebar. */
function RailLogo(props: { variant: AppLogoVariant; href: string | undefined }) {
  const { t } = useText();
  return (
    <div class="window-rail-logo">
      <Show when={props.href} fallback={<AppLogo variant={props.variant} />}>
        {(href) => (
          <MotionTooltip content={t("app.rail.website")}>
            <a
              class="window-rail-logo-link"
              href={href()}
              target="_blank"
              rel="noopener"
              aria-label={t("app.rail.website")}
            >
              <AppLogo variant={props.variant} />
            </a>
          </MotionTooltip>
        )}
      </Show>
    </div>
  );
}

/**
 * The page rail at the left of the window, on desktop and on the web. Its buttons change the page in
 * the card. A usage ring shows the plan limits of one provider and opens the usage page.
 */
export function PageRail(props: PageRailProps) {
  const { t } = useText();
  return (
    <nav class="window-rail" aria-label={t("app.rail.label")} hidden={props.hidden}>
      <Show when={props.logo}>{(logo) => <RailLogo variant={logo().variant} href={logo().href} />}</Show>
      <div class="window-rail-group">
        <RailButton label={t("app.rail.agents")} current={props.current === "agents"} onClick={props.onAgents}>
          <Bot aria-hidden="true" />
        </RailButton>
        <Show when={props.onRoutines}>
          {(onRoutines) => (
            <RailButton
              label={t("sidebar.view.routines")}
              current={props.current === "routines"}
              onClick={() => onRoutines()()}
            >
              <Workflow aria-hidden="true" />
            </RailButton>
          )}
        </Show>
        <Show when={props.onTasks}>
          {(onTasks) => (
            <RailButton
              label={t("app.rail.tasks")}
              current={props.current === "tasks"}
              onClick={(button) => onTasks()(button)}
            >
              <ListChecks aria-hidden="true" />
            </RailButton>
          )}
        </Show>
        <Show when={props.onSchedule}>
          {(onSchedule) => (
            <RailButton
              label={t("app.rail.schedule")}
              current={props.current === "schedule"}
              onClick={(button) => onSchedule()(button)}
            >
              <CalendarClock aria-hidden="true" />
            </RailButton>
          )}
        </Show>
        <RailButton label={t("app.rail.usage")} current={props.current === "usage"} onClick={props.onUsage}>
          <ChartArea aria-hidden="true" />
        </RailButton>
      </div>
      <div class="window-rail-group">
        {/* A status update builds new rows. The key keeps each ring, and its open hover card, mounted. */}
        <For
          each={props.usageRows.filter((row) => row.reportsUsage && row.windows.length > 0)}
          keyed={accountUsageRowKey}
        >
          {(row) => <UsageRings row={row()} onOpen={props.onUsage} />}
        </For>
        <For each={props.customAgentUsage ?? []} keyed={(row) => row.id}>
          {(row) => <CustomAgentUsageButton row={row()} onOpen={props.onUsage} />}
        </For>
        <Show when={props.onMarketplace}>
          {(onMarketplace) => (
            <RailButton
              label={t("app.rail.marketplace")}
              current={props.current === "marketplace"}
              onClick={() => onMarketplace()()}
            >
              <Store aria-hidden="true" />
            </RailButton>
          )}
        </Show>
        {props.help}
        <RailButton
          label={
            props.settingsNotice
              ? t("app.rail.settingsNotice", { notice: props.settingsNotice })
              : t("app.rail.settings")
          }
          current={props.current === "settings"}
          onClick={props.onSettings}
        >
          <Settings aria-hidden="true" />
          <Show when={props.settingsNotice}>
            <span class="window-rail-notice" aria-hidden="true" />
          </Show>
        </RailButton>
      </div>
    </nav>
  );
}
