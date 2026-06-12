/*
 * screens/SearchScreen.tsx  –  Suche ueber Titel, Ort und Notizen
 * ==========================================================================
 * Portierung von pwa/js/views/searchView.js. Tippen auf ein Ergebnis oeffnet
 * die Tagesansicht des betreffenden Tages.
 */

import React, { useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, FlatList, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../navigation";
import { useStore, searchEvents } from "../store/useStore";
import { useTheme } from "../theme/useTheme";
import { dayKey, formatLongDate, formatTime } from "../utils/dates";

type Props = NativeStackScreenProps<RootStackParamList, "Search">;

export default function SearchScreen({ navigation }: Props) {
  const theme = useTheme();
  const events = useStore((s) => s.events);
  const calendars = useStore((s) => s.calendars);
  const [query, setQuery] = useState("");

  const results = useMemo(
    () => searchEvents(events, calendars, query).slice(0, 100),
    [events, calendars, query]
  );
  const colorById = useMemo(() => new Map(calendars.map((c) => [c.id, c.color])), [calendars]);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <TextInput
        style={[styles.input, {
          color: theme.text, backgroundColor: theme.surface, borderColor: theme.border,
        }]}
        value={query}
        onChangeText={setQuery}
        placeholder="Titel, Ort oder Notizen suchen …"
        placeholderTextColor={theme.textMuted}
        autoFocus
        clearButtonMode="while-editing"
      />

      <FlatList
        data={results}
        keyExtractor={(e) => e.uid}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          query.trim() ? (
            <Text style={[styles.empty, { color: theme.textMuted }]}>Keine Treffer.</Text>
          ) : null
        }
        renderItem={({ item }) => {
          const start = new Date(item.start);
          const color = colorById.get(item.calendarId) || theme.accent;
          return (
            <Pressable
              style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}
              onPress={() => navigation.navigate("Day", { dateKey: dayKey(start) })}
            >
              <View style={[styles.dot, { backgroundColor: color }]} />
              <View style={styles.rowBody}>
                <Text style={[styles.rowTitle, { color: theme.text }]}>{item.title}</Text>
                <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
                  {formatLongDate(start)}
                  {item.allDay ? "  ·  Ganztägig" : `  ·  ${formatTime(start)} Uhr`}
                  {item.location ? `  ·  ${item.location}` : ""}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 12 },
  input: {
    borderWidth: StyleSheet.hairlineWidth, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, marginBottom: 10,
  },
  list: { paddingBottom: 32 },
  row: {
    flexDirection: "row", alignItems: "center", borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth, padding: 10, marginBottom: 8,
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 16, fontWeight: "600" },
  rowMeta: { fontSize: 13, marginTop: 2 },
  empty: { textAlign: "center", marginTop: 32, fontSize: 15 },
});
