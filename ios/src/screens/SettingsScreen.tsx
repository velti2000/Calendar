/*
 * screens/SettingsScreen.tsx  –  Einstellungen
 * ==========================================================================
 * Portierung von pwa/js/views/settingsView.js:
 *   - Darstellung: Theme (auto/hell/dunkel), Position der Navigationsleiste
 *   - Kalender: Sichtbarkeit einzelner Kategorien
 *   - Benachrichtigungen: Erlaubnis anfragen + Erinnerungen planen
 *   - mailbox.org: Benutzername, App-Passwort (-> iOS-Schluesselbund),
 *     Verbindung testen, Sync Server -> App
 *   - Sicherheit: Nur-Lesen-Schalter (Standard AN)
 */

import React, { useEffect, useState } from "react";
import {
  View, Text, TextInput, Switch, Pressable, ScrollView, Alert, StyleSheet,
} from "react-native";
import * as SecureStore from "expo-secure-store";

import {
  useStore, savePassword, saveUsername, getStoredUsername, getCredentials,
  saveTodoistToken, getTodoistToken,
} from "../store/useStore";
import { useTheme } from "../theme/useTheme";
import * as caldav from "../data/caldav";
import { requestPermission, rescheduleAll } from "../notifications/reminders";
import { requestRemindersPermission } from "../data/appleReminders";
import { formatBandHour } from "../utils/timeBands";
import type { Settings } from "../types";

