/*
 * components/HatchBand.tsx  –  eine farbig+schraffiert hinterlegte Zeitphase
 * ==========================================================================
 * Zeichnet ein Rechteck mit dezenter Fuellfarbe UND grober diagonaler Schraffur,
 * damit sich die Zeitphasen (Muedigkeit/Schlaf/Nacht) klar von echten Terminen
 * abheben.
 *
 * Umsetzung OHNE Bild/tintColor (Image+resizeMode="repeat"+tintColor kachelt auf
 * iOS unzuverlaessig – es erschien nur eine Kachel): Wir legen ein um 45° ge-
 * drehtes Quadrat mit waagerechten Streifen ueber die Flaeche; durch die Drehung
 * werden daraus diagonale Streifen. `overflow:"hidden"` schneidet sie sauber auf
 * die Phasenflaeche zu. Die Quadratseite D = Breite + Hoehe deckt die Flaeche
 * nach der Drehung garantiert vollstaendig ab.
 */

import React, { useState } from "react";
import { View, StyleSheet } from "react-native";
import type { BandRect } from "../utils/timeBands";

// Schraffur-Maße.
const STRIPE = 5;          // Linienbreite (px)
const GAP = 10;            // Abstand zwischen den Linien (px)
const PERIOD = STRIPE + GAP;
const FILL_ALPHA = "14";   // sehr dezente flaechige Fuellung (~8 %)
const HATCH_OPACITY = 0.45; // Deckkraft der Streifen

export function HatchBand({ rect }: { rect: BandRect }) {
  const [width, setWidth] = useState(0);
  const H = rect.height;
  const D = width + H;                  // deckt die Flaeche nach 45°-Drehung ab
  const count = D > 0 ? Math.ceil(D / PERIOD) + 1 : 0;

  return (
    <View
      pointerEvents="none"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ position: "absolute", left: 0, right: 0, top: rect.top, height: H, overflow: "hidden" }}
    >
      {/* dezente flaechige Fuellung */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: rect.color + FILL_ALPHA }]} />

      {/* gedrehtes Quadrat mit waagerechten Streifen -> diagonale Schraffur */}
      {width > 0 && (
        <View
          style={{
            position: "absolute",
            width: D, height: D,
            left: (width - D) / 2, top: (H - D) / 2,
            transform: [{ rotate: "45deg" }],
            opacity: HATCH_OPACITY,
          }}
        >
          {Array.from({ length: count }).map((_, i) => (
            <View
              key={i}
              style={{
                position: "absolute", left: 0, width: D,
                top: i * PERIOD, height: STRIPE,
                backgroundColor: rect.color,
              }}
            />
          ))}
        </View>
      )}
    </View>
  );
}
