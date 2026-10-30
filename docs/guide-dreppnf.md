# Services de la DREPPNF (version 49)

Les 11 services de la DREPPNF ont chacun leur compte, créé par la DREPPNF (même liste que la DPEPPNF) :
Secrétariat, SGRFM, SGRH, SEP, SEPP, SENF, SEC, SPEIEFG, SEmPC, SASCL, SCTIC.
⚠ Liste fournie par vos soins, à confirmer avec l'organigramme officiel : si elle diffère, il suffit de modifier
`SERVICES` dans app-services.js et les listes de codes dans les deux fichiers SQL.

## Mise en route (une seule fois)
1. Supabase → SQL Editor : **supabase-services.sql** (si pas déjà fait), puis **supabase-dreppnf.sql** → Run.
2. Relancer **supabase-securite.sql**.
3. Recharger l'application (cache v49).

## Créer les comptes (DREPPNF)
Menu **Comptes des structures** : en bas, la carte **Services de la DREPPNF**. Un seul compte par service et par région.

## Qui peut écrire à qui
| De | Vers |
|---|---|
| Service de la DREPPNF | services des DPEPPNF, bureaux des CEB, écoles de la région (toutes les provinces ou certaines), autres services de la DREPPNF |
| Service de la DPEPPNF | + services de la DREPPNF |
| Bureau de la CEB | + services de la DREPPNF |
| École, CCEB, DPEPPNF, ministère | peuvent viser un service de la DREPPNF précis |

- Un service ne voit que ce qui lui est destiné ; adressé à la DREPPNF sans service précis → **Secrétariat**.
- La DREPPNF voit tout ce que ses services envoient.
- Filtre **Provinces concernées** : le document ne va qu'aux DPEPPNF, CEB et écoles des provinces cochées.
- Le raccourci « nature du document » coche l'homologue (bureau de CEB et service de DPEPPNF).
- Si un document vise à la fois des services de la DPEPPNF et de la DREPPNF, les cases sont indépendantes.
