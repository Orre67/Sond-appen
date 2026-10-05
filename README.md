# Sond appen

Räknar försättning mot fri bergyta för sonderade borrhål. Läser en georefererad ytmodell
(LandXML eller OBJ), hålens startpunkter och DM4-filer från sonderingsinstrumentet, bygger
varje hål som en bruten linje med medelvinkelmetoden och mäter vid valt mått längs hålet det
minsta avståndet till ytan. Allt körs lokalt i webbläsaren, inga filer laddas upp någonstans.

## Status

- Steg 1, beräkningskärna med kommandoradsverktyg och tester: klart.
- Steg 2, webbgränssnitt med profilbilder, planvy, 3D-vy, översikt och tabell: klart.
- Steg 3, driftsättning på Vercel och PDF-export: återstår. Utskrift till PDF går redan via
  knappen "Skriv ut alla".

## Köra webbappen

```
npm install
npm run dev
```

Öppna adressen som skrivs ut, normalt http://localhost:5173. Släpp in filerna i rutan uppe
till vänster, gärna alla på en gång: `.obj` + `.mtl` + `.jpg` (eller `.xml`), startpunkter
som `.txt` och en eller flera `.dm4`. Startpunkter går också att klistra in som text.

Flikar:

- **Profil**: lodrätt snitt genom påhugget längs hålets bäring. Slänten till vänster, hålet
  lutar mot den, djup till höger. Varje linje går från stickans sämsta punkt till närmaste
  ytpunkt projicerad in i snittet, siffran är det verkliga 3D-måttet. Ett färgat band längs
  hålet visar vilken sträcka värdet gäller för, och det röda ytspåret visar närmaste ytpunkt
  för varje tät provpunkt. Mått som slutar i samma ytpunkt, inom 20 cm, får en gemensam
  siffra, den minsta, så att bilden hålls ren; kryssrutan "En siffra per ytpunkt" stänger av det. Dra med mus eller finger längs hålet så visas måttet och djupet
  där du pekar. Till höger visas väggen framifrån i hålets bäringsriktning, som en bild
  renderad ur modellen, i samma höjdskala som snittet och med ytspåret, stickornas
  ytpunkter och hålet (streckat, bakom väggen) ovanpå. Meterskalor på kanterna: höjd på
  sidorna, sidledes läge från hålet längs nederkanten. Piltangenterna byter hål. "Visa alla"
  staplar alla hål.
- **3D**: ytan med textur, hålen och mätlinjerna. Klick på ett hål väljer det.
- **Översikt**: salvan uppifrån på en ortofotobild av modellen, hålen färgade efter sin
  minsta försättning. Klick väljer hål.
- **Tabell**: alla provpunkter för valt hål eller alla hål.

Export: CSV för Excel, SVG av vald profil, DXF för kontroll, samt "Skriv ut alla" som ger en
sida per hål och kan sparas som PDF i webbläsarens utskriftsdialog.

## Översikten: skjutriktning och omnumrering

Fliken Översikt visar ortofotot uppifrån med hålens spår och nummer, utan mått och färger, samt
startpunkter som saknar sondering (grå) eller nummer (ihåliga). Scrollhjulet zoomar, dra flyttar
kartan och "Hela ytan" återställer. Ange skjutriktningen i grader, eller tryck
"Rita riktning" och dra en linje längs raden från höger till vänster: riktningen blir vinkelrät
mot linjen och kartan vrids så att den pekar uppåt. Hålens spår ska då peka uppåt.

När numreringen i startpunktsfilen inte stämmer med sonderingsfilen: "Nollställ numrering" tar
bort alla nummer, klicka sedan på hålen i tur och ordning så får de 1, 2, 3 … från startvärdet.
"Numrera onumrerade" ger resten nummer i filens ordning från sista numret. Upptagna nummer hoppas
över. "Originalnummer" återgår till filens numrering. Omnumreringen och skjutriktningen sparas i
webbläsaren per fil, och hålets ursprungliga nummer visas inom parentes under det nya.

## Mobilsidan för sprängarna

Knappen "Publicera" öppnar en ruta med plats, inmätningsdatum och anteckning, förifyllda ur
filnamnen, skickar hålens resultat, ytans snitt längs varje hål och en färdigritad vy framifrån
till servern och lägger inmätningen i listan på `/m`. Svaret är en länk och en QR-kod direkt
till salvan. Samma plats och datum ersätter en tidigare publicering, och "Avpublicera" tar bort
den igen. På telefonen öppnar sprängaren `/m`, loggar in en gång med företagets åtkomstkod
(`ACCESS_CODE`, kakan gäller 30 dagar) och väljer inmätning i listan. Snittet ritas på telefonen
i skärmens egen storlek, så bilden fyller skärmen oavsett modell och vridning:

- Dra fingret längs hålet så visas försättningen och djupet där fingret är, och markeringen
  står kvar när fingret lyfts.
- Knappen "Framifrån" nere till höger växlar till väggen framifrån och tillbaka.
- Svep åt höger ger nästa hål, svep åt vänster föregående. De två stora pilarna överst gör samma sak.

