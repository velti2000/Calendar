/*
 * theme/useTheme.ts  –  liefert das aktive Farbschema
 * ==========================================================================
 * settings.theme: "auto" folgt dem System-Erscheinungsbild, "light"/"dark"
 * erzwingen eine Variante (wie in der PWA).
 */

import { useColorScheme } from "react-native";
import { useStore } from "../store/useStore";
import { lightTheme, darkTheme, Theme } from "./index";

export function useTheme(): Theme {
  const systemScheme = useColorScheme(); // "light" | "dark" | null
  const themeSetting = useStore((s) => s.settings.theme);

  const dark =
    themeSetting === "dark" ||
    (themeSetting === "auto" && systemScheme === "dark");

  return dark ? darkTheme : lightTheme;
}
