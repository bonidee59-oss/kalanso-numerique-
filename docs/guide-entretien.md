# Entretien automatique de Supabase (contact quotidien + sauvegarde)

Fichier : `.github/workflows/entretien.yml` (à déjà inclus dans ce dépôt).

## 1. Contact quotidien (plan gratuit)
Le plan gratuit met le projet en pause après 7 jours sans activité. Chaque jour à 05h17 (UTC), GitHub envoie une requête minuscule à Supabase.
- Il ne faut RIEN configurer : l'adresse et la clé « publishable » sont celles, publiques, de l'application.
- Exécuter une fois `sql/supabase-sync-v51.sql` (il crée la fonction `ping()`). Sans elle, le contact fonctionne quand même.
- Si Supabase ne répond plus, le workflow passe au rouge et GitHub vous envoie un e-mail : c'est votre alerte.
- Test immédiat : Actions → « Entretien Supabase » → Run workflow → tâche `contact`.

## 2. Sauvegarde hebdomadaire (chaque dimanche)
Elle enregistre toutes les données de l'application (`sauvegarde-donnees-AAAA-MM-JJ.sql.gz`) et les comptes de connexion (`sauvegarde-comptes-….sql.gz`). Elle est conservée 30 jours dans Actions → l'exécution → Artifacts.

**Condition : dépôt PRIVÉ.** Les sauvegardes contiennent des données d'élèves ; dans un dépôt public, tout le monde pourrait les télécharger. Le workflow refuse de les faire dans un dépôt public.

Mise en place (une fois) :
1. Supabase → votre projet → bouton **Connect** → onglet **Session pooler** (et non « Direct connection » : GitHub n'accepte pas l'IPv6) → copiez l'URI, remplacez `[YOUR-PASSWORD]` par le mot de passe de la base (Project Settings → Database → Reset database password si vous l'avez perdu).
2. GitHub → dépôt → Settings → Secrets and variables → Actions → **New repository secret** : nom `SUPABASE_DB_URL`, valeur = l'URI.
3. (Facultatif, recommandé) Secret `BACKUP_PASSPHRASE` : un mot de passe fort. Les sauvegardes sont alors chiffrées (`.gpg`) ; notez ce mot de passe : sans lui, elles sont inutilisables.
4. Test : Actions → « Entretien Supabase » → Run workflow → tâche `sauvegarde`.

Restaurer (ordinateur avec PostgreSQL) :
`gunzip -c sauvegarde-donnees-AAAA-MM-JJ.sql.gz | psql "URI-de-la-base"`
(fichier `.gpg` : `gpg -d fichier.gpg > fichier.sql.gz` d'abord).

## À savoir
- GitHub peut décaler un horaire programmé de quelques minutes à une heure.
- Dans un dépôt public, GitHub désactive les tâches programmées après 60 jours sans aucune activité dans le dépôt (non applicable à un dépôt privé).
