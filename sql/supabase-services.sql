-- ============================================================
-- SERVICES DU DPEPPNF + ÉCHANGES AVEC LES BUREAUX DE LA CEB (version 48)
-- À exécuter UNE FOIS dans Supabase → SQL Editor, APRÈS supabase-bureaux.sql.
-- Relancer ensuite supabase-securite.sql. Sans danger si relancé.
-- Aucune donnée existante n'est modifiée.
--
-- Services : secretariat, sgrfm, sgrh, sep, sepp, senf, sec, speiefg, sempc, sascl, sctic.
-- Règles :
--   * le DPEPPNF crée et retire les comptes « service » de SA province ;
--   * un service envoie des documents : aux CEB de sa province (à leurs bureaux), aux écoles
--     de sa province, et aux autres services du DPEPPNF ;
--   * un bureau de CEB peut maintenant aussi écrire aux services du DPEPPNF et aux autres
--     bureaux de sa CEB (en plus des écoles) ;
--   * un service reçoit uniquement les documents qui lui sont destinés ; le Secrétariat
--     reçoit en plus ce qui est adressé au DPEPPNF sans service précis ;
--   * le DPEPPNF voit tout ce que ses services envoient (supervision), comme le CCEB pour ses bureaux ;
--   * un document peut viser certaines CEB seulement (colonne ceb_dest ; vide = toutes).
-- ============================================================

-- 1) Profils : nouveau rôle « service » + colonne service
alter table profiles add column if not exists service text;
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in (
  'directeur', 'directeur_adjoint', 'secretaire',
  'comptable', 'magasinier', 'cantine', 'enseignant', 'parent',
  'ceb', 'dpeppnf', 'dreppnf', 'ministere', 'centre', 'bureau', 'service'
));
alter table profiles drop constraint if exists profiles_service_check;
alter table profiles add constraint profiles_service_check check (
  (role = 'service' and service in ('secretariat','sgrfm','sgrh','sep','sepp','senf','sec','speiefg','sempc','sascl','sctic'))
  or (role <> 'service' and service is null)
);
-- Un seul compte par service et par province
create unique index if not exists profiles_service_unique
  on profiles (norm_zone(region), norm_zone(province), service) where role = 'service';

-- 2) Le DPEPPNF gère les comptes « service » de sa province (reprend la version 47 + une ligne)
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
      or (me.role = 'dpeppnf' and p_role in ('ceb', 'service')
          and norm_zone(p_region) = norm_zone(me.region) and norm_zone(p_province) = norm_zone(me.province))
      or (me.role = 'ceb' and p_role in ('directeur', 'centre', 'bureau')
          and norm_zone(p_region) = norm_zone(me.region) and norm_zone(p_province) = norm_zone(me.province)
          and norm_zone(p_ceb) = norm_zone(me.ceb))
    )
  )
$$;

-- 3) Documents : services destinataires, service émetteur, CEB visées
alter table circuit_documents add column if not exists services text[] not null default '{}';
alter table circuit_documents add column if not exists service_emetteur text;
alter table circuit_documents add column if not exists ceb_dest text[] not null default '{}';
alter table circuit_documents drop constraint if exists circuit_documents_services_check;
alter table circuit_documents add constraint circuit_documents_services_check check (
  services <@ array['secretariat','sgrfm','sgrh','sep','sepp','senf','sec','speiefg','sempc','sascl','sctic']::text[]
  and (service_emetteur is null or service_emetteur in ('secretariat','sgrfm','sgrh','sep','sepp','senf','sec','speiefg','sempc','sascl','sctic'))
  and not (service_emetteur is not null and bureau_emetteur is not null)
);

-- 3 bis) La règle d'origine interdisait d'écrire à son propre niveau (« not niveau = any(cibles) »).
--        Un bureau ou un service peut écrire à ses homologues de sa propre structure : on l'autorise
--        pour eux seulement. (On retrouve l'ancienne contrainte par son contenu, quel que soit son nom.)
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.circuit_documents'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%cardinality(cibles)%'
  loop
    execute format('alter table circuit_documents drop constraint %I', c.conname);
  end loop;
end $$;
alter table circuit_documents add constraint circuit_documents_cibles_check check (
  cardinality(cibles) > 0
  and cibles <@ array['ministere', 'dreppnf', 'dpeppnf', 'ceb', 'ecole']::text[]
  and (not (niveau = any (cibles)) or bureau_emetteur is not null or service_emetteur is not null)
);

-- 4) Droit de publier
--    * bureau de CEB : au nom de la CEB, vers écoles / bureaux de sa CEB / DPEPPNF ;
--    * service du DPEPPNF : au nom du DPEPPNF (zone = sa province, jamais de CEB), vers CEB / écoles / services ;
--    * les autres comptes : comme avant (sans bureau ni service émetteur).
create or replace function peut_publier_document(d_niveau text, d_region text, d_province text, d_ceb text, d_emetteur uuid, d_cibles text[], d_bureau text, d_service text)
returns boolean language sql stable security definer set search_path = public as $$
  select d_emetteur = auth.uid() and exists (
    select 1 from profiles v
    where v.id = auth.uid()
      and case
        when v.role = 'bureau' then d_niveau = 'ceb' and d_bureau = v.bureau and d_service is null
             and cardinality(d_cibles) > 0 and d_cibles <@ array['ecole', 'ceb', 'dpeppnf']::text[]
             and d_region = v.region and d_province = v.province and d_ceb = v.ceb
        when v.role = 'service' then d_niveau = 'dpeppnf' and d_service = v.service and d_bureau is null
             and cardinality(d_cibles) > 0 and d_cibles <@ array['ecole', 'ceb', 'dpeppnf']::text[]
             and d_region = v.region and d_province = v.province and d_ceb is null
        else niveau_reseau(v.role) = d_niveau and d_bureau is null and d_service is null
             and case when rang_niveau(d_niveau) >= 1 then d_region is not null and d_region = v.region else d_region is null end
             and case when rang_niveau(d_niveau) >= 2 then d_province is not null and d_province = v.province else d_province is null end
             and case when rang_niveau(d_niveau) >= 3 then d_ceb is not null and d_ceb = v.ceb else d_ceb is null end
      end
  )