export default function SettingsScreen() {
  const theme = useTheme();
  const { settings, calendars, events, syncing, updateSettings, toggleCalendarVisible, setCalendarColor, resetToDemo, clearData, syncFromServer, syncTodoist, syncReminders } = useStore();

  // Welcher Kalender hat gerade die Farb-Auswahl offen? (null = keiner)
  const [colorEditId, setColorEditId] = useState<string | null>(null);

  // Fallback, falls ein gespeicherter Zustand das Feld noch nicht kennt.
  const dayStartHour = settings.dayStartHour ?? 6;

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [hasStoredPassword, setHasStoredPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  const [todoistToken, setTodoistToken] = useState("");
  const [hasStoredTodoistToken, setHasStoredTodoistToken] = useState(false);

  // Beim Oeffnen: gespeicherte Zugangsdaten aus dem Schluesselbund laden.
  useEffect(() => {
    getStoredUsername().then(setUsername);
    SecureStore.getItemAsync("mailbox.password").then((p) => setHasStoredPassword(!!p));
    getTodoistToken().then((t) => setHasStoredTodoistToken(!!t));
  }, []);

  /** Todoist-Token speichern und – falls aktiviert – gleich laden. */
  const saveTodoist = async () => {
    if (todoistToken) {
      await saveTodoistToken(todoistToken);
      setHasStoredTodoistToken(true);
      setTodoistToken("");
    }
    if (settings.todoistEnabled) {
      setBusy(true);
      try {
        await syncTodoist();
        Alert.alert("Gespeichert", `Todoist-Aufgaben geladen: ${useStore.getState().todoistTasks.length}.`);
      } catch (err: any) {
        Alert.alert("Todoist-Fehler", String(err?.message ?? err));
      } finally {
        setBusy(false);
      }
    } else {
      Alert.alert("Gespeichert", "Token gespeichert. Aktiviere „Aufgaben anzeigen“, um sie zu laden.");
    }
  };

  /** Todoist-Anzeige ein-/ausschalten. */
  const toggleTodoist = async (enabled: boolean) => {
    updateSettings({ todoistEnabled: enabled });
    setBusy(true);
    try {
      await syncTodoist(); // laedt bei an / leert bei aus
      if (enabled && !(await getTodoistToken())) {
        Alert.alert("Token fehlt", "Bitte zuerst dein Todoist-API-Token eintragen und speichern.");
      }
    } catch (err: any) {
      Alert.alert("Todoist-Fehler", String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  /** iPhone-Erinnerungen jetzt neu vom Gerät laden (manueller Sync-Button). */
  const refreshReminders = async () => {
    if (!settings.remindersEnabled) {
      Alert.alert("Nicht aktiv", "Bitte zuerst „Erinnerungen anzeigen“ einschalten.");
      return;
    }
    setBusy(true);
    try {
      await syncReminders();
      Alert.alert("Aktualisiert", `${useStore.getState().reminderItems.length} offene Erinnerungen geladen.`);
    } catch (err: any) {
      Alert.alert("Erinnerungen-Fehler", String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  /** iPhone-Erinnerungen ein-/ausschalten (beim Einschalten Berechtigung anfragen). */
  const toggleReminders = async (enabled: boolean) => {
    if (enabled) {
      const granted = await requestRemindersPermission();
      if (!granted) {
        Alert.alert(
          "Nicht erlaubt",
          "Bitte den Zugriff auf „Erinnerungen“ in den iOS-Einstellungen erlauben."
        );
        return;
      }
    }
    updateSettings({ remindersEnabled: enabled });
    setBusy(true);
    try {
      await syncReminders(); // laedt bei an / leert bei aus
    } catch (err: any) {
      Alert.alert("Erinnerungen-Fehler", String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  /** Eine Zeitphase (per Index) teilweise aktualisieren. */
  const updateBand = (index: number, patch: Partial<Settings["timeBands"][number]>) => {
    const bands = (settings.timeBands ?? []).map((b, i) => (i === index ? { ...b, ...patch } : b));
    updateSettings({ timeBands: bands });
  };

  /** Farbe einer Overlay-Quelle aendern und neu einfaerben. */
  const changeOverlayColor = async (which: "todoist" | "reminders", color: string) => {
    if (which === "todoist") {
      updateSettings({ todoistColor: color });
      if (settings.todoistEnabled) await syncTodoist().catch(() => {});
    } else {
      updateSettings({ remindersColor: color });
      if (settings.remindersEnabled) await syncReminders().catch(() => {});
    }
  };

  /**
   * Benutzername + Passwort im Schluesselbund speichern. Wird ein ANDERES Konto
   * eingegeben als bisher, werden die lokalen Daten des alten Kontos aus der
   * App geloescht (der Server bleibt unberuehrt).
   */
  const saveAccount = async () => {
    const newUsername = username.trim();
    const oldUsername = await getStoredUsername();
    const switchedAccount = !!oldUsername && !!newUsername && oldUsername !== newUsername;

    await saveUsername(newUsername);
    // Evtl. noch im normalen Speicher liegenden Klartext-Namen entfernen.
    if (settings.username) updateSettings({ username: "" });
    if (password) {
      await savePassword(password);
      setHasStoredPassword(true);
      setPassword("");
    }

    if (switchedAccount) {
      clearData(); // Termine + Kalender des alten Kontos aus der App entfernen
      // dataSource bleibt "caldav" – der Sync-Button lädt dann das neue Konto.
      Alert.alert(
        "Konto gewechselt",
        "Die Termine des vorherigen Kontos wurden aus der App entfernt (der Server bleibt unverändert). Tippe auf „Jetzt synchronisieren“, um die Termine des neuen Kontos zu laden."
      );
    } else {
      Alert.alert("Gespeichert", "Zugangsdaten wurden im Schlüsselbund gespeichert.");
    }
  };

  const testConnection = async () => {
    setBusy(true);
    try {
      await saveUsername(username.trim());
      if (password) { await savePassword(password); setHasStoredPassword(true); setPassword(""); }
      const creds = await getCredentials();
      if (!creds) throw new Error("Bitte zuerst Benutzername und Passwort eintragen.");
      const found = await caldav.discoverCalendars(creds);
      Alert.alert("Verbindung OK", `${found.length} Kalender gefunden:\n${found.map((c) => "• " + c.name).join("\n")}`);
    } catch (err: any) {
      Alert.alert("Fehler", String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
    setBusy(true);
    try {
      await syncFromServer();
      const s = useStore.getState();
      if (s.settings.notificationsEnabled) {
        await rescheduleAll(s.events, s.calendars);
      }
      Alert.alert("Sync fertig", `${s.events.length} Termine aus ${s.calendars.length} Kalendern geladen.`);
    } catch (err: any) {
      Alert.alert("Sync fehlgeschlagen", String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  const toggleNotifications = async (enabled: boolean) => {
    if (enabled) {
      const granted = await requestPermission();
      if (!granted) {
        Alert.alert("Nicht erlaubt", "Bitte Benachrichtigungen in den iOS-Einstellungen erlauben.");
        return;
      }
      updateSettings({ notificationsEnabled: true });
      const n = await rescheduleAll(events, calendars);
      Alert.alert("Erinnerungen aktiv", `${n} Erinnerungen geplant.`);
    } else {
      updateSettings({ notificationsEnabled: false });
    }
  };

  const toggleReadOnly = (readOnly: boolean) => {
    if (!readOnly) {
      // Ausschalten = Schreiben auf den Server erlauben -> Rueckfrage (wie PWA).
      Alert.alert(
        "Nur-Lesen ausschalten?",
        "Die App darf dann Termine auf dem Server anlegen, ändern und löschen.",
        [
          { text: "Abbrechen", style: "cancel" },
          { text: "Ausschalten", style: "destructive", onPress: () => updateSettings({ readOnly: false }) },
        ]
      );
    } else {
      updateSettings({ readOnly: true });
    }
  };

  const section = [styles.section, { backgroundColor: theme.surface, borderColor: theme.border }];
  const inputStyle = [styles.input, {
    color: theme.text, backgroundColor: theme.background, borderColor: theme.border,
  }];

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.container}>

      {/* ---------- Darstellung ---------- */}
      <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>DARSTELLUNG</Text>
      <View style={section}>
        <Text style={[styles.rowLabel, { color: theme.text }]}>Erscheinungsbild</Text>
        <SegmentRow
          options={[["auto", "Automatisch"], ["light", "Hell"], ["dark", "Dunkel"]]}
          value={settings.theme}
          onChange={(v) => updateSettings({ theme: v as Settings["theme"] })}
        />
        <Text style={[styles.rowLabel, { color: theme.text, marginTop: 14 }]}>Navigationsleiste</Text>
        <SegmentRow
          options={[["bottom", "Unten"], ["top", "Oben"]]}
          value={settings.navPosition}
          onChange={(v) => updateSettings({ navPosition: v as Settings["navPosition"] })}
        />

        {/* Schriftgroesse der Termine in der Monatsansicht */}
        <View style={[styles.switchRow, { marginTop: 14 }]}>
          <Text style={[styles.rowLabel, { color: theme.text }]}>Schriftgröße Termine</Text>
          <View style={styles.fontStepper}>
            <Pressable
              style={[styles.stepBtn, { borderColor: theme.accent, opacity: settings.eventFontSize <= 6 ? 0.35 : 1 }]}
              disabled={settings.eventFontSize <= 6}
              onPress={() => updateSettings({ eventFontSize: settings.eventFontSize - 1 })}
            >
              <Text style={{ color: theme.accent, fontSize: 18, fontWeight: "600" }}>−</Text>
            </Pressable>
            <Text style={[styles.stepValue, { color: theme.text }]}>{settings.eventFontSize}</Text>
            <Pressable
              style={[styles.stepBtn, { borderColor: theme.accent, opacity: settings.eventFontSize >= 14 ? 0.35 : 1 }]}
              disabled={settings.eventFontSize >= 14}
              onPress={() => updateSettings({ eventFontSize: settings.eventFontSize + 1 })}
            >
              <Text style={{ color: theme.accent, fontSize: 18, fontWeight: "600" }}>+</Text>
            </Pressable>
          </View>
        </View>
        <Text style={[styles.hint, { color: theme.textMuted }]}>
          Beispiel: <Text style={{ fontSize: settings.eventFontSize, color: theme.accent }}>09:00 Zahnarzt</Text>
        </Text>

        {/* Start-Stunde fuer Tages-/Wochenansicht */}
        <View style={[styles.switchRow, { marginTop: 14 }]}>
          <Text style={[styles.rowLabel, { color: theme.text }]}>Startzeit Tag/Woche</Text>
          <View style={styles.fontStepper}>
            <Pressable
              style={[styles.stepBtn, { borderColor: theme.accent, opacity: dayStartHour <= 0 ? 0.35 : 1 }]}
              disabled={dayStartHour <= 0}
              onPress={() => updateSettings({ dayStartHour: dayStartHour - 1 })}
            >
              <Text style={{ color: theme.accent, fontSize: 18, fontWeight: "600" }}>−</Text>
            </Pressable>
            <Text style={[styles.stepValue, { color: theme.text }]}>{dayStartHour} Uhr</Text>
            <Pressable
              style={[styles.stepBtn, { borderColor: theme.accent, opacity: dayStartHour >= 23 ? 0.35 : 1 }]}
              disabled={dayStartHour >= 23}
              onPress={() => updateSettings({ dayStartHour: dayStartHour + 1 })}
            >
              <Text style={{ color: theme.accent, fontSize: 18, fontWeight: "600" }}>+</Text>
            </Pressable>
          </View>
        </View>
        <Text style={[styles.hint, { color: theme.textMuted }]}>
          Beim Öffnen der Tages- und Wochenansicht wird automatisch zu dieser Uhrzeit gescrollt.
        </Text>
      </View>

      {/* ---------- Zeitphasen (Tag/Woche) ---------- */}
      <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>ZEITPHASEN (TAG/WOCHE)</Text>
      <View style={section}>
        <Text style={[styles.hint, { color: theme.textMuted, marginTop: 0 }]}>
          Hinterlegt bestimmte Uhrzeiten farbig – z.B. Müdigkeits-, Schlaf- oder
          Nachtphasen. Nur zur Orientierung bei der Planung; erscheint nur in
          Tages- und Wochenansicht. Phasen über Mitternacht sind möglich (z.B. 22–6 Uhr).
        </Text>

        {(settings.timeBands ?? []).map((band, i) => (
          <View
            key={i}
            style={[styles.bandBlock, i > 0 && { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth }]}
          >
            <View style={styles.switchRow}>
              <View style={styles.calName}>
                <View style={[styles.dot, { backgroundColor: band.color, opacity: band.enabled ? 1 : 0.3 }]} />
                <Text style={[styles.rowLabel, { color: theme.text }]}>Phase {i + 1}</Text>
              </View>
              <Switch value={band.enabled} onValueChange={(v) => updateBand(i, { enabled: v })} />
            </View>

            {band.enabled && (
              <>
                <View style={styles.bandTimes}>
                  <Text style={[styles.bandTimeLabel, { color: theme.text }]}>Von</Text>
                  <Stepper value={band.startHour} min={0} max={23.5} step={0.5} format={formatBandHour}
                    onChange={(v) => updateBand(i, { startHour: v })} />
                  <Text style={[styles.bandTimeLabel, { color: theme.text }]}>Bis</Text>
                  <Stepper value={band.endHour} min={0.5} max={24} step={0.5} format={formatBandHour}
                    onChange={(v) => updateBand(i, { endHour: v })} />
                </View>
                <ColorRow value={band.color} onChange={(c) => updateBand(i, { color: c })} />
              </>
            )}
          </View>
        ))}
      </View>

      {/* ---------- Kalender ---------- */}
      <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>KALENDER</Text>
      <View style={section}>
        {calendars.map((cal) => {
          // Ist dieser Kalender der Standard fuer neue Termine?
          const isDefault = settings.defaultCalendarId === cal.id;
          const editingColor = colorEditId === cal.id;
          return (
            <View key={cal.id}>
              <View style={styles.switchRow}>
                <View style={styles.calName}>
                  {/* Farbpunkt antippen -> Farb-Auswahl auf/zu */}
                  <Pressable onPress={() => setColorEditId(editingColor ? null : cal.id)} hitSlop={10}>
                    <View style={[styles.dotTappable, { backgroundColor: cal.color, borderColor: theme.border }]} />
                  </Pressable>
                  <Text style={[styles.rowLabel, { color: theme.text }]} numberOfLines={1}>{cal.name}</Text>
                </View>
                <View style={styles.calRight}>
                  {/* Stern = Standardkalender. Nochmal tippen hebt die Auswahl auf. */}
                  <Pressable
                    onPress={() => updateSettings({ defaultCalendarId: isDefault ? "" : cal.id })}
                    hitSlop={8}
                    style={styles.starBtn}
                  >
                    <Text style={{ fontSize: 20, color: isDefault ? theme.accent : theme.textMuted }}>
                      {isDefault ? "★" : "☆"}
                    </Text>
                  </Pressable>
                  <Switch value={cal.visible} onValueChange={() => toggleCalendarVisible(cal.id)} />
                </View>
              </View>
              {/* Farb-Auswahl (aufklappbar) */}
              {editingColor && (
                <ColorRow
                  value={cal.color}
                  onChange={(c) => { setCalendarColor(cal.id, c); setColorEditId(null); }}
                />
              )}
            </View>
          );
        })}
        <Text style={[styles.hint, { color: theme.textMuted }]}>
          Tippe auf den Farbpunkt, um die Kalenderfarbe zu ändern. ★ markiert den
          Standardkalender (bei neuen Terminen vorausgewählt). Der Schalter rechts
          blendet die Termine eines Kalenders ein/aus.
        </Text>
      </View>

      {/* ---------- Benachrichtigungen ---------- */}
      <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>BENACHRICHTIGUNGEN</Text>
      <View style={section}>
        <View style={styles.switchRow}>
          <Text style={[styles.rowLabel, { color: theme.text }]}>Erinnerungen aktiv</Text>
          <Switch value={settings.notificationsEnabled} onValueChange={toggleNotifications} />
        </View>
        <Text style={[styles.hint, { color: theme.textMuted }]}>
          Erinnerungen kommen als echte iOS-Benachrichtigungen – auch bei geschlossener App.
        </Text>
      </View>

      {/* ---------- mailbox.org ---------- */}
      <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>MAILBOX.ORG (CALDAV)</Text>
      <View style={section}>
        <Text style={[styles.rowLabel, { color: theme.text }]}>E-Mail-Adresse</Text>
        <TextInput
          style={inputStyle} value={username} onChangeText={setUsername}
          autoCapitalize="none" keyboardType="email-address"
          placeholder="name@mailbox.org" placeholderTextColor={theme.textMuted}
        />
        <Text style={[styles.rowLabel, { color: theme.text, marginTop: 10 }]}>App-Passwort</Text>
        <TextInput
          style={inputStyle} value={password} onChangeText={setPassword}
          secureTextEntry autoCapitalize="none"
          placeholder={hasStoredPassword ? "•••••• (gespeichert)" : "App-Passwort"}
          placeholderTextColor={theme.textMuted}
        />
        <Text style={[styles.hint, { color: theme.textMuted }]}>
          Das Passwort wird sicher im iOS-Schlüsselbund gespeichert. Empfehlung:
          eigenes App-Passwort bei mailbox.org anlegen, nicht das Hauptpasswort.
        </Text>

        <ActionButton label="Zugangsdaten speichern" onPress={saveAccount} theme={theme} disabled={busy} />
        <ActionButton label="Verbindung testen" onPress={testConnection} theme={theme} disabled={busy} />
        <ActionButton
          label={syncing || busy ? "Synchronisiere …" : "Jetzt synchronisieren (Server → App)"}
          onPress={syncNow} theme={theme} disabled={busy || syncing}
        />
        <ActionButton label="Zurück zu Demo-Daten" onPress={() => {
          Alert.alert("Demo-Daten laden?", "Die synchronisierten Termine werden lokal ersetzt.", [
            { text: "Abbrechen", style: "cancel" },
            { text: "Laden", onPress: () => { resetToDemo(); updateSettings({ dataSource: "demo" }); } },
          ]);
        }} theme={theme} disabled={busy} />
      </View>

      {/* ---------- Todoist (nur lesend) ---------- */}
      <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>TODOIST (NUR LESEN)</Text>
      <View style={section}>
        <View style={styles.switchRow}>
          <Text style={[styles.rowLabel, { color: theme.text }]}>Aufgaben anzeigen</Text>
          <Switch value={settings.todoistEnabled} onValueChange={toggleTodoist} disabled={busy} />
        </View>
        <Text style={[styles.hint, { color: theme.textMuted }]}>
          Zeigt Todoist-Aufgaben mit Fälligkeit im Kalender an. Es wird nur
          gelesen – Aufgaben verwaltest du in der Todoist-App.
        </Text>

        <Text style={[styles.rowLabel, { color: theme.text, marginTop: 10 }]}>API-Token</Text>
        <TextInput
          style={inputStyle} value={todoistToken} onChangeText={setTodoistToken}
          secureTextEntry autoCapitalize="none"
          placeholder={hasStoredTodoistToken ? "•••••• (gespeichert)" : "Todoist-API-Token"}
          placeholderTextColor={theme.textMuted}
        />
        <Text style={[styles.hint, { color: theme.textMuted }]}>
          Zu finden in Todoist → Einstellungen → Integrationen → Entwickler.
          Wird sicher im iOS-Schlüsselbund gespeichert.
        </Text>

        <Text style={[styles.rowLabel, { color: theme.text, marginTop: 10 }]}>Farbe</Text>
        <ColorRow value={settings.todoistColor} onChange={(c) => changeOverlayColor("todoist", c)} />

        <ActionButton
          label={busy ? "Lade …" : "Token speichern & laden"}
          onPress={saveTodoist} theme={theme} disabled={busy}
        />
      </View>

      {/* ---------- iPhone-Erinnerungen (nur lesend) ---------- */}
      <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>iPHONE-ERINNERUNGEN (NUR LESEN)</Text>
      <View style={section}>
        <View style={styles.switchRow}>
          <Text style={[styles.rowLabel, { color: theme.text }]}>Erinnerungen anzeigen</Text>
          <Switch value={settings.remindersEnabled} onValueChange={toggleReminders} disabled={busy} />
        </View>
        <Text style={[styles.hint, { color: theme.textMuted }]}>
          Zeigt fällige Einträge aus der iPhone-App „Erinnerungen“ im Kalender an.
          Es wird nur gelesen – verwaltet werden sie in der Erinnerungen-App.
        </Text>

        <View style={styles.switchRow}>
          <Text style={[styles.rowLabel, { color: theme.text }]}>Serien in Monatsansicht ausblenden</Text>
          <Switch
            value={settings.hideRecurringRemindersInMonth ?? false}
            onValueChange={(v) => updateSettings({ hideRecurringRemindersInMonth: v })}
          />
        </View>
        <Text style={[styles.hint, { color: theme.textMuted }]}>
          Blendet wiederkehrende (Serien-)Erinnerungen NUR in der Monatsansicht aus.
          Tages- und Wochenansicht zeigen sie weiterhin.
        </Text>

        <Text style={[styles.rowLabel, { color: theme.text, marginTop: 10 }]}>Farbe</Text>
        <ColorRow value={settings.remindersColor} onChange={(c) => changeOverlayColor("reminders", c)} />

        <ActionButton
          label={busy ? "Lade …" : "Erinnerungen jetzt aktualisieren"}
          onPress={refreshReminders} theme={theme} disabled={busy}
        />
      </View>

      {/* ---------- Sicherheit ---------- */}
      <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>SICHERHEIT</Text>
      <View style={section}>
        <View style={styles.switchRow}>
          <Text style={[styles.rowLabel, { color: theme.text }]}>Nur-Lesen</Text>
          <Switch value={settings.readOnly} onValueChange={toggleReadOnly} />
        </View>
        <Text style={[styles.hint, { color: theme.textMuted }]}>
          Solange aktiv, wird NICHTS auf den Server geschrieben. Sync läuft nur
          Server → App. (Empfohlen, bis alles zuverlässig läuft.)
        </Text>
      </View>
    </ScrollView>
  );
}

/** Einfache Segment-Auswahl (z.B. Automatisch/Hell/Dunkel). */
function SegmentRow({ options, value, onChange }: {
  options: [string, string][];
  value: string;
  onChange: (v: string) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.segmentRow}>
      {options.map(([v, label]) => (
        <Pressable
          key={v}
          style={[
            styles.segment,
            { borderColor: theme.accent },
            value === v && { backgroundColor: theme.accent },
          ]}
          onPress={() => onChange(v)}
        >
          <Text style={{ color: value === v ? "#fff" : theme.accent, fontSize: 14 }}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Auswahl-Palette fuer die Overlay-Farben (Todoist / Erinnerungen). */
const COLOR_PALETTE = [
  "#E44332", "#FF9500", "#F1C40F", "#38A169", "#0D9488",
  "#2B6CB0", "#7C3AED", "#D53F8C", "#718096", "#1A202C",
];

/** Reihe antippbarer Farb-Punkte; der gewaehlte ist umrandet. */
function ColorRow({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.colorRow}>
      {COLOR_PALETTE.map((c) => {
        const selected = c.toLowerCase() === value.toLowerCase();
        return (
          <Pressable
            key={c}
            onPress={() => onChange(c)}
            style={[
              styles.colorSwatch,
              { backgroundColor: c, borderColor: selected ? theme.text : "transparent" },
            ]}
          >
            {selected && <Text style={styles.colorCheck}>✓</Text>}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Kleiner −/Wert/+ Stepper. `step`/`format` optional (z.B. halbe Stunden, "HH:MM"). */
function Stepper({ value, min, max, onChange, step = 1, format }: {
  value: number; min: number; max: number; onChange: (v: number) => void;
  step?: number; format?: (v: number) => string;
}) {
  const theme = useTheme();
  const label = format ? format(value) : String(value);
  return (
    <View style={styles.fontStepper}>
      <Pressable
        style={[styles.stepBtn, { borderColor: theme.accent, opacity: value <= min ? 0.35 : 1 }]}
        disabled={value <= min}
        onPress={() => onChange(Math.max(min, value - step))}
      >
        <Text style={{ color: theme.accent, fontSize: 18, fontWeight: "600" }}>−</Text>
      </Pressable>
      <Text style={[styles.stepValue, { color: theme.text }]}>{label}</Text>
      <Pressable
        style={[styles.stepBtn, { borderColor: theme.accent, opacity: value >= max ? 0.35 : 1 }]}
        disabled={value >= max}
        onPress={() => onChange(Math.min(max, value + step))}
      >
        <Text style={{ color: theme.accent, fontSize: 18, fontWeight: "600" }}>+</Text>
      </Pressable>
    </View>
  );
}

function ActionButton({ label, onPress, theme, disabled }: {
  label: string; onPress: () => void; theme: ReturnType<typeof useTheme>; disabled?: boolean;
}) {
  return (
    <Pressable
      style={[styles.actionBtn, { backgroundColor: theme.accent, opacity: disabled ? 0.5 : 1 }]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={styles.actionBtnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: 14, paddingBottom: 48 },
  sectionTitle: { fontSize: 12, fontWeight: "700", marginTop: 18, marginBottom: 6, marginLeft: 4 },
  section: {
    borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 14,
  },
  rowLabel: { fontSize: 15, fontWeight: "500" },
  switchRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 6,
  },
  bandBlock: { paddingTop: 8, marginTop: 4 },
  bandTimes: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" },
  bandTimeLabel: { fontSize: 15 },
  colorRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 8 },
  colorSwatch: {
    width: 30, height: 30, borderRadius: 15, borderWidth: 3,
    alignItems: "center", justifyContent: "center",
  },
  colorCheck: { color: "#fff", fontSize: 15, fontWeight: "700" },
  // Kalender-/Phasen-Name links (nimmt den Platz bis zu den Schaltern ein).
  calName: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  // Rechte Seite einer Kalenderzeile: Standard-Stern + Sichtbarkeits-Schalter.
  calRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  starBtn: { paddingHorizontal: 2 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  // Groesserer, antippbarer Farbpunkt zum Aendern der Kalenderfarbe.
  dotTappable: { width: 20, height: 20, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  segmentRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  segment: { borderWidth: 1.5, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6 },
  input: {
    borderWidth: StyleSheet.hairlineWidth, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, marginTop: 6,
  },
  hint: { fontSize: 12, marginTop: 8, lineHeight: 17 },
  fontStepper: { flexDirection: "row", alignItems: "center", gap: 4 },
  stepBtn: {
    borderWidth: 1.5, borderRadius: 8, width: 32, height: 32,
    alignItems: "center", justifyContent: "center",
  },
  stepValue: { fontSize: 16, fontWeight: "600", minWidth: 46, textAlign: "center" },
  actionBtn: {
    borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 10,
  },
  actionBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
