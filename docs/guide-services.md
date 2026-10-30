# Services du DPEPPNF et échanges avec les bureaux de la CEB (version 48)

Les 11 services du DPEPPNF ont chacun leur compte, créé par le DPEPPNF :
Secrétariat, SGRFM, SGRH, SEP, SEPP, SENF, SEC, SPEIEFG, SEmPC, SASCL, SCTIC.

## Mise en route (une seule fois)
1. Supabase → SQL Editor → coller **supabase-services.sql** → Run
   (après supabase-bureaux.sql ; sans danger si relancé).
2. Puis relancer **supabase-securite.sql**.
3. Recharger l'application (le cache passe en v48).

## Créer les comptes (DPEPPNF)
Menu **Comptes des structures** : en bas, la carte **Services du DPEPPNF** liste les 11 services.
« Créer le compte » demande le nom du responsable et son e-mail. Un seul compte par service et par province.

## Qui peut écrire à qui
| De | Vers |
|---|---|
| Service du DPEPPNF | bureaux de la CEB (une, plusieurs ou toutes les CEB de la province), écoles, autres services |
| Bureau de la CEB | services du DPEPPNF, autres bureaux de sa CEB, écoles de sa CEB |
| École, CCEB, DREPPNF, ministère | peuvent aussi viser un service ou un bureau précis |

- Un service ne voit que ce qui lui est destiné. Un document adressé au DPEPPNF **sans service précis**
  va au **Secrétariat** (comme pour le Secrétariat de la CEB).
- Le DPEPPNF voit tout ce que ses services envoient ; le CCEB voit tout ce que ses bureaux envoient.
- Cases cochées d'office : un service coche ses homologues (SGRH → BGRH, SEPP → BEPres + BEPrim…).
  SPEIEFG, SEmPC et SCTIC n'ont pas d'homologue en CEB : le Secrétariat est coché, à vous d'ajuster.
- « Raccourci : nature du document » coche le bon bureau / service en un clic.
- Les accusés de réception remontent à l'expéditeur, comme avant.

## Limites connues
- Pièces jointes : 1,5 Mo maximum (limite existante).
- Les services ne voient pas les tableaux de bord du CEP : ils n'ont que les documents publiés.
- Les documents envoyés par les services comptent aussi dans « à accuser » du DPEPPNF (supervision).
