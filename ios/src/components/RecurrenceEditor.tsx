/*
 * components/RecurrenceEditor.tsx  –  Einstellungen fuer Serientermine
 * ==========================================================================
 * Baut aus den Eingaben eine iCalendar-RRULE (CalDAV-kompatibel) zusammen:
 *   - Frequenz + Intervall: "alle 2 Wochen"          -> FREQ=WEEKLY;INTERVAL=2
 *   - Wochentage (woechentlich): "Mo, Mi, Fr"        -> BYDAY=MO,WE,FR
 *   - Monatlich: "am 14. Tag" ODER "am 2. Donnerstag"-> BYDAY=2TH
 *     oder "am letzten Donnerstag"                   -> BYDAY=-1TH
 *   - Ende: nie / "nach 10 Terminen" / "bis 31.12."  -> COUNT=10 / UNTIL=...
 */

import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";

import { useTheme } from "../theme/useTheme";
import {
  RruleOptions, BydayEntry, BYDAY_CODES,
  parseRruleOptions, buildRrule,
} from "../data/ical";
import { WEEKDAYS_SHORT, WEEKDAYS_LONG, mondayIndex, addMonths } from "../utils/dates";

type Freq = RruleOptions["freq"];
type MonthlyMode = "monthday" | "nth" | "last";
type EndMode = "never" | "count" | "until";

interface Props {
  value: string;        // aktuelle RRULE ("" = keine Wiederholung)
  startDate: Date;      // Beginn des Termins (bestimmt Wochentag/Monatstag)
  onChange: (rrule: string) => void;
}

const FREQ_OPTIONS: { label: string; value: Freq | null }[] = [
  { label: "Nie", value: null },
  { label: "Täglich", value: "DAILY" },
  { label: "Wöchentlich", value: "WEEKLY" },
  { label: "Monatlich", value: "MONTHLY" },
  { label: "Jährlich", value: "YEARLY" },
];

const UNIT_LABELS: Record<Freq, [string, string]> = {
  DAILY: ["Tag", "Tage"],
  WEEKLY: ["Woche", "Wochen"],
  MONTHLY: ["Monat", "Monate"],
  YEARLY: ["Jahr", "Jahre"],
};

/** Wochentag des Startdatums als BYDAY-Code ("MO".."SU"). */
function startDayCode(startDate: Date): string {
  return BYDAY_CODES[mondayIndex(startDate)];
}

/** Wievielter (z.B. 2.) Wochentag des Monats ist das Startdatum? */
function nthOfMonth(startDate: Date): number {
  return Math.ceil(startDate.getDate() / 7);
}

