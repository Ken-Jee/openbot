import {
  EMPTY_VAULT,
  type OpenBotDesktopApi,
  type VaultItemSummary,
  type VaultSaveInput,
  type VaultSecretField,
  type VaultState,
} from "@openbot/contracts/ipc";

function brandOf(number: string): "visa" | "mastercard" | "amex" | "discover" | null {
  if (number.startsWith("4")) return "visa";
  if (/^5[1-5]/u.test(number)) return "mastercard";
  if (/^3[47]/u.test(number)) return "amex";
  if (number.startsWith("6")) return "discover";
  return null;
}

/** An empty Vault kept in memory. The import adds one login, as if the user chose a CSV file. */
export function createMockVault(): OpenBotDesktopApi["vault"] {
  let state: VaultState = EMPTY_VAULT;
  const secrets = new Map<string, Partial<Record<VaultSecretField, string>>>();
  const listeners = new Set<(state: VaultState) => void>();
  let nextId = 1;
  const change = (items: VaultItemSummary[]) => {
    state = { status: "ready", items };
    for (const listener of listeners) listener(state);
    return state;
  };
  const summary = (input: VaultSaveInput, id: string): VaultItemSummary => {
    const saved = secrets.get(id) ?? {};
    if (input.kind === "login") {
      if (input.password !== null) saved.password = input.password;
      secrets.set(id, saved);
      const { password: _password, ...login } = input;
      return { ...login, id, hasPassword: Boolean(saved.password) };
    }
    if (input.kind === "card") {
      if (input.number !== null) saved.number = input.number.replace(/\D/gu, "");
      if (input.securityCode !== null) saved.securityCode = input.securityCode;
      secrets.set(id, saved);
      const { number: _number, securityCode: _securityCode, fillSites = [], ...card } = input;
      const number = saved.number ?? "";
      return { ...card, id, brand: brandOf(number), last4: number.slice(-4), fillSites };
    }
    return { ...input, id };
  };
  return {
    list: async () => state,
    save: async (input) => {
      const id = input.id ?? `mock-${nextId++}`;
      const item = summary(input, id);
      const exists = state.items.some((current) => current.id === id);
      return change(
        exists ? state.items.map((current) => (current.id === id ? item : current)) : [...state.items, item],
      );
    },
    delete: async (id) => {
      secrets.delete(id);
      return change(state.items.filter((item) => item.id !== id));
    },
    reveal: async ({ id, field }) => secrets.get(id)?.[field] ?? "",
    copy: async () => undefined,
    importCsv: async () => {
      const id = `mock-${nextId++}`;
      const item = summary(
        {
          kind: "login",
          id: null,
          website: "example.com",
          username: "user@example.com",
          notes: "",
          password: "imported",
        },
        id,
      );
      return { imported: 1, skipped: 0, state: change([...state.items, item]) };
    },
    reset: async () => {
      secrets.clear();
      return change([]);
    },
    onChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
