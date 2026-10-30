# Guide — Comptes du personnel

Depuis cette version, **seul le tout premier compte (le directeur)** se crée
à la main dans Supabase. Tous les autres comptes (adjoint, secrétaire,
comptable, magasinier, cantine, enseignants) se créent **directement depuis
l'application**, dans la rubrique **Utilisateurs** → **+ Créer un compte**.

## Étape 0 — À faire une seule fois dans Supabase

Ces deux réglages sont indispensables pour que la création de compte
fonctionne depuis l'appli.

**A. Réexécuter le script SQL**
1. Ouvre ton projet sur [supabase.com](https://supabase.com) → **SQL Editor**
   → **New query**.
2. Colle le contenu de `supabase-setup.sql` (fourni avec l'appli) et clique
   **Run**. Sans risque de le rejouer même s'il a déjà été exécuté avant.

**B. Désactiver la confirmation par e-mail**
1. Menu de gauche → **Authentication** → **Providers** (ou **Sign In / Providers**
   selon la version) → **Email**.
2. Désactive l'option **"Confirm email"**.
3. Enregistre.

Sans cette étape B, un compte créé depuis l'appli reste "en attente de
confirmation" et la personne ne peut pas se connecter tant qu'elle n'a pas
cliqué un lien reçu par e-mail (peu pratique si le personnel n'a pas
d'adresse e-mail vérifiable).

## Étape 1 — Créer le compte du directeur (une seule fois, à la main)

1. **Authentication** → **Users** → **Add user** → **Create new user**.
2. Renseigne un e-mail et un mot de passe, coche **Auto Confirm User**,
   clique **Create user**.
3. Copie son UID (sur la fiche de l'utilisateur).
4. **Table Editor** → table `profiles` → **Insert row** :
   - **id** : l'UID copié
   - **nom** : nom du directeur
   - **role** : `directeur`
5. Enregistre.

## Étape 2 — Créer tous les autres comptes, depuis l'appli

1. Connecte-toi à l'appli avec le compte directeur.
2. Va dans **Utilisateurs** (menu Administration) → **+ Créer un compte**.
3. Renseigne le nom, le rôle, l'e-mail de connexion. Un mot de passe
   temporaire est proposé automatiquement (modifiable).
4. Clique **Créer le compte**. Les identifiants s'affichent une fois :
   note-les et transmets-les à la personne concernée.

La personne pourra se connecter immédiatement avec cet e-mail et ce mot de
passe.

## Erreurs fréquentes

| Symptôme | Cause probable |
|---|---|
| "Identifiants incorrects" à la connexion | Email ou mot de passe mal saisi, ou compte non créé |
| Erreur à la création de compte mentionnant la confirmation par e-mail | L'étape 0-B n'a pas été faite (confirmation email encore active) |
| "Le compte de connexion a été créé, mais le profil n'a pas pu être enregistré" | Le script SQL de l'étape 0-A n'a pas été (re)exécuté, ou le compte connecté n'a pas le rôle directeur/directeur_adjoint |
| "Aucun profil associé" après connexion | Ligne manquante ou `id` incorrect dans `profiles` (cas d'un compte créé à la main, hors appli) |
| La page reste vide après connexion | Le rôle dans `profiles` ne correspond à aucune des valeurs autorisées (directeur, directeur_adjoint, secretaire, comptable, magasinier, cantine, enseignant, parent, ceb, dpeppnf, dreppnf, ministere — orthographe exacte) |

## Comptes du réseau : CEB, DPEPPNF, DREPPNF, ministère

Chaque niveau a **son propre compte**, comme le directeur pour l'école. Ces
comptes **ne voient aucune rubrique de l'école** (élèves, classes, finances…) :
ils ont leur tableau de bord, leur espace de travail (examens du CEP) et la
rubrique **Documents publiés**.

Chaque niveau **crée les comptes du niveau juste en dessous**, depuis la
rubrique **Comptes des structures** :

| Compte | Crée les comptes de… |
|---|---|
| Ministère | DREPPNF (une par région) |
| DREPPNF | DPEPPNF (une par province de sa région) |
| DPEPPNF | CEB (une par CEB de sa province) |
| CEB | Directeurs d'école de sa circonscription |
| Directeur | Personnel de son école (comme avant) |

### À faire une seule fois

1. **Réexécuter `supabase-setup.sql`** dans Supabase (SQL Editor). Il ajoute les
   nouveaux rôles, le rattachement (région / province / CEB), les tables de
   publication et verrouille l'accès aux données de l'école. Sans risque de le
   rejouer. Si vous utilisez aussi `supabase-examens.sql`, rejouez-le **après**.
2. **Créer à la main le tout premier compte du réseau : le ministère**, exactement
   comme pour le directeur (étape 1 ci-dessus), avec dans `profiles` :
   - **role** : `ministere`
   - **nom** : nom du responsable
   - **structure** : `Ministère (SG MEBAPLN)` (libellé affiché)
   Les autres champs (region, province, ceb) restent vides.
3. Ensuite, tout se fait dans l'application : le ministère crée les DREPPNF, qui
   créent les DPEPPNF, qui créent les CEB, qui créent les directeurs d'école.

### Écoles déjà existantes (compte directeur créé avant cette version)

Le directeur ouvre **Documents publiés** : une carte lui propose de
**rattacher son école à sa CEB** en la choisissant dans la liste des CEB qui ont
un compte. Tout le personnel de l'école est alors rattaché d'un coup. Tant que
ce rattachement n'est pas fait, l'école ne reçoit et ne publie rien.

### Qui reçoit quoi ?

Quand un niveau publie, il coche les niveaux destinataires. Le document n'est
visible que dans **sa zone** : une CEB qui publie vers « École » atteint les
écoles de **sa** CEB ; vers « DPEPPNF », la DPEPPNF de **sa** province. Le
ministère atteint tout le pays. Les destinataires accusent réception, et
l'auteur voit la liste des accusés. L'auteur peut retirer un document à tout
moment.

Les noms de région, province et CEB sont comparés sans tenir compte des accents
ni des majuscules (« Koudougou 1 » = « koudougou1 »), mais une vraie faute de
frappe (« Koudogou ») sépare les zones : saisissez-les avec soin à la création
d'un compte, c'est ce qui sert de rattachement à tous les comptes en dessous.

> Une connexion internet est nécessaire pour publier et consulter les documents
> publiés. Le reste de l'application continue de fonctionner hors ligne.

## Plusieurs écoles dans le même projet : isolement des données

Chaque école a un identifiant (`ecole_id`) partagé par son personnel et ses
parents. Toutes les données de l'école (élèves, classes, notes, finances, espace
parents…) le portent, et les règles du serveur font qu'**une école ne peut ni lire
ni modifier les données d'une autre**, ni celles d'un compte CEB / DPEPPNF /
DREPPNF / ministère. Sur un même téléphone ou ordinateur, chaque école a aussi sa
propre base locale : changer de compte ne mélange rien.

- Une **nouvelle école** naît quand sa CEB crée le compte de son directeur (depuis
  « Comptes des structures ») : elle reçoit automatiquement son identifiant. Le
  directeur crée ensuite son personnel comme avant, qui rejoint la même école.
- **Données déjà présentes** : en rejouant `supabase-setup.sql`, tout ce qui existe
  (données et comptes d'école) est regroupé dans **une seule école « historique »**.
  Si plusieurs écoles utilisaient déjà ce projet avant cette version, leurs données
  y sont encore ensemble et **ne peuvent pas être séparées automatiquement** (rien
  n'indique à quelle école appartient chaque ligne). Dans ce cas, il faut décider
  école par école de repartir de zéro avec un nouveau compte directeur créé par la
  CEB, ou de nettoyer l'ancienne.
- Le tout premier directeur, créé à la main (étape 1), obtient lui aussi son
  `ecole_id` automatiquement. Pour **ajouter à la main** un second profil à une
  école, renseignez son `ecole_id` avec celui du directeur (colonne de `profiles`).

## Listes d'élèves : de l'école vers la CEB

### À faire une seule fois
Exécuter **`supabase-listes.sql`** dans Supabase (SQL Editor → New query → Run), après `supabase-setup.sql`
(son contenu est aussi à la fin de `supabase-setup.sql` : l'un ou l'autre suffit). Sans risque de le rejouer.

### Côté école (direction ou secrétariat) — rubrique « Liste des élèves → CEB »
1. L'école doit être **rattachée à sa CEB** (carte en haut de la page, ou compte créé par la CEB).
2. Choisir les élèves à inclure (actifs par défaut ; transférés, abandons, diplômés en option) et, si besoin,
   joindre le nom des parents.
3. L'application contrôle la liste :
   - **anomalies bloquantes** (nom, sexe ou classe manquant, même matricule pour deux élèves) : à corriger dans
     « Élèves » avant de publier ;
   - **points d'attention** (date de naissance manquante ou invraisemblable, matricule vide, possible doublon).
4. **Publier à ma CEB**. Chaque publication est une **version numérotée** et non modifiable ; la CEB voit toujours la
   plus récente. Republier une liste identique est refusé.
5. L'école suit le sort de chaque version : *envoyée*, *reçue*, *validée* ou *à corriger* (avec la remarque de la CEB).
   Elle peut retirer une version tant que la CEB ne l'a pas validée.

Jamais transmis : photos, téléphones, finances, discipline, observations.

### Côté CEB — rubrique « Listes d'élèves des écoles »
1. Le tableau montre **toutes les écoles de la circonscription**, y compris celles qui n'ont encore rien publié
   (*en attente*). Un directeur apparaît dès que son compte est rattaché à la CEB.
2. **Récupérer les listes** copie les nouvelles listes sur l'appareil de la CEB (consultables ensuite **hors
   connexion**), vérifie leur **empreinte d'intégrité** et envoie l'accusé de réception à l'école.
3. **Ouvrir** une liste (recherche, filtre par classe, CSV, PDF), puis **Valider** ou **À corriger** (remarque
   obligatoire, visible par l'école).
4. **Liste consolidée (CSV)** de toutes les écoles, **État des effectifs (PDF)** signable, et détection des
   **doublons entre écoles** (même élève, ou même matricule, dans deux écoles).

### Confidentialité
Une école ne voit que ses propres listes ; une CEB ne voit que celles de sa circonscription ; DPEPPNF, DREPPNF et
ministère n'y ont pas accès. Ces règles sont appliquées par le serveur (RLS), pas seulement par l'écran.


---

## Version 36 — Circuit du CEP par le serveur

1. Dans Supabase → SQL Editor, exécutez **supabase-complet.sql** (une seule fois suffit ; le rejouer ne casse rien).
2. **Président de centre** : c'est un nouveau type de compte (rôle « centre »), créé par la **CEB** depuis « Centres et présidents » (bouton « Créer le compte du président »). Le centre doit d'abord être **publié** (bouton « Publier la liste des centres »).
3. Les comptes CEB, DPEPPNF, DREPPNF et ministère doivent avoir leur **zone** renseignée (région ; région + province ; région + province + CEB). Un compte sans zone ne voit aucune donnée, par sécurité.
4. Le **ministère** fixe le calendrier dans « Calendrier et échéances » → « Modifier le calendrier ».
5. Le fichier .json reste disponible comme solution de secours hors ligne (Espace Examen → Résultats / Remontées).

Aucun nom de candidat n'est stocké au-dessus de la CEB. Les tables `cep_*` ne reçoivent que des chiffres et des noms de structures ; le texte libre des incidents du jour J n'est lisible que du centre et de la CEB.