Under utveckling tar dev-servern emot paketen via `POST /api/share` och sparar dem i
`out/share/`.

### Publik app på Vercel

Appen ligger på https://sond-appen.vercel.app (projektet sond-appen i Vercel, kopplat till
GitHub-repot så att varje push till main bygger och driftsätter). Delningspaketen lagras i
Vercel Blob, publik lagring i region Stockholm:

- `api/share/upload.ts` lämnar ut en kortlivad uppladdningsnyckel om klienten skickar rätt
  delningsnyckel (miljövariabeln `SHARE_KEY`). Paketet går sedan direkt från webbläsaren till
  Blob, eftersom en funktion bara får ta emot 4,5 MB. Skrivbordsappen frågar efter nyckeln
  första gången och sparar den i webbläsaren.
- `api/share/[id].ts` skickar telefonen vidare till paketets adress i Blob. Länken är
  `https://sond-appen.vercel.app/m/<id>` (omskrivning i `vercel.json`).
- `api/m/login.ts` loggar in telefonen med åtkomstkoden (`ACCESS_CODE`) och sätter en signerad
  kaka. `api/m/catalog.ts` lämnar ut registret över publicerade inmätningar till inloggade.
  `api/m/publish.ts` tar emot skrivbordets publicering och avpublicering (kräver `SHARE_KEY`).
  Registret ligger i samma Blob-lagring under en hemlig sökväg (`REGISTER_SECRET`), som
  versionerade JSON-filer: varje skrivning blir en ny fil och den senaste hittas med `list()`,
  eftersom överskrivning av samma fil gav gamla läsningar i flera sekunder.
- `api/cron/cleanup.ts` körs varje natt och tar bort paket äldre än 30 dagar (`CRON_SECRET`),
  och plockar bort dem ur registret.

Miljövariabler sätts med `npx vercel env add` och hämtas lokalt med `npx vercel env pull .env.local`.
`node scripts/vercel-smoke.mjs https://sond-appen.vercel.app` kör hela flödet mot den publika
appen: läser in exempelfilerna via filväljaren, delar och öppnar länken i telefonstorlek.

### Demoläge under utveckling

I utvecklingsläge kan filer hämtas direkt från disk via adressen, så att man slipper släppa
in dem efter varje omladdning. Sökvägen måste finnas med i `server.fs.allow` i
`vite.config.ts`. Adressen för Torphyttan-filerna ligger i `out/demo-url.txt` efter en körning
av `scripts/screenshot.mjs`, eller byggs så här:

```
http://localhost:5173/?demo=<url-kodad bas, t.ex. /@fs/C:/Users/oscar/Desktop/filer till claude/sond appen/>&files=obj/test1.obj,obj/test1.mtl,obj/test1.jpg,hålens startpunkter/2026-10-01-Torphyttan.txt,sond data dm4/261001-torphyttan-993.dm4
```

Lägg till `&tab=scene`, `plan` eller `table` för att öppna en viss flik direkt.

## Kommandoradsverktyget

```
npm run calc -- --surface yta.obj --points startpunkter.txt --dm4 fil1.dm4 fil2.dm4 --interval 0.5 --min 1.5 --max 3.5 --start 1 --hole 20 --svg out/profiler
```

| Flagga | Betydelse | Standard |
|---|---|---|
| `--surface` | LandXML (.xml) eller OBJ (.obj) | krävs |
| `--points` | Textfil med hål-id och E, N, Z. Koordinaterna känns igen på värdena (SWEREF 99 TM, även i ordningen N E Z), övriga kolumner ignoreras | krävs |
| `--dm4` | En eller flera DM4-filer, matchas på Profile Number = hål-ID | krävs |
| `--interval` | Måttstickans längd, eller avståndet mellan punkter i punktläge, m | 1.0 |
| `--mode` | `stick`: sämsta värdet inom varje sticka. `point`: värdet i punkten | stick |
| `--fine` | Internt söksteg längs hålet, styr även ytspåret, m | 0.05 |
| `--min` | Under detta blir punkten röd, m | 1.5 |
| `--max` | Över detta blir punkten blå, m | 3.5 |
| `--start` | Startdjup: punkter grundare än detta visas som "skipped" och räknas inte in i minsta försättning, m | 1 |
| `--free` | Fri 3D från djup: ovanför detta djup används i stället planet vinkelrätt mot hålet (äldre regel). 0 = fri 3D hela vägen, m | 0 |
| `--crest` | Krönmarginal: yta högre än påhugget minus detta räknas aldrig som fri yta, m | 0.5 |
| `--correction` | Bäringskorrektion som läggs på alla mätningar, grader | 0 |
| `--auto` | Automatisk bäringskorrektion: missvisning (WMM2025) minus meridiankonvergens, ur ytmodellens läge i SWEREF 99 TM och sonderingsdatumet, läggs på `--correction` | av |
| `--date` | Datum för missvisningen, ÅÅÅÅ-MM-DD. Annars ur DM4-filnamnet, annars i dag | |
| `--method` | `average` (medelvinkel) eller `tangent` | average |
| `--hole` | Vilket hål som skrivs ut i detalj | första |
| `--out` | CSV-fil, semikolon och decimalkomma | out/forsattning.csv |
| `--svg` | Mapp dit en profilbild per hål skrivs | av |
| `--dxf` | DXF-fil för kontroll i Metashape eller CAD, se nedan | av |
| `--holes` | Begränsa SVG och DXF till dessa hål, t.ex. `19,20` | alla |

