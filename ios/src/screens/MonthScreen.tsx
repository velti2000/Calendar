/*
 * screens/MonthScreen.tsx  –  Monatsansicht im CalenGoo-Stil
 * ==========================================================================
 * Portierung von pwa/js/views/monthView.js:
 *   - Kalenderwoche (KW) in schmaler Spalte links
 *   - Ganztagestermine farbig hinterlegt
 *   - MEHRTAGES-Termine als durchgehender, verbundener Balken ueber die Tage
 *   - Zeit-Termine: farbiger Punkt + Text in Kategoriefarbe
 *   - Wischen links/rechts wechselt den Monat
 *   - Tippen auf einen Tag oeffnet die Tagesansicht
 *
 * Obere Leiste: Einstellungen (links) · Monat/Jahr (mittig) · Suche (rechts)
 * Untere Leiste: "Zu Datum springen" (Auswahlraeder) · ‹ Heute ›
 */

import React, { useMemo, useState } from "react";
import { View, Text, Pressable, Modal, StyleSheet } from "react-native";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import DateTimePicker from "@react-native-community/datetimepicker";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../navigation";
import { useStore, getEventsByDay, getVisibleEvents } from "../store/useStore";
import { useTheme } from "../theme/useTheme";
import {
  buildMonthGrid, dayKey, isToday, isWeekend, formatMonthTitle,
  addMonths, isoWeekNumber, formatTime, WEEKDAYS_SHORT,
} from "../utils/dates";
import type { CalEvent } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Month">;

const DAY_MS = 24 * 60 * 60 * 1000;
const BAR_H = 15;       // Hoehe eines Mehrtages-Balkens
const BAR_GAP = 2;      // Abstand zwischen Balken-Ebenen
const DAYNUM_H = 18;    // Hoehe der Tagesnummern-Zeile (flach)

