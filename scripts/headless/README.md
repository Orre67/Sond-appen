# Headless-kontroller

Små puppeteer-skript som laddar demoläget (`npm run dev` på port 5173), klickar och läser DOM.
Sökvägarna till exempelfilerna pekar på `C:\Users\oscar\Desktop\filer till claude\...`.
Kör med `node scripts/headless/<namn>.mjs`. Kontrollera först att servern serverar aktuell kod:
`curl -s http://127.0.0.1:5173/src/main.ts | grep -c <ny sträng>`.

- `rig-shot.mjs` Rockma plan + logg utan yta: översikt, omnumrering av 240, 3D-skärmdump.
- `undo-shot.mjs` Delete, Ctrl+Z, Ctrl+Y, ångra av inställning och numrering.
- `remove-shot.mjs` markera, ta bort, lista, återställ.
- `removed-link-shot.mjs` Oscars lagring från Hakunge (borttagna 63, 37 + omnumrering) återskapad.
- `stack-shot.mjs` 3D-klick utan sonderade hål, klickcykel i en stapel.
- `dup-shot.mjs` Torphyttan utan yta: inga dubbletter mellan hål och punkter.
- `bugg1-shot.mjs` Hakunge-filerna i demoläget. `prod-bugg1.mjs` samma mot produktionen via filväljaren.
- `auto-shot.mjs` automatisk bäringskorrektion på/av med Torphyttan (kräver `out/demo-url.txt`).
