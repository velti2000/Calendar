/*
 * notifications/reminders.ts  –  Termin-Erinnerungen als echte iOS-Benachrichtigungen
 * ==========================================================================
 * DER grosse Vorteil der nativen App gegenueber der PWA: iOS liefert geplante
 * lokale Benachrichtigungen zuverlaessig aus – auch wenn die App geschlossen
 * ist. (In der PWA gingen Erinnerungen nur bei geoeffneter App.)
 *
 * Strategie: Nach jeder Datenaenderung/jedem Sync werden alle anstehenden
 * Erinnerungen neu geplant (erst alle alten abraeumen, dann neu setzen).
 * iOS erlaubt maximal 64 geplante Benachrichtigungen pro App – deshalb
 * planen wir nur die naechsten 60.
 */

import * as Notifications from "expo-notifications";
import * as Device from "expo-device";

import type { CalEvent, Calendar } from "../types";
import { getVisibleEvents } from "../store/useStore";
import { formatTime } from "../utils/dates";

// Benachrichtigungen auch anzeigen, wenn die App gerade offen ist.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Fragt die Benachrichtigungs-Erlaubnis beim Nutzer an.
 * @returns true, wenn erlaubt.
 */
export async function requestPermission(): Promise<boolean> {
  if (!Device.isDevice) return false; // Simulator kann keine Push-Erlaubnis
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  const result = await Notifications.requestPermissionsAsync();
  return result.granted;
}

/**
 * Plant alle anstehenden Erinnerungen neu.
 * Aufrufen nach: Sync, Termin anlegen/aendern/loeschen, App-Start.
 */
export async function rescheduleAll(events: CalEvent[], calendars: Calendar[]): Promise<number> {
  // Erst alle bisher geplanten Benachrichtigungen entfernen.
  await Notifications.cancelAllScheduledNotificationsAsync();

  const now = Date.now();
  const upcoming: { date: Date; event: CalEvent; minutes: number }[] = [];

  for (const event of getVisibleEvents(events, calendars)) {
    for (const minutes of event.reminders || []) {
      const fireAt = new Date(new Date(event.start).getTime() - minutes * 60 * 1000);
      if (fireAt.getTime() > now) {
        upcoming.push({ date: fireAt, event, minutes });
      }
    }
  }

  // Nach Zeitpunkt sortieren und auf die iOS-Grenze beschraenken.
  upcoming.sort((a, b) => a.date.getTime() - b.date.getTime());
  const toSchedule = upcoming.slice(0, 60);

  for (const { date, event } of toSchedule) {
    const start = new Date(event.start);
    const body = event.allDay
      ? "Ganztägig"
      : `${formatTime(start)} Uhr${event.location ? " · " + event.location : ""}`;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: event.title,
        body,
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date,
      },
    });
  }
  return toSchedule.length;
}
