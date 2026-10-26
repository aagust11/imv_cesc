# CESC — INS Mollet

## Ús a GitHub Pages

https://aagust11.github.io/imv_cesc/

1. A l’ordinador docent, entra a administració, prepara el qüestionari i tria un codi de 6 lletres/números (o deixa’l buit).
2. Prem **Obre a respostes d’alumnes**. Espera que indiqui **Connectat · rebent respostes**. Si el codi ja està ocupat o no hi ha connexió, no s’obre la sessió.
3. Mantén la consola oberta i el dispositiu despert. Cada alumne obre la mateixa web des del seu dispositiu, tria el portal d’alumnes i introdueix el codi.
4. Cada resposta s’envia per HTTPS a una bústia temporal xifrada; la consola docent la consulta cada segon. El receptor valida i desa les dades abans de confirmar la recepció. El recompte i el sociograma s’actualitzen després de rebre la resposta. Les respostes d’altres alumnes no es comparteixen amb els participants.
5. Els enviaments pendents es reintenten cada 5 segons i es conserven a sessionStorage mentre la pestanya existeixi. La pantalla final només confirma l’enviament quan administració l’ha rebut. No tanqueu una pàgina amb enviaments pendents.
6. Exporta JSON/CSV des d’administració. Les dades es desen al navegador docent, no a GitHub. Si recarregues la consola, es recupera la sessió desada i s’intenta recuperar la connexió. Tancar la sessió o sortir d’administració atura la recepció.

## Connexió i límits

La web continua a GitHub Pages. El servei `https://cesc-https-relay.wittygrove17.chatgpt.site` executa un relé HTTPS a Cloudflare Workers (allotjat amb Sites), amb una bústia D1 de missatges xifrats. No s’utilitzen WebRTC, WebSockets, PeerJS ni Supabase.

Cada petició es xifra al navegador amb ECDH P-256 + AES-GCM, incloent nom, respostes i tokens. El servidor només veu el codi del grup, claus públiques, identificadors aleatoris i contingut xifrat. El docent valida i desa al seu navegador abans de retornar el justificant xifrat. El servidor és un intermediari de confiança per descobrir la clau pública; això no és una verificació independent de la identitat del docent.

La bústia caduca les peticions als 5 minuts i elimina els registres caducats amb les peticions següents. La sala necessita un senyal de la consola cada 90 segons. Tancar-la elimina la sala i els seus missatges. La còpia definitiva de les respostes continua al navegador docent: exporteu-la abans d’esborrar dades del navegador.

L’administració de la sala usa un secret independent del codi de grup; els justificants requereixen un secret aleatori per petició. El codi compartit permet veure la llista del grup, però no les respostes dels altres alumnes. La contrasenya local del docent no és autenticació de servidor. El mode compartit no verifica la identitat real; utilitzeu codis individuals per evitar la selecció d’un altre nom.

L’aïllament entre dispositius de la Wi-Fi deixa de ser rellevant perquè tots contacten amb un servidor per HTTPS. Cal que el filtre del centre permeti el domini del relé. El botó **Comprova la connexió HTTPS** comprova aquest accés des del dispositiu; encara cal provar el flux complet a `gencat_ens_edu`.

## Desenvolupament i desplegament

```sh
npm ci
npm run lint
npm run build
```

El workflow de Pages compila amb `VITE_STATIC_MODE=true` i publica `dist/` després de cada canvi a `main`. A Settings → Pages seleccioneu GitHub Actions si cal.

`npm run dev` manté el servidor Node.js original per desenvolupament. `npm run build:server` genera també el servidor opcional. Aquest servidor conserva projectes en memòria i cal revisar-ne la persistència i l’autenticació abans d’usar-lo en producció.

## Proves de connexió

`npm run test:live` inicia la bústia de prova amb el mateix codi Worker i SQL (SQLite local), i comprova la comunicació HTTPS entre contextos de navegador separats amb WebRTC i WebSockets bloquejats. Cal instal·lar Chromium amb `npx playwright install chromium` la primera vegada. El servidor de prova no forma part del desplegament a Pages.

## Participació individual

La identificació és obligatòria. El primer navegador que comença reserva l’alumne al dispositiu docent. Altres navegadors/dispositius queden bloquejats; el mateix navegador pot reprendre les seves respostes. Aquesta vinculació utilitza un identificador aleatori desat a localStorage, no una identificació física de l’ordinador ni una verificació de la identitat real de l’alumne. No es comparteixen tokens d’accés amb els altres alumnes.

El seguiment d’administració mostra **No iniciat**, **En curs** i **Acabat**. Acabat exigeix que s’hagi rebut el lliurament final; les respostes parcials no compten com a acabades. Un lliurament acabat no admet més modificacions.

Per alliberar un alumne, prem **Esborra i permet tornar a contestar** i escriu el seu nom exacte. S’esborren només les seves respostes i es revoca l’accés anterior. Pot començar de nou des d’un altre navegador. Si es perd el localStorage del navegador alumne o ja hi havia respostes d’una versió antiga, cal aquest reinici individual. El reinici global allibera tots els alumnes.

## Modes d’accés i targetes

En crear el grup es pot triar **Codi compartit + selecció del nom** o **Codis individuals**. Els projectes anteriors conserven el mode compartit. També es pot configurar el mode amb la sessió tancada i sense participacions actives.

Els codis individuals tenen un prefix comú configurable de 2 caràcters i un sufix aleatori. S’utilitza l’alfabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, sense `0`, `O`, `1`, `I` ni `L`. Són de 6 caràcters; si el nombre d’alumnes arriba al 70% de les combinacions del sufix de 4 caràcters, es generen de 8. Si ja s’han ampliat a 8, es manté la longitud. No es repeteixen dins del grup i tornar-los a descarregar no els canvia.

**Descarrega targetes NOM + CODI per imprimir** crea un HTML autònom amb targetes retallables. Obriu-lo i premeu **Imprimeix / Desa en PDF**. Conté el nom, el codi privat, l’URL i, si la sessió està oberta, el codi del grup. El mode individual comprova el codi privat al navegador docent; no es pot substituir per la selecció d’un nom.

## Seguiment, congelació i revisió

La taula mostra preguntes amb almenys una selecció, última resposta rebuda i última comunicació. Cada navegador participant envia un senyal aproximadament cada 15 segons. Més de 45 segons sense senyals mostra un avís; és una falta de comunicació recent, no una prova que l’alumne hagi tancat la pestanya. Els senyals no alteren la data de l’última resposta.

Mentre el qüestionari està obert, els alumnes, preguntes, títol, mode d’accés, prefix i codis queden congelats. L’edició està desactivada i també es rebutgen els intents d’importar damunt del qüestionari actiu. El seguiment i els reinicis individuals continuen disponibles. Tanqueu la sessió per editar-la.

L’última pregunta porta a un resum de totes les preguntes amb el nombre de seleccions i l’avís **En blanc**. Es pot tornar a una pregunta per revisar-la. Només **Confirma i envia definitivament** marca el qüestionari com a acabat, després de la confirmació de recepció del docent.

## Servei HTTPS

`relay/worker.js` conté el servei desplegat. `relay/schema.sql` en defineix les taules i índexs. `VITE_RELAY_URL` permet apuntar a una altra instal·lació compatible; `.env.example` en mostra el format. No cal configurar cap servidor local als dispositius del centre.

`node tests/mailbox.mjs` comprova autorització de la consola, col·lisions de codi, justificants privats, enviaments duplicats, caducitat i tancament. `npm run test:live` comprova el flux complet amb 30 alumnes concurrents, reconnexió, reintents i confirmació final.
