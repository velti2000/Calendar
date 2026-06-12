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

import { useStore, savePassword, getCredentials } from "../store/useStore";
import { useTheme } from "../theme/useTheme";
import * as caldav from "../data/caldav";
import { requestPermission, rescheduleAll } from "../notifications/reminders";
import type { Settings } from "../types";

export default function SettingsScreen() {
  const theme = useTheme();
  const { settings, calendars, events, syncing, updateSettings, toggleCalendarVisible, resetToDemo, syncFromServer } = useStore();

  const [username, setUsername] = useState(settings.username);
  const [password, setPassword] = useState("");
  const [hasStoredPassword, setHasStoredPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync("mailbox.password").then((p) => setHasStoredPassword(!!p));
  }, []);

  /** Benutzername + Passwort speichern (Passwort in den Schluesselbund). */
  const saveAccount = async () => {
    updateSettings({ username: username.trim() });
    if (password) {
      await savePassword(password);
      setHasStoredPassword(true);
      setPassword("");
    }
    Alert.alert("Gespeichert", "Zugangsdaten wurden gespeichert.");
  };

  const testConnection = async () => {
    setBusy(true);
    try {
      updateSettings({ username: username.trim() });
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
      </View>

      {/* ---------- Kalender ---------- */}
      <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>KALENDER</Text>
      <View style={section}>
        {calendars.map((cal) => (
          <View key={cal.id} style={styles.switchRow}>
            <View style={styles.calName}>
              <View style={[styles.dot, { backgroundColor: cal.color }]} />
              <Text style={[styles.rowLabel, { color: theme.text }]}>{cal.name}</Text>
            </View>
            <Switch value={cal.visible} onValueChange={() => toggleCalendarVisible(cal.id)} />
          </View>
        ))}
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
  calName: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 12, height: 12, borderRadius: 6 },
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
  stepValue: { fontSize: 16, fontWeight: "600", minWidth: 28, textAlign: "center" },
  actionBtn: {
    borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 10,
  },
  actionBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
