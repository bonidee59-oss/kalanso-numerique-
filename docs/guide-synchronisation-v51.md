# Synchronisation fiabilisée (version 51)

## Ce qui causait la perte de notes et la lenteur
1. Les données reçues d'un autre appareil étaient renvoyées au serveur (« écho ») et pouvaient écraser une saisie plus récente.
2. Une évaluation entière (toutes les notes) était une seule ligne : le dernier enregistrement écrasait tous les autres.
3. Une note dont l'élève n'était pas encore reçu était jetée en silence.
4. Aucune file d'attente : une saisie faite pendant une coupure n'était jamais envoyée.
5. Le rafraîchissement automatique pouvait reconstruire la page pendant une saisie.
6. Téléchargement limité à 1000 lignes par rubrique, sans pagination.
7. Repère de synchro pris sur l'horloge du téléphone.
8. Aucun rattrapage quand le téléphone revenait en avant-plan (la connexion temps réel y est coupée).

## Ce qui a été corrigé
- Ce qui est reçu n'est plus renvoyé.
- **File d'attente d'envoi** conservée sur l'appareil : rien n'est perdu hors ligne ; envois groupés (50 lignes par requête) ; l'indicateur affiche « Hors ligne (N à envoyer) ».
- **Fusion note par note** : chaque note porte un horodatage ; pour une même case élève × matière, la plus récente gagne. Notes de deux enseignants dans la même évaluation = les deux conservées.
- Garde-fou dans `db.js` : enregistrer une copie périmée d'une évaluation ne peut plus effacer des notes plus récentes.
- La saisie d'une note relit la version enregistrée et ne modifie que la case concernée.
- Notes dont l'élève/la matière n'est pas encore arrivé : conservées, rattachées automatiquement dès leur arrivée.
- Téléchargement par pages de 1000, dans l'ordre classes → enseignants → matières → élèves → le reste.
- Horodatage fixé par le serveur (`sql/supabase-sync-v51.sql`) ; repère de synchro = horloge serveur.
- Rattrapage automatique au retour du réseau et au retour dans l'application.
- Le rafraîchissement automatique n'a lieu que si des données ont changé et jamais pendant une saisie.

## Mise en route
1. Supabase → SQL Editor : exécuter `sql/supabase-sync-v51.sql`.
2. Mettre en ligne la nouvelle version ; recharger l'application une fois.
3. La première synchronisation après la mise à jour retélécharge tout une fois (nouveau repère).

## Limites connues
- Si deux enseignants modifient la MÊME case au même moment, c'est la saisie la plus récente (selon l'horloge des téléphones) qui gagne. Mettre les téléphones en heure automatique.
- Les données restent d'abord sur l'appareil : si un téléphone est réinitialisé avant d'avoir pu envoyer ses saisies, celles-ci sont perdues.
