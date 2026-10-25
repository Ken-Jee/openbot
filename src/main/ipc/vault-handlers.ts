// The Vault of this computer, for Server settings of the local server. Main opens the CSV file dialog
// and writes the clipboard, so a copied secret does not pass through the renderer.

import { readFile, stat } from "node:fs/promises";
import type { AppTranslate } from "@openbot/i18n";
import { sourceText } from "@openbot/i18n/source";
import { type BrowserWindow, clipboard, dialog, type OpenDialogOptions } from "electron";
import { runCauseEffect } from "../../backend/effect-boundary";
import { decodeVaultSaveInput, decodeVaultSecretRequest } from "../vault-inputs";
import { VAULT_CSV_LIMIT, type VaultService } from "../vault-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { stringPayload } from "./validation";

export interface VaultIpcDependencies {
  vault: VaultService;
  getMainWindow: () => BrowserWindow | null;
  translate: AppTranslate;
}

export function vaultIpcHandlers({
  vault,
  getMainWindow,
  translate,
}: VaultIpcDependencies): Pick<IpcGroupHandlers, "vault"> {
  const chooseCsv = async (): Promise<string | null> => {
    const mainWindow = getMainWindow();
    const options: OpenDialogOptions = {
      title: translate("dialog.chooseVaultCsv"),
      properties: ["openFile"],
      filters: [{ name: translate("dialog.filter.csv"), extensions: ["csv"] }],
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  };

  return {
    vault: {
      list: handler(() => vault.state()),
      save: payloadHandler(decodeVaultSaveInput, (input) => runCauseEffect(vault.save(input))),
      delete: payloadHandler(stringPayload("id", 64), (id) => runCauseEffect(vault.delete(id))),
      reveal: payloadHandler(decodeVaultSecretRequest, (request) => vault.reveal(request)),
      copy: payloadHandler(decodeVaultSecretRequest, (request) => {
        clipboard.writeText(vault.reveal(request));
      }),
      importCsv: handler(async () => {
        const path = await chooseCsv();
        if (!path) return null;
        const info = await stat(path);
        if (!info.isFile()) throw new Error(sourceText("error.vault.csvInvalid"));
        if (info.size > VAULT_CSV_LIMIT) throw new Error(sourceText("error.vault.csvTooLarge"));
        return runCauseEffect(vault.importCsv(await readFile(path, "utf8")));
      }),
      reset: handler(() => runCauseEffect(vault.reset())),
    },
  };
}
