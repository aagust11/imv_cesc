# CESC — INS Mollet

## Ús a GitHub Pages

https://aagust11.github.io/imv_cesc/

1. A l’ordinador docent, entra a administració, prepara el qüestionari i tria un codi de 6 lletres/números (o deixa’l buit).
2. Prem **Obre a respostes d’alumnes**. Espera que indiqui **Connectat · rebent respostes**. Si el codi ja està ocupat o no hi ha connexió, no s’obre la sessió.
3. Mantén la consola oberta i el dispositiu despert. Cada alumne obre la mateixa web des del seu dispositiu, tria el portal d’alumnes i introdueix el codi.
4. Cada resposta s’envia amb WebRTC al navegador docent. El receptor valida i desa les dades abans de confirmar la recepció. El recompte i el sociograma s’actualitzen immediatament. Les respostes d’altres alumnes no es comparteixen amb els participants.
5. Els enviaments pendents es reintenten cada 5 segons i es conserven a sessionStorage mentre la pestanya existeixi. La pantalla final només confirma l’enviament quan administració l’ha rebut. No tanqueu una pàgina amb enviaments pendents.
6. Exporta JSON/CSV des d’administració. Les dades es desen al navegador docent, no a GitHub. Si recarregues la consola, es recupera la sessió desada i s’intenta recuperar la connexió. Tancar la sessió o sortir d’administració atura la recepció.

## Connexió i límits

PeerJS Cloud proporciona la senyalització inicial (Internet necessari). Les respostes viatgen pel canal WebRTC entre navegadors. No hi ha servidor Node.js local per configurar. El codi és una clau d’accés al qüestionari, no verifica la identitat de l’alumne; qualsevol persona que el conegui pot accedir a la llista del grup. La contrasenya local del docent tampoc constitueix autenticació de servidor. No compartiu els codis públicament.

Algunes xarxes de centre o NAT poden bloquejar WebRTC. No es pot garantir connexió en totes les xarxes sense un servei TURN accessible. El codi permet configurar un servidor de senyalització propi i ICE/TURN amb variables Vite (vegeu `.env.example`). No inclogueu credencials TURN permanents al frontend; utilitzeu credencials temporals. Per defecte s’utilitza la infraestructura pública de PeerJS.

## Desenvolupament i desplegament

```sh
npm ci
npm run lint
npm run build
```

El workflow de Pages compila amb `VITE_STATIC_MODE=true` i publica `dist/` després de cada canvi a `main`. A Settings → Pages seleccioneu GitHub Actions si cal.

`npm run dev` manté el servidor Node.js original per desenvolupament. `npm run build:server` genera també el servidor opcional. Aquest servidor conserva projectes en memòria i cal revisar-ne la persistència i l’autenticació abans d’usar-lo en producció.

## Proves de connexió

`npm run test:live` inicia un servidor de senyalització de prova i Vite i comprova la comunicació WebRTC entre contextos de navegador separats. Cal instal·lar Chromium amb `npx playwright install chromium` la primera vegada. El servidor de prova no forma part del desplegament a Pages.
