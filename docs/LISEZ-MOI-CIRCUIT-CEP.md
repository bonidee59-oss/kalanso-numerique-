# Circuit du CEP par le serveur (version 36)

| Besoin | Où | Fichiers |
|---|---|---|
| Remontée par le serveur | Espace Examen → Candidats (« Transmettre les effectifs ») et Résultats (« Transmettre par le serveur ») ; page « Remontées et validation » | app-cep-core.js, app-cep-validation.js, supabase-circuit.sql |
| Tableau de bord par niveau | « Tableau de bord du CEP » | app-cep-tableaux.js |
| Calendrier et échéances | « Calendrier et échéances » | app-cep-calendrier.js |
| Validation hiérarchique + journal | « Remontées et validation » | app-cep-validation.js, fonctions cep_valider / cep_renvoyer |
| Jour J | « Suivi du jour J » (président de centre, ou CEB pour un centre sans réseau) | app-cep-jourj.js |
| Handicap / bilingue | Fiche élève, liste des candidats au CEP, publication à la CEB, Espace Examen, statistiques | app-people.js, app-examens-circuit.js, app-listes-ceb.js, app-examens*.js |
| Centres à risque | « Centres et présidents » (CEB) ; visibles et modifiables dans le tableau de bord | app-cep-jourj.js |

Tests automatiques : `node tests/cep.test.js` (34 vérifications, sans navigateur ni serveur).
Le SQL n'a pas pu être exécuté dans l'environnement de travail : à essayer sur un projet Supabase de test avant la production.
