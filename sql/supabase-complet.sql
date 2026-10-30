-- ============================================================
-- ÉCOLE NUMÉRIQUE — SUPABASE COMPLET (version 36)
-- À coller en UNE fois dans Supabase → SQL Editor → Run.
-- Sans danger si exécuté plusieurs fois : tout est « create if not exists »,
-- « create or replace » ou « drop … if exists » avant recréation. Les données
-- existantes ne sont ni supprimées ni modifiées.
-- Contenu : 1/4 — Base : comptes, zones, école (app_data), listes de base | 2/4 — Listes d'élèves et candidats au CEP (école → CEB) | 3/4 — Espace Examen (accès du personnel) | 4/4 — Circuit du CEP par le serveur (nouveau)
-- ============================================================


-- ############################################################
-- PARTIE 1/4 — Base : comptes, zones, école (app_data), listes de base
-- (fichier d'origine : supabase-setup.sql)
-- ############################################################

-- ============================================================
-- À exécuter UNE SEULE FOIS dans Supabase → SQL Editor → New query
-- Projet : École Numérique Burkina Faso — synchronisation temps réel
-- ============================================================
-- ⚠️ Ce fichier remplace l'ancienne version "accès libre". Il suppose que
-- chaque utilisateur de l'appli se connecte désormais via Supabase Auth
-- (email + mot de passe). Sans ça, personne ne pourra plus rien lire ni
-- écrire : c'est voulu, c'est tout l'objectif de la correction.

-- ------------------------------------------------------------
-- 1) Table des profils : relie chaque compte Supabase Auth à son rôle
--    dans l'école. Un profil doit être créé pour chaque utilisateur
--    (à la main dans Supabase, ou via un écran d'admin plus tard) —
--    sans profil, l'utilisateur est authentifié mais n'a accès à rien.
-- ------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nom text not null,
  role text not null,
  created_at timestamptz not null default now()
);

-- RÉSEAU (CEB, DPEPPNF, DREPPNF, ministère) : chaque profil porte son
-- rattachement géographique. Il sert à décider qui reçoit quels documents
-- publiés (voir section 4). Vide pour les rôles qui n'en ont pas besoin.
--   structure : nom affiché (ex. « CEB de Koudougou 1 », « EPP de Réo A »)
--   region / province / ceb : zone de la structure (comparées sans accents
--   ni majuscules, voir norm_zone)
alter table profiles add column if not exists structure text;
alter table profiles add column if not exists region text;
alter table profiles add column if not exists province text;
alter table profiles add column if not exists ceb text;

-- PRÉSIDENT DE CENTRE (rôle « centre ») : compte créé par la CEB pour un centre d'examen.
-- centre_id = identifiant du centre dans cep_centres (voir supabase-circuit.sql).
alter table profiles add column if not exists centre_id uuid;

-- ISOLEMENT DES ÉCOLES : plusieurs écoles partagent ce projet Supabase. Chaque
-- école a un identifiant (ecole_id), partagé par tout son personnel et ses
-- parents. Toutes les données de l'école (app_data, espace parents) portent cet
-- identifiant : une école ne lit et n'écrit JAMAIS les données d'une autre.
alter table profiles add column if not exists ecole_id uuid;

alter table profiles enable row level security;

-- Les anciennes policies/fonctions sont retirées d'abord (elles dépendent de
-- peut_gerer_profil, dont la signature change : elle reçoit maintenant l'école).
drop policy if exists "profil visible par son propriétaire" on profiles;
drop policy if exists "profils visibles par tout utilisateur connecté" on profiles;
drop policy if exists "profils : lecture" on profiles;
drop policy if exists "directeur peut créer des profils" on profiles;
drop policy if exists "directeur peut modifier des profils" on profiles;
drop policy if exists "directeur peut supprimer des profils" on profiles;
drop policy if exists "profils : création" on profiles;
drop policy if exists "profils : modification" on profiles;
drop policy if exists "profils : suppression" on profiles;
drop function if exists peut_gerer_profil(text, text, text, text);

-- Rôles autorisés : personnel d'école, parent, et les 4 niveaux du réseau.
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in (
  'directeur', 'directeur_adjoint', 'secretaire',
  'comptable', 'magasinier', 'cantine', 'enseignant', 'parent',
  'ceb', 'dpeppnf', 'dreppnf', 'ministere', 'centre'
));

create or replace function est_parent() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'parent')
$$;

create or replace function est_direction() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('directeur', 'directeur_adjoint'))
$$;

-- École du compte connecté (null pour les comptes du réseau).
create or replace function mon_ecole() returns uuid
language sql stable security definer set search_path = public as $$
  select ecole_id from profiles where id = auth.uid()
$$;

-- Un profil d'école (personnel ou parent) créé sans ecole_id reçoit celui de
-- la personne qui le crée (le directeur qui ajoute son personnel). S'il n'y en
-- a pas (premier directeur créé à la main, ou directeur créé par une CEB),
-- une nouvelle école est créée.
create or replace function profils_ecole_defaut() returns trigger
language plpgsql as $$
begin
  if new.ecole_id is null and new.role in (
    'directeur', 'directeur_adjoint', 'secretaire', 'comptable', 'magasinier', 'cantine', 'enseignant', 'parent'
  ) then
    new.ecole_id := coalesce(mon_ecole(), gen_random_uuid());
  end if;
  return new;
end
$$;
drop trigger if exists profils_ecole_defaut on profiles;
create trigger profils_ecole_defaut before insert on profiles
  for each row execute function profils_ecole_defaut();

-- Personnel d'une école (hors parents et hors réseau). Seuls ces rôles ont
-- accès aux données de l'école (table app_data) : un compte CEB, DPEPPNF,
-- DREPPNF ou ministère ne voit JAMAIS les rubriques de l'école.
create or replace function est_personnel_ecole() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid()
      and role in ('directeur', 'directeur_adjoint', 'secretaire', 'comptable', 'magasinier', 'cantine', 'enseignant')
  )
$$;

-- Niveau du réseau d'un rôle : ministere > dreppnf > dpeppnf > ceb > ecole.
-- Seuls direction et secrétariat de l'école participent aux publications.
create or replace function niveau_reseau(r text) returns text
language sql immutable as $$
  select case
    when r = 'ministere' then 'ministere'
    when r = 'dreppnf' then 'dreppnf'
    when r = 'dpeppnf' then 'dpeppnf'
    when r = 'ceb' then 'ceb'
    when r in ('directeur', 'directeur_adjoint', 'secretaire') then 'ecole'
    else null
  end
$$;

create or replace function rang_niveau(n text) returns int
language sql immutable as $$
  select case n when 'ministere' then 0 when 'dreppnf' then 1 when 'dpeppnf' then 2 when 'ceb' then 3 when 'ecole' then 4 else null end
$$;

-- Compare deux noms de zone sans tenir compte des accents, majuscules,
-- espaces ni ponctuation : « Koudougou 1 » = « koudougou1 ».
create or replace function norm_zone(t text) returns text
language sql immutable as $$
  select nullif(lower(regexp_replace(
    translate(coalesce(t, ''), 'àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ', 'aaaeeeeiioouuucAAAEEEEIIOOUUUC'),
    '[^a-zA-Z0-9]+', '', 'g')), '')
$$;

-- Qui peut créer / modifier / supprimer le profil d'un autre compte ?
--   directeur, adjoint  : le personnel de SON école et les parents
--   ministère           : les DREPPNF
--   DREPPNF             : les DPEPPNF de sa région
--   DPEPPNF             : les CEB de sa province
--   CEB                 : les directeurs d'école et les présidents de centre de sa circonscription
-- Personne ne peut donc se donner (ni donner) un rôle supérieur au sien.
create or replace function peut_gerer_profil(p_role text, p_region text, p_province text, p_ceb text, p_ecole uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles me
    where me.id = auth.uid() and (
      (me.role in ('directeur', 'directeur_adjoint')
        and p_role in ('directeur', 'directeur_adjoint', 'secretaire', 'comptable', 'magasinier', 'cantine', 'enseignant', 'parent')
        and me.ecole_id is not null and p_ecole is not distinct from me.ecole_id)
      or (me.role = 'ministere' and p_role = 'dreppnf')
      or (me.role = 'dreppnf' and p_role = 'dpeppnf'
          and norm_zone(p_region) = norm_zone(me.region))
      or (me.role = 'dpeppnf' and p_role = 'ceb'
          and norm_zone(p_region) = norm_zone(me.region) and norm_zone(p_province) = norm_zone(me.province))
      or (me.role = 'ceb' and p_role in ('directeur', 'centre')
          and norm_zone(p_region) = norm_zone(me.region) and norm_zone(p_province) = norm_zone(me.province)
          and norm_zone(p_ceb) = norm_zone(me.ceb))
    )
  )
$$;

-- Lecture : son propre profil ; le personnel d'école voit les profils de
-- l'école (nom + rôle des collègues, nécessaire à l'écran de connexion et à
-- la liste des utilisateurs) ; un compte du réseau voit les comptes qu'il
-- a le droit de gérer. Un parent ne voit que le sien.
create policy "profils : lecture"
  on profiles for select
  using (
    id = auth.uid()
    or (est_personnel_ecole() and ecole_id = mon_ecole() and role in (
      'directeur', 'directeur_adjoint', 'secretaire', 'comptable', 'magasinier', 'cantine', 'enseignant', 'parent'))
    or peut_gerer_profil(role, region, province, ceb, ecole_id)
  );

create policy "profils : création"
  on profiles for insert
  with check (peut_gerer_profil(role, region, province, ceb, ecole_id));

create policy "profils : modification"
  on profiles for update
  using (peut_gerer_profil(role, region, province, ceb, ecole_id))
  with check (peut_gerer_profil(role, region, province, ceb, ecole_id));

create policy "profils : suppression"
  on profiles for delete
  using (peut_gerer_profil(role, region, province, ceb, ecole_id));

-- ------------------------------------------------------------
-- 2) Table des données de l'école
-- ------------------------------------------------------------
create table if not exists app_data (
  store text not null,
  uuid uuid not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (store, uuid)
);

-- Colonne école : remplie automatiquement avec l'école du compte connecté.
-- La clé primaire passe à (ecole_id, store, uuid) plus bas (section 3b) : deux
-- écoles peuvent avoir des enregistrements de même identifiant (classes standard...).
alter table app_data add column if not exists ecole_id uuid;
alter table app_data alter column ecole_id set default mon_ecole();

alter table app_data enable row level security;

drop policy if exists "allow read" on app_data;
drop policy if exists "allow insert" on app_data;
drop policy if exists "allow update" on app_data;
drop policy if exists "allow delete" on app_data;

-- Rubriques les plus sensibles : réservées aux rôles qui en ont vraiment
-- besoin. Ajuste cette liste si d'autres rubriques doivent être limitées.
create or replace function peut_acceder(store_name text)
returns boolean
language sql
stable
as $$
  select case
    when store_name = 'cahierBord' then
      exists (
        select 1 from profiles
        where id = auth.uid()
          and role in ('directeur', 'directeur_adjoint')
      )
    when store_name in ('examSessions', 'examCentres', 'examJurys', 'examCandidats', 'examNotes', 'examRemontees') then
      exists (
        select 1 from profiles
        where id = auth.uid()
          and role in ('directeur', 'directeur_adjoint', 'secretaire')
      )
    when store_name in ('finances', 'cotisations') then
      exists (
        select 1 from profiles
        where id = auth.uid()
          and role in ('directeur', 'directeur_adjoint', 'comptable')
      )
    else
      est_personnel_ecole()
  end;
$$;

-- Lecture/écriture : il faut être authentifié, avoir un profil dans
-- l'école, et (pour les rubriques sensibles) avoir le bon rôle.
create policy "allow read"   on app_data for select using (ecole_id = mon_ecole() and peut_acceder(store));
create policy "allow insert" on app_data for insert with check (ecole_id = mon_ecole() and peut_acceder(store));
create policy "allow update" on app_data for update using (ecole_id = mon_ecole() and peut_acceder(store)) with check (ecole_id = mon_ecole() and peut_acceder(store));
create policy "allow delete" on app_data for delete using (ecole_id = mon_ecole() and peut_acceder(store));

