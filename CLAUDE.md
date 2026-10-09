# Sond appen: arbetsguide för Claude och andra utvecklare

Vad appen gör, hur den körs och var allt ligger står i [README.md](README.md). Den här filen
handlar om hur vi arbetar i repot och vilka regler som gäller när något byggs vidare.

## Så arbetar Oscar

- Oscar skriver på svenska och vill ha svar på svenska. Kodkommentarer, commit-meddelanden,
  README och UI är på svenska. Variabel- och funktionsnamn är engelska.
- "Diskutera", "gör inget", "bara planera" betyder exakt det: svara med bedömning och förslag,
  bygg inget. "Bygg", "vi kör", "vi testar" är klartecken.
- Appen testas live. När Oscar säger "commit, push, deploy" eller har sagt att vi testar direkt:
  committa, pusha till main (Vercel bygger automatiskt), vänta in deployen med
  `npx vercel inspect <deploy-url> --wait`, kontrollera att produktionen serverar det nya
  (curl mot https://sond-appen.vercel.app med cache-brytande query), och ge återgångskommandot
  `npx vercel promote <föregående deploy-url>` i svaret. Annars: committa bara när han ber om det.
- Minimalistiskt gränssnitt. Admin bygger i skrivbordsappen det som sprängarna sedan ser på
  telefonen; en rapport kommer senare. UI:t ska göras om i grunden, så lägg logik i kärnan,
  inte i DOM-hanteringen.

## Kommandon

```
npm run dev            # Vite på port 5173 (Oscar har den ofta igång själv: porten upptagen = använd den)
npm test               # vitest, syntetiska ytor + exempelfiler om de finns
npm run build          # tsc --noEmit && vite build
npm run calc -- ...    # kommandoradsverktyget, flaggor i README
node scripts/screenshot.mjs   # röktest i headless Chrome mot demoläget (kräver dev-servern)
```

Exempelfiler ligger utanför repot, under `C:\Users\oscar\Desktop\filer till claude\`:
`sond appen\` (Torphyttan: OBJ, LandXML, startpunkter, DM4) och `iredes och quallog\`
(Epiroc, Rockma, Sandvik). Dev-servern får läsa hela mappen (`vite.config.ts`, `fs.allow`), så
demoläget kan laddas med `?demo=/@fs/...&files=...`. Headless-kontroller skrivs som små
puppeteer-skript som laddar demoläget, klickar och läser DOM; `out/` är gitignorerat och
lämpligt för skärmdumpar.

Kontrollera före varje headless-körning att servern serverar aktuell kod, till exempel
`curl -s http://127.0.0.1:5173/src/main.ts | grep -c <ny sträng>`. Vites filbevakning kan dö
tyst på Windows; då serveras gammal kod tills servern startas om (pid via `netstat -ano`,
stoppa med `Stop-Process`).

## Regler för koden

- All beräkning sker i webbläsaren. Telefonen (`mobil.html`, `src/mobil.ts`) har ingen
  ytmodell och räknar inget: allt den visar måste finnas i delningspaketet (`src/core/share.ts`,
  `HoleResult` följer med i sin helhet). Publicerade inmätningar bär gamla värden tills de
  publiceras om.
- Koordinater är E N Z i SWEREF 99 TM. Ytmodellen flyttas till ett lokalt origo innan float32.
  IREDES skriver northing i PointX och easting i PointY.
- XML läses med reguljära uttryck (LandXML, IREDES), inte DOM, så att det fungerar i worker och
  Node och klarar filer på 100 MB.
- Mätregeln är fri 3D med två spärrar (krönspärr och startplan); den äldre planregeln finns
  kvar som val. Ändra inte regeln utan att läsa stycket "Mätregeln" i README.
- Ångra: allt användaren bestämmer ligger i beslutsobjektet `Decisions` i `src/main.ts` och
  varje ändring görs inom `history.apply(label, mutate, coalesceKey?)`
  (`src/core/history.ts`). En ny funktion som ändrar något användaren kan vilja ta tillbaka
  ska lägga sitt beslut där och ändra inom `apply()`. Filinläsning ingår inte.
- Beslut sparas i webbläsaren per plats: omnumrering, borttagna hål och skjutriktning under
  nycklar med startpunktsfilens namn, annars riggens plannamn.
- Hål identifieras på ursprungs-id (`sourceId`, normaliserat med `normalizeId`); gällande
  nummer efter omnumrering är `id`. Sonderingens Profile Number matchas mot gällande nummer.
- Tester: varje regeländring får ett syntetiskt fall i `test/` med känt facit. Exempelfilstester
  hoppar över sig själva när filerna saknas.

## Driftsättning

Vercel-projektet `sond-appen` i teamet `orre67s-projects` byggs från GitHub `Orre67/Sond-appen`
(publikt repo). Hemligheter ligger i `.env.local` och i Vercel, aldrig i repot eller i
dokumentation. API-filerna i `api/` använder namngivna exporter (GET/POST med Request/Response).
Registret i Blob är append-only versionerade filer, eftersom överskrivning ger gamla läsningar i
flera sekunder.

## Hushålla med sammanhanget

Delningspaket (`out/share/*.json`, flera MB), profil-SVG:er och loggar får aldrig läsas i sin
helhet. Skriv en node-rad som skriver ut nycklar och längder, använd `sed -n` och `grep` i stora
källfiler, och titta på högst en eller två skärmdumpar per steg.