## DXF för kontroll

Knappen "DXF, alla hål" i appen och flaggan `--dxf` skriver en DXF (ASCII R12) med tre lager per hål:

- `H<id>_YTPUNKTER`: punkterna på ytan som måtten räknats från, samt en 3D-polylinje genom dem i djupordning. Magenta.
- `H<id>_MATT`: en linje per mätning från provpunkten i hålet till ytpunkten, röd, grön eller blå efter klass.
- `H<id>_SPAR`: ytspåret, närmaste ytpunkt för varje tät provpunkt, som 3D-polylinje. Röd.
- `H<id>_HAL`: hålbanan från påhugg till botten.

Koordinaterna är desamma som i indata (E, N, höjd). I Metashape: File, Import, Import Shapes,
välj DXF-filen och ange samma koordinatsystem som chunken, för Torphyttan SWEREF99 TM + RH2000
(EPSG 5845). Punkter ovanför startdjupet tas inte med.

## Mätregeln

**Måttstickor.** Hålet delas från startdjupet i stickor av vald längd, åt båda hållen så
att startdjupet alltid är en stickgräns. Hålet söks av i söksteget (0,05 m) och varje sticka
får det sämsta värdet som hittades inom den. Värdet är därmed en garanti för hela stickan,
med högst ett halvt söksteg i marginal, oavsett var i stickan den sämsta punkten satt.
Linjen ritas från den punkten. I punktläge visas i stället värdet i varje punkt.

**Riktning.** Försättningen är kortaste vägen i hela 3D från provpunkten till ytan, åt alla håll,
även uppåt: slänfoten under ett hål som borrats förbi den, och hålrum eller överhäng ovanför
provpunkten, räknas. Det enda som hålls borta är överytan: yta högre än påhugget minus
krönmarginalen (0,5 m) räknas aldrig, annars skulle minimum peka rakt upp i pallkrönet så snart
försättningen är större än djupet. Med "fri 3D från djup" större än 0 används ovanför det djupet
i stället den äldre regeln: ett plan vinkelrätt mot hålet, bara yta på den djupare sidan räknas,
med 5 cm tolerans. Det fria 3D-minimum helt utan regel finns med som egen kolumn i tabellen
och CSV-filen.

Hålbanan byggs med medelvinkelmetoden: mellan två stationer används medelriktningen av
deras pilar i rummet, så att bäring 359 och 1 ger 0 och inte 180. Tangentmetoden finns som val.

**Bäring.** Sondens bäring är magnetisk. Kryssrutan Auto vid bäringskorrektionen lägger på
missvisningen ur WMM2025 minus meridiankonvergensen för SWEREF 99 TM, båda räknade ur ytmodellens
mitt och sonderingsdatumet i DM4-filnamnet, så att hålen hamnar i rutnätets nord. I Norberg blir det
omkring +6°. Fältet bredvid är ett tillägg för en uppmätt lokal avvikelse. När Auto är på ritas
hålbanan utan korrektion som en tunn streckad spöklinje i profilen så att skillnaden syns, och
profilens rubrik och telefonens infotext anger den tillämpade korrektionen. Lokal magnetisk störning
från berg och rigg rättas inte. Tecknet bör kontrolleras mot riggens GNSS-bäring på några hål.

## Tester och röktest

```
npm test
node scripts/screenshot.mjs
```

`npm test` kör inläsare, hålbana, ytsökning, snitt, profilritning och hela kedjan mot
syntetiska ytor med känt facit, samt mot Torphyttan-filerna om de finns på skrivbordet.
`scripts/screenshot.mjs` öppnar demoläget i headless Chrome, väntar tills hålen är
beräknade och fotar alla flikar till `out/app-*.png`. Kräver att `npm run dev` kör.

## Kodstruktur

- `src/io/` inläsare: `landxml.ts`, `obj.ts`, `startpoints.ts`, `dm4.ts`
- `src/geom/hole.ts` hålbana från stationer, provpunkter längs hålet
- `src/geom/surface.ts` ytmodell med sökindex och närmaste punkt, med eller utan halvrumsregel
- `src/geom/burden.ts` försättning per provpunkt och klassning
- `src/geom/section.ts` snitt genom ytan, hålets huvudbäring
- `src/core/project.ts` koppling startpunkter till sonderingsprofiler, `src/core/csv.ts` export
- `src/view/profile.ts` profilbild som SVG, `plan.ts` översikt, `scene3d.ts` 3D-vy, `table.ts` tabell
- `src/workers/parse.worker.ts` inläsning av stora filer i bakgrundstråd
- `src/main.ts` gränssnittets logik, `src/cli/calc.ts` kommandoradsverktyget
