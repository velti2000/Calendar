/*
 * screens/DayScreen.tsx  –  Tagesansicht
 * ==========================================================================
 * Zeigt alle Termine eines Tages als Liste (Ganztags zuerst). Tippen auf
 * einen Termin oeffnet den Editor; "+" legt einen neuen Termin an
 * (Standard-Beginn 8:00 Uhr, wie in der PWA).
 */

import React, { useMemo } from "react";
import { View, Text, Pressable, FlatList, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../navigation";
import { useStore, getEventsByDay } from "../store/useStore";
import { useTheme } from "../theme/useTheme";
import { dateFromKey, formatLongDate, formatTime } from "../utils/dates";
import type { CalEvent } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Day">;

export default function DayScreen({ route, navigation }: Props) {
  const theme = useTheme();
  const events = useStore((s) => s.events);
  const calendars = useStore((s) => s.calendars);

  const date = dateFromKey(route.params.dateKey);
  const dayEvents = useMemo(
    () => getEventsByDay(events, calendars).get(route.params.dateKey) || [],
    [events, calendars, route.params.dateKey]
  );
  const calById = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);

  React.useLayoutEffect(() => {
    navigation.setOptions({ title: formatLongDate(date) });
  }, [navigation, route.params.dateKey]);

  const renderItem = ({ item }: { item: CalEvent }) => {
    const cal = calById.get(item.calendarId);
    const color = cal?.color || theme.accent;
    return (
      <Pressable
        style={[styles.eventRow, { backgroundColor: theme.surface, borderColor: theme.border }]}
        onPress={() => navigation.navigate("EventEditor", {
          // Bei Serien-Vorkommen den Originaltermin bearbeiten.
          uid: item.recurringMaster || item.uid,
        })}
      >
        <View style={[styles.colorBar, { backgroundColor: color }]} />
        <View style={styles.eventBody}>
          <Text style={[styles.eventTitle, { color: theme.text }]}>{item.title}</Text>
          <Text style={[styles.eventMeta, { color: theme.textMuted }]}>
            {item.allDay
              ? "Ganztägig"
              : `${formatTime(new Date(item.start))} – ${formatTime(new Date(item.end))}`}
            {item.location ? `  ·  ${item.location}` : ""}
          </Text>
          {cal && <Text style={[styles.eventMeta, { color }]}>{cal.name}</Text>}
        </View>
      </Pressable>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <FlatList
        data={dayEvents}
        keyExtractor={(e) => e.uid}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: theme.textMuted }]}>
            Keine Termine an diesem Tag.
          </Text>
        }
      />

      {/* Neuen Termin anlegen */}
      <Pressable
        style={[styles.fab, { backgroundColor: theme.accent }]}
        onPress={() => navigation.navigate("EventEditor", { dateKey: route.params.dateKey })}
      >
        <Text style={styles.fabText}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 12, paddingBottom: 96 },
  eventRow: {
    flexDirection: "row", borderRadius: 10, borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 8, overflow: "hidden",
  },
  colorBar: { width: 5 },
  eventBody: { flex: 1, padding: 10 },
  eventTitle: { fontSize: 16, fontWeight: "600", marginBottom: 2 },
  eventMeta: { fontSize: 13, marginTop: 1 },
  empty: { textAlign: "center", marginTop: 48, fontSize: 15 },
  fab: {
    position: "absolute", right: 20, bottom: 32, width: 56, height: 56,
    borderRadius: 28, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
  },
  fabText: { color: "#fff", fontSize: 30, lineHeight: 34 },
});
