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
