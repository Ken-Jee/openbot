import type { VaultImportResult, VaultSaveInput, VaultSecretRequest, VaultState } from "@openbot/contracts/ipc";

/** The Vault of this computer. Only main can read it: a joined server's Vault stays on its host. */
export interface VaultCalls {
  list(): Promise<VaultState>;
  save(input: VaultSaveInput): Promise<VaultState>;
  remove(id: string): Promise<VaultState>;
  reveal(request: VaultSecretRequest): Promise<string>;
  copy(request: VaultSecretRequest): Promise<void>;
  importCsv(): Promise<VaultImportResult>;
  reset(): Promise<VaultState>;
  /** Returns the function that stops the subscription. */
  onChanged(listener: (state: VaultState) => void): () => void;
}

/** The desktop calls. Reads `window.openbot` on each call: stories replace it per case. */
export function desktopVaultCalls(): VaultCalls {
  const vault = () => window.openbot.vault;
  return {
    list: () => vault().list(),
    save: (input) => vault().save(input),
    remove: (id) => vault().delete(id),
    reveal: (request) => vault().reveal(request),
    copy: (request) => vault().copy(request),
    importCsv: () => vault().importCsv(),
    reset: () => vault().reset(),
    onChanged: (listener) => vault().onChanged(listener),
  };
}
