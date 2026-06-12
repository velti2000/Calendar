/*
 * navigation/index.ts  –  Typen fuer die Navigation
 * ==========================================================================
 * Beschreibt, welche Screens es gibt und welche Parameter sie erwarten.
 * (TypeScript prueft so z.B., dass "Day" immer einen dateKey bekommt.)
 */

export type RootStackParamList = {
  Month: undefined;
  Day: { dateKey: string };                       // "YYYY-MM-DD"
  EventEditor: {
    uid?: string;               // uid = bestehenden Termin bearbeiten
    dateKey?: string;           // dateKey = neuen Termin an diesem Tag anlegen
    occurrenceDateKey?: string; // bei Serien: welches Vorkommen wurde angetippt
  };
  Search: undefined;
  Settings: undefined;
};