-- La réplication temps réel (Realtime) ne s'active PAS ici en SQL (ça posait
-- problème). Une fois ce script exécuté avec succès, active-la manuellement :
-- Table Editor → sélectionne la table "app_data" → icône Realtime en haut
-- → active le bouton. Ou : Database → Replication → coche "app_data".

-- Index utile pour accélérer le filtrage par rubrique.
create index if not exists app_data_store_idx on app_data (store);

-- ------------------------------------------------------------
-- 3) ESPACE PARENTS
--    - parents_liens   : quel compte parent est lié à quel élève (géré par la direction)
--    - parents_fiches  : fiche de suivi publiée pour chaque élève lié (présences,
--                        résultats, cotisation) — un parent ne lit que celles de ses enfants
--    - parents_annonces: annonces de l'école ; un parent ne lit que les annonces générales et celles de la classe de ses enfants
-- ------------------------------------------------------------
create table if not exists parents_liens (
  parent_id uuid not null references auth.users(id) on delete cascade,
  eleve_uuid uuid not null,
  lien text,
  primary key (parent_id, eleve_uuid)
);
create table if not exists parents_fiches (
  eleve_uuid uuid primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists parents_annonces (
  id uuid primary key,
  classe_nom text,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table parents_liens add column if not exists ecole_id uuid;
alter table parents_fiches add column if not exists ecole_id uuid;
alter table parents_annonces add column if not exists ecole_id uuid;
alter table parents_liens alter column ecole_id set default mon_ecole();
alter table parents_fiches alter column ecole_id set default mon_ecole();
alter table parents_annonces alter column ecole_id set default mon_ecole();

alter table parents_liens enable row level security;
alter table parents_fiches enable row level security;
alter table parents_annonces enable row level security;

drop policy if exists "liens : lecture" on parents_liens;
drop policy if exists "liens : gestion direction" on parents_liens;
drop policy if exists "fiches : lecture" on parents_fiches;
drop policy if exists "fiches : gestion direction" on parents_fiches;
drop policy if exists "annonces : lecture" on parents_annonces;
drop policy if exists "annonces : gestion direction" on parents_annonces;

create policy "liens : lecture" on parents_liens for select
  using (parent_id = auth.uid() or (est_direction() and ecole_id = mon_ecole()));
create policy "liens : gestion direction" on parents_liens for all
  using (est_direction() and ecole_id = mon_ecole()) with check (est_direction() and ecole_id = mon_ecole());

create policy "fiches : lecture" on parents_fiches for select
  using (
    (est_direction() and ecole_id = mon_ecole())
    or exists (select 1 from parents_liens l where l.parent_id = auth.uid() and l.eleve_uuid = parents_fiches.eleve_uuid)
  );
create policy "fiches : gestion direction" on parents_fiches for all
  using (est_direction() and ecole_id = mon_ecole()) with check (est_direction() and ecole_id = mon_ecole());

-- Personnel de l'école : toutes les annonces DE SON ÉCOLE. Parent : annonces
-- générales (sans classe) de son école et annonces de la classe de l'un de SES
-- enfants uniquement.
create policy "annonces : lecture" on parents_annonces for select
  using (
    ecole_id = mon_ecole()
    and (
      est_personnel_ecole()
      or (
        est_parent()
        and (
          classe_nom is null
          or exists (
            select 1 from parents_liens l join parents_fiches f on f.eleve_uuid = l.eleve_uuid
            where l.parent_id = auth.uid() and f.data->>'classe' = parents_annonces.classe_nom
          )
        )
      )
    )
  );
create policy "annonces : gestion direction" on parents_annonces for all
  using (est_direction() and ecole_id = mon_ecole()) with check (est_direction() and ecole_id = mon_ecole());

-- ------------------------------------------------------------
-- 3b) MIGRATION vers l'isolement par école (sans danger si rejouée)
--     Les données et profils existants, qui n'ont pas encore d'école, sont
--     regroupés dans UNE école « historique ». Si plusieurs écoles utilisaient
--     déjà ce projet, leurs données restent donc ensemble : voir le guide.
-- ------------------------------------------------------------
do $$
declare
  v uuid;
  roles_ecole text[] := array['directeur', 'directeur_adjoint', 'secretaire', 'comptable', 'magasinier', 'cantine', 'enseignant', 'parent'];
begin
  if exists (select 1 from app_data where ecole_id is null)
     or exists (select 1 from parents_liens where ecole_id is null)
     or exists (select 1 from parents_fiches where ecole_id is null)
     or exists (select 1 from parents_annonces where ecole_id is null)
     or exists (select 1 from profiles where ecole_id is null and role = any (roles_ecole)) then
    select p.ecole_id into v from profiles p where p.ecole_id is not null and p.role = any (roles_ecole) limit 1;
    v := coalesce(v, gen_random_uuid());
    update profiles set ecole_id = v where ecole_id is null and role = any (roles_ecole);
    update app_data set ecole_id = v where ecole_id is null;
    update parents_liens set ecole_id = v where ecole_id is null;
    update parents_fiches set ecole_id = v where ecole_id is null;
    update parents_annonces set ecole_id = v where ecole_id is null;
  end if;
end $$;

alter table app_data alter column ecole_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'app_data'::regclass and contype = 'p' and pg_get_constraintdef(oid) like '%ecole_id%'
  ) then
    alter table app_data drop constraint app_data_pkey;
    alter table app_data add primary key (ecole_id, store, uuid);
  end if;
end $$;
create index if not exists app_data_ecole_store_idx on app_data (ecole_id, store, updated_at);