/** Tag als fortlaufende Nummer (UTC-basiert, unempfindlich gegen Sommerzeit). */
function dayNumber(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

/** Ganztaegig UND laenger als ein Tag? (iCal: Ende ist exklusiv) */
function isMultiDayAllDay(ev: CalEvent): boolean {
  if (!ev.allDay) return false;
  const start = new Date(ev.start);
  const endIncl = new Date(new Date(ev.end).getTime() - 1);
  return dayNumber(endIncl) > dayNumber(start);
}

/** Ein Balken-Segment innerhalb einer Wochenzeile. */
interface WeekBar {
  event: CalEvent;
  startIdx: number;   // Spalte 0..6 (Mo..So)
  endIdx: number;
  lane: number;       // Ebene (0 = oberste)
  startsHere: boolean; // beginnt der Termin in dieser Woche?
  endsHere: boolean;
}

/** Berechnet die Mehrtages-Balken einer Woche inkl. Ebenen-Zuteilung. */
function computeWeekBars(week: Date[], multiDay: CalEvent[]): { bars: WeekBar[]; lanes: number } {
  const wStart = dayNumber(week[0]);
  const wEnd = wStart + 6;

  const segments = multiDay
    .map((event) => {
      const evStart = dayNumber(new Date(event.start));
      const evEnd = dayNumber(new Date(new Date(event.end).getTime() - 1));
      if (evEnd < wStart || evStart > wEnd) return null;
      return {
        event,
        startIdx: Math.max(0, evStart - wStart),
        endIdx: Math.min(6, evEnd - wStart),
        startsHere: evStart >= wStart,
        endsHere: evEnd <= wEnd,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => a.startIdx - b.startIdx || b.endIdx - a.endIdx);

  // Ebenen greedy zuteilen: erster freier Platz von oben.
  const laneEnds: number[] = []; // letzte belegte Spalte je Ebene
  const bars: WeekBar[] = segments.map((seg) => {
    let lane = laneEnds.findIndex((end) => seg.startIdx > end);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(seg.endIdx); }
    else laneEnds[lane] = seg.endIdx;
    return { ...seg, lane };
  });

  return { bars, lanes: laneEnds.length };
}

export default function MonthScreen({ navigation }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const events = useStore((s) => s.events);
  const calendars = useStore((s) => s.calendars);
  const settings = useStore((s) => s.settings);

  const [monthDate, setMonthDate] = useState(new Date());
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpDate, setJumpDate] = useState(new Date());

  const grid = useMemo(() => buildMonthGrid(monthDate), [monthDate]);
  const byDay = useMemo(() => getEventsByDay(events, calendars), [events, calendars]);
  const multiDayEvents = useMemo(
    () => getVisibleEvents(events, calendars).filter(isMultiDayAllDay),
    [events, calendars]
  );
  const colorById = useMemo(
    () => new Map(calendars.map((c) => [c.id, c.color])),
    [calendars]
  );

  const goMonth = (delta: number) => setMonthDate((d) => addMonths(d, delta));
  const goToday = () => setMonthDate(new Date());

  // Wischen nach links = naechster Monat, nach rechts = voriger Monat.
  const swipe = Gesture.Pan()
    .activeOffsetX([-30, 30])
    .runOnJS(true)
    .onEnd((e) => {
      if (e.translationX < -60) goMonth(1);
      else if (e.translationX > 60) goMonth(-1);
    });

  const weeks: Date[][] = [];
  for (let w = 0; w < grid.weeks; w++) {
    weeks.push(grid.days.slice(w * 7, w * 7 + 7));
  }

  const navBar = (
    <View style={[styles.navBar, { borderColor: theme.border }]}>
      {/* "Zu Datum springen" – Auswahlraeder wie in der PWA */}
      <Pressable
        style={styles.navBtn}
        onPress={() => { setJumpDate(monthDate); setJumpOpen(true); }}
      >
        <Text style={[styles.navBtnText, { color: theme.accent, fontSize: 20 }]}>📅</Text>
      </Pressable>
      <Pressable style={styles.navBtn} onPress={() => goMonth(-1)}>
        <Text style={[styles.navBtnText, { color: theme.accent }]}>‹</Text>
      </Pressable>
      <Pressable style={styles.navBtn} onPress={goToday}>
        <Text style={[styles.navBtnText, { color: theme.accent, fontSize: 16 }]}>Heute</Text>
      </Pressable>
      <Pressable style={styles.navBtn} onPress={() => goMonth(1)}>
        <Text style={[styles.navBtnText, { color: theme.accent }]}>›</Text>
      </Pressable>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background, paddingTop: insets.top }]}>
      {/* Obere Leiste */}
      <View style={[styles.topBar, { borderColor: theme.border }]}>
        <Pressable style={styles.iconBtn} onPress={() => navigation.navigate("Settings")}>
          <Text style={[styles.gearIcon, { color: theme.textMuted }]}>⚙︎</Text>
        </Pressable>
        <Text style={[styles.title, { color: theme.text }]}>{formatMonthTitle(monthDate)}</Text>
        <Pressable style={styles.iconBtn} onPress={() => navigation.navigate("Search")}>
          <Text style={[styles.icon, { color: theme.textMuted }]}>🔍</Text>
        </Pressable>
      </View>

      {settings.navPosition === "top" && navBar}

      {/* Wochentags-Kopf (mit Platzhalter fuer die KW-Spalte) */}
      <View style={[styles.weekdayRow, { borderColor: theme.border }]}>
        <View style={styles.kwCell}>
          <Text style={[styles.kwText, { color: theme.textMuted }]}>KW</Text>
        </View>
        {WEEKDAYS_SHORT.map((wd) => (
          <View key={wd} style={styles.weekdayCell}>
            <Text style={[styles.weekdayText, { color: theme.textMuted }]}>{wd}</Text>
          </View>
        ))}
      </View>

      {/* Monatsraster */}
      <GestureDetector gesture={swipe}>
        <View style={styles.gridArea}>
          {weeks.map((week) => {
            const { bars, lanes } = computeWeekBars(week, multiDayEvents);
            const barSpace = lanes * (BAR_H + BAR_GAP);
            return (
              <View key={dayKey(week[0])} style={[styles.weekRow, { borderColor: theme.border }]}>
                <View style={[styles.kwCell, { borderColor: theme.border }]}>
                  <Text style={[styles.kwText, { color: theme.textMuted }]}>
                    {isoWeekNumber(week[0])}
                  </Text>
                </View>

                {/* Tagesbereich: 7 Zellen + Balken-Overlay darueber */}
                <View style={styles.daysArea}>
                  <View style={styles.daysRow}>
                    {week.map((day) => (
                      <DayCell
                        key={dayKey(day)}
                        day={day}
                        inMonth={day.getMonth() === monthDate.getMonth()}
                        events={(byDay.get(dayKey(day)) || []).filter((e) => !isMultiDayAllDay(e))}
                        barSpace={barSpace}
                        colorById={colorById}
                        fontSize={settings.eventFontSize}
                        onPress={() => navigation.navigate("Day", { dateKey: dayKey(day) })}
                      />
                    ))}
                  </View>

                  {/* Durchgehende Mehrtages-Balken (tippen geht an die Zelle darunter) */}
                  <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                    {bars.map((bar) => {
                      const color = colorById.get(bar.event.calendarId) || theme.accent;
                      return (
                        <View
                          key={`${bar.event.uid}-${bar.lane}`}
                          style={{
                            position: "absolute",
                            top: DAYNUM_H + bar.lane * (BAR_H + BAR_GAP),
                            left: `${(bar.startIdx / 7) * 100}%`,
                            width: `${((bar.endIdx - bar.startIdx + 1) / 7) * 100}%`,
                            height: BAR_H,
                            backgroundColor: color,
                            justifyContent: "center",
                            paddingHorizontal: 3,
                            // Runde Ecken nur dort, wo der Termin wirklich anfaengt/endet.
                            borderTopLeftRadius: bar.startsHere ? 4 : 0,
                            borderBottomLeftRadius: bar.startsHere ? 4 : 0,
                            borderTopRightRadius: bar.endsHere ? 4 : 0,
                            borderBottomRightRadius: bar.endsHere ? 4 : 0,
                          }}
                        >
                          <Text numberOfLines={1} style={{ fontSize: settings.eventFontSize, color: "#fff" }}>
                            {bar.event.title}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      </GestureDetector>

      {settings.navPosition === "bottom" && navBar}
      <View style={{ height: insets.bottom }} />

      {/* "Zu Datum springen" – Modal mit Auswahlraedern */}
      <Modal transparent animationType="fade" visible={jumpOpen} onRequestClose={() => setJumpOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Zu Datum springen</Text>
            <DateTimePicker
              value={jumpDate}
              mode="date"
              display="spinner"
              locale="de-DE"
              onChange={(_, d) => d && setJumpDate(d)}
            />
            <View style={styles.modalButtons}>
              <Pressable style={styles.modalBtn} onPress={() => setJumpOpen(false)}>
                <Text style={{ color: theme.textMuted, fontSize: 16 }}>Abbrechen</Text>
              </Pressable>
              <Pressable
                style={styles.modalBtn}
                onPress={() => { setMonthDate(jumpDate); setJumpOpen(false); }}
              >
                <Text style={{ color: theme.accent, fontSize: 16, fontWeight: "600" }}>Springen</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** Eine Tageszelle mit (gekuerzter) Terminliste. */
function DayCell({ day, inMonth, events, barSpace, colorById, fontSize, onPress }: {
  day: Date;
  inMonth: boolean;
  events: CalEvent[];
  barSpace: number;        // Platz, den die Mehrtages-Balken oben belegen
  colorById: Map<string, string>;
  fontSize: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  const today = isToday(day);

  const MAX_SHOWN = 4;
  const shown = events.slice(0, MAX_SHOWN);
  const more = events.length - shown.length;

  return (
    <Pressable
      style={[
        styles.dayCell,
        { borderColor: theme.border },
        isWeekend(day) && { backgroundColor: theme.weekend },
        // Heutiger Tag: leicht grau hinterlegt, etwas dunkler als Wochenende.
        today && { backgroundColor: theme.todayCell },
        !inMonth && { backgroundColor: theme.surfaceMuted, opacity: 0.55 },
      ]}
      onPress={onPress}
    >
      <View style={[styles.dayNumWrap, today && { backgroundColor: theme.todayRing }]}>
        <Text style={[
          styles.dayNum,
          { color: today ? "#fff" : theme.text },
        ]}>
          {day.getDate()}
        </Text>
      </View>

      {/* Platzhalter unter der Tagesnummer fuer die Mehrtages-Balken. */}
      {barSpace > 0 && <View style={{ height: barSpace }} />}

      {shown.map((ev) => {
        const color = colorById.get(ev.calendarId) || theme.accent;
        return ev.allDay ? (
          // Ganztags (eintaegig): farbig hinterlegter Balken.
          <View key={ev.uid} style={[styles.allDayChip, { backgroundColor: color }]}>
            <Text numberOfLines={1} style={[styles.chipText, { fontSize, color: "#fff" }]}>
              {ev.title}
            </Text>
          </View>
        ) : (
          // Zeit-Termin: Text in Kategoriefarbe, buendig links.
          <Text
            key={ev.uid}
            numberOfLines={1}
            style={[styles.chipText, styles.timedText, { fontSize, color }]}
          >
            {formatTime(new Date(ev.start))} {ev.title}
          </Text>
        );
      })}
      {more > 0 && (
        <Text style={[styles.moreText, { color: theme.textMuted, fontSize: fontSize - 1 }]}>
          +{more} weitere
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: { padding: 8, minWidth: 44, alignItems: "center" },
  icon: { fontSize: 20 },
  gearIcon: { fontSize: 34, lineHeight: 36 }, // Textglyph ⚙︎ wirkt sonst winzig neben dem Emoji
  title: { fontSize: 18, fontWeight: "600" },
  weekdayRow: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  weekdayCell: { flex: 1, alignItems: "center", paddingVertical: 4 },
  weekdayText: { fontSize: 12, fontWeight: "600" },
  gridArea: { flex: 1 },
  weekRow: { flex: 1, flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  daysArea: { flex: 1 },
  daysRow: { flex: 1, flexDirection: "row" },
  // KW vertikal mittig, Zahlen gleich gross wie die Tageszahlen.
  kwCell: { width: 22, alignItems: "center", justifyContent: "center" },
  kwText: { fontSize: 12, fontWeight: "600" },
  dayCell: {
    flex: 1, borderLeftWidth: StyleSheet.hairlineWidth,
    paddingTop: 1, overflow: "hidden", // kein seitliches Padding -> Eintraege buendig links
  },
  dayNumWrap: {
    alignSelf: "flex-start", minWidth: 17, height: 16, borderRadius: 8,
    alignItems: "center", justifyContent: "center", paddingHorizontal: 3,
    marginBottom: 1, marginLeft: 1,
  },
  dayNum: { fontSize: 12, fontWeight: "600" },
  allDayChip: { borderRadius: 3, paddingHorizontal: 2, paddingVertical: 1, marginBottom: 1 },
  timedText: { marginBottom: 1 },
  chipText: { flexShrink: 1 },
  moreText: { marginTop: 1 },
  navBar: {
    flexDirection: "row", justifyContent: "space-around", alignItems: "center",
    paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth,
  },
  navBtn: { paddingHorizontal: 18, paddingVertical: 4 },
  navBtnText: { fontSize: 24, fontWeight: "600" },
  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center", justifyContent: "center", padding: 24,
  },
  modalSheet: {
    borderRadius: 16, borderWidth: StyleSheet.hairlineWidth,
    padding: 16, width: "100%", maxWidth: 380,
  },
  modalTitle: { fontSize: 17, fontWeight: "600", textAlign: "center", marginBottom: 4 },
  modalButtons: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  modalBtn: { paddingVertical: 10, paddingHorizontal: 16 },
});
