# CESC — INS Mollet

## GitHub Pages

El workflow `.github/workflows/pages.yml` compila i publica `dist/` en cada canvi a `main`.
URL: https://aagust11.github.io/imv_cesc/
Si el repositori encara no té Pages activat, selecciona **Settings → Pages → Source → GitHub Actions**.

```sh
npm ci
npm run lint
npm run build
```

La compilació estàtica no inclou el servidor ni `data/admin_config.json`.
A Pages s’utilitza el mode local: qüestionaris, respostes i contrasenya es desen només en aquest navegador. Es poden gestionar qüestionaris, respondre al mateix navegador, analitzar sociogrames i importar/exportar JSON i CSV. Exporta còpies JSON abans d’esborrar dades del navegador. La contrasenya inicial local és `InsM0ll3t`; aquesta barrera local no constitueix autenticació segura.

**Els codis locals no permeten que altres ordinadors o mòbils enviïn respostes.** La recollida compartida necessita un backend. No es presenta una còpia local com a sincronització entre dispositius.

## Servidor Node.js opcional

`npm run dev` inicia el servidor de desenvolupament. Per producció amb servidor: `npm run build:server` i `NODE_ENV=production npm start`. Aquest servidor no s’executa a GitHub Pages i conserva els projectes en memòria; no ofereix persistència duradora. Cal revisar-ne autenticació i persistència abans d’utilitzar-lo amb dades reals d’alumnat.
