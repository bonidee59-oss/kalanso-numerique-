# Cahier de chemin (cahier de semaine)

Menu : **Pédagogie → Cahier de chemin (semaine)**. Accès : directeur, adjoint, enseignants (lecture du planning pour tous).

## Principe
Un seul cahier tourne de classe en classe. Chaque semaine, l'enseignant de la classe de permanence note, jour par jour (lundi à samedi), les événements de la cour : heure, moment, événement, personnes concernées, mesure prise. Il écrit un bilan, remet le cahier à la classe suivante ; le directeur vise.

## Mise en route (directeur)
1. Onglet **Planning de rotation** : vérifier l'ordre des classes (CP1 → CM2 par défaut, modifiable avec ↑ ↓).
2. Choisir première et dernière semaine, puis **Générer / compléter le planning**.
3. Vacances / jours fériés : bouton **Sauter** sur la semaine (les suivantes se décalent), ou déclarer les jours non travaillés dans le registre d'appel.
4. **Modifier** une semaine : changer de classe ou mettre un remplaçant (la rotation continue ensuite).

## Chaque semaine
- L'enseignant de la classe de permanence ouvre **Cahier de la semaine** : **+ Événement**, **R.A.S.**, observation du jour, bilan, date de remise.
- Les autres enseignants lisent seulement. Après le visa du directeur, le cahier est verrouillé pour l'enseignant.
- Imprimer / PDF, Word, Excel (CSV) disponibles.

## Technique
Nouveau magasin synchronisé `cahierSemaine` (base locale v14). Aucun script SQL à lancer. Les classes sont repérées par leur nom. Éviter que deux personnes écrivent la même semaine en même temps hors ligne (la dernière sauvegarde l'emporte).