$$;

-- 5) Droit de lire
create or replace function peut_lire_document(d_niveau text, d_region text, d_province text, d_ceb text, d_cibles text[], d_emetteur uuid, d_bureaux text[], d_services text[], d_ceb_dest text[])
returns boolean language sql stable security definer set search_path = public as $$
  select d_emetteur = auth.uid() or exists (
    select 1 from profiles v
    where v.id = auth.uid()
      and (
        case
          -- un bureau de CEB : seulement les documents adressés à CE bureau (le Secrétariat reçoit aussi
          -- le courrier adressé à la CEB sans bureau précis), pour sa CEB
          when v.role = 'bureau' then
            'ceb' = any (d_cibles)
            and (d_region is null or norm_zone(v.region) = norm_zone(d_region))
            and (d_province is null or norm_zone(v.province) = norm_zone(d_province))
            and (d_ceb is null or norm_zone(v.ceb) = norm_zone(d_ceb))
            and (cardinality(d_ceb_dest) = 0 or exists (select 1 from unnest(d_ceb_dest) z where norm_zone(z) = norm_zone(v.ceb)))
            and (v.bureau = any (d_bureaux) or (v.bureau = 'scr' and cardinality(d_bureaux) = 0))
          -- un service du DPEPPNF : seulement les documents adressés à CE service (le Secrétariat reçoit
          -- aussi ce qui est adressé au DPEPPNF sans service précis), pour sa province
          when v.role = 'service' then
            'dpeppnf' = any (d_cibles)
            and (d_region is null or norm_zone(v.region) = norm_zone(d_region))
            and (d_province is null or norm_zone(v.province) = norm_zone(d_province))
            and (v.service = any (d_services) or (v.service = 'secretariat' and cardinality(d_services) = 0))
          else
            niveau_reseau(v.role) is not null
            and niveau_reseau(v.role) = any (d_cibles)
            and (rang_niveau(niveau_reseau(v.role)) < 1 or d_region is null or norm_zone(v.region) = norm_zone(d_region))
            and (rang_niveau(niveau_reseau(v.role)) < 2 or d_province is null or norm_zone(v.province) = norm_zone(d_province))
            and (rang_niveau(niveau_reseau(v.role)) < 3 or d_ceb is null or norm_zone(v.ceb) = norm_zone(d_ceb))
            -- document visant certaines CEB seulement : la CEB et ses écoles
            and (rang_niveau(niveau_reseau(v.role)) < 3 or cardinality(d_ceb_dest) = 0
                 or exists (select 1 from unnest(d_ceb_dest) z where norm_zone(z) = norm_zone(v.ceb)))
        end
        -- supervision du CCEB sur sa CEB
        or (v.role = 'ceb' and d_niveau = 'ceb' and norm_zone(v.ceb) = norm_zone(d_ceb)
            and norm_zone(v.province) = norm_zone(d_province) and norm_zone(v.region) = norm_zone(d_region))
        -- supervision du DPEPPNF sur ses services
        or (v.role = 'dpeppnf' and d_niveau = 'dpeppnf'
            and norm_zone(v.province) = norm_zone(d_province) and norm_zone(v.region) = norm_zone(d_region))
      )
  )
$$;

-- 6) Politiques (on remplace les politiques, puis on retire les anciennes versions des fonctions)
drop policy if exists "publications : lecture" on circuit_documents;
drop policy if exists "publications : création" on circuit_documents;
create policy "publications : lecture" on circuit_documents for select
  using (peut_lire_document(niveau, region, province, ceb, cibles, emetteur_id, bureaux, services, ceb_dest));
create policy "publications : création" on circuit_documents for insert
  with check (peut_publier_document(niveau, region, province, ceb, emetteur_id, cibles, bureau_emetteur, service_emetteur));
drop function if exists peut_publier_document(text, text, text, text, uuid, text[], text);
drop function if exists peut_lire_document(text, text, text, text, text[], uuid, text[]);
