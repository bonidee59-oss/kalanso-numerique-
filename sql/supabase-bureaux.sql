-- ============================================================
-- BUREAUX DE LA CEB : comptes + documents par bureau (version 47)
-- À exécuter UNE FOIS dans Supabase → SQL Editor, APRÈS supabase-complet.sql
-- (et supabase-personnel.sql). Relancer ensuite supabase-securite.sql.
-- Sans danger si relancé. Aucune donnée existante n'est modifiée.
--
-- Bureaux : scr (Secrétariat), bgrh, bgrfm, bse, bec, bascl, bepres, beprim, benf.
-- Règles :
--   * le CCEB (compte « ceb ») crée et retire les comptes « bureau » de SA CEB ;
--   * un bureau envoie des documents aux ÉCOLES de sa CEB (et à elles seules) ;
--   * un bureau reçoit uniquement les documents qui lui sont destinés ; le
--     Secrétariat reçoit en plus le courrier adressé à la CEB sans bureau précis ;
--   * le CCEB voit tout : documents reçus par la CEB et documents de ses bureaux.
-- ============================================================

-- 1) Profils : nouveau rôle « bureau » + colonne bureau
alter table profiles add column if not exists bureau text;
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in (
  'directeur', 'directeur_adjoint', 'secretaire',
  'comptable', 'magasinier', 'cantine', 'enseignant', 'parent',
  'ceb', 'dpeppnf', 'dreppnf', 'ministere', 'centre', 'bureau'
));
alter table profiles drop constraint if exists profiles_bureau_check;
alter table profiles add constraint profiles_bureau_check check (
  (role = 'bureau' and bureau in ('scr','bgrh','bgrfm','bse','bec','bascl','bepres','beprim','benf'))
  or (role <> 'bureau' and bureau is null)
);
-- Un seul compte par bureau et par CEB
create unique index if not exists profiles_bureau_unique
  on profiles (norm_zone(region), norm_zone(province), norm_zone(ceb), bureau) where role = 'bureau';

-- 2) Le CCEB gère les comptes « bureau » de sa circonscription
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
      or (me.role = 'ceb' and p_role in ('directeur', 'centre', 'bureau')
          and norm_zone(p_region) = norm_zone(me.region) and norm_zone(p_province) = norm_zone(me.province)
          and norm_zone(p_ceb) = norm_zone(me.ceb))
    )
  )
$$;

-- 3) Documents : bureaux destinataires, bureau émetteur, nature du document
alter table circuit_documents add column if not exists bureaux text[] not null default '{}';
alter table circuit_documents add column if not exists bureau_emetteur text;
alter table circuit_documents add column if not exists nature text;
alter table circuit_documents drop constraint if exists circuit_documents_bureaux_check;
alter table circuit_documents add constraint circuit_documents_bureaux_check check (
  bureaux <@ array['scr','bgrh','bgrfm','bse','bec','bascl','bepres','beprim','benf']::text[]
  and (bureau_emetteur is null or bureau_emetteur in ('scr','bgrh','bgrfm','bse','bec','bascl','bepres','beprim','benf'))
);

-- 4) Droit de publier : un bureau publie au nom de la CEB (niveau « ceb »), de sa
--    zone, vers les écoles uniquement, en indiquant son propre bureau.
create or replace function peut_publier_document(d_niveau text, d_region text, d_province text, d_ceb text, d_emetteur uuid, d_cibles text[], d_bureau text)
returns boolean language sql stable security definer set search_path = public as $$
  select d_emetteur = auth.uid() and exists (
    select 1 from profiles v
    where v.id = auth.uid()
      and case
        when v.role = 'bureau' then d_niveau = 'ceb' and d_cibles = array['ecole']::text[] and d_bureau = v.bureau
             and d_region = v.region and d_province = v.province and d_ceb = v.ceb
        else niveau_reseau(v.role) = d_niveau and d_bureau is null
             and case when rang_niveau(d_niveau) >= 1 then d_region is not null and d_region = v.region else d_region is null end
             and case when rang_niveau(d_niveau) >= 2 then d_province is not null and d_province = v.province else d_province is null end
             and case when rang_niveau(d_niveau) >= 3 then d_ceb is not null and d_ceb = v.ceb else d_ceb is null end
      end
  )
$$;

-- 5) Droit de lire
create or replace function peut_lire_document(d_niveau text, d_region text, d_province text, d_ceb text, d_cibles text[], d_emetteur uuid, d_bureaux text[])
returns boolean language sql stable security definer set search_path = public as $$
  select d_emetteur = auth.uid() or exists (
    select 1 from profiles v
    where v.id = auth.uid()
      and case
        -- un bureau : seulement les documents adressés à CE bureau (le Secrétariat reçoit aussi le courrier sans bureau précis)
        when v.role = 'bureau' then
          'ceb' = any (d_cibles)
          and norm_zone(v.region) = norm_zone(d_region) and norm_zone(v.province) = norm_zone(d_province) and norm_zone(v.ceb) = norm_zone(d_ceb)
          and (v.bureau = any (d_bureaux) or (v.bureau = 'scr' and cardinality(d_bureaux) = 0))
        else
          niveau_reseau(v.role) is not null
          and niveau_reseau(v.role) = any (d_cibles)
          and (rang_niveau(niveau_reseau(v.role)) < 1 or d_region is null or norm_zone(v.region) = norm_zone(d_region))
          and (rang_niveau(niveau_reseau(v.role)) < 2 or d_province is null or norm_zone(v.province) = norm_zone(d_province))
          and (rang_niveau(niveau_reseau(v.role)) < 3 or d_ceb is null or norm_zone(v.ceb) = norm_zone(d_ceb))
      end
    or (v.id = auth.uid() and v.role = 'ceb' and d_niveau = 'ceb' and norm_zone(v.ceb) = norm_zone(d_ceb)
        and norm_zone(v.province) = norm_zone(d_province) and norm_zone(v.region) = norm_zone(d_region))  -- supervision du CCEB
  )
$$;

-- 6) Politiques (les anciennes versions des fonctions à 5 / 6 arguments ne servent plus)
drop policy if exists "publications : lecture" on circuit_documents;
drop policy if exists "publications : création" on circuit_documents;
create policy "publications : lecture" on circuit_documents for select
  using (peut_lire_document(niveau, region, province, ceb, cibles, emetteur_id, bureaux));
create policy "publications : création" on circuit_documents for insert
  with check (peut_publier_document(niveau, region, province, ceb, emetteur_id, cibles, bureau_emetteur));
drop function if exists peut_publier_document(text, text, text, text, uuid);
drop function if exists peut_lire_document(text, text, text, text, text[], uuid);

-- 7) Liste des bureaux d'une CEB qui ont déjà un compte (utile au CCEB)
-- (la table profiles suffit : le CCEB voit ses bureaux grâce à peut_gerer_profil)