-- ------------------------------------------------------------
-- 4) PUBLICATIONS DU RÉSEAU : ministère → DREPPNF → DPEPPNF → CEB → école
--    Chaque niveau publie des documents directement depuis l'application,
--    vers un ou plusieurs autres niveaux. Un document n'est visible que :
--      - par son auteur,
--      - par les comptes dont le niveau figure dans « cibles » ET qui sont
--        dans la zone de l'auteur (même CEB pour les écoles d'une CEB,
--        même province pour les CEB d'une province, etc.).
--    circuit_accuses : accusés de réception (visibles de l'auteur).
-- ------------------------------------------------------------
create table if not exists circuit_documents (
  id uuid primary key default gen_random_uuid(),
  niveau text not null check (niveau in ('ministere', 'dreppnf', 'dpeppnf', 'ceb', 'ecole')),
  emetteur_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  emetteur_nom text not null,
  structure text,
  region text,
  province text,
  ceb text,
  cibles text[] not null,
  categorie text,
  reference text,
  objet text not null,
  contenu text,
  echeance date,
  pj_nom text,
  pj_type text,
  pj_data text,
  created_at timestamptz not null default now(),
  check (cardinality(cibles) > 0
         and cibles <@ array['ministere', 'dreppnf', 'dpeppnf', 'ceb', 'ecole']::text[]
         and not (niveau = any (cibles)))
);
create index if not exists circuit_documents_date_idx on circuit_documents (created_at desc);

create table if not exists circuit_accuses (
  doc_id uuid not null references circuit_documents(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nom text,
  structure text,
  accuse_le timestamptz not null default now(),
  primary key (doc_id, user_id)
);

alter table circuit_documents enable row level security;
alter table circuit_accuses enable row level security;

-- Droit de publier : seulement au nom de SON propre niveau et de SA propre zone
-- (on ne peut pas publier « au nom du ministère » avec un compte CEB).
create or replace function peut_publier_document(d_niveau text, d_region text, d_province text, d_ceb text, d_emetteur uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select d_emetteur = auth.uid() and exists (
    select 1 from profiles v
    where v.id = auth.uid()
      and niveau_reseau(v.role) = d_niveau
      and case when rang_niveau(d_niveau) >= 1 then d_region is not null and d_region = v.region else d_region is null end
      and case when rang_niveau(d_niveau) >= 2 then d_province is not null and d_province = v.province else d_province is null end
      and case when rang_niveau(d_niveau) >= 3 then d_ceb is not null and d_ceb = v.ceb else d_ceb is null end
  )
$$;

-- Droit de lire : auteur, ou destinataire dans la zone de l'auteur.
-- Pour chaque échelon que le lecteur possède (région, province, CEB), si le
-- document en porte un, il doit être identique (sans accents ni majuscules).
create or replace function peut_lire_document(d_niveau text, d_region text, d_province text, d_ceb text, d_cibles text[], d_emetteur uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select d_emetteur = auth.uid() or exists (
    select 1 from profiles v
    where v.id = auth.uid()
      and niveau_reseau(v.role) is not null
      and niveau_reseau(v.role) = any (d_cibles)
      and (rang_niveau(niveau_reseau(v.role)) < 1 or d_region is null or norm_zone(v.region) = norm_zone(d_region))
      and (rang_niveau(niveau_reseau(v.role)) < 2 or d_province is null or norm_zone(v.province) = norm_zone(d_province))
      and (rang_niveau(niveau_reseau(v.role)) < 3 or d_ceb is null or norm_zone(v.ceb) = norm_zone(d_ceb))
  )
$$;

drop policy if exists "publications : lecture" on circuit_documents;
drop policy if exists "publications : création" on circuit_documents;
drop policy if exists "publications : suppression" on circuit_documents;
create policy "publications : lecture" on circuit_documents for select
  using (peut_lire_document(niveau, region, province, ceb, cibles, emetteur_id));
create policy "publications : création" on circuit_documents for insert
  with check (peut_publier_document(niveau, region, province, ceb, emetteur_id));
create policy "publications : suppression" on circuit_documents for delete
  using (emetteur_id = auth.uid());

drop policy if exists "accusés : lecture" on circuit_accuses;
drop policy if exists "accusés : création" on circuit_accuses;
create policy "accusés : lecture" on circuit_accuses for select
  using (
    user_id = auth.uid()
    or exists (select 1 from circuit_documents d where d.id = circuit_accuses.doc_id and d.emetteur_id = auth.uid())
  );
create policy "accusés : création" on circuit_accuses for insert
  with check (
    user_id = auth.uid()
    and exists (select 1 from circuit_documents d where d.id = circuit_accuses.doc_id)
  );

-- Liste des CEB existantes (nom + province + région, aucune donnée
-- personnelle) : permet à une école de se rattacher à sa CEB en la choisissant
-- dans une liste, sans faute de frappe possible.
create or replace function liste_cebs()
returns table (ceb text, province text, region text, structure text)
language sql stable security definer set search_path = public as $$
  select p.ceb, p.province, p.region, p.structure
  from profiles p
  where p.role = 'ceb' and est_personnel_ecole()
  order by p.region, p.province, p.ceb
$$;
grant execute on function liste_cebs() to authenticated;

-- ============================================================
-- LISTES D'ÉLÈVES : école → CEB
-- À exécuter UNE FOIS dans Supabase → SQL Editor (après supabase-setup.sql).
-- Sans danger si exécuté plusieurs fois.
--
-- Principe :
--  * la direction (ou le secrétariat) de l'école prépare la liste nominative
--    de ses élèves et la PUBLIE dans le compte de SA CEB ;
--  * chaque publication est une version numérotée, non modifiable (traçabilité) ;
--  * la CEB de la zone récupère les listes, accuse réception, puis valide la
--    liste ou demande une correction (avec remarque) ;
--  * une école ne voit que ses propres listes ; une CEB ne voit que celles des
--    écoles de SA circonscription ; aucun autre compte n'y a accès.
-- ============================================================

create table if not exists listes_eleves (
  id uuid primary key default gen_random_uuid(),
  ecole_id uuid not null default mon_ecole(),
  annee text not null,
  version int not null default 1,
  ecole_nom text not null,
  region text not null,
  province text not null,
  ceb text not null,
  emetteur_id uuid default auth.uid() references auth.users(id) on delete set null,
  emetteur_nom text not null,
  effectif int not null check (effectif > 0),
  garcons int not null default 0,
  filles int not null default 0,
  empreinte text,
  data jsonb not null,
  created_at timestamptz not null default now(),
  unique (ecole_id, annee, version),
  check (jsonb_typeof(data) = 'array' and jsonb_array_length(data) = effectif)
);
create index if not exists listes_eleves_zone_idx on listes_eleves (ceb, province, region, created_at desc);
create index if not exists listes_eleves_ecole_idx on listes_eleves (ecole_id, annee, version desc);

create table if not exists listes_eleves_suivi (
  liste_id uuid primary key references listes_eleves(id) on delete cascade,
  statut text not null check (statut in ('recue', 'validee', 'a_corriger')),
  remarque text,
  traite_par uuid default auth.uid(),
  traite_nom text,
  traite_le timestamptz not null default now()
);

alter table listes_eleves enable row level security;
alter table listes_eleves_suivi enable row level security;

-- Personnel de l'école habilité à publier : direction et secrétariat.
create or replace function peut_publier_liste_ecole() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid()
    and role in ('directeur', 'directeur_adjoint', 'secretaire'))
$$;

-- La zone portée par la liste doit être EXACTEMENT celle du profil de l'auteur
-- (on ne peut pas publier vers la CEB d'un autre).
create or replace function zone_liste_conforme(l_region text, l_province text, l_ceb text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles v where v.id = auth.uid()
    and norm_zone(v.region) is not null and norm_zone(v.region) = norm_zone(l_region)
    and norm_zone(v.province) is not null and norm_zone(v.province) = norm_zone(l_province)
    and norm_zone(v.ceb) is not null and norm_zone(v.ceb) = norm_zone(l_ceb))
$$;

-- Lecture : l'école propriétaire (direction/secrétariat) ou la CEB de la zone.
create or replace function peut_lire_liste(l_ecole uuid, l_region text, l_province text, l_ceb text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles v where v.id = auth.uid() and (
    (v.role in ('directeur', 'directeur_adjoint', 'secretaire') and v.ecole_id is not null and v.ecole_id = l_ecole)
    or (v.role = 'ceb'
        and norm_zone(v.region) = norm_zone(l_region)
        and norm_zone(v.province) = norm_zone(l_province)
        and norm_zone(v.ceb) = norm_zone(l_ceb))
  ))
$$;

create or replace function ceb_peut_traiter_liste(p_liste uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from listes_eleves l join profiles v on v.id = auth.uid() and v.role = 'ceb'
    where l.id = p_liste
      and norm_zone(v.region) = norm_zone(l.region)
      and norm_zone(v.province) = norm_zone(l.province)
      and norm_zone(v.ceb) = norm_zone(l.ceb))
$$;

create or replace function lire_suivi_liste(p_liste uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from listes_eleves l
    where l.id = p_liste and peut_lire_liste(l.ecole_id, l.region, l.province, l.ceb))
$$;

drop policy if exists "listes : lecture" on listes_eleves;
drop policy if exists "listes : publication" on listes_eleves;
drop policy if exists "listes : retrait" on listes_eleves;
create policy "listes : lecture" on listes_eleves for select
  using (peut_lire_liste(ecole_id, region, province, ceb));
create policy "listes : publication" on listes_eleves for insert
  with check (
    emetteur_id = auth.uid()
    and ecole_id = mon_ecole()
    and peut_publier_liste_ecole()
    and zone_liste_conforme(region, province, ceb)
  );
-- Retrait : l'école peut retirer une liste tant que la CEB ne l'a pas validée.
create policy "listes : retrait" on listes_eleves for delete
  using (
    ecole_id = mon_ecole() and peut_publier_liste_ecole()
    and not exists (select 1 from listes_eleves_suivi s where s.liste_id = listes_eleves.id and s.statut = 'validee')
  );

drop policy if exists "suivi : lecture" on listes_eleves_suivi;
drop policy if exists "suivi : création" on listes_eleves_suivi;
drop policy if exists "suivi : modification" on listes_eleves_suivi;
create policy "suivi : lecture" on listes_eleves_suivi for select using (lire_suivi_liste(liste_id));
create policy "suivi : création" on listes_eleves_suivi for insert with check (ceb_peut_traiter_liste(liste_id));
create policy "suivi : modification" on listes_eleves_suivi for update
  using (ceb_peut_traiter_liste(liste_id)) with check (ceb_peut_traiter_liste(liste_id));

-- ############################################################
-- PARTIE 2/4 — Listes d'élèves et candidats au CEP (école → CEB)
-- (fichier d'origine : supabase-listes.sql)
-- ############################################################

-- ============================================================
-- LISTES D'ÉLÈVES : école → CEB
-- À exécuter UNE FOIS dans Supabase → SQL Editor (après supabase-setup.sql).
-- Sans danger si exécuté plusieurs fois.
--
-- Principe :
--  * la direction (ou le secrétariat) de l'école prépare la liste nominative
--    de ses élèves et la PUBLIE dans le compte de SA CEB ;
--  * chaque publication est une version numérotée, non modifiable (traçabilité) ;
--  * la CEB de la zone récupère les listes, accuse réception, puis valide la
--    liste ou demande une correction (avec remarque) ;
--  * une école ne voit que ses propres listes ; une CEB ne voit que celles des
--    écoles de SA circonscription ; aucun autre compte n'y a accès.
-- ============================================================

create table if not exists listes_eleves (
  id uuid primary key default gen_random_uuid(),
  ecole_id uuid not null default mon_ecole(),
  annee text not null,
  version int not null default 1,
  ecole_nom text not null,
  region text not null,
  province text not null,
  ceb text not null,
  emetteur_id uuid default auth.uid() references auth.users(id) on delete set null,
  emetteur_nom text not null,
  effectif int not null check (effectif > 0),
  garcons int not null default 0,
  filles int not null default 0,
  empreinte text,
  data jsonb not null,
  created_at timestamptz not null default now(),
  unique (ecole_id, annee, version),
  check (jsonb_typeof(data) = 'array' and jsonb_array_length(data) = effectif)
);
create index if not exists listes_eleves_zone_idx on listes_eleves (ceb, province, region, created_at desc);
create index if not exists listes_eleves_ecole_idx on listes_eleves (ecole_id, annee, version desc);

create table if not exists listes_eleves_suivi (
  liste_id uuid primary key references listes_eleves(id) on delete cascade,
  statut text not null check (statut in ('recue', 'validee', 'a_corriger')),
  remarque text,
  traite_par uuid default auth.uid(),
  traite_nom text,
  traite_le timestamptz not null default now()
);

alter table listes_eleves enable row level security;
alter table listes_eleves_suivi enable row level security;

-- Personnel de l'école habilité à publier : direction et secrétariat.
create or replace function peut_publier_liste_ecole() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid()
    and role in ('directeur', 'directeur_adjoint', 'secretaire'))
$$;

-- La zone portée par la liste doit être EXACTEMENT celle du profil de l'auteur
-- (on ne peut pas publier vers la CEB d'un autre).
create or replace function zone_liste_conforme(l_region text, l_province text, l_ceb text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles v where v.id = auth.uid()
    and norm_zone(v.region) is not null and norm_zone(v.region) = norm_zone(l_region)
    and norm_zone(v.province) is not null and norm_zone(v.province) = norm_zone(l_province)
    and norm_zone(v.ceb) is not null and norm_zone(v.ceb) = norm_zone(l_ceb))
$$;

-- Lecture : l'école propriétaire (direction/secrétariat) ou la CEB de la zone.
create or replace function peut_lire_liste(l_ecole uuid, l_region text, l_province text, l_ceb text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles v where v.id = auth.uid() and (
    (v.role in ('directeur', 'directeur_adjoint', 'secretaire') and v.ecole_id is not null and v.ecole_id = l_ecole)
    or (v.role = 'ceb'
        and norm_zone(v.region) = norm_zone(l_region)
        and norm_zone(v.province) = norm_zone(l_province)
        and norm_zone(v.ceb) = norm_zone(l_ceb))
  ))
$$;

create or replace function ceb_peut_traiter_liste(p_liste uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from listes_eleves l join profiles v on v.id = auth.uid() and v.role = 'ceb'
    where l.id = p_liste
      and norm_zone(v.region) = norm_zone(l.region)
      and norm_zone(v.province) = norm_zone(l.province)
      and norm_zone(v.ceb) = norm_zone(l.ceb))
$$;

create or replace function lire_suivi_liste(p_liste uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from listes_eleves l
    where l.id = p_liste and peut_lire_liste(l.ecole_id, l.region, l.province, l.ceb))
$$;

drop policy if exists "listes : lecture" on listes_eleves;
drop policy if exists "listes : publication" on listes_eleves;
drop policy if exists "listes : retrait" on listes_eleves;
create policy "listes : lecture" on listes_eleves for select
  using (peut_lire_liste(ecole_id, region, province, ceb));
create policy "listes : publication" on listes_eleves for insert
  with check (
    emetteur_id = auth.uid()
    and ecole_id = mon_ecole()
    and peut_publier_liste_ecole()
    and zone_liste_conforme(region, province, ceb)
  );
-- Retrait : l'école peut retirer une liste tant que la CEB ne l'a pas validée.
create policy "listes : retrait" on listes_eleves for delete
  using (
    ecole_id = mon_ecole() and peut_publier_liste_ecole()
    and not exists (select 1 from listes_eleves_suivi s where s.liste_id = listes_eleves.id and s.statut = 'validee')
  );

drop policy if exists "suivi : lecture" on listes_eleves_suivi;
drop policy if exists "suivi : création" on listes_eleves_suivi;
drop policy if exists "suivi : modification" on listes_eleves_suivi;
create policy "suivi : lecture" on listes_eleves_suivi for select using (lire_suivi_liste(liste_id));
create policy "suivi : création" on listes_eleves_suivi for insert with check (ceb_peut_traiter_liste(liste_id));
create policy "suivi : modification" on listes_eleves_suivi for update
  using (ceb_peut_traiter_liste(liste_id)) with check (ceb_peut_traiter_liste(liste_id));


-- ============================================================
-- MISE À JOUR : candidats au CEP (même table, colonne « type »)
-- Sans danger si exécuté plusieurs fois.
--  * type = 'eleves' : liste nominative des élèves (comportement d'origine)
--  * type = 'cep'    : liste des candidats au CEP, publiée par l'école et
--                      récupérée par la CEB dans l'Espace Examen
-- Les règles d'accès (école propriétaire / CEB de la zone) sont inchangées.
-- ============================================================
alter table listes_eleves add column if not exists type text not null default 'eleves';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'listes_eleves_type_check') then
    alter table listes_eleves add constraint listes_eleves_type_check check (type in ('eleves', 'cep'));
  end if;
  -- l'unicité tient désormais compte du type (une liste d'élèves v1 ET une liste CEP v1 sont possibles)
  if exists (select 1 from pg_constraint where conname = 'listes_eleves_ecole_id_annee_version_key') then
    alter table listes_eleves drop constraint listes_eleves_ecole_id_annee_version_key;
  end if;
end $$;
create unique index if not exists listes_eleves_unique_type_idx on listes_eleves (ecole_id, annee, type, version);
create index if not exists listes_eleves_type_idx on listes_eleves (ecole_id, annee, type, version desc);

-- ############################################################
-- PARTIE 3/4 — Espace Examen (accès du personnel)
-- (fichier d'origine : supabase-examens.sql)
-- ############################################################

-- ============================================================
-- Espace Examen : à exécuter UNE FOIS dans Supabase -> SQL Editor
-- (projet déjà installé). Réservé à la direction et au secrétariat :
-- les enseignants, comptables, etc. ne voient pas les données d'examen.
-- Sans danger si exécuté plusieurs fois.
-- ============================================================
-- Aucun compte du réseau (CEB, DPEPPNF, DREPPNF, ministère) ni parent ne doit
-- lire les données de l'école : seul le personnel de l'école y a accès.
create or replace function est_personnel_ecole() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid()
      and role in ('directeur', 'directeur_adjoint', 'secretaire', 'comptable', 'magasinier', 'cantine', 'enseignant')
  )
$$;

create or replace function peut_acceder(store_name text)
returns boolean
language sql
stable
as $$
  select case
    when store_name = 'cahierBord' then
      exists (select 1 from profiles where id = auth.uid() and role in ('directeur', 'directeur_adjoint'))
    when store_name in ('examSessions', 'examCentres', 'examJurys', 'examCandidats', 'examNotes', 'examRemontees') then
      exists (select 1 from profiles where id = auth.uid() and role in ('directeur', 'directeur_adjoint', 'secretaire'))
    when store_name in ('finances', 'cotisations') then
      exists (select 1 from profiles where id = auth.uid() and role in ('directeur', 'directeur_adjoint', 'comptable'))
    else
      est_personnel_ecole()
  end;
$$;

-- ############################################################
-- PARTIE 4/4 — Circuit du CEP par le serveur (nouveau)
-- (fichier d'origine : supabase-circuit.sql)
-- ############################################################

-- ============================================================
-- CIRCUIT DU CEP PAR LE SERVEUR : École → CEB → DPEPPNF → DREPPNF → Ministère
-- À exécuter dans Supabase → SQL Editor, APRÈS supabase-setup.sql.
-- Sans danger si exécuté plusieurs fois (le fichier supabase-complet.sql
-- contient déjà tout dans le bon ordre).
--
-- Principes
--  * Les comptes du réseau n'ont pas d'école : ils n'utilisent donc PAS la
--    table app_data. Ils ont leurs propres tables, protégées par la ZONE du
--    compte (région, province, CEB), comparée avec norm_zone().
--  * AUCUN nom de candidat n'est stocké dans ces tables : seulement des
--    chiffres et des noms de structures (écoles, centres, CEB…). Le texte
--    libre des incidents (cep_jourj_incidents) n'est lisible que par le
--    président du centre et par la CEB de la zone.
--  * Les clients ne peuvent PAS écrire directement dans ces tables : aucune
--    règle d'écriture n'existe. Tout passe par des fonctions (cep_*) qui
--    reprennent la zone et l'identité DANS LE PROFIL du compte connecté (on
--    ne peut donc pas écrire au nom d'une autre zone) et qui tiennent le
--    journal (cep_journal) dans la même opération.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Fonctions d'aide
-- ------------------------------------------------------------

-- Clé de zone normalisée (sans accents ni majuscules) : "centreouest|sangui|reo"
create or replace function cep_cle_zone(p_region text, p_province text, p_ceb text) returns text
language sql immutable as $$
  select coalesce(norm_zone(p_region), '') || '|' || coalesce(norm_zone(p_province), '') || '|' || coalesce(norm_zone(p_ceb), '')
$$;

-- Le compte connecté (CEB, DPEPPNF, DREPPNF ou ministère) couvre-t-il cette zone ?
--   ministère : tout le pays ; DREPPNF : sa région ; DPEPPNF : sa province ;
--   CEB : sa circonscription. Une zone vide dans le profil ne couvre RIEN.
create or replace function cep_zone_couverte(z_region text, z_province text, z_ceb text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles v
    where v.id = auth.uid() and (
      v.role = 'ministere'
      or (v.role = 'dreppnf' and norm_zone(v.region) is not null
          and norm_zone(v.region) = norm_zone(z_region))
      or (v.role = 'dpeppnf' and norm_zone(v.region) is not null and norm_zone(v.province) is not null
          and norm_zone(v.region) = norm_zone(z_region) and norm_zone(v.province) = norm_zone(z_province))
      or (v.role = 'ceb' and norm_zone(v.region) is not null and norm_zone(v.province) is not null and norm_zone(v.ceb) is not null
          and norm_zone(v.region) = norm_zone(z_region) and norm_zone(v.province) = norm_zone(z_province)
          and norm_zone(v.ceb) = norm_zone(z_ceb))
    )
  )
$$;

-- Le compte connecté est-il la CEB EXACTE de cette zone (pas un niveau supérieur) ?
create or replace function cep_zone_ceb_exacte(z_region text, z_province text, z_ceb text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles v
    where v.id = auth.uid() and v.role = 'ceb'
      and norm_zone(v.region) is not null and norm_zone(v.province) is not null and norm_zone(v.ceb) is not null
      and norm_zone(v.region) = norm_zone(z_region) and norm_zone(v.province) = norm_zone(z_province)
      and norm_zone(v.ceb) = norm_zone(z_ceb)
  )
$$;

-- Centre d'examen du compte « président de centre » (null pour les autres comptes)
create or replace function cep_mon_centre() returns uuid
language sql stable security definer set search_path = public as $$
  select centre_id from profiles where id = auth.uid() and role = 'centre'
$$;

-- Qui peut consulter le calendrier du CEP
create or replace function cep_peut_lire_calendrier() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid()
    and role in ('ceb', 'dpeppnf', 'dreppnf', 'ministere', 'centre', 'directeur', 'directeur_adjoint', 'secretaire'))
$$;

-- Rang de validation : DPEPPNF 1, DREPPNF 2, ministère 3 (0 = pas encore validé)
create or replace function cep_rang_validation(r text) returns int
language sql immutable as $$
  select case r when 'dpeppnf' then 1 when 'dreppnf' then 2 when 'ministere' then 3 else 0 end
$$;

-- Lit un entier positif dans un jsonb. defaut null = obligatoire.
create or replace function cep_entier(j jsonb, cle text, defaut int default null) returns int
language plpgsql immutable as $$
declare t text;
begin
  t := j ->> cle;
  if t is null or btrim(t) = '' then
    if defaut is null then raise exception 'Le chiffre « % » est manquant.', cle using errcode = '22023'; end if;
    return defaut;
  end if;
  if t !~ '^[0-9]{1,7}$' then raise exception 'Le chiffre « % » est invalide.', cle using errcode = '22023'; end if;
  return t::int;
end $$;

-- Compte CEB complet (région, province, CEB renseignées), sinon erreur claire
create or replace function cep_profil_ceb() returns profiles
language plpgsql stable security definer set search_path = public as $$
declare v profiles;
begin
  select * into v from profiles where id = auth.uid();
  if not found or v.role <> 'ceb' then
    raise exception 'Cette action est réservée au compte de la CEB.' using errcode = '42501';
  end if;
  if norm_zone(v.region) is null or norm_zone(v.province) is null or norm_zone(v.ceb) is null then
    raise exception 'Le compte de la CEB n''a pas sa région, sa province et sa CEB renseignées.' using errcode = '42501';
  end if;
  return v;
end $$;

-- Écrit une ligne dans le journal (usage interne, jamais appelée par l'application)
create or replace function cep_journaliser(
  p_cible text, p_cible_id uuid, p_annee text, p_region text, p_province text, p_ceb text,
  p_action text, p_version int, p_motif text, p_details jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare v profiles;
begin
  select * into v from profiles where id = auth.uid();
  insert into cep_journal (acteur_id, acteur_nom, acteur_role, acteur_structure, cible, cible_id, annee,
                           region, province, ceb, action, version, motif, details)
  values (auth.uid(), coalesce(v.nom, '?'), coalesce(v.role, '?'), v.structure, p_cible, p_cible_id, p_annee,
          p_region, p_province, p_ceb, p_action, p_version, p_motif, coalesce(p_details, '{}'::jsonb));
end $$;

-- ------------------------------------------------------------
-- 2) Tables
-- ------------------------------------------------------------

-- Journal : qui a fait quoi, quand (jamais modifiable ni effaçable par un client)
create table if not exists cep_journal (
  id bigint generated always as identity primary key,
  le timestamptz not null default now(),
  acteur_id uuid references auth.users(id) on delete set null,
  acteur_nom text not null,
  acteur_role text not null,
  acteur_structure text,
  cible text not null,
  cible_id uuid,
  annee text,
  region text,
  province text,
  ceb text,
  action text not null,
  version int,
  motif text,
  details jsonb not null default '{}'::jsonb
);
create index if not exists cep_journal_annee_idx on cep_journal (annee, le desc);
create index if not exists cep_journal_cible_idx on cep_journal (cible_id, le desc);

-- Calendrier fixé par le ministère. niveau = 'tous' (valeur par défaut) ou une
-- date propre à un niveau (ecole, ceb, dpeppnf, dreppnf, ministere).
create table if not exists cep_calendrier (
  annee text not null,
  etape text not null check (etape in ('inscriptions', 'depot_epreuves', 'composition', 'correction', 'depot_resultats', 'deliberation')),
  niveau text not null default 'tous' check (niveau in ('tous', 'ecole', 'ceb', 'dpeppnf', 'dreppnf', 'ministere')),
  date_debut date,
  date_limite date not null,
  note text,
  maj_par uuid references auth.users(id) on delete set null,
  maj_nom text,
  maj_le timestamptz not null default now(),
  primary key (annee, etape, niveau),
  check (date_debut is null or date_debut <= date_limite)
);

-- Centres d'examen (noms d'écoles hôtes et chiffres, aucun candidat)
create table if not exists cep_centres (
  id uuid primary key,
  annee text not null,
  region text not null,
  province text not null,
  ceb text not null,
  nom text not null,
  jury text,
  localite text,
  nb_salles int not null default 0 check (nb_salles >= 0),
  capacite int not null default 0 check (capacite >= 0),
  nb_candidats int not null default 0 check (nb_candidats >= 0),
  nb_epreuves int not null default 0 check (nb_epreuves >= 0),
  epreuves jsonb not null default '[]'::jsonb check (jsonb_typeof(epreuves) = 'array'),
  statut_risque text not null default 'normal' check (statut_risque in ('normal', 'ferme', 'delocalise', 'securise')),
  motif_risque text,
  centre_accueil text,
  risque_niveau text,
  risque_par_nom text,
  risque_le timestamptz,
  maj_le timestamptz not null default now(),
  check (statut_risque = 'normal' or length(btrim(coalesce(motif_risque, ''))) >= 3)
);
create index if not exists cep_centres_zone_idx on cep_centres (annee, region, province, ceb);

-- Effectifs d'inscription : une ligne par CEB, par année et par type d'examen
create table if not exists cep_effectifs (
  id uuid primary key default gen_random_uuid(),
  annee text not null,
  type_examen text not null check (type_examen in ('cep', 'cep_concours')),
  zone_key text not null,
  region text not null,
  province text not null,
  ceb text not null,
  inscrits_f int not null check (inscrits_f >= 0),
  inscrits_g int not null check (inscrits_g >= 0),
  nb_ecoles int not null default 0 check (nb_ecoles >= 0),
  nb_ecoles_attendues int not null default 0 check (nb_ecoles_attendues >= 0),
  nb_centres int not null default 0 check (nb_centres >= 0),
  nb_jurys int not null default 0 check (nb_jurys >= 0),
  nb_salles int not null default 0 check (nb_salles >= 0),
  nb_handicap int not null default 0 check (nb_handicap >= 0),
  nb_bilingues int not null default 0 check (nb_bilingues >= 0),
  statut text not null default 'transmis' check (statut in ('transmis', 'valide', 'a_corriger')),
  niveau_valide text check (niveau_valide in ('dpeppnf', 'dreppnf', 'ministere')),
  renvoye_par_niveau text check (renvoye_par_niveau in ('dpeppnf', 'dreppnf', 'ministere')),
  motif_retour text,
  version int not null default 1,
  transmis_le timestamptz not null default now(),
  transmis_par uuid references auth.users(id) on delete set null,
  transmis_par_nom text,
  traite_le timestamptz,
  traite_par_nom text,
  maj_le timestamptz not null default now(),
  unique (annee, type_examen, zone_key),
  check (nb_handicap <= inscrits_f + inscrits_g and nb_bilingues <= inscrits_f + inscrits_g)
);
create index if not exists cep_effectifs_zone_idx on cep_effectifs (annee, region, province);

-- Bordereaux de résultats : chiffres agrégés uniquement
create table if not exists cep_bordereaux (
  id uuid primary key default gen_random_uuid(),
  annee text not null,
  type_examen text not null check (type_examen in ('cep', 'cep_concours')),
  zone_key text not null,
  region text not null,
  province text not null,
  ceb text not null,
  f_inscrits int not null check (f_inscrits >= 0),
  f_absents int not null check (f_absents >= 0),
  f_admis int not null check (f_admis >= 0),
  f_ajournes int not null check (f_ajournes >= 0),
  f_exclus int not null check (f_exclus >= 0),
  g_inscrits int not null check (g_inscrits >= 0),
  g_absents int not null check (g_absents >= 0),
  g_admis int not null check (g_admis >= 0),
  g_ajournes int not null check (g_ajournes >= 0),
  g_exclus int not null check (g_exclus >= 0),
  handicap_inscrits int not null default 0 check (handicap_inscrits >= 0),
  handicap_admis int not null default 0 check (handicap_admis >= 0),
  bilingues_inscrits int not null default 0 check (bilingues_inscrits >= 0),
  bilingues_admis int not null default 0 check (bilingues_admis >= 0),
  moyenne_generale numeric(5, 2),
  nb_moyennes int not null default 0 check (nb_moyennes >= 0),
  seuil numeric(4, 2),
  epreuves jsonb not null default '[]'::jsonb check (jsonb_typeof(epreuves) = 'array' and jsonb_array_length(epreuves) <= 12),
  statut text not null default 'transmis' check (statut in ('transmis', 'valide', 'a_corriger')),
  niveau_valide text check (niveau_valide in ('dpeppnf', 'dreppnf', 'ministere')),
  renvoye_par_niveau text check (renvoye_par_niveau in ('dpeppnf', 'dreppnf', 'ministere')),
  motif_retour text,
  version int not null default 1,
  transmis_le timestamptz not null default now(),
  transmis_par uuid references auth.users(id) on delete set null,
  transmis_par_nom text,
  traite_le timestamptz,
  traite_par_nom text,
  maj_le timestamptz not null default now(),
  unique (annee, type_examen, zone_key),
  check (f_absents <= f_inscrits and g_absents <= g_inscrits),
  check (f_admis + f_ajournes + f_exclus = f_inscrits - f_absents),
  check (g_admis + g_ajournes + g_exclus = g_inscrits - g_absents),
  check (handicap_admis <= handicap_inscrits and bilingues_admis <= bilingues_inscrits
         and handicap_inscrits <= f_inscrits + g_inscrits and bilingues_inscrits <= f_inscrits + g_inscrits)
);
create index if not exists cep_bordereaux_zone_idx on cep_bordereaux (annee, region, province);

-- Étapes marquées « faites » à la main par un niveau (dépôt des épreuves, correction, délibération…)
create table if not exists cep_avancement (
  annee text not null,
  etape text not null check (etape in ('inscriptions', 'depot_epreuves', 'composition', 'correction', 'depot_resultats', 'deliberation')),
  niveau text not null check (niveau in ('ceb', 'dpeppnf', 'dreppnf', 'ministere')),
  zone_key text not null,
  region text,
  province text,
  ceb text,
  fait_le timestamptz not null default now(),
  fait_par_nom text,
  primary key (annee, etape, niveau, zone_key)
);

-- Suivi du jour J : une ligne par centre et par épreuve (chiffres seulement)
create table if not exists cep_jourj (
  centre_id uuid not null references cep_centres(id) on delete cascade,
  epreuve_code text not null check (epreuve_code ~ '^[A-Za-z0-9_-]{1,12}$'),
  epreuve_nom text,
  annee text not null,
  region text not null,
  province text not null,
  ceb text not null,
  presents int check (presents is null or (presents >= 0 and presents <= 5000)),
  absents int check (absents is null or (absents >= 0 and absents <= 5000)),
  enveloppe_le timestamptz,
  recu_le timestamptz,
  scelle_intact boolean,
  inc_fraude int not null default 0 check (inc_fraude >= 0),
  inc_sante int not null default 0 check (inc_sante >= 0),
  inc_securite int not null default 0 check (inc_securite >= 0),
  inc_logistique int not null default 0 check (inc_logistique >= 0),
  inc_autre int not null default 0 check (inc_autre >= 0),
  maj_client timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  maj_par_nom text,
  maj_par_role text,
  primary key (centre_id, epreuve_code)
);
create index if not exists cep_jourj_zone_idx on cep_jourj (annee, region, province, ceb);

-- Détail des incidents (texte libre) : visible du président du centre et de la CEB SEULEMENT
create table if not exists cep_jourj_incidents (
  id uuid primary key default gen_random_uuid(),
  centre_id uuid not null references cep_centres(id) on delete cascade,
  epreuve_code text not null,
  region text not null,
  province text not null,
  ceb text not null,
  type text not null check (type in ('fraude', 'sante', 'securite', 'logistique', 'autre')),
  gravite text not null default 'mineur' check (gravite in ('mineur', 'majeur')),
  description text check (description is null or length(description) <= 500),
  signale_le timestamptz not null default now(),
  par_nom text
);
create index if not exists cep_jourj_incidents_idx on cep_jourj_incidents (centre_id, epreuve_code);

-- ------------------------------------------------------------
-- 3) Règles d'accès (RLS) : lecture seulement, jamais d'écriture directe
-- ------------------------------------------------------------
alter table cep_journal enable row level security;
alter table cep_calendrier enable row level security;
alter table cep_centres enable row level security;
alter table cep_effectifs enable row level security;
alter table cep_bordereaux enable row level security;
alter table cep_avancement enable row level security;
alter table cep_jourj enable row level security;
alter table cep_jourj_incidents enable row level security;

drop policy if exists "cep journal : lecture" on cep_journal;
create policy "cep journal : lecture" on cep_journal for select
  using (cep_zone_couverte(region, province, ceb) or acteur_id = auth.uid());

drop policy if exists "cep calendrier : lecture" on cep_calendrier;
create policy "cep calendrier : lecture" on cep_calendrier for select
  using (cep_peut_lire_calendrier());

drop policy if exists "cep centres : lecture" on cep_centres;
create policy "cep centres : lecture" on cep_centres for select
  using (cep_zone_couverte(region, province, ceb) or id = cep_mon_centre());

drop policy if exists "cep effectifs : lecture" on cep_effectifs;
create policy "cep effectifs : lecture" on cep_effectifs for select
  using (cep_zone_couverte(region, province, ceb));

drop policy if exists "cep bordereaux : lecture" on cep_bordereaux;
create policy "cep bordereaux : lecture" on cep_bordereaux for select
  using (cep_zone_couverte(region, province, ceb));

drop policy if exists "cep avancement : lecture" on cep_avancement;
create policy "cep avancement : lecture" on cep_avancement for select
  using (cep_zone_couverte(region, province, ceb));

drop policy if exists "cep jourj : lecture" on cep_jourj;
create policy "cep jourj : lecture" on cep_jourj for select
  using (cep_zone_couverte(region, province, ceb) or centre_id = cep_mon_centre());

drop policy if exists "cep incidents : lecture" on cep_jourj_incidents;
create policy "cep incidents : lecture" on cep_jourj_incidents for select
  using (cep_zone_ceb_exacte(region, province, ceb) or centre_id = cep_mon_centre());

-- Aucun droit d'écriture directe pour les clients (ceinture et bretelles : en plus de l'absence de règle)
revoke all on cep_journal, cep_calendrier, cep_centres, cep_effectifs, cep_bordereaux, cep_avancement, cep_jourj, cep_jourj_incidents from anon;
revoke insert, update, delete, truncate on cep_journal, cep_calendrier, cep_centres, cep_effectifs, cep_bordereaux, cep_avancement, cep_jourj, cep_jourj_incidents from authenticated;
grant select on cep_journal, cep_calendrier, cep_centres, cep_effectifs, cep_bordereaux, cep_avancement, cep_jourj, cep_jourj_incidents to authenticated;

-- ------------------------------------------------------------
-- 4) Fonctions d'écriture (seul chemin pour écrire)
-- ------------------------------------------------------------

-- ---- Calendrier (ministère) ----
create or replace function cep_calendrier_definir(p_annee text, p_lignes jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v profiles; l jsonb; n int := 0; d1 date; d2 date; e text; nv text;
begin
  select * into v from profiles where id = auth.uid();
  if not found or v.role <> 'ministere' then
    raise exception 'Seul le ministère peut définir le calendrier.' using errcode = '42501';
  end if;
  if p_annee is null or btrim(p_annee) = '' then raise exception 'Indiquez l''année du calendrier.'; end if;
  if p_lignes is null or jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) > 60 then
    raise exception 'Liste de dates invalide.';
  end if;
  delete from cep_calendrier where annee = p_annee;
  for l in select * from jsonb_array_elements(p_lignes) loop
    e := l ->> 'etape';
    nv := coalesce(nullif(l ->> 'niveau', ''), 'tous');
    if e is null or e not in ('inscriptions', 'depot_epreuves', 'composition', 'correction', 'depot_resultats', 'deliberation') then
      raise exception 'Étape inconnue : %.', coalesce(e, '?');
    end if;
    if nv not in ('tous', 'ecole', 'ceb', 'dpeppnf', 'dreppnf', 'ministere') then
      raise exception 'Niveau inconnu : %.', nv;
    end if;
    begin
      d2 := (l ->> 'date_limite')::date;
      d1 := nullif(l ->> 'date_debut', '')::date;
    exception when others then
      raise exception 'Une date de l''étape « % » est illisible.', e;
    end;
    if d2 is null then raise exception 'La date limite de l''étape « % » est obligatoire.', e; end if;
    if d1 is not null and d1 > d2 then raise exception 'L''étape « % » commence après sa date limite.', e; end if;
    insert into cep_calendrier (annee, etape, niveau, date_debut, date_limite, note, maj_par, maj_nom, maj_le)
    values (p_annee, e, nv, d1, d2, left(nullif(btrim(coalesce(l ->> 'note', '')), ''), 300), auth.uid(), v.nom, now());
    n := n + 1;
  end loop;
  perform cep_journaliser('calendrier', null, p_annee, null, null, null, 'definir_calendrier', null, null,
                          jsonb_build_object('lignes', n));
  return n;
end $$;

-- ---- Étapes marquées à la main ----
create or replace function cep_etape_marquer(p_annee text, p_etape text, p_fait boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v profiles; k text; reg text; prov text; cb text;
begin
  select * into v from profiles where id = auth.uid();
  if not found or v.role not in ('ceb', 'dpeppnf', 'dreppnf', 'ministere') then
    raise exception 'Cette action est réservée aux comptes du réseau.' using errcode = '42501';
  end if;
  if p_etape is null or p_etape not in ('inscriptions', 'depot_epreuves', 'composition', 'correction', 'depot_resultats', 'deliberation') then
    raise exception 'Étape inconnue.';
  end if;
  if p_annee is null or btrim(p_annee) = '' then raise exception 'Indiquez l''année.'; end if;
  reg := case when v.role in ('ceb', 'dpeppnf', 'dreppnf') then v.region end;
  prov := case when v.role in ('ceb', 'dpeppnf') then v.province end;
  cb := case when v.role = 'ceb' then v.ceb end;
  if (v.role <> 'ministere' and norm_zone(reg) is null)
     or (v.role in ('ceb', 'dpeppnf') and norm_zone(prov) is null)
     or (v.role = 'ceb' and norm_zone(cb) is null) then
    raise exception 'Votre compte n''a pas sa zone (région, province, CEB) renseignée.' using errcode = '42501';
  end if;
  k := cep_cle_zone(reg, prov, cb);
  if coalesce(p_fait, true) then
    insert into cep_avancement (annee, etape, niveau, zone_key, region, province, ceb, fait_le, fait_par_nom)
    values (p_annee, p_etape, v.role, k, reg, prov, cb, now(), v.nom)
    on conflict (annee, etape, niveau, zone_key) do update set fait_le = now(), fait_par_nom = excluded.fait_par_nom;
  else
    delete from cep_avancement where annee = p_annee and etape = p_etape and niveau = v.role and zone_key = k;
  end if;
  perform cep_journaliser('etape', null, p_annee, reg, prov, cb,
                          case when coalesce(p_fait, true) then 'etape_faite' else 'etape_annulee' end, null, null,
                          jsonb_build_object('etape', p_etape));
end $$;

-- ---- Centres ----
create or replace function cep_centres_publier(p_annee text, p_centres jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v profiles; c jsonb; n int := 0; ids uuid[] := '{}'; cid uuid; ex cep_centres; eps jsonb; k text;
begin
  v := cep_profil_ceb();
  if p_annee is null or btrim(p_annee) = '' then raise exception 'Indiquez l''année de la session.'; end if;
  if p_centres is null or jsonb_typeof(p_centres) <> 'array' then raise exception 'Liste de centres invalide.'; end if;
  if jsonb_array_length(p_centres) > 300 then raise exception 'Trop de centres dans une même publication (300 au maximum).'; end if;
  k := cep_cle_zone(v.region, v.province, v.ceb);
  for c in select * from jsonb_array_elements(p_centres) loop
    begin
      cid := (c ->> 'id')::uuid;
    exception when others then
      raise exception 'Un centre a un identifiant invalide.';
    end;
    if coalesce(btrim(c ->> 'nom'), '') = '' then raise exception 'Un centre n''a pas de nom.'; end if;
    select * into ex from cep_centres where id = cid;
    if found and not (ex.annee = p_annee and cep_cle_zone(ex.region, ex.province, ex.ceb) = k) then
      raise exception 'Le centre « % » existe déjà pour une autre session ou une autre circonscription.', c ->> 'nom';
    end if;
    if jsonb_typeof(coalesce(c -> 'epreuves', '[]'::jsonb)) <> 'array' then raise exception 'Liste d''épreuves invalide.'; end if;
    -- seules les rubriques attendues sont conservées (code, nom, date, heure)
    select coalesce(jsonb_agg(jsonb_build_object(
             'code', left(coalesce(e ->> 'code', ''), 12), 'nom', left(coalesce(e ->> 'nom', ''), 60),
             'date', left(coalesce(e ->> 'date', ''), 10), 'heure', left(coalesce(e ->> 'heure', ''), 20))), '[]'::jsonb)
      into eps
      from (select e from jsonb_array_elements(coalesce(c -> 'epreuves', '[]'::jsonb)) e limit 12) t;
    insert into cep_centres (id, annee, region, province, ceb, nom, jury, localite, nb_salles, capacite, nb_candidats, nb_epreuves, epreuves)
    values (cid, p_annee, v.region, v.province, v.ceb, left(btrim(c ->> 'nom'), 120),
            left(nullif(btrim(coalesce(c ->> 'jury', '')), ''), 80), left(nullif(btrim(coalesce(c ->> 'localite', '')), ''), 120),
            cep_entier(c, 'nb_salles', 0), cep_entier(c, 'capacite', 0), cep_entier(c, 'nb_candidats', 0),
            jsonb_array_length(eps), eps)
    on conflict (id) do update set
      nom = excluded.nom, jury = excluded.jury, localite = excluded.localite, nb_salles = excluded.nb_salles,
      capacite = excluded.capacite, nb_candidats = excluded.nb_candidats, nb_epreuves = excluded.nb_epreuves,
      epreuves = excluded.epreuves, maj_le = now();
    ids := ids || cid;
    n := n + 1;
  end loop;
  -- un centre retiré de la liste disparaît, sauf s'il a déjà des saisies du jour J
  delete from cep_centres x
   where x.annee = p_annee and cep_cle_zone(x.region, x.province, x.ceb) = k
     and not (x.id = any (ids))
     and not exists (select 1 from cep_jourj j where j.centre_id = x.id);
  perform cep_journaliser('centre', null, p_annee, v.region, v.province, v.ceb, 'publier_centres', null, null,
                          jsonb_build_object('centres', n));
  return n;
end $$;

create or replace function cep_centre_marquer(p_id uuid, p_statut text, p_motif text, p_accueil text) returns cep_centres
language plpgsql security definer set search_path = public as $$
declare v profiles; c cep_centres; r cep_centres; motif text;
begin
  select * into v from profiles where id = auth.uid();
  if not found or v.role not in ('ceb', 'dpeppnf', 'dreppnf', 'ministere') then
    raise exception 'Cette action est réservée aux comptes du réseau.' using errcode = '42501';
  end if;
  if p_statut is null or p_statut not in ('normal', 'ferme', 'delocalise', 'securise') then
    raise exception 'Situation du centre inconnue.';
  end if;
  select * into c from cep_centres where id = p_id;
  if not found then raise exception 'Centre introuvable.'; end if;
  if not cep_zone_couverte(c.region, c.province, c.ceb) then
    raise exception 'Ce centre n''est pas dans votre zone.' using errcode = '42501';
  end if;
  motif := left(nullif(btrim(coalesce(p_motif, '')), ''), 300);
  if p_statut <> 'normal' and (motif is null or length(motif) < 3) then
    raise exception 'Indiquez le motif (au moins quelques mots).';
  end if;
  update cep_centres set
    statut_risque = p_statut,
    motif_risque = case when p_statut = 'normal' then null else motif end,
    centre_accueil = case when p_statut = 'delocalise' then left(nullif(btrim(coalesce(p_accueil, '')), ''), 120) else null end,
    risque_niveau = v.role, risque_par_nom = v.nom, risque_le = now(), maj_le = now()
  where id = p_id returning * into r;
  perform cep_journaliser('centre', p_id, c.annee, c.region, c.province, c.ceb, 'marquer_centre', null, motif,
                          jsonb_build_object('centre', c.nom, 'avant', c.statut_risque, 'apres', p_statut,
                                             'accueil', r.centre_accueil));
  return r;
end $$;

-- ---- Effectifs d'inscription (CEB → serveur) ----
create or replace function cep_effectifs_transmettre(
  p_annee text, p_type text, p_inscrits_f int, p_inscrits_g int,
  p_nb_ecoles int, p_nb_ecoles_attendues int, p_nb_centres int, p_nb_jurys int, p_nb_salles int,
  p_nb_handicap int, p_nb_bilingues int
) returns cep_effectifs
language plpgsql security definer set search_path = public as $$
declare v profiles; k text; ex cep_effectifs; r cep_effectifs; total int;
begin
  v := cep_profil_ceb();
  if p_annee is null or btrim(p_annee) = '' then raise exception 'Indiquez l''année de la session.'; end if;
  if p_type is null or p_type not in ('cep', 'cep_concours') then
    raise exception 'Un examen blanc ne se transmet pas au serveur.';
  end if;
  if p_inscrits_f is null or p_inscrits_g is null or p_inscrits_f < 0 or p_inscrits_g < 0 then
    raise exception 'Les effectifs filles et garçons sont obligatoires.';
  end if;
  total := p_inscrits_f + p_inscrits_g;
  if total = 0 then raise exception 'Aucun candidat inscrit : il n''y a rien à transmettre.'; end if;
  if coalesce(p_nb_handicap, 0) > total or coalesce(p_nb_bilingues, 0) > total then
    raise exception 'Le nombre de candidats handicapés ou bilingues dépasse le nombre d''inscrits.';
  end if;
  k := cep_cle_zone(v.region, v.province, v.ceb);
  select * into ex from cep_effectifs where annee = p_annee and type_examen = p_type and zone_key = k for update;
  if found then
    if ex.statut = 'valide' and ex.niveau_valide = 'ministere' then
      raise exception 'Ces effectifs sont déjà validés par le ministère : ils ne peuvent plus être modifiés.';
    end if;
    -- mêmes chiffres, déjà transmis : on ne refait rien (évite les doublons si l'envoi est rejoué)
    if ex.statut in ('transmis', 'valide')
       and ex.inscrits_f = p_inscrits_f and ex.inscrits_g = p_inscrits_g and ex.nb_ecoles = coalesce(p_nb_ecoles, 0)
       and ex.nb_ecoles_attendues = coalesce(p_nb_ecoles_attendues, 0) and ex.nb_centres = coalesce(p_nb_centres, 0)
       and ex.nb_jurys = coalesce(p_nb_jurys, 0) and ex.nb_salles = coalesce(p_nb_salles, 0)
       and ex.nb_handicap = coalesce(p_nb_handicap, 0) and ex.nb_bilingues = coalesce(p_nb_bilingues, 0) then
      return ex;
    end if;
    update cep_effectifs set
      inscrits_f = p_inscrits_f, inscrits_g = p_inscrits_g, nb_ecoles = coalesce(p_nb_ecoles, 0),
      nb_ecoles_attendues = coalesce(p_nb_ecoles_attendues, 0), nb_centres = coalesce(p_nb_centres, 0),
      nb_jurys = coalesce(p_nb_jurys, 0), nb_salles = coalesce(p_nb_salles, 0),
      nb_handicap = coalesce(p_nb_handicap, 0), nb_bilingues = coalesce(p_nb_bilingues, 0),
      statut = 'transmis', niveau_valide = null, renvoye_par_niveau = null, motif_retour = null,
      version = ex.version + 1, transmis_le = now(), transmis_par = auth.uid(), transmis_par_nom = v.nom,
      traite_le = null, traite_par_nom = null, maj_le = now()
    where id = ex.id returning * into r;
    perform cep_journaliser('effectifs', r.id, p_annee, v.region, v.province, v.ceb, 'retransmettre', r.version, null,
                            jsonb_build_object('inscrits_f', r.inscrits_f, 'inscrits_g', r.inscrits_g, 'type', p_type));
  else
    insert into cep_effectifs (annee, type_examen, zone_key, region, province, ceb, inscrits_f, inscrits_g, nb_ecoles,
      nb_ecoles_attendues, nb_centres, nb_jurys, nb_salles, nb_handicap, nb_bilingues, transmis_par, transmis_par_nom)
    values (p_annee, p_type, k, v.region, v.province, v.ceb, p_inscrits_f, p_inscrits_g, coalesce(p_nb_ecoles, 0),
      coalesce(p_nb_ecoles_attendues, 0), coalesce(p_nb_centres, 0), coalesce(p_nb_jurys, 0), coalesce(p_nb_salles, 0),
      coalesce(p_nb_handicap, 0), coalesce(p_nb_bilingues, 0), auth.uid(), v.nom)
    returning * into r;
    perform cep_journaliser('effectifs', r.id, p_annee, v.region, v.province, v.ceb, 'transmettre', r.version, null,
                            jsonb_build_object('inscrits_f', r.inscrits_f, 'inscrits_g', r.inscrits_g, 'type', p_type));
  end if;
  return r;
end $$;

-- ---- Bordereau de résultats (CEB → serveur) ----
create or replace function cep_bordereau_transmettre(
  p_annee text, p_type text, p_f jsonb, p_g jsonb, p_moyenne numeric, p_nb_moyennes int, p_seuil numeric,
  p_epreuves jsonb, p_handicap_inscrits int, p_handicap_admis int, p_bilingues_inscrits int, p_bilingues_admis int
) returns cep_bordereaux
language plpgsql security definer set search_path = public as $$
declare
  v profiles; k text; ex cep_bordereaux; r cep_bordereaux; e jsonb; cle text;
  fi int; fa int; fad int; faj int; fex int; gi int; ga int; gad int; gaj int; gex int; eps jsonb;
begin
  v := cep_profil_ceb();
  if p_annee is null or btrim(p_annee) = '' then raise exception 'Indiquez l''année de la session.'; end if;
  if p_type is null or p_type not in ('cep', 'cep_concours') then
    raise exception 'Un examen blanc ne se transmet pas au serveur.';
  end if;
  if p_f is null or p_g is null or jsonb_typeof(p_f) <> 'object' or jsonb_typeof(p_g) <> 'object' then
    raise exception 'Les chiffres des filles et des garçons sont obligatoires.';
  end if;
  fi := cep_entier(p_f, 'inscrits'); fa := cep_entier(p_f, 'absents'); fad := cep_entier(p_f, 'admis');
  faj := cep_entier(p_f, 'ajournes'); fex := cep_entier(p_f, 'exclus');
  gi := cep_entier(p_g, 'inscrits'); ga := cep_entier(p_g, 'absents'); gad := cep_entier(p_g, 'admis');
  gaj := cep_entier(p_g, 'ajournes'); gex := cep_entier(p_g, 'exclus');
  if fi + gi = 0 then raise exception 'Aucun candidat : il n''y a rien à transmettre.'; end if;
  if fa > fi or ga > gi then raise exception 'Il y a plus d''absents que d''inscrits.'; end if;
  if fad + faj + fex <> fi - fa then
    raise exception 'Chiffres des filles incohérents : admis + ajournés + exclus doit être égal aux présents (candidats encore « en attente » ?).';
  end if;
  if gad + gaj + gex <> gi - ga then
    raise exception 'Chiffres des garçons incohérents : admis + ajournés + exclus doit être égal aux présents (candidats encore « en attente » ?).';
  end if;
  if coalesce(p_handicap_admis, 0) > coalesce(p_handicap_inscrits, 0) or coalesce(p_bilingues_admis, 0) > coalesce(p_bilingues_inscrits, 0) then
    raise exception 'Le nombre d''admis handicapés ou bilingues dépasse le nombre d''inscrits correspondants.';
  end if;
  if coalesce(p_handicap_inscrits, 0) > fi + gi or coalesce(p_bilingues_inscrits, 0) > fi + gi then
    raise exception 'Le nombre de candidats handicapés ou bilingues dépasse le nombre d''inscrits.';
  end if;
  if p_moyenne is not null and (p_moyenne < 0 or p_moyenne > 20) then raise exception 'La moyenne générale doit être entre 0 et 20.'; end if;
  if p_seuil is not null and (p_seuil < 0 or p_seuil > 20) then raise exception 'Le seuil d''admission doit être entre 0 et 20.'; end if;
  -- épreuves : on n'accepte QUE nom, moyenne et nombre de copies (aucune autre rubrique ne peut passer)
  if p_epreuves is null then p_epreuves := '[]'::jsonb; end if;
  if jsonb_typeof(p_epreuves) <> 'array' or jsonb_array_length(p_epreuves) > 12 then raise exception 'Liste des épreuves invalide.'; end if;
  for e in select * from jsonb_array_elements(p_epreuves) loop
    if jsonb_typeof(e) <> 'object' then raise exception 'Liste des épreuves invalide.'; end if;
    for cle in select jsonb_object_keys(e) loop
      if cle not in ('nom', 'moyenne', 'nb') then raise exception 'Rubrique non autorisée dans les épreuves : %.', cle; end if;
    end loop;
    if coalesce(jsonb_typeof(e -> 'nom'), '') <> 'string' then raise exception 'Nom d''épreuve invalide.'; end if;
    if length(e ->> 'nom') < 1 or length(e ->> 'nom') > 60 then raise exception 'Nom d''épreuve invalide (1 à 60 caractères).'; end if;
    if jsonb_typeof(e -> 'moyenne') = 'number' then
      if (e ->> 'moyenne')::numeric < 0 or (e ->> 'moyenne')::numeric > 20 then raise exception 'Moyenne d''épreuve invalide.'; end if;
    elsif jsonb_typeof(e -> 'moyenne') is not null and jsonb_typeof(e -> 'moyenne') <> 'null' then
      raise exception 'Moyenne d''épreuve invalide.';
    end if;
    perform cep_entier(e, 'nb', 0);
  end loop;
  eps := p_epreuves;

  k := cep_cle_zone(v.region, v.province, v.ceb);
  select * into ex from cep_bordereaux where annee = p_annee and type_examen = p_type and zone_key = k for update;
  if found then
    if ex.statut = 'valide' and ex.niveau_valide = 'ministere' then
      raise exception 'Ce bordereau est déjà validé par le ministère : il ne peut plus être modifié.';
    end if;
    if ex.statut in ('transmis', 'valide')
       and ex.f_inscrits = fi and ex.f_absents = fa and ex.f_admis = fad and ex.f_ajournes = faj and ex.f_exclus = fex
       and ex.g_inscrits = gi and ex.g_absents = ga and ex.g_admis = gad and ex.g_ajournes = gaj and ex.g_exclus = gex
       and ex.handicap_inscrits = coalesce(p_handicap_inscrits, 0) and ex.handicap_admis = coalesce(p_handicap_admis, 0)
       and ex.bilingues_inscrits = coalesce(p_bilingues_inscrits, 0) and ex.bilingues_admis = coalesce(p_bilingues_admis, 0)
       and ex.moyenne_generale is not distinct from p_moyenne and ex.epreuves = eps then
      return ex;
    end if;
    update cep_bordereaux set
      f_inscrits = fi, f_absents = fa, f_admis = fad, f_ajournes = faj, f_exclus = fex,
      g_inscrits = gi, g_absents = ga, g_admis = gad, g_ajournes = gaj, g_exclus = gex,
      handicap_inscrits = coalesce(p_handicap_inscrits, 0), handicap_admis = coalesce(p_handicap_admis, 0),
      bilingues_inscrits = coalesce(p_bilingues_inscrits, 0), bilingues_admis = coalesce(p_bilingues_admis, 0),
      moyenne_generale = p_moyenne, nb_moyennes = coalesce(p_nb_moyennes, 0), seuil = p_seuil, epreuves = eps,
      statut = 'transmis', niveau_valide = null, renvoye_par_niveau = null, motif_retour = null,
      version = ex.version + 1, transmis_le = now(), transmis_par = auth.uid(), transmis_par_nom = v.nom,
      traite_le = null, traite_par_nom = null, maj_le = now()
    where id = ex.id returning * into r;
    perform cep_journaliser('bordereau', r.id, p_annee, v.region, v.province, v.ceb, 'retransmettre', r.version, null,
                            jsonb_build_object('filles', p_f, 'garcons', p_g, 'type', p_type));
  else
    insert into cep_bordereaux (annee, type_examen, zone_key, region, province, ceb,
      f_inscrits, f_absents, f_admis, f_ajournes, f_exclus, g_inscrits, g_absents, g_admis, g_ajournes, g_exclus,
      handicap_inscrits, handicap_admis, bilingues_inscrits, bilingues_admis,
      moyenne_generale, nb_moyennes, seuil, epreuves, transmis_par, transmis_par_nom)
    values (p_annee, p_type, k, v.region, v.province, v.ceb,
      fi, fa, fad, faj, fex, gi, ga, gad, gaj, gex,
      coalesce(p_handicap_inscrits, 0), coalesce(p_handicap_admis, 0), coalesce(p_bilingues_inscrits, 0), coalesce(p_bilingues_admis, 0),
      p_moyenne, coalesce(p_nb_moyennes, 0), p_seuil, eps, auth.uid(), v.nom)
    returning * into r;
    perform cep_journaliser('bordereau', r.id, p_annee, v.region, v.province, v.ceb, 'transmettre', r.version, null,
                            jsonb_build_object('filles', p_f, 'garcons', p_g, 'type', p_type));
  end if;
  return r;
end $$;

-- ---- Validation hiérarchique ----
-- Chaîne : la DPEPPNF valide d'abord, puis la DREPPNF, puis le ministère.
-- Chaque niveau de la zone peut renvoyer avec un motif (sauf si un niveau
-- supérieur a déjà validé).
create or replace function cep_valider(p_nature text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v profiles; tbl text; l jsonb; n int; msg text;
begin
  select * into v from profiles where id = auth.uid();
  if not found or v.role not in ('dpeppnf', 'dreppnf', 'ministere') then
    raise exception 'Seuls la DPEPPNF, la DREPPNF et le ministère peuvent valider.' using errcode = '42501';
  end if;
  tbl := case p_nature when 'effectifs' then 'cep_effectifs' when 'bordereau' then 'cep_bordereaux' else null end;
  if tbl is null then raise exception 'Type de document inconnu.'; end if;
  execute format('select to_jsonb(t) from (select id, annee, region, province, ceb, statut, niveau_valide, version from %I where id = $1) t', tbl)
    into l using p_id;
  if l is null then raise exception 'Document introuvable.'; end if;
  if not cep_zone_couverte(l ->> 'region', l ->> 'province', l ->> 'ceb') then
    raise exception 'Ce document n''est pas dans votre zone.' using errcode = '42501';
  end if;
  if (l ->> 'statut') = 'a_corriger' then
    raise exception 'Ce document a été renvoyé à la CEB pour correction : attendez qu''elle le retransmette.';
  end if;
  if not (
       (v.role = 'dpeppnf' and (l ->> 'statut') = 'transmis')
    or (v.role = 'dreppnf' and (l ->> 'statut') = 'valide' and (l ->> 'niveau_valide') = 'dpeppnf')
    or (v.role = 'ministere' and (l ->> 'statut') = 'valide' and (l ->> 'niveau_valide') = 'dreppnf')
  ) then
    msg := case v.role
      when 'dpeppnf' then 'Ce document est déjà validé par la DPEPPNF.'
      when 'dreppnf' then 'La DREPPNF ne peut valider qu''après la validation de la DPEPPNF.'
      else 'Le ministère ne peut valider qu''après la validation de la DREPPNF.'
    end;
    raise exception '%', msg;
  end if;
  execute format('update %I set statut = ''valide'', niveau_valide = $2, motif_retour = null, renvoye_par_niveau = null, traite_le = now(), traite_par_nom = $3, maj_le = now() where id = $1 and version = $4 and statut = $5', tbl)
    using p_id, v.role, v.nom, (l ->> 'version')::int, (l ->> 'statut');
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Ce document vient d''être modifié par la CEB : actualisez la page avant de valider.'; end if;
  perform cep_journaliser(p_nature, p_id, l ->> 'annee', l ->> 'region', l ->> 'province', l ->> 'ceb', 'valider',
                          (l ->> 'version')::int, null, jsonb_build_object('niveau', v.role));
  return jsonb_build_object('statut', 'valide', 'niveau_valide', v.role, 'version', (l ->> 'version')::int);
end $$;

create or replace function cep_renvoyer(p_nature text, p_id uuid, p_motif text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v profiles; tbl text; l jsonb; n int; motif text;
begin
  select * into v from profiles where id = auth.uid();
  if not found or v.role not in ('dpeppnf', 'dreppnf', 'ministere') then
    raise exception 'Seuls la DPEPPNF, la DREPPNF et le ministère peuvent renvoyer un document.' using errcode = '42501';
  end if;
  motif := left(nullif(btrim(coalesce(p_motif, '')), ''), 500);
  if motif is null or length(motif) < 5 then raise exception 'Indiquez le motif du renvoi (au moins quelques mots).'; end if;
  tbl := case p_nature when 'effectifs' then 'cep_effectifs' when 'bordereau' then 'cep_bordereaux' else null end;
  if tbl is null then raise exception 'Type de document inconnu.'; end if;
  execute format('select to_jsonb(t) from (select id, annee, region, province, ceb, statut, niveau_valide, version from %I where id = $1) t', tbl)
    into l using p_id;
  if l is null then raise exception 'Document introuvable.'; end if;
  if not cep_zone_couverte(l ->> 'region', l ->> 'province', l ->> 'ceb') then
    raise exception 'Ce document n''est pas dans votre zone.' using errcode = '42501';
  end if;
  if (l ->> 'statut') = 'a_corriger' then raise exception 'Ce document est déjà renvoyé à la CEB.'; end if;
  if cep_rang_validation(l ->> 'niveau_valide') > cep_rang_validation(v.role) then
    raise exception 'Ce document a déjà été validé par un niveau supérieur : vous ne pouvez plus le renvoyer.';
  end if;
  execute format('update %I set statut = ''a_corriger'', niveau_valide = null, renvoye_par_niveau = $2, motif_retour = $3, traite_le = now(), traite_par_nom = $4, maj_le = now() where id = $1 and version = $5 and statut = $6', tbl)
    using p_id, v.role, motif, v.nom, (l ->> 'version')::int, (l ->> 'statut');
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Ce document vient d''être modifié par la CEB : actualisez la page avant de le renvoyer.'; end if;
  perform cep_journaliser(p_nature, p_id, l ->> 'annee', l ->> 'region', l ->> 'province', l ->> 'ceb', 'renvoyer',
                          (l ->> 'version')::int, motif, jsonb_build_object('niveau', v.role));
  return jsonb_build_object('statut', 'a_corriger', 'renvoye_par_niveau', v.role, 'version', (l ->> 'version')::int);
end $$;

-- ---- Jour J (président de centre, ou CEB pour le compte du centre) ----
create or replace function cep_jourj_enregistrer(
  p_centre uuid, p_epreuve_code text, p_epreuve_nom text, p_presents int, p_absents int,
  p_enveloppe_le timestamptz, p_recu_le timestamptz, p_scelle_intact boolean, p_incidents jsonb, p_maj_client timestamptz
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v profiles; c cep_centres; ex cep_jourj; inc jsonb; t text; g text; d text;
  nf int := 0; ns int := 0; nse int := 0; nl int := 0; na int := 0; maj timestamptz;
begin
  select * into v from profiles where id = auth.uid();
  if not found then raise exception 'Compte introuvable.' using errcode = '42501'; end if;
  select * into c from cep_centres where id = p_centre;
  if not found then raise exception 'Centre inconnu : demandez à la CEB de publier la liste des centres.'; end if;
  if v.role = 'centre' then
    if v.centre_id is distinct from p_centre
       or cep_cle_zone(v.region, v.province, v.ceb) <> cep_cle_zone(c.region, c.province, c.ceb) then
      raise exception 'Vous ne pouvez saisir que pour votre propre centre.' using errcode = '42501';
    end if;
  elsif v.role = 'ceb' then
    if not cep_zone_ceb_exacte(c.region, c.province, c.ceb) then
      raise exception 'Ce centre n''est pas dans votre circonscription.' using errcode = '42501';
    end if;
  else
    raise exception 'Seuls le président du centre et la CEB peuvent saisir le suivi du jour J.' using errcode = '42501';
  end if;
  if p_epreuve_code is null or p_epreuve_code !~ '^[A-Za-z0-9_-]{1,12}$' then raise exception 'Code d''épreuve invalide.'; end if;
  if p_presents is not null and (p_presents < 0 or p_presents > 5000) then raise exception 'Nombre de présents invalide.'; end if;
  if p_absents is not null and (p_absents < 0 or p_absents > 5000) then raise exception 'Nombre d''absents invalide.'; end if;
  if p_incidents is null then p_incidents := '[]'::jsonb; end if;
  if jsonb_typeof(p_incidents) <> 'array' or jsonb_array_length(p_incidents) > 30 then
    raise exception 'Liste d''incidents invalide (30 au maximum).';
  end if;
  for inc in select * from jsonb_array_elements(p_incidents) loop
    t := inc ->> 'type';
    if t is null or t not in ('fraude', 'sante', 'securite', 'logistique', 'autre') then raise exception 'Type d''incident inconnu.'; end if;
    if coalesce(inc ->> 'gravite', 'mineur') not in ('mineur', 'majeur') then raise exception 'Gravité d''incident inconnue.'; end if;
    if length(coalesce(inc ->> 'description', '')) > 500 then raise exception 'Description d''incident trop longue (500 caractères au maximum).'; end if;
    if t = 'fraude' then nf := nf + 1; elsif t = 'sante' then ns := ns + 1; elsif t = 'securite' then nse := nse + 1;
    elsif t = 'logistique' then nl := nl + 1; else na := na + 1; end if;
  end loop;
  maj := least(coalesce(p_maj_client, now()), now() + interval '5 minutes');

  select * into ex from cep_jourj where centre_id = p_centre and epreuve_code = p_epreuve_code for update;
  if found and ex.maj_client > maj then
    return 'ignore'; -- une saisie plus récente existe déjà (envoi hors ligne en retard)
  end if;
  insert into cep_jourj (centre_id, epreuve_code, epreuve_nom, annee, region, province, ceb, presents, absents,
                         enveloppe_le, recu_le, scelle_intact, inc_fraude, inc_sante, inc_securite, inc_logistique, inc_autre,
                         maj_client, maj_le, maj_par_nom, maj_par_role)
  values (p_centre, p_epreuve_code, left(nullif(btrim(coalesce(p_epreuve_nom, '')), ''), 60), c.annee, c.region, c.province, c.ceb,
          p_presents, p_absents, p_enveloppe_le, p_recu_le, p_scelle_intact, nf, ns, nse, nl, na, maj, now(), v.nom, v.role)
  on conflict (centre_id, epreuve_code) do update set
    epreuve_nom = excluded.epreuve_nom, presents = excluded.presents, absents = excluded.absents,
    enveloppe_le = excluded.enveloppe_le, recu_le = excluded.recu_le, scelle_intact = excluded.scelle_intact,
    inc_fraude = excluded.inc_fraude, inc_sante = excluded.inc_sante, inc_securite = excluded.inc_securite,
    inc_logistique = excluded.inc_logistique, inc_autre = excluded.inc_autre,
    maj_client = excluded.maj_client, maj_le = now(), maj_par_nom = excluded.maj_par_nom, maj_par_role = excluded.maj_par_role;
  delete from cep_jourj_incidents where centre_id = p_centre and epreuve_code = p_epreuve_code;
  for inc in select * from jsonb_array_elements(p_incidents) loop
    g := coalesce(inc ->> 'gravite', 'mineur');
    d := left(nullif(btrim(coalesce(inc ->> 'description', '')), ''), 500);
    insert into cep_jourj_incidents (centre_id, epreuve_code, region, province, ceb, type, gravite, description, par_nom)
    values (p_centre, p_epreuve_code, c.region, c.province, c.ceb, inc ->> 'type', g, d, v.nom);
  end loop;
  perform cep_journaliser('jourj', p_centre, c.annee, c.region, c.province, c.ceb, 'saisie_jourj', null, null,
                          jsonb_build_object('centre', c.nom, 'epreuve', p_epreuve_code, 'presents', p_presents, 'absents', p_absents,
                                             'incidents', nf + ns + nse + nl + na));
  return 'enregistre';
end $$;

-- ------------------------------------------------------------
-- 5) Fonctions de lecture groupée (pour les tableaux de bord)
-- ------------------------------------------------------------

-- Structures connues dans la zone du compte (noms de structures, aucune donnée de personne)
create or replace function cep_structures()
returns table (role text, structure text, region text, province text, ceb text)
language sql stable security definer set search_path = public as $$
  select p.role, p.structure, p.region, p.province, p.ceb
  from profiles p, profiles me
  where me.id = auth.uid()
    and p.role in ('ceb', 'dpeppnf', 'dreppnf')
    and (
      me.role = 'ministere'
      or (me.role = 'dreppnf' and norm_zone(me.region) is not null and norm_zone(p.region) = norm_zone(me.region))
      or (me.role = 'dpeppnf' and norm_zone(me.region) is not null and norm_zone(me.province) is not null
          and norm_zone(p.region) = norm_zone(me.region) and norm_zone(p.province) = norm_zone(me.province)
          and p.role in ('ceb', 'dpeppnf'))
      or (me.role = 'ceb' and p.id = me.id)
    )
$$;

create or replace function cep_centres_resume(p_annee text)
returns table (region text, province text, ceb text, nb_centres bigint, nb_jurys bigint, nb_a_risque bigint, nb_candidats bigint, nb_complets bigint)
language sql stable security definer set search_path = public as $$
  select c.region, c.province, c.ceb,
         count(*)::bigint,
         count(distinct nullif(btrim(coalesce(c.jury, '')), ''))::bigint,
         (count(*) filter (where c.statut_risque <> 'normal'))::bigint,
         coalesce(sum(c.nb_candidats), 0)::bigint,
         (count(*) filter (where coalesce(s.nb, 0) >= greatest(c.nb_epreuves, 1)))::bigint
  from cep_centres c
  left join (select j.centre_id, count(*) as nb from cep_jourj j
              where j.presents is not null and j.absents is not null group by j.centre_id) s on s.centre_id = c.id
  where c.annee = p_annee and cep_zone_couverte(c.region, c.province, c.ceb)
  group by c.region, c.province, c.ceb
$$;

create or replace function cep_jourj_resume(p_annee text)
returns table (region text, province text, ceb text, epreuve_code text, epreuve_nom text,
               nb_centres_saisis bigint, nb_presents bigint, nb_absents bigint, nb_enveloppes bigint, nb_recus bigint,
               nb_scelles_anormaux bigint, inc_fraude bigint, inc_sante bigint, inc_securite bigint, inc_logistique bigint, inc_autre bigint)
language sql stable security definer set search_path = public as $$
  select j.region, j.province, j.ceb, j.epreuve_code, max(j.epreuve_nom),
         (count(*) filter (where j.presents is not null and j.absents is not null))::bigint,
         coalesce(sum(j.presents), 0)::bigint, coalesce(sum(j.absents), 0)::bigint,
         (count(*) filter (where j.enveloppe_le is not null))::bigint,
         (count(*) filter (where j.recu_le is not null))::bigint,
         (count(*) filter (where j.scelle_intact = false))::bigint,
         coalesce(sum(j.inc_fraude), 0)::bigint, coalesce(sum(j.inc_sante), 0)::bigint, coalesce(sum(j.inc_securite), 0)::bigint,
         coalesce(sum(j.inc_logistique), 0)::bigint, coalesce(sum(j.inc_autre), 0)::bigint
  from cep_jourj j
  where j.annee = p_annee and cep_zone_couverte(j.region, j.province, j.ceb)
  group by j.region, j.province, j.ceb, j.epreuve_code
$$;

-- ------------------------------------------------------------
-- 6) Droits d'exécution : seuls les comptes connectés appellent ces fonctions
-- ------------------------------------------------------------
revoke execute on function cep_journaliser(text, uuid, text, text, text, text, text, int, text, jsonb) from public, anon, authenticated;
revoke execute on function cep_profil_ceb() from public, anon, authenticated;
revoke execute on function cep_entier(jsonb, text, int) from public, anon;

revoke execute on function cep_zone_couverte(text, text, text) from public, anon;
revoke execute on function cep_zone_ceb_exacte(text, text, text) from public, anon;
revoke execute on function cep_mon_centre() from public, anon;
revoke execute on function cep_peut_lire_calendrier() from public, anon;
grant execute on function cep_zone_couverte(text, text, text) to authenticated;
grant execute on function cep_zone_ceb_exacte(text, text, text) to authenticated;
grant execute on function cep_mon_centre() to authenticated;
grant execute on function cep_peut_lire_calendrier() to authenticated;
grant execute on function cep_entier(jsonb, text, int) to authenticated;

revoke execute on function cep_calendrier_definir(text, jsonb) from public, anon;
revoke execute on function cep_etape_marquer(text, text, boolean) from public, anon;
revoke execute on function cep_centres_publier(text, jsonb) from public, anon;
revoke execute on function cep_centre_marquer(uuid, text, text, text) from public, anon;
revoke execute on function cep_effectifs_transmettre(text, text, int, int, int, int, int, int, int, int, int) from public, anon;
revoke execute on function cep_bordereau_transmettre(text, text, jsonb, jsonb, numeric, int, numeric, jsonb, int, int, int, int) from public, anon;
revoke execute on function cep_valider(text, uuid) from public, anon;
revoke execute on function cep_renvoyer(text, uuid, text) from public, anon;
revoke execute on function cep_jourj_enregistrer(uuid, text, text, int, int, timestamptz, timestamptz, boolean, jsonb, timestamptz) from public, anon;
revoke execute on function cep_structures() from public, anon;
revoke execute on function cep_centres_resume(text) from public, anon;
revoke execute on function cep_jourj_resume(text) from public, anon;

grant execute on function cep_calendrier_definir(text, jsonb) to authenticated;
grant execute on function cep_etape_marquer(text, text, boolean) to authenticated;
grant execute on function cep_centres_publier(text, jsonb) to authenticated;
grant execute on function cep_centre_marquer(uuid, text, text, text) to authenticated;
grant execute on function cep_effectifs_transmettre(text, text, int, int, int, int, int, int, int, int, int) to authenticated;
grant execute on function cep_bordereau_transmettre(text, text, jsonb, jsonb, numeric, int, numeric, jsonb, int, int, int, int) to authenticated;
grant execute on function cep_valider(text, uuid) to authenticated;
grant execute on function cep_renvoyer(text, uuid, text) to authenticated;
grant execute on function cep_jourj_enregistrer(uuid, text, text, int, int, timestamptz, timestamptz, boolean, jsonb, timestamptz) to authenticated;
grant execute on function cep_structures() to authenticated;
grant execute on function cep_centres_resume(text) to authenticated;
grant execute on function cep_jourj_resume(text) to authenticated;
