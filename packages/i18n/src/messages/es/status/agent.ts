import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/agent";

export const messages = {
  "status.agent.claudeWriteOutside":
    "Escribir en {path}, fuera del espacio de trabajo del agente, la carpeta compartida y las carpetas temporales.",
  "status.agent.contextCleared": "Contexto borrado. Aquí empieza un nuevo chat.",
  "status.agent.modelSwitchedForLimit": "Límite de uso alcanzado. Se cambió a {model}.",
  "status.agent.modelReturnedAfterLimit": "El límite de uso terminó. Se volvió a {model}.",
  "status.agent.modelSwitchedForError": "Error del proveedor. Se cambió a {model}.",
  "status.agent.modelReturnedAfterError": "Se volvió a {model} tras el error del proveedor.",
  "status.agent.marketplaceSuggested": "Se sugirió una aplicación de Marketplace: {app}.",
  "status.agent.channelMemberAdded": "{agent} agregó a {member} al canal. {person} lo pidió.",
  "status.agent.channelMemberRemoved": "{agent} quitó a {member} del canal. {person} lo pidió.",
  "status.agent.channelInstructionsChanged": "{agent} cambió las instrucciones del canal. {person} lo pidió.",
  "status.agent.channelRoutineCreated": "{agent} creó la rutina {routine}. {person} lo pidió.",
  "status.agent.channelRoutineUpdated": "{agent} cambió la rutina {routine}. {person} lo pidió.",
  "status.agent.channelRoutineDeleted": "{agent} eliminó la rutina {routine}. {person} lo pidió.",
  "status.agent.screenCaptureScreen": "Capturar la pantalla principal y enviar la imagen al modelo del agente.",
  "status.agent.screenCaptureChannel":
    "La imagen aparece en el canal {channel}, y cada miembro de este servidor que lee el canal puede verla.",
  "status.agent.screenCaptureDisplay": "Capturar la pantalla {name} y enviar la imagen al modelo del agente.",
  "status.agent.screenCaptureWindow": "Capturar la ventana {name} y enviar la imagen al modelo del agente.",
  "status.agent.screenCaptureRegion":
    "Capturar el área de la pantalla en {x}, {y}, de {width} × {height} puntos, y enviar la imagen al modelo del agente.",
  "status.agent.screenCaptureProgress": "Pidiendo permiso para capturar la pantalla…",
  "status.agent.screenCaptureReviewing": "Revisando la captura de pantalla…",
  "status.agent.memoriesSearching": "Buscando en sus recuerdos…",
  "status.agent.memoriesSearched": {
    one: "Buscó en sus recuerdos: {count} encontrado",
    other: "Buscó en sus recuerdos: {count} encontrados",
  },
  "status.agent.memoriesUpdating": "Actualizando sus recuerdos…",
  "status.agent.skillUsing": "Usando la habilidad {name}…",
  "status.agent.skillReading": "Leyendo una habilidad…",
  "status.agent.memoryChanges": "Recuerdos: {saved} guardados, {updated} actualizados, {forgotten} olvidados.",
} as const satisfies PartialTranslation<typeof source>;
