/**
 * HelpModal — erklaert die berechneten physikalischen Groessen (v3D, Tangential-
 * Beschleunigung, Beschleunigungsvektor-Zerlegung, spezifische Energie). Modal
 * im WebView, keine externen Abhaengigkeiten. Erreichbar ueber das „?" in der
 * Toolbar.
 *
 * Begriffe konsistent mit der UI: „Spezifische Energie" (nicht „Energiehoehe"),
 * „Energierate" fuer dH/dt.
 */

import { useEffect } from "react";

interface Props {
  onClose: () => void;
}

export function HelpModal({ onClose }: Props) {
  // Schliessen per Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div style={headerStyle}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>
            Berechnete Größen — Erklärung
          </span>
          <button style={closeBtnStyle} onClick={onClose} title="Schließen (Esc)">
            ×
          </button>
        </div>

        <div style={bodyStyle}>
          <Section title="Geschwindigkeit v₃D">
            <Formula>v₃D = √(v_h² + v_z²)</Formula>
            <p style={pStyle}>
              v_h = GPS-Geschwindigkeit (SOG, horizontal, m/s), v_z = Δhöhe / Δzeit.
              SOG ist eine Doppler-Projektion auf das WGS-84-Ellipsoid — horizontal,
              sehr genau. v_z aus Höhendifferenzen ist deutlich verrauschter
              (GPS-Höhe ±5–10 m vs. ±1–3 m horizontal). In der Werteachse als km/h
              dargestellt (vergleichbar mit der GPS-Geschwindigkeit).
            </p>
          </Section>

          <Section title="Tangential-Beschleunigung aₜ = dv₃D/dt">
            <p style={pStyle}>
              Skalare Änderungsrate der Gesamtgeschwindigkeit (Zentraldifferenz
              über die ungerundeten Werte). Positiv = Beschleunigung, negativ =
              Verzögerung. Physikalisch: die Projektion der Gesamtbeschleunigung
              auf den Geschwindigkeitsvektor. Sie leitet sich aus <b>v₃D</b> ab,
              nicht aus der GPS-Geschwindigkeit — deshalb steht v₃D im Selektor
              direkt davor.
            </p>
            <p style={pStyle}>
              Nicht zu verwechseln mit <b>|a|</b> (Betrag des vollen
              Beschleunigungsvektors, siehe unten): aₜ ist nur der Anteil entlang
              der Bahn und kann nahe 0 sein, während |a| durch Quer- oder
              Vertikalanteile groß ist (z.B. in einer Kurve mit konstantem Tempo).
            </p>
          </Section>

          <Section title="Beschleunigungsvektor-Zerlegung (Längs / Quer / Vertikal)">
            <p style={pStyle}>
              Vollständige 3D-Beschleunigung im ENU-Frame, zerlegt in drei
              Körperachsen:
            </p>
            <ul style={ulStyle}>
              <li>
                <b>Längs (aₗ)</b>: entlang der Bewegungsrichtung (Heading) —
                Beschleunigen/Bremsen.
              </li>
              <li>
                <b>Quer (a꜀)</b>: senkrecht zur Bewegungsrichtung, horizontal —
                die Kurven-Querkraft.
              </li>
              <li>
                <b>Vertikal (a᷊)</b>: senkrecht zur horizontalen Ebene —
                Steigen/Sinken.
              </li>
            </ul>
            <p style={pStyle}>
              Alle drei in m/s² (1 g ≈ 9,81 m/s²), rein kinematisch aus der
              Position abgeleitet — ohne Schwerkraftanteil. Berechnet mit
              zentralen Zeitdifferenzen; die Glättung folgt dem Regler in den
              Overlay-Schaltflächen (Standard: 3-Punkt-Mittel). <b>|a|</b> ist
              der Betrag √(aₗ² + a꜀² + a᷊²) — immer ≥ 0. Die Komponenten stehen
              im Seitenpanel und im Tooltip; der Schalter „Beschleunigungsvektor"
              blendet nur die Pfeile im 3D-Bild ein/aus.
            </p>
          </Section>

          <Section title="Spezifische Energie H = h + v₃D²/(2g)">
            <Formula>H = h + v₃D² / (2g)</Formula>
            <p style={pStyle}>
              Spezifische mechanische Energie als <b>Höhenäquivalent</b> (in Metern):
              die Höhe, auf die der Körper stiege, würde er seine kinetische Energie
              vollständig in Höhe umsetzen. Massenunabhängig. Setzt kinetische und
              potentielle Energie ins Verhältnis — nützlich z.B. im Segelflug.
              Der Wert hat bewusst keine Korrelation mit der räumlichen Höhe des
              Tracks; die Einheit ist nur deshalb Meter, weil durch g geteilt wird.
            </p>
            <p style={pStyle}>
              <b>Energierate</b> (ΔH/Δt, m/s) zeigt, ob Energie auf- oder abgebaut
              wird — in der Luftfahrt die „spezifische Überschussleistung" Pₛ.
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 18 }}>
      <h3 style={h3Style}>{title}</h3>
      {children}
    </section>
  );
}

function Formula({ children }: { children: React.ReactNode }) {
  return <div style={formulaStyle}>{children}</div>;
}

// --- Styles ----------------------------------------------------------------

const backdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 2000,
};

const panelStyle: React.CSSProperties = {
  width: "min(640px, 92vw)",
  maxHeight: "85vh",
  display: "flex",
  flexDirection: "column",
  background: "#15151c",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 8,
  boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
  color: "#eee",
  fontFamily: "system-ui, sans-serif",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 16px",
  borderBottom: "1px solid #2a2a2a",
};

const closeBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid #444",
  color: "#bbb",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 18,
  lineHeight: "18px",
  width: 26,
  height: 26,
  padding: 0,
};

const bodyStyle: React.CSSProperties = {
  padding: "16px 20px",
  overflowY: "auto",
  fontSize: 13,
  lineHeight: 1.5,
};

const h3Style: React.CSSProperties = {
  margin: "0 0 6px 0",
  fontSize: 14,
  color: "#cdd6ff",
};

const pStyle: React.CSSProperties = {
  margin: "0 0 8px 0",
  color: "#cfcfd6",
};

const ulStyle: React.CSSProperties = {
  margin: "0 0 8px 0",
  paddingLeft: 20,
  color: "#cfcfd6",
};

const formulaStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
  fontSize: 14,
  background: "#0a0a12",
  border: "1px solid #2a2a3a",
  borderRadius: 4,
  padding: "8px 10px",
  margin: "0 0 8px 0",
  color: "#e0e0ea",
};
