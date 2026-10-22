# Löwen-Inseln

Online-Aufbauspiel im Townscaper-Stil auf einer echten Weltkarte. Jeder Spieler startet in einer echten Region (Bundesland, US-Staat, Provinz …), baut dort seine Stadt und erobert Nachbarregionen. Jede Region gehört genau einem Spieler.

## Starten

```bash
npm start
```

Dann http://localhost:10000 öffnen. Ohne weitere Einstellungen speichert der Server lokal in `daten.json`.

## Online mit Supabase

1. `supabase_setup.sql` einmal im Supabase-Dashboard unter „SQL Editor“ ausführen.
2. Auf dem Server (z. B. Render) diese Variablen setzen:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY` (der service_role-Schlüssel, niemals im Browser verwenden)

## Aufbau

| Pfad | Inhalt |
|---|---|
| `server.js` | Konten, Speichern, Vergabe der Regionen, Auslieferung des Spiels |
| `shared/rules.js` | Regeln, die Server und Browser teilen (KI-Reiche, Verteidigung, Beute) |
| `public/game.js` | Spiel-Logik: 3D-Insel, Wirtschaft, Weltkarte |
| `public/ui.js` | Anmeldung und Oberfläche |
| `public/api.js` | Verbindung zum Server |
| `public/assets/` | Weltkarte (Natural Earth, Admin-1) und 3D-Modelle |

## API

| Methode | Pfad | Zweck |
|---|---|---|
| POST | `/api/register` | Konto anlegen (`name`, `password`) |
| POST | `/api/login` | Anmelden, liefert ein Token |
| POST | `/api/logout` | Token löschen |
| GET | `/api/me` | Eigene Stadt und Regionen |
| GET | `/api/world` | Wem welche Region gehört |
| PUT | `/api/city` | Stadt speichern |
| POST | `/api/world/start` | Startregion wählen |
| POST | `/api/world/attack` | Region erobern |

Kartendaten: Natural Earth (gemeinfrei).
