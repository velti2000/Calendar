/*
 * screens/WeekScreen.tsx  –  Wochenansicht als Stundenraster (7 Tage nebeneinander)
 * ==========================================================================
 * Wie die Tagesansicht, nur mit allen sieben Tagen einer Woche (Mo–So)
 * nebeneinander:
 *   - Kopfzeile mit Wochentag + Datum je Spalte (heute hervorgehoben).
 *   - Ganztagestermine je Tag in einer eigenen Reihe oben.
 *   - Zeit-Termine an ihrer Uhrzeit/Dauer; parallele Termine eines Tages teilen
 *     sich die (schmale) Tagesspalte (siehe utils/timeline).
 *   - Rote "Jetzt"-Linie in der Spalte des heutigen Tages.
 * Geoeffnet wird sie durch Tippen auf die KW-Zahl in der Monatsansicht.
 * Tippen auf einen Termin oeffnet den Editor; Tippen auf eine freie Stunde
 * legt einen neuen Termin an diesem Tag/dieser Stunde an.
 */

import React, { useMemo, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../navigation";
import { useStore, getEventsByDay } from "../store/useStore";
import { useTheme } from "../theme/useTheme";
import {
  dateFromKey, dayKey, isToday, startOfWeekMonday, addDays,
  isoWeekNumber, isWeekend, WEEKDAYS_SHORT, formatTime,
} from "../utils/dates";
import { positionTimedEvents } from "../utils/timeline";
import { presentOverlayItem } from "../utils/overlayUi";
import { bandRects } from "../utils/timeBands";
import { HatchBand } from "../components/HatchBand";
import type { CalEvent } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Week">;

const EMPTY: CalEvent[] = []; // stabile Referenz, wenn Todoist aus ist

const HOUR_H = 45;          // Hoehe einer Stunde (wie Tagesansicht)
const GUTTER = 32;          // schmale Uhrzeit-Spalte links (Woche braucht Platz)
const MIN_BLOCK_H = 16;     // Mindesthoehe eines Termin-Blocks
const GAP = 1;              // Abstand zwischen parallelen Spalten innerhalb eines Tages

export default function WeekScreen({ route, navigation }: Props) {
  const theme = useTheme();
  const events = useStore((s) => s.events);
  const calendars = useStore((s) => s.calendars);
  const dayStartHour = useStore((s) => s.settings.dayStartHour ?? 6);
  const timeBands = useStore((s) => s.settings.timeBands);
  const bands = useMemo(() => bandRects(timeBands, HOUR_H), [timeBands]);
  const todoistTasks = useStore((s) => s.todoistTasks);
  const todoistEnabled = useStore((s) => s.settings.todoistEnabled);
  const reminderItems = useStore((s) => s.reminderItems);
  const remindersEnabled = useStore((s) => s.settings.remindersEnabled);
  const overlay = useMemo(() => [
    ...(todoistEnabled ? todoistTasks : EMPTY),
    ...(remindersEnabled ? reminderItems : EMPTY),
  ], [todoistEnabled, todoistTasks, remindersEnabled, reminderItems]);

  // Montag der Woche bestimmen, in der das uebergebene Datum liegt.
  const monday = useMemo(() => startOfWeekMonday(dateFromKey(route.params.dateKey)), [route.params.dateKey]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday]);

  const byDay = useMemo(() => getEventsByDay(events, calendars, overlay), [events, calendars, overlay]);
  const calById = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);

  // Pro Tag: ganztaegige und (positionierte) Zeit-Termine.
  const perDay = useMemo(() => days.map((day) => {
    const list = byDay.get(dayKey(day)) || [];
    const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
    return {
      allDay: list.filter((e) => e.allDay),
      timed: positionTimedEvents(list.filter((e) => !e.allDay), dayStart),
    };
  }), [days, byDay]);

  const maxAllDay = Math.max(0, ...perDay.map((d) => d.allDay.length));
  const scrollRef = useRef<ScrollView>(null);
  const [colWidth, setColWidth] = useState(0);

  React.useLayoutEffect(() => {
    navigation.setOptions({ title: `KW ${isoWeekNumber(monday)}` });
  }, [navigation, monday]);

  // Beim Oeffnen so scrollen, dass die eingestellte Start-Stunde oben sitzt.
  React.useEffect(() => {
    const y = dayStartHour * HOUR_H;
    const id = setTimeout(() => scrollRef.current?.scrollTo({ y, animated: false }), 50);
    return () => clearTimeout(id);
  }, [route.params.dateKey, dayStartHour]);

  const openEvent = (item: CalEvent) => {
    // Externe Overlays (Todoist/Erinnerungen) sind nur lesend -> nur Info.
    if (item.source) { presentOverlayItem(item); return; }
    navigation.navigate("EventEditor", {
      uid: item.recurringMaster || item.uid,
      occurrenceDateKey: item.recurringMaster ? dayKey(new Date(item.start)) : undefined,
    });
  };

  const newEventAt = (day: Date, hour: number) =>
    navigation.navigate("EventEditor", { dateKey: dayKey(day), startHour: hour });

  const hours = Array.from({ length: 24 }, (_, h) => h);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Kopfzeile: Wochentage + Datum */}
      <View style={[styles.headerRow, { borderColor: theme.border }]}>
        <View style={{ width: GUTTER }} />
        {days.map((day) => {
          const today = isToday(day);
          return (
            <Pressable
              key={dayKey(day)}
              style={styles.headerCell}
              onPress={() => navigation.navigate("Day", { dateKey: dayKey(day) })}
            >
              <Text style={[styles.headerWd, { color: isWeekend(day) ? theme.textMuted : theme.text }]}>
                {WEEKDAYS_SHORT[(day.getDay() + 6) % 7]}
              </Text>
              <View style={[styles.headerNumWrap, today && { backgroundColor: theme.todayRing }]}>
                <Text style={[styles.headerNum, { color: today ? "#fff" : theme.text }]}>
                  {day.getDate()}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* Ganztages-Reihe (nur wenn es ueberhaupt welche gibt) */}
      {maxAllDay > 0 && (
        <View style={[styles.allDayRow, { borderColor: theme.border, minHeight: 18 + maxAllDay * 16 }]}>
          <View style={[styles.gutterCell, { width: GUTTER }]}>
            <Text style={[styles.allDayLabel, { color: theme.textMuted }]}>g.</Text>
          </View>
          {perDay.map((d, i) => (
            <View key={i} style={styles.allDayDayCell}>
              {d.allDay.map((ev) => {
                const color = ev.color || calById.get(ev.calendarId)?.color || theme.accent;
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
          ))}
        </View>
      )}

      {/* Stunden-Raster */}
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ height: 24 * HOUR_H + 12 }}
        showsVerticalScrollIndicator
      >
        {/* Hintergrund: Uhrzeit-Spalte + 7 Tagesspalten (nur Raster/Hintergrund) */}
        <View style={styles.gridRow}>
          <View style={{ width: GUTTER }}>
            {hours.map((h) => (
              <View key={h} style={{ height: HOUR_H }}>
                <Text style={[styles.hourLabel, { color: theme.textMuted }]}>
                  {String(h).padStart(2, "0")}
                </Text>
              </View>
            ))}
          </View>

          {days.map((day, dayIdx) => (
            <View
              key={dayKey(day)}
              style={[styles.dayColumn, { borderColor: theme.border }, isWeekend(day) && { backgroundColor: theme.weekend }]}
              onLayout={(e) => { if (dayIdx === 0) setColWidth(e.nativeEvent.layout.width); }}
            >
              {hours.map((h) => (
                <Pressable
                  key={h}
                  style={[styles.hourCell, { height: HOUR_H, borderColor: theme.border }]}
                  onPress={() => newEventAt(day, h)}
                />
              ))}
            </View>
          ))}
        </View>

        {/* DURCHGEHENDE Schraffur ueber alle 7 Spalten (eine Schicht -> keine Brueche) */}
        <View pointerEvents="none" style={[styles.overlay, { left: GUTTER }]}>
          {bands.map((b, i) => <HatchBand key={`band-${i}`} rect={b} />)}
        </View>

        {/* Termine + "Jetzt"-Linie als Overlay darueber (pro Tag versetzt) */}
        {colWidth > 0 && (
          <View pointerEvents="box-none" style={[styles.overlay, { left: GUTTER }]}>
            {perDay.map((d, dayIdx) => {
              const dayLeft = dayIdx * colWidth;
              return (
                <React.Fragment key={dayIdx}>
                  {d.timed.map((p) => {
                    const cal = calById.get(p.event.calendarId);
                    const color = p.event.color || cal?.color || theme.accent;
                    const w = (colWidth - 2) / p.cols;
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
                            left: dayLeft + 1 + p.col * w,
                            width: w - GAP,
                            height,
                            backgroundColor: color + "2C",
                            borderLeftColor: color,
                          },
                        ]}
                      >
                        <Text numberOfLines={2} style={[styles.eventTitle, { color: theme.text }]}>
                          {p.event.title}
                        </Text>
                      </Pressable>
                    );
                  })}

                  {isToday(days[dayIdx]) && (
                    <View
                      pointerEvents="none"
                      style={[styles.nowLine, { left: dayLeft, width: colWidth, top: (nowMin / 60) * HOUR_H }]}
                    >
                      <View style={[styles.nowDot, { backgroundColor: theme.danger }]} />
                      <View style={[styles.nowBar, { backgroundColor: theme.danger }]} />
                    </View>
                  )}
                </React.Fragment>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  headerRow: {
    flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 3,
  },
  headerCell: { flex: 1, alignItems: "center", paddingTop: 3 },
  headerWd: { fontSize: 11, fontWeight: "600" },
  headerNumWrap: {
    minWidth: 22, height: 22, borderRadius: 11, marginTop: 1,
    alignItems: "center", justifyContent: "center", paddingHorizontal: 4,
  },
  headerNum: { fontSize: 13, fontWeight: "600" },

  allDayRow: {
    flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 2,
  },
  gutterCell: { alignItems: "center", justifyContent: "center" },
  allDayLabel: { fontSize: 9 },
  allDayDayCell: { flex: 1, paddingHorizontal: 1, gap: 1 },
  allDayChip: { borderRadius: 3, paddingHorizontal: 3, paddingVertical: 2 },
  allDayChipText: { color: "#fff", fontSize: 9 },

  gridRow: { flexDirection: "row" },
  hourLabel: { fontSize: 9, marginTop: -5, textAlign: "center" },

  // Overlay ueber die 7 Tagesspalten (Schraffur bzw. Termine); left wird inline gesetzt.
  overlay: { position: "absolute", top: 0, right: 0, height: 24 * HOUR_H },

  dayColumn: { flex: 1, borderLeftWidth: StyleSheet.hairlineWidth },
  hourCell: { borderTopWidth: StyleSheet.hairlineWidth },

  eventBlock: {
    position: "absolute", borderRadius: 4, borderLeftWidth: 2,
    paddingHorizontal: 2, paddingVertical: 1, overflow: "hidden",
  },
  eventTitle: { fontSize: 9, fontWeight: "600", lineHeight: 11 },

  nowLine: { position: "absolute", height: 2, flexDirection: "row", alignItems: "center" },
  nowDot: { width: 6, height: 6, borderRadius: 3, marginLeft: -3 },
  nowBar: { flex: 1, height: 2 },
});
