# sun-lunch

En enkel webbapp som visar restauranger runt Vasagatan 7 i Göteborg och
uppskattar vilka som har bäst chans till sol vid lunch (standard: kl 12:00).

## Hur det fungerar

- Hämtar restauranger/caféer/snabbmat från OpenStreetMap (Overpass API).
- Beräknar solens riktning och höjd för vald tid (SunCalc).
- Hämtar molnighet från Open-Meteo.
- Räknar ut en **solpoäng** baserat på riktning, solhöjd, avstånd och molnighet.

> Solpoängen är en uppskattning, inte en exakt skugg-simulering av byggnader.

## Kör lokalt

Eftersom appen använder ES-moduler behöver du servera filerna via en lokal
webbserver (inte öppna `index.html` direkt från filsystemet).

Exempel med Python:

```bash
python3 -m http.server 8080
```

Öppna sedan:

`http://localhost:8080`
