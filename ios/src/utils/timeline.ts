/*
 * utils/timeline.ts  –  Anordnung von Terminen auf einer Stunden-Zeitachse
 * ==========================================================================
 * Gemeinsame Logik fuer Tages- und Wochenansicht:
 *   - positionTimedEvents(): rechnet Termine eines Tages in Minuten-Positionen
 *     um (auf den Tag begrenzt) und ordnet ueberlappende Termine in Spalten.
 *   - layoutOverlapping(): die eigentliche Spalten-Zuteilung.
 */

import type { CalEvent } from "../types";

/** Termin mit Position auf der Zeitachse (Minuten ab Mitternacht). */
export interface Positioned {
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
export function layoutOverlapping(items: Positioned[]): Positioned[] {
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

/**
 * Rechnet die Zeit-Termine eines Tages in Positionen um (auf [0, 1440] Minuten
 * begrenzt – Termine ueber Mitternacht werden gekappt) und ordnet Ueberlappungen.
 * @param events    Termine des Tages (ganztaegige bitte vorher herausfiltern)
 * @param dayStartMs Mitternacht des Tages in Millisekunden
 */
export function positionTimedEvents(events: CalEvent[], dayStartMs: number): Positioned[] {
  const minutesFromDayStart = (t: number) => (t - dayStartMs) / 60000;
  const positioned: Positioned[] = events.map((event) => {
    const startMin = Math.max(0, Math.min(1440, minutesFromDayStart(new Date(event.start).getTime())));
    const endMin = Math.max(startMin + 1, Math.min(1440, minutesFromDayStart(new Date(event.end).getTime())));
    return { event, startMin, endMin, col: 0, cols: 1 };
  });
  return layoutOverlapping(positioned);
}
