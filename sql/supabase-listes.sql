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
