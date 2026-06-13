/*
 * App.tsx  –  Einstiegspunkt der App
 * ==========================================================================
 * Baut die Navigation auf (Monat -> Tag -> Editor, Suche, Einstellungen)
 * und plant beim Start die lokalen Erinnerungen neu.
 */

import React, { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer, DefaultTheme, DarkTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import type { RootStackParamList } from "./src/navigation";
import { useStore } from "./src/store/useStore";
import { rescheduleAll } from "./src/notifications/reminders";

import MonthScreen from "./src/screens/MonthScreen";
import WeekScreen from "./src/screens/WeekScreen";
import DayScreen from "./src/screens/DayScreen";
import EventEditorScreen from "./src/screens/EventEditorScreen";
import SearchScreen from "./src/screens/SearchScreen";
import SettingsScreen from "./src/screens/SettingsScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const systemScheme = useColorScheme();
  const themeSetting = useStore((s) => s.settings.theme);
  const dark = themeSetting === "dark" || (themeSetting === "auto" && systemScheme === "dark");

  // Beim App-Start: erst still vom Server synchronisieren (falls CalDAV aktiv),
  // danach die Erinnerungen neu planen (falls aktiviert).
  useEffect(() => {
    (async () => {
      const { settings, syncFromServer, syncTodoist } = useStore.getState();
      if (settings.dataSource === "caldav") {
        // Fehler hier nicht stoerend melden – die App zeigt einfach den
        // letzten lokalen Stand; manueller Sync geht in den Einstellungen.
        await syncFromServer().catch(() => {});
      }
      if (settings.todoistEnabled) {
        await syncTodoist().catch(() => {}); // Todoist-Aufgaben (rein lesend) holen
      }
      const s = useStore.getState();
      if (s.settings.notificationsEnabled) {
        rescheduleAll(s.events, s.calendars).catch(() => {});
      }
    })();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <NavigationContainer theme={dark ? DarkTheme : DefaultTheme}>
          <StatusBar style={dark ? "light" : "dark"} />
          <Stack.Navigator initialRouteName="Month">
            {/* Die Monatsansicht hat eine eigene obere Leiste -> kein Header. */}
            <Stack.Screen name="Month" component={MonthScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Week" component={WeekScreen} options={{ title: "Woche" }} />
            <Stack.Screen name="Day" component={DayScreen} options={{ title: "" }} />
            <Stack.Screen name="EventEditor" component={EventEditorScreen} options={{ title: "Termin" }} />
            <Stack.Screen name="Search" component={SearchScreen} options={{ title: "Suche" }} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: "Einstellungen" }} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
