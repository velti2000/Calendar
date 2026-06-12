/*
 * screens/DayScreen.tsx  –  Tagesansicht als Stundenraster
 * ==========================================================================
 * Zeigt den kompletten Tag von 0–24 Uhr als senkrechte Zeitachse:
 *   - Ganztagestermine stehen in einer eigenen Reihe ganz oben.
 *   - Zeit-Termine sind an ihrer Uhrzeit fuer ihre Dauer eingetragen.
 *   - Parallele (ueberlappende) Termine werden nebeneinander in Spalten
 *     dargestellt (siehe layoutOverlapping()).
 *   - Bei "heute" zeigt eine rote Linie die aktuelle Uhrzeit.
 * Tippen auf einen Termin oeffnet den Editor; "+" oder Tippen auf eine freie
 * Stunde legt einen neuen Termin an.
 */

import React, { useMemo, useRef, useState } from "react";
import {
  View, Text, Pressable, ScrollView, StyleSheet,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../navigation";
import { useStore, getEventsByDay } from "../store/useStore";
import { useTheme } from "../theme/useTheme";
import { dateFromKey, dayKey, isToday, formatLongDate, formatTime } from "../utils/dates";
import type { CalEvent } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Day">;

const HOUR_H = 56;          // Hoehe einer Stunde in Pixeln
const GUTTER = 48;          // Breite der Uhrzeit-Spalte links
const MIN_BLOCK_H = 22;     // Mindesthoehe eines Termin-Blocks (Lesbarkeit)
const GAP = 3;              // Abstand zwischen parallelen Spalten / Bloecken

/** Termin mit Position auf der Zeitachse (in Minuten ab Mitternacht). */
interface Positioned {
  event: CalEvent;
  startMin: number;
  endMin: number;
  col: number;   // Spalte innerhalb seines Ueberlappungs-Clusters
  cols: number;  // Gesamtzahl Spalten im Cluster (bestimmt die Breite)
}

/**
 * Ordnet ueberlappende Termine in Spalten an.
 * Vorgehen: Termine werden zu "Clustern" zusammengefasst (alles, was sich
 * direkt oder ueber Nachbarn ueberlappt). Innerhalb eines Clusters bekommt
 * jeder Termin die erste freie Spalte; die Cluster-Breite ergibt sich aus der
 * maximalen Spaltenzahl. So ueberlappt nichts und die Breite ist gleichmaessig.
 */
function layoutOverlapping(items: Positioned[]): Positioned[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  let cluster: Positioned[] = [];
  let columnsEnd: number[] = []; // letztes Ende je Spalte im aktuellen Cluster
  let clusterMaxEnd = -1;

  const finalize = (group: Positioned[]) => {
    const cols = group.reduce((m, p) => Math.max(m, p.col + 1), 0);
    for (const p of group) p.cols = cols;
  };

  for (const p of sorted) {
    // Neuer Cluster, sobald der naechste Termin nach allen bisherigen beginnt.
    if (cluster.length && p.startMin >= clusterMaxEnd) {
      finalize(cluster);
      cluster = [];
      columnsEnd = [];
      clusterMaxEnd = -1;
    }
    // Erste Spalte suchen, die schon frei ist (Termin beginnt nach ihrem Ende).
    let placed = columnsEnd.findIndex((end) => end <= p.startMin);
    if (placed === -1) { placed = columnsEnd.length; columnsEnd.push(p.endMin); }
    else columnsEnd[placed] = p.endMin;

    p.col = placed;
    cluster.push(p);
    clusterMaxEnd = Math.max(clusterMaxEnd, p.endMin);
  }
  finalize(cluster);
  return sorted;
}

export default function DayScreen({ route, navigation }: Props) {
  const theme = useTheme();
  const events = useStore((s) => s.events);
  const calendars = useStore((s) => s.calendars);

  const date = dateFromKey(route.params.dateKey);
  const dayStart = useMemo(
    () => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(),
    [route.params.dateKey]
  );

  const dayEvents = useMemo(
    () => getEventsByDay(events, calendars).get(route.params.dateKey) || [],
    [events, calendars, route.params.dateKey]
  );
  const calById = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);

  const allDay = dayEvents.filter((e) => e.allDay);
  const timed = useMemo(() => {
    const minutesFromDayStart = (t: number) => (t - dayStart) / 60000;
    const positioned: Positioned[] = dayEvents
      .filter((e) => !e.allDay)
      .map((event) => {
        // Auf den Tag begrenzen (Termine ueber Mitternacht werden gekappt).
        const startMin = Math.max(0, Math.min(1440, minutesFromDayStart(new Date(event.start).getTime())));
        const endMin = Math.max(startMin + 1, Math.min(1440, minutesFromDayStart(new Date(event.end).getTime())));
        return { event, startMin, endMin, col: 0, cols: 1 };
      });
    return layoutOverlapping(positioned);
  }, [dayEvents, dayStart]);

  const [areaWidth, setAreaWidth] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  React.useLayoutEffect(() => {
    navigation.setOptions({ title: formatLongDate(date) });
  }, [navigation, route.params.dateKey]);

  // Beim Oeffnen zur sinnvollen Stelle scrollen: aktuelle Zeit (heute),
  // sonst zum ersten Termin, sonst 7:00 Uhr.
  const today = isToday(date);
  const nowMin = today ? (Date.now() - dayStart) / 60000 : -1;
  React.useEffect(() => {
    const target =
      today && nowMin >= 0 ? nowMin
      : timed.length ? Math.min(...timed.map((p) => p.startMin))
      : 7 * 60;
    const y = Math.max(0, (target / 60) * HOUR_H - 80);
    const id = setTimeout(() => scrollRef.current?.scrollTo({ y, animated: false }), 50);
    return () => clearTimeout(id);
  }, [route.params.dateKey]);

  const openEvent = (item: CalEvent) =>
    navigation.navigate("EventEditor", {
      uid: item.recurringMaster || item.uid,
      occurrenceDateKey: item.recurringMaster ? dayKey(new Date(item.start)) : undefined,
    });

  /** Neuen Termin an einer angetippten Stunde anlegen. */
  const newEventAtHour = (hour: number) =>
    navigation.navigate("EventEditor", { dateKey: route.params.dateKey, startHour: hour });

  const hours = Array.from({ length: 24 }, (_, h) => h);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Ganztages-Reihe oben */}
      {allDay.length > 0 && (
        <View style={[styles.allDayRow, { borderColor: theme.border }]}>
          <View style={styles.allDayGutter}>
            <Text style={[styles.allDayLabel, { color: theme.textMuted }]}>ganztägig</Text>
          </View>
          <View style={styles.allDayChips}>
            {allDay.map((ev) => {
              const color = calById.get(ev.calendarId)?.color || theme.accent;
              return (
                <Pressable
                  key={ev.uid}
                  style={[styles.allDayChip, { backgroundColor: color }]}
                  onPress={() => openEvent(ev)}
                >
                  <Text numberOfLines={1} style={styles.allDayChipText}>{ev.title}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      {/* Stunden-Raster */}
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ height: 24 * HOUR_H + 24 }}
        showsVerticalScrollIndicator
      >
        {/* Stundenlinien + Beschriftung; jede Stunde ist antippbar (neuer Termin) */}
        {hours.map((h) => (
          <Pressable
            key={h}
            style={[styles.hourRow, { height: HOUR_H, borderColor: theme.border }]}
            onPress={() => newEventAtHour(h)}
          >
            <View style={styles.hourGutter}>
              <Text style={[styles.hourLabel, { color: theme.textMuted }]}>
                {String(h).padStart(2, "0")}:00
              </Text>
            </View>
          </Pressable>
        ))}

        {/* Termin-Bereich rechts der Uhrzeit-Spalte (misst seine Breite selbst) */}
        <View
          style={[styles.eventLayer, { left: GUTTER }]}
          pointerEvents="box-none"
          onLayout={(e) => setAreaWidth(e.nativeEvent.layout.width)}
        >
          {areaWidth > 0 && timed.map((p) => {
            const cal = calById.get(p.event.calendarId);
            const color = cal?.color || theme.accent;
            const colW = areaWidth / p.cols;
            const top = (p.startMin / 60) * HOUR_H;
            const height = Math.max(MIN_BLOCK_H, ((p.endMin - p.startMin) / 60) * HOUR_H - GAP);
            return (
              <Pressable
                key={p.event.uid}
                onPress={() => openEvent(p.event)}
                style={[
                  styles.eventBlock,
                  {
                    top,
                    left: p.col * colW,
                    width: colW - GAP,
                    height,
                    backgroundColor: color + "26", // gleiche Farbe, dezent transparent
                    borderLeftColor: color,
                  },
                ]}
              >
                <Text numberOfLines={1} style={[styles.eventTitle, { color: theme.text }]}>
                  {p.event.title}
                </Text>
                {height > 30 && (
                  <Text numberOfLines={1} style={[styles.eventTime, { color: theme.textMuted }]}>
                    {formatTime(new Date(p.event.start))}–{formatTime(new Date(p.event.end))}
                    {p.event.location ? ` · ${p.event.location}` : ""}
                  </Text>
                )}
              </Pressable>
            );
          })}

          {/* Aktuelle-Uhrzeit-Linie (nur heute) */}
          {today && nowMin >= 0 && nowMin <= 1440 && (
            <View pointerEvents="none" style={[styles.nowLine, { top: (nowMin / 60) * HOUR_H }]}>
              <View style={[styles.nowDot, { backgroundColor: theme.danger }]} />
              <View style={[styles.nowBar, { backgroundColor: theme.danger }]} />
            </View>
          )}
        </View>
      </ScrollView>

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

  allDayRow: {
    flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6, alignItems: "flex-start",
  },
  allDayGutter: { width: GUTTER, paddingTop: 3, alignItems: "center" },
  allDayLabel: { fontSize: 9 },
  allDayChips: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 4, paddingRight: 8 },
  allDayChip: { borderRadius: 5, paddingHorizontal: 8, paddingVertical: 4 },
  allDayChipText: { color: "#fff", fontSize: 13, fontWeight: "500" },

  hourRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
  },
  hourGutter: { width: GUTTER, alignItems: "center" },
  hourLabel: { fontSize: 10, marginTop: -6 }, // Label sitzt auf der Stundenlinie

  eventLayer: { position: "absolute", top: 0, right: 4, bottom: 0 },
  eventBlock: {
    position: "absolute", borderRadius: 6, borderLeftWidth: 3,
    paddingHorizontal: 5, paddingVertical: 2, overflow: "hidden",
  },
  eventTitle: { fontSize: 12, fontWeight: "600" },
  eventTime: { fontSize: 10, marginTop: 1 },

  nowLine: { position: "absolute", left: 0, right: 0, height: 2, flexDirection: "row", alignItems: "center" },
  nowDot: { width: 8, height: 8, borderRadius: 4, marginLeft: -4 },
  nowBar: { flex: 1, height: 2 },

  fab: {
    position: "absolute", right: 20, bottom: 32, width: 56, height: 56,
    borderRadius: 28, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
  },
  fabText: { color: "#fff", fontSize: 30, lineHeight: 34 },
});
