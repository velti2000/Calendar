/*
 * screens/EventEditorScreen.tsx  –  Termin anlegen / aendern / loeschen
 * ==========================================================================
 * Portierung von pwa/js/views/eventEditor.js:
 *   Titel · Kategorie (Kalender) · ganztaegig · Beginn/Ende · Wiederholung ·
 *   Erinnerung · Ort · Notizen · Loeschen mit Bestaetigung.
 *
 * Neue Termine starten standardmaessig um 8:00 Uhr (wie in der PWA).
 * Nach jeder Aenderung werden die lokalen Erinnerungen neu geplant.
 */

import React, { useState, useMemo } from "react";
import {
  View, Text, TextInput, Switch, Pressable, ScrollView, Alert, StyleSheet,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../navigation";
import { useStore, pushEventToServer, deleteEventEverywhere } from "../store/useStore";
import { useTheme } from "../theme/useTheme";
import { dateFromKey, addDays } from "../utils/dates";
import { rescheduleAll } from "../notifications/reminders";
import RecurrenceEditor from "../components/RecurrenceEditor";

type Props = NativeStackScreenProps<RootStackParamList, "EventEditor">;

/** Feste Auswahlmoeglichkeiten fuer die Erinnerung (Minuten vor Beginn). */
const REMINDER_OPTIONS = [
  { label: "Keine", value: -1 },
  { label: "Zum Termin", value: 0 },
  { label: "10 Min", value: 10 },
  { label: "30 Min", value: 30 },
  { label: "1 Std", value: 60 },
  { label: "6 Std", value: 360 },
  { label: "12 Std", value: 720 },
  { label: "1 Tag", value: 1440 },
];

const REMINDER_PRESET_VALUES = REMINDER_OPTIONS.map((o) => o.value);

/** Minuten -> Datum mit passender Stunde/Minute (fuer das Zeit-Wählrad). */
function minutesToWheelDate(total: number): Date {
  const d = new Date(2000, 0, 1, Math.floor(total / 60) % 24, total % 60, 0);
  return d;
}

export default function EventEditorScreen({ route, navigation }: Props) {
  const theme = useTheme();
  const { calendars, events, settings, addEvent, updateEvent } = useStore();

  const existing = route.params.uid
    ? events.find((e) => e.uid === route.params.uid) || null
    : null;

  // Als Kategorie nur die in den Einstellungen AKTIVIERTEN (sichtbaren) Kalender
  // anbieten. Ausnahme: Bearbeitet man einen Termin, dessen Kalender gerade
  // ausgeblendet ist, bleibt dieser dennoch waehlbar (sonst ginge er verloren).
  const categoryOptions = useMemo(() => {
    const visible = calendars.filter((c) => c.visible);
    if (existing && !visible.some((c) => c.id === existing.calendarId)) {
      const current = calendars.find((c) => c.id === existing.calendarId);
      if (current) return [current, ...visible];
    }
    return visible;
  }, [calendars, existing]);

  // Anfangswerte: bestehender Termin ODER neuer Termin. Standard-Beginn 8:00,
  // oder die in der Tagesansicht angetippte Stunde (startHour).
  const baseDay = route.params.dateKey ? dateFromKey(route.params.dateKey) : new Date();
  const startHour = route.params.startHour ?? 8;
  const defaultStart = new Date(baseDay.getFullYear(), baseDay.getMonth(), baseDay.getDate(), startHour, 0);
  const defaultEnd = new Date(baseDay.getFullYear(), baseDay.getMonth(), baseDay.getDate(), startHour + 1, 0);

  const [title, setTitle] = useState(existing?.title ?? "");
  const [calendarId, setCalendarId] = useState(existing?.calendarId ?? categoryOptions[0]?.id ?? "");
  const [allDay, setAllDay] = useState(existing?.allDay ?? false);
  const [start, setStart] = useState(existing ? new Date(existing.start) : defaultStart);
  const [end, setEnd] = useState(existing ? new Date(existing.end) : defaultEnd);
  const [rrule, setRrule] = useState(existing?.rrule ?? "");
  const initialReminder = existing?.reminders?.length ? existing.reminders[0] : settings.defaultReminder;
  const [reminder, setReminder] = useState<number>(initialReminder);
  // "Frei einstellbar": aktiv, wenn der Wert nicht zu den festen Optionen passt.
  const [customReminder, setCustomReminder] = useState<boolean>(
    initialReminder >= 0 && !REMINDER_PRESET_VALUES.includes(initialReminder)
  );
  const [location, setLocation] = useState(existing?.location ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");

  React.useLayoutEffect(() => {
    navigation.setOptions({ title: existing ? "Termin bearbeiten" : "Neuer Termin" });
  }, [navigation, existing]);

  const save = async () => {
    // Bei Ganztags gilt die iCal-Konvention: Ende = Folgetag 00:00.
    const startISO = allDay
      ? new Date(start.getFullYear(), start.getMonth(), start.getDate()).toISOString()
      : start.toISOString();
    const endISO = allDay
      ? addDays(new Date(end.getFullYear(), end.getMonth(), end.getDate()), 1).toISOString()
      : end.toISOString();

    if (!allDay && end <= start) {
      Alert.alert("Hinweis", "Das Ende muss nach dem Beginn liegen.");
      return;
    }

    const data = {
      title: title.trim() || "(ohne Titel)",
      calendarId,
      allDay,
      start: startISO,
      end: endISO,
      location: location.trim(),
      notes: notes.trim(),
      reminders: reminder >= 0 ? [reminder] : [],
      rrule: rrule || null,
    };

    // 1) Lokal speichern (sofort sichtbar).
    const savedUid = existing ? existing.uid : addEvent(data).uid;
    if (existing) updateEvent(existing.uid, data);

    // 2) Erinnerungen neu planen (falls Benachrichtigungen aktiv sind).
    if (settings.notificationsEnabled) {
      const s = useStore.getState();
      rescheduleAll(s.events, s.calendars).catch(() => {});
    }

    navigation.goBack();

    // 3) Auf den Server schreiben (nur bei CalDAV und ausgeschaltetem Nur-Lesen).
    try {
      const result = await pushEventToServer(savedUid);
      if (result === "readonly") {
        Alert.alert(
          "Nur lokal gespeichert",
          "Nur-Lesen ist aktiv – die Änderung wurde NICHT auf den Server geschrieben und geht beim nächsten Sync verloren. Zum Schreiben den Schalter in den Einstellungen ausschalten."
        );
      }
    } catch (err: any) {
      Alert.alert(
        "Server-Speichern fehlgeschlagen",
        `${err?.message ?? err}\n\nDer Termin ist lokal gespeichert.`
      );
    }
  };

  /** Erinnerungen nach einer Aenderung neu planen. */
  const refreshReminders = () => {
    if (settings.notificationsEnabled) {
      const s = useStore.getState();
      rescheduleAll(s.events, s.calendars).catch(() => {});
    }
  };

  /** Ganze Serie bzw. Einzeltermin endgueltig loeschen (lokal + Server). */
  const deleteWhole = async () => {
    if (!existing) return;
    navigation.goBack();
    try {
      const result = await deleteEventEverywhere(existing.uid);
      if (result === "readonly") {
        Alert.alert(
          "Nur lokal gelöscht",
          "Nur-Lesen ist aktiv – auf dem Server bleibt der Termin bestehen und kommt beim nächsten Sync zurück."
        );
      }
    } catch (err: any) {
      Alert.alert(
        "Server-Löschen fehlgeschlagen",
        `${err?.message ?? err}\n\nLokal wurde der Termin entfernt.`
      );
    }
    refreshReminders();
  };

  /**
   * Nur EIN Vorkommen einer Serie loeschen: der Tag wird als Ausnahme
   * (EXDATE) am Serientermin vermerkt und die Serie neu zum Server geschrieben.
   */
  const deleteSingleOccurrence = async () => {
    if (!existing) return;
    const key = route.params.occurrenceDateKey!;
    updateEvent(existing.uid, {
      exdates: [...(existing.exdates || []), key],
    });
    navigation.goBack();
    try {
      const result = await pushEventToServer(existing.uid);
      if (result === "readonly") {
        Alert.alert(
          "Nur lokal gelöscht",
          "Nur-Lesen ist aktiv – die Ausnahme wurde NICHT auf den Server geschrieben und geht beim nächsten Sync verloren."
        );
      }
    } catch (err: any) {
      Alert.alert(
        "Server-Speichern fehlgeschlagen",
        `${err?.message ?? err}\n\nDie Ausnahme ist nur lokal gespeichert.`
      );
    }
    refreshReminders();
  };

  const confirmDelete = () => {
    if (!existing) return;

    // Serie + angetipptes Vorkommen bekannt -> Auswahl anbieten.
    if (existing.rrule && route.params.occurrenceDateKey) {
      Alert.alert(
        "Serientermin löschen",
        `„${existing.title}" ist ein Serientermin.`,
        [
          { text: "Abbrechen", style: "cancel" },
          { text: "Nur diesen Termin", style: "destructive", onPress: deleteSingleOccurrence },
          { text: "Ganze Serie", style: "destructive", onPress: deleteWhole },
        ]
      );
      return;
    }

    Alert.alert(
      "Termin löschen?",
      existing.rrule
        ? `„${existing.title}" ist ein Serientermin – die GESAMTE Serie wird gelöscht.`
        : `„${existing.title}" wird gelöscht.`,
      [
        { text: "Abbrechen", style: "cancel" },
        { text: "Löschen", style: "destructive", onPress: deleteWhole },
      ]
    );
  };

  const inputStyle = [styles.input, {
    color: theme.text, backgroundColor: theme.surface, borderColor: theme.border,
  }];

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      // iOS: schiebt den Inhalt automatisch ueber die Tastatur und scrollt das
      // fokussierte Feld (z.B. Notizen ganz unten) in den sichtbaren Bereich.
      automaticallyAdjustKeyboardInsets
    >
      <Text style={[styles.label, { color: theme.textMuted }]}>Titel</Text>
      <TextInput
        style={inputStyle} value={title} onChangeText={setTitle}
        placeholder="Titel" placeholderTextColor={theme.textMuted}
      />

      <Text style={[styles.label, { color: theme.textMuted }]}>Kategorie</Text>
      <View style={styles.chipRow}>
        {categoryOptions.map((cal) => (
          <Pressable
            key={cal.id}
            style={[
              styles.chip,
              { borderColor: cal.color },
              calendarId === cal.id && { backgroundColor: cal.color },
            ]}
            onPress={() => setCalendarId(cal.id)}
          >
            <Text style={{ color: calendarId === cal.id ? "#fff" : cal.color, fontSize: 13 }}>
              {cal.name}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.switchRow}>
        <Text style={[styles.switchLabel, { color: theme.text }]}>Ganztägig</Text>
        <Switch value={allDay} onValueChange={setAllDay} />
      </View>

      <Text style={[styles.label, { color: theme.textMuted }]}>Beginn</Text>
      <DateTimePicker
        value={start}
        mode={allDay ? "date" : "datetime"}
        locale="de-DE"
        onChange={(_, d) => {
          if (!d) return;
          setStart(d);
          // Ende automatisch mitschieben, wenn es sonst vor dem Beginn laege.
          if (end <= d) setEnd(new Date(d.getTime() + 60 * 60 * 1000));
        }}
      />

      <Text style={[styles.label, { color: theme.textMuted }]}>Ende</Text>
      <DateTimePicker
        value={end}
        mode={allDay ? "date" : "datetime"}
        locale="de-DE"
        onChange={(_, d) => d && setEnd(d)}
      />

      <Text style={[styles.label, { color: theme.textMuted }]}>Wiederholung</Text>
      <RecurrenceEditor
        value={rrule || ""}
        startDate={start}
        onChange={setRrule}
      />

      <Text style={[styles.label, { color: theme.textMuted }]}>Erinnerung</Text>
      <View style={styles.chipRow}>
        {REMINDER_OPTIONS.map((opt) => {
          const active = !customReminder && reminder === opt.value;
          return (
            <Pressable
              key={opt.value}
              style={[styles.chip, { borderColor: theme.accent }, active && { backgroundColor: theme.accent }]}
              onPress={() => { setCustomReminder(false); setReminder(opt.value); }}
            >
              <Text style={{ color: active ? "#fff" : theme.accent, fontSize: 13 }}>{opt.label}</Text>
            </Pressable>
          );
        })}
        {/* Frei einstellbar: blendet Stunden-/Minuten-Wählräder ein */}
        <Pressable
          style={[styles.chip, { borderColor: theme.accent }, customReminder && { backgroundColor: theme.accent }]}
          onPress={() => {
            setCustomReminder(true);
            // Bei Umschalten aus einem Preset einen sinnvollen Startwert setzen.
            if (reminder < 0 || REMINDER_PRESET_VALUES.includes(reminder)) setReminder(120);
          }}
        >
          <Text style={{ color: customReminder ? "#fff" : theme.accent, fontSize: 13 }}>Frei…</Text>
        </Pressable>
      </View>

      {customReminder && (
        <View style={styles.customReminderRow}>
          <Text style={[styles.customReminderLabel, { color: theme.text }]}>
            {Math.floor(reminder / 60)} Std {reminder % 60} Min vorher
          </Text>
          <DateTimePicker
            value={minutesToWheelDate(reminder)}
            mode="time"
            display="spinner"
            locale="de-DE"
            is24Hour
            onChange={(_, d) => { if (d) setReminder(d.getHours() * 60 + d.getMinutes()); }}
          />
        </View>
      )}

      <Text style={[styles.label, { color: theme.textMuted }]}>Ort</Text>
      <TextInput
        style={inputStyle} value={location} onChangeText={setLocation}
        placeholder="Ort" placeholderTextColor={theme.textMuted}
      />

      <Text style={[styles.label, { color: theme.textMuted }]}>Notizen</Text>
      <TextInput
        style={[...inputStyle, styles.notesInput]} value={notes} onChangeText={setNotes}
        placeholder="Notizen" placeholderTextColor={theme.textMuted}
        multiline
      />

      <Pressable style={[styles.saveBtn, { backgroundColor: theme.accent }]} onPress={save}>
        <Text style={styles.saveBtnText}>Speichern</Text>
      </Pressable>

      {existing && (
        <Pressable style={styles.deleteBtn} onPress={confirmDelete}>
          <Text style={[styles.deleteBtnText, { color: theme.danger }]}>Termin löschen</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48 },
  label: { fontSize: 13, fontWeight: "600", marginTop: 14, marginBottom: 6 },
  input: {
    borderWidth: StyleSheet.hairlineWidth, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 16,
  },
  notesInput: { minHeight: 80, textAlignVertical: "top" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1.5, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 5,
  },
  customReminderRow: { marginTop: 8, alignItems: "center" },
  customReminderLabel: { fontSize: 14, fontWeight: "500", marginBottom: -4 },
  switchRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 16,
  },
  switchLabel: { fontSize: 16 },
  saveBtn: {
    marginTop: 28, borderRadius: 10, paddingVertical: 14, alignItems: "center",
  },
  saveBtnText: { color: "#fff", fontSize: 17, fontWeight: "600" },
  deleteBtn: { marginTop: 16, alignItems: "center", paddingVertical: 10 },
  deleteBtnText: { fontSize: 16 },
});
