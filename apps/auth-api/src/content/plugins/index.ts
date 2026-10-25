import { AAVE_PLUGIN_GUIDE } from "./aave";
import { AIRTABLE_PLUGIN_GUIDE } from "./airtable";
import { BRAVE_SEARCH_PLUGIN_GUIDE } from "./brave-search";
import { CANVA_PLUGIN_GUIDE } from "./canva";
import { COBRAIN_PLUGIN_GUIDE } from "./cobrain";
import { COMPOSIO_PLUGIN_GUIDE } from "./composio";
import { CONTEXT7_PLUGIN_GUIDE } from "./context7";
import { FIGMA_PLUGIN_GUIDE } from "./figma";
import { FIRECRAWL_PLUGIN_GUIDE } from "./firecrawl";
import { LINEAR_PLUGIN_GUIDE } from "./linear";
import { NOTION_PLUGIN_GUIDE } from "./notion";
import { PAPER_PLUGIN_GUIDE } from "./paper";
import type { PluginGuide } from "./plugin-guide";
import { POSTHOG_PLUGIN_GUIDE } from "./posthog";
import { RESEND_PLUGIN_GUIDE } from "./resend";
import { SENTRY_PLUGIN_GUIDE } from "./sentry";
import { STRIPE_PLUGIN_GUIDE } from "./stripe";
import { VERCEL_PLUGIN_GUIDE } from "./vercel";

// The written part of each plugin page, by catalog slug. A listing with no entry here
// still has its page, without the uses, the questions and the sources.

const PLUGIN_GUIDES: Readonly<Record<string, PluginGuide>> = {
  aave: AAVE_PLUGIN_GUIDE,
  airtable: AIRTABLE_PLUGIN_GUIDE,
  "brave-search": BRAVE_SEARCH_PLUGIN_GUIDE,
  canva: CANVA_PLUGIN_GUIDE,
  cobrain: COBRAIN_PLUGIN_GUIDE,
  composio: COMPOSIO_PLUGIN_GUIDE,
  context7: CONTEXT7_PLUGIN_GUIDE,
  figma: FIGMA_PLUGIN_GUIDE,
  firecrawl: FIRECRAWL_PLUGIN_GUIDE,
  linear: LINEAR_PLUGIN_GUIDE,
  notion: NOTION_PLUGIN_GUIDE,
  paper: PAPER_PLUGIN_GUIDE,
  posthog: POSTHOG_PLUGIN_GUIDE,
  resend: RESEND_PLUGIN_GUIDE,
  sentry: SENTRY_PLUGIN_GUIDE,
  stripe: STRIPE_PLUGIN_GUIDE,
  vercel: VERCEL_PLUGIN_GUIDE,
};

export function findPluginGuide(slug: string): PluginGuide | null {
  return PLUGIN_GUIDES[slug] ?? null;
}
