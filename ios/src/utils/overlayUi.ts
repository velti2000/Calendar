/*
 * utils/overlayUi.ts  –  Antippen von NUR-LESEN-Overlay-Eintraegen
 * ==========================================================================
 * Externe Eintraege (Todoist, iPhone-Erinnerungen) sind rein lesend. Statt den
 * Termin-Editor zu oeffnen, zeigt diese Funktion nur eine Info – optional mit
 * Sprung in die Quell-App. Verwaltet werden die Eintraege in der jeweiligen App.
 */

import { Alert, Linking } from "react-native";
import type { CalEvent } from "../types";
import { formatTime } from "./dates";

export function presentOverlayItem(ev: CalEvent): void {
  const sourceName = ev.source === "todoist" ? "Todoist-Aufgabe" : "iPhone-Erinnerung";
  const when = ev.allDay
    ? "Fällig: ganztägig"
    : `Fällig: ${formatTime(new Date(ev.start))} Uhr`;

  const buttons: { text: string; onPress?: () => void; style?: "cancel" }[] = [];
  if (ev.externalUrl) {
    buttons.push({
      text: ev.source === "todoist" ? "In Todoist öffnen" : "Öffnen",
      onPress: () => Linking.openURL(ev.externalUrl!),
    });
  }
  buttons.push({ text: "Schließen", style: "cancel" });

  Alert.alert(ev.title, `${sourceName}\n${when}`, buttons);
}