export default function RecurrenceEditor({ value, startDate, onChange }: Props) {
  const theme = useTheme();

  // Anfangszustand aus einer evtl. vorhandenen RRULE ableiten.
  const parsed = parseRruleOptions(value);
  const [freq, setFreq] = useState<Freq | null>(parsed?.freq ?? null);
  const [interval, setIntervalVal] = useState(parsed?.interval ?? 1);
  const [weekdays, setWeekdays] = useState<string[]>(() => {
    if (parsed?.freq === "WEEKLY" && parsed.byday.length) return parsed.byday.map((b) => b.day);
    return [startDayCode(startDate)];
  });
  const [monthlyMode, setMonthlyMode] = useState<MonthlyMode>(() => {
    if (parsed?.freq === "MONTHLY" && parsed.byday.length) {
      return parsed.byday[0].ord === -1 ? "last" : "nth";
    }
    return "monthday";
  });
  const [endMode, setEndMode] = useState<EndMode>(() => {
    if (parsed?.count) return "count";
    if (parsed?.until) return "until";
    return "never";
  });
  const [count, setCount] = useState(parsed?.count ?? 10);
  const [until, setUntil] = useState<Date>(parsed?.until ?? addMonths(startDate, 3));

  /** Baut die RRULE aus dem aktuellen Zustand und meldet sie nach oben. */
  function emit(next: {
    freq?: Freq | null; interval?: number; weekdays?: string[];
    monthlyMode?: MonthlyMode; endMode?: EndMode; count?: number; until?: Date;
  }) {
    const f = next.freq !== undefined ? next.freq : freq;
    if (!f) { onChange(""); return; }

    let byday: BydayEntry[] = [];
    const wd = next.weekdays ?? weekdays;
    const mm = next.monthlyMode ?? monthlyMode;
    if (f === "WEEKLY" && wd.length) {
      byday = BYDAY_CODES.filter((c) => wd.includes(c)).map((c) => ({ ord: 0, day: c }));
    } else if (f === "MONTHLY" && mm === "nth") {
      byday = [{ ord: nthOfMonth(startDate), day: startDayCode(startDate) }];
    } else if (f === "MONTHLY" && mm === "last") {
      byday = [{ ord: -1, day: startDayCode(startDate) }];
    }

    const em = next.endMode ?? endMode;
    onChange(buildRrule({
      freq: f,
      interval: next.interval ?? interval,
      byday,
      count: em === "count" ? (next.count ?? count) : null,
      until: em === "until" ? (next.until ?? until) : null,
    }));
  }

  const chip = (selected: boolean, accent: string) => [
    styles.chip,
    { borderColor: accent },
    selected && { backgroundColor: accent },
  ];
  const chipText = (selected: boolean, accent: string) => ({
    color: selected ? "#fff" : accent, fontSize: 13,
  });

  const weekdayLong = WEEKDAYS_LONG[mondayIndex(startDate)];
  const unit = freq ? UNIT_LABELS[freq][interval === 1 ? 0 : 1] : "";

  return (
    <View>
      {/* Frequenz */}
      <View style={styles.chipRow}>
        {FREQ_OPTIONS.map((opt) => (
          <Pressable
            key={opt.label}
            style={chip(freq === opt.value, theme.accent)}
            onPress={() => { setFreq(opt.value); emit({ freq: opt.value }); }}
          >
            <Text style={chipText(freq === opt.value, theme.accent)}>{opt.label}</Text>
          </Pressable>
        ))}
      </View>

      {freq && (
        <>
          {/* Intervall: "Alle [2] Wochen" */}
          <View style={styles.stepperRow}>
            <Text style={[styles.stepperLabel, { color: theme.text }]}>Alle</Text>
            <Stepper
              value={interval} min={1} max={99}
              onChange={(v) => { setIntervalVal(v); emit({ interval: v }); }}
            />
            <Text style={[styles.stepperLabel, { color: theme.text }]}>{unit}</Text>
          </View>

          {/* Woechentlich: Wochentage waehlen */}
          {freq === "WEEKLY" && (
            <>
              <Text style={[styles.subLabel, { color: theme.textMuted }]}>Nur an diesen Wochentagen</Text>
              <View style={styles.chipRow}>
                {BYDAY_CODES.map((code, i) => {
                  const sel = weekdays.includes(code);
                  return (
                    <Pressable
                      key={code}
                      style={[styles.dayChip, { borderColor: theme.accent }, sel && { backgroundColor: theme.accent }]}
                      onPress={() => {
                        // Mindestens ein Tag muss gewaehlt bleiben.
                        const next = sel
                          ? weekdays.filter((c) => c !== code)
                          : [...weekdays, code];
                        if (!next.length) return;
                        setWeekdays(next);
                        emit({ weekdays: next });
                      }}
                    >
                      <Text style={chipText(sel, theme.accent)}>{WEEKDAYS_SHORT[i]}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          {/* Monatlich: Monatstag oder N-ter Wochentag */}
          {freq === "MONTHLY" && (
            <>
              <Text style={[styles.subLabel, { color: theme.textMuted }]}>Wiederholen am</Text>
              <View style={styles.chipRow}>
                {([
                  ["monthday", `${startDate.getDate()}. Tag des Monats`],
                  ["nth", `${nthOfMonth(startDate)}. ${weekdayLong}`],
                  ["last", `letzten ${weekdayLong}`],
                ] as [MonthlyMode, string][]).map(([mode, label]) => (
                  <Pressable
                    key={mode}
                    style={chip(monthlyMode === mode, theme.accent)}
                    onPress={() => { setMonthlyMode(mode); emit({ monthlyMode: mode }); }}
                  >
                    <Text style={chipText(monthlyMode === mode, theme.accent)}>{label}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          {/* Ende der Serie */}
          <Text style={[styles.subLabel, { color: theme.textMuted }]}>Ende</Text>
          <View style={styles.chipRow}>
            {([["never", "Nie"], ["count", "Nach Anzahl"], ["until", "Am Datum"]] as [EndMode, string][]).map(([mode, label]) => (
              <Pressable
                key={mode}
                style={chip(endMode === mode, theme.accent)}
                onPress={() => { setEndMode(mode); emit({ endMode: mode }); }}
              >
                <Text style={chipText(endMode === mode, theme.accent)}>{label}</Text>
              </Pressable>
            ))}
          </View>

          {endMode === "count" && (
            <View style={styles.stepperRow}>
              <Text style={[styles.stepperLabel, { color: theme.text }]}>Nach</Text>
              <Stepper
                value={count} min={1} max={365}
                onChange={(v) => { setCount(v); emit({ count: v }); }}
              />
              <Text style={[styles.stepperLabel, { color: theme.text }]}>Terminen</Text>
            </View>
          )}

          {endMode === "until" && (
            <View style={styles.untilRow}>
              <Text style={[styles.stepperLabel, { color: theme.text }]}>Bis</Text>
              <DateTimePicker
                value={until}
                mode="date"
                locale="de-DE"
                minimumDate={startDate}
                onChange={(_, d) => { if (d) { setUntil(d); emit({ until: d }); } }}
              />
            </View>
          )}
        </>
      )}
    </View>
  );
}

/** Kleiner −/Wert/+ Stepper. */
function Stepper({ value, min, max, onChange }: {
  value: number; min: number; max: number; onChange: (v: number) => void;
}) {
  const theme = useTheme();
  const btn = (label: string, delta: number, disabled: boolean) => (
    <Pressable
      style={[styles.stepBtn, { borderColor: theme.accent, opacity: disabled ? 0.35 : 1 }]}
      disabled={disabled}
      onPress={() => onChange(Math.min(max, Math.max(min, value + delta)))}
    >
      <Text style={{ color: theme.accent, fontSize: 18, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={styles.stepper}>
      {btn("−", -1, value <= min)}
      <Text style={[styles.stepValue, { color: theme.text }]}>{value}</Text>
      {btn("+", +1, value >= max)}
    </View>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  chip: { borderWidth: 1.5, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 5 },
  dayChip: {
    borderWidth: 1.5, borderRadius: 16, width: 40, alignItems: "center", paddingVertical: 5,
  },
  subLabel: { fontSize: 13, fontWeight: "600", marginTop: 14, marginBottom: 4 },
  stepperRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
  stepperLabel: { fontSize: 15 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 4 },
  stepBtn: {
    borderWidth: 1.5, borderRadius: 8, width: 34, height: 34,
    alignItems: "center", justifyContent: "center",
  },
  stepValue: { fontSize: 16, fontWeight: "600", minWidth: 32, textAlign: "center" },
  untilRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
});
