# Services du Secrétariat général — ministère (version 50)

Le compte **Ministère** crée un compte pour chacun des services du Secrétaire général, selon la même procédure
que la DREPPNF :

| Code | Sigle | Service |
|---|---|---|
| be | BE | Bureau d'études (étude des dossiers, synthèse, projets de correspondance) |
| spsg | SP/SG | Secrétariat particulier du Secrétaire général (courrier confidentiel, appui direct) |
| scc | SCC | Service central du courrier (réception, enregistrement, expédition, ventilation) |
| sqe | SQE | Service des questions environnementales |
| sai | SAI | Service d'accueil et d'information |
| spsga | SP/SGA | Secrétariat particulier du Secrétaire général adjoint |

Le Secrétaire général est assisté d'un Secrétaire général adjoint, qui dispose lui aussi d'un secrétariat
particulier : il est ajouté comme 6e service (SP/SGA).
⚠ À confirmer avec le texte officiel : pour modifier la liste, changer `SERVICES_MIN` dans app-services.js
et les listes de codes dans supabase-ministere.sql.

## Mise en route (une seule fois)
1. Supabase → SQL Editor : **supabase-services.sql** puis **supabase-dreppnf.sql** (si pas déjà fait), puis **supabase-ministere.sql** → Run.
2. Relancer **supabase-securite.sql**.
3. Recharger l'application (cache v50).

## Créer les comptes (Ministère)
Menu **Comptes des structures** : en bas, la carte **Services du Secrétariat général**. Un seul compte par service.

## Qui peut écrire à qui
| De | Vers |
|---|---|
| Service du Secrétariat général | services des DREPPNF et des DPEPPNF, bureaux des CEB, écoles (tout le pays ou certaines régions), autres services du SG |
| Service de la DREPPNF / DPEPPNF, bureau de la CEB | + services du Secrétariat général |
| École, CCEB, DPEPPNF, DREPPNF | peuvent viser un service du Secrétariat général précis |

- Un service ne voit que ce qui lui est destiné ; adressé au ministère sans service précis → **SCC** (courrier).
- Le compte Ministère voit tout ce que ses services envoient.
- Filtre **Régions concernées** : le document ne va qu'aux DREPPNF, DPEPPNF, CEB et écoles des régions cochées.
- Correction : la liste des CEB (filtres « CEB / provinces / régions concernées ») était vide pour les comptes de
  services ; supabase-ministere.sql la rend accessible à ces comptes, dans leur zone.
