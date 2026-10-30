-- ============================================================
-- SERVICES DE LA DREPPNF + ÉCHANGES AVEC LES SERVICES DE LA DPEPPNF ET LES BUREAUX DES CEB (version 49)
-- À exécuter UNE FOIS dans Supabase → SQL Editor, APRÈS supabase-services.sql.
-- Relancer ensuite supabase-securite.sql. Sans danger si relancé.
-- Aucune donnée existante n'est modifiée.
--
-- Services (mêmes codes que ceux de la DPEPPNF) :
--   secretariat, sgrfm, sgrh, sep, sepp, senf, sec, speiefg, sempc, sascl, sctic.
-- Règles :
--   * la DREPPNF crée et retire les comptes « service_reg » de SA région ;
--   * un service de la DREPPNF envoie des documents : aux services des DPEPPNF, aux bureaux des CEB,
--     aux écoles de sa région (toutes les provinces, ou certaines), et aux autres services de la DREPPNF ;
--   * les services des DPEPPNF et les bureaux des CEB peuvent aussi écrire aux services de la DREPPNF ;
--   * un service ne reçoit que ce qui lui est destiné ; le Secrétariat reçoit en plus ce qui est adressé
--     à la DREPPNF sans service précis ;
--   * la DREPPNF voit tout ce que ses services envoient (supervision).
-- ============================================================

-- 1) Profils : nouveau rôle « service_reg » (la colonne service est partagée avec « service »)
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in (
  'directeur', 'directeur_adjoint', 'secretaire',
  'comptable', 'magasinier', 'cantine', 'enseignant', 'parent',
  'ceb', 'dpeppnf', 'dreppnf', 'ministere', 'centre', 'bureau', 'service', 'service_reg'
));
alter table profiles drop constraint if exists profiles_service_check;
alter table profiles add constraint profiles_service_check check (
  (role in ('service', 'service_reg') and service in ('secretariat','sgrfm','sgrh','sep','sepp','senf','sec','speiefg','sempc','sascl','sctic'))
  or (role not in ('service', 'service_reg') and service is null)
);
-- Un seul compte par service et par région
create unique index if not exists profiles_service_reg_unique
  on profiles (norm_zone(region), service) where role = 'service_reg';

-- 2) La DREPPNF gère les comptes « service_reg » de sa région (reprend la version 48 + une ligne)
create or replace function peut_gerer_profil(p_role text, p_region text, p_province text, p_ceb text, p_ecole uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles me
    where me.id = auth.uid() and (
      (me.role in ('directeur', 'directeur_adjoint')
        and p_role in ('directeur', 'directeur_adjoint', 'secretaire', 'comptable', 'magasinier', 'cantine', 'enseignant', 'parent')
        and me.ecole_id is not null and p_ecole is not distinct from me.ecole_id)
      or (me.role = 'ministere' and p_role = 'dreppnf')
      or (me.role = 'dreppnf' and p_role in ('dpeppnf', 'service_reg')
          and norm_zone(p_region) = norm_zone(me.region))
      or (me.role = 'dpeppnf' and p_role in ('ceb', 'service')
          and norm_zone(p_region) = norm_zone(me.region) and norm_zone(p_province) = norm_zone(me.province))
      or (me.role = 'ceb' and p_role in ('directeur', 'centre', 'bureau')
          and norm_zone(p_region) = norm_zone(me.region) and norm_zone(p_province) = norm_zone(me.province)
          and norm_zone(p_ceb) = norm_zone(me.ceb))
    )
  )
$$;

-- 3) Documents : services de la DREPPNF destinataires, provinces visées
alter table circuit_documents add column if not exists services_reg text[] not null default '{}';
alter table circuit_documents add column if not exists province_dest text[] not null default '{}';
alter table circuit_documents drop constraint if exists circuit_documents_services_reg_check;
alter table circuit_documents add constraint circuit_documents_services_reg_check check (
  services_reg <@ array['secretariat','sgrfm','sgrh','sep','sepp','senf','sec','speiefg','sempc','sascl','sctic']::text[]
);
-- (service_emetteur sert aux deux niveaux : le niveau du document dit s'il s'agit de la DPEPPNF ou de la DREPPNF)

-- 4) Droit de publier : + service de la DREPPNF (zone = sa région, jamais de province ni de CEB) ;
--    bureaux et services de la DPEPPNF peuvent maintenant viser aussi la DREPPNF.
create or replace function peut_publier_document(d_niveau text, d_region text, d_province text, d_ceb text, d_emetteur uuid, d_cibles text[], d_bureau text, d_service text)
returns boolean language sql stable security definer set search_path = public as $$
  select d_emetteur = auth.uid() and exists (
    select 1 from profiles v
    where v.id = auth.uid()
      and case
        when v.role = 'bureau' then d_niveau = 'ceb' and d_bureau = v.bureau and d_service is null
             and cardinality(d_cibles) > 0 and d_cibles <@ array['ecole', 'ceb', 'dpeppnf', 'dreppnf']::text[]
             and d_region = v.region and d_province = v.province and d_ceb = v.ceb
        when v.role = 'service' then d_niveau = 'dpeppnf' and d_service = v.service and d_bureau is null
             and cardinality(d_cibles) > 0 and d_cibles <@ array['ecole', 'ceb', 'dpeppnf', 'dreppnf']::text[]
             and d_region = v.region and d_province = v.province and d_ceb is null
        when v.role = 'service_reg' then d_niveau = 'dreppnf' and d_service = v.service and d_bureau is null
             and cardinality(d_cibles) > 0 and d_cibles <@ array['ecole', 'ceb', 'dpeppnf', 'dreppnf']::text[]
             and d_region = v.region and d_province is null and d_ceb is null
        else niveau_reseau(v.role) = d_niveau and d_bureau is null and d_service is null
             and case when rang_niveau(d_niveau) >= 1 then d_region is not null and d_region = v.region else d_region is null end
             and case when rang_niveau(d_niveau) >= 2 then d_province is not null and d_province = v.province else d_province is null end
             and case when rang_niveau(d_niveau) >= 3 then d_ceb is not null and d_ceb = v.ceb else d_ceb is null end
      end
  )
$$;

-- 5) Droit de lire
create or replace function peut_lire_document(d_niveau text, d_region text, d_province text, d_ceb text, d_cibles text[], d_emetteur uuid, d_bureaux text[], d_services text[], d_services_reg text[], d_ceb_dest text[], d_province_dest text[])
returns boolean language sql stable security definer set search_path = public as $$
  select d_emetteur = auth.uid() or exists (
    select 1 from profiles v
    where v.id = auth.uid()
      and (
        case
          -- bureau de CEB : documents adressés à CE bureau (le Secrétariat reçoit aussi le courrier sans bureau précis)
          when v.role = 'bureau' then
            'ceb' = any (d_cibles)
            and (d_region is null or norm_zone(v.region) = norm_zone(d_region))
            and (d_province is null or norm_zone(v.province) = norm_zone(d_province))
            and (d_ceb is null or norm_zone(v.ceb) = norm_zone(d_ceb))
            and (cardinality(d_ceb_dest) = 0 or exists (select 1 from unnest(d_ceb_dest) z where norm_zone(z) = norm_zone(v.ceb)))
            and (cardinality(d_province_dest) = 0 or exists (select 1 from unnest(d_province_dest) z where norm_zone(z) = norm_zone(v.province)))
            and (v.bureau = any (d_bureaux) or (v.bureau = 'scr' and cardinality(d_bureaux) = 0))
          -- service de la DPEPPNF : documents adressés à CE service (le Secrétariat reçoit aussi ce qui est adressé au DPEPPNF sans service précis)
          when v.role = 'service' then
            'dpeppnf' = any (d_cibles)
            and (d_region is null or norm_zone(v.region) = norm_zone(d_region))
            and (d_province is null or norm_zone(v.province) = norm_zone(d_province))
            and (cardinality(d_province_dest) = 0 or exists (select 1 from unnest(d_province_dest) z where norm_zone(z) = norm_zone(v.province)))
            and (v.service = any (d_services) or (v.service = 'secretariat' and cardinality(d_services) = 0))
          -- service de la DREPPNF : documents adressés à CE service (le Secrétariat reçoit aussi ce qui est adressé à la DREPPNF sans service précis)
          when v.role = 'service_reg' then
            'dreppnf' = any (d_cibles)
            and (d_region is null or norm_zone(v.region) = norm_zone(d_region))
            and (v.service = any (d_services_reg) or (v.service = 'secretariat' and cardinality(d_services_reg) = 0))
          else
            niveau_reseau(v.role) is not null
            and niveau_reseau(v.role) = any (d_cibles)
            and (rang_niveau(niveau_reseau(v.role)) < 1 or d_region is null or norm_zone(v.region) = norm_zone(d_region))
            and (rang_niveau(niveau_reseau(v.role)) < 2 or d_province is null or norm_zone(v.province) = norm_zone(d_province))
            and (rang_niveau(niveau_reseau(v.role)) < 3 or d_ceb is null or norm_zone(v.ceb) = norm_zone(d_ceb))
            -- document visant certaines provinces seulement : leur DPEPPNF, leurs CEB et leurs écoles
            and (rang_niveau(niveau_reseau(v.role)) < 2 or cardinality(d_province_dest) = 0
                 or exists (select 1 from unnest(d_province_dest) z where norm_zone(z) = norm_zone(v.province)))
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
        -- supervision de la DREPPNF sur ses services
        or (v.role = 'dreppnf' and d_niveau = 'dreppnf' and norm_zone(v.region) = norm_zone(d_region))
      )
  )
$$;

-- 6) Politiques, puis retrait de l'ancienne version de la fonction de lecture
drop policy if exists "publications : lecture" on circuit_documents;
create policy "publications : lecture" on circuit_documents for select
  using (peut_lire_document(niveau, region, province, ceb, cibles, emetteur_id, bureaux, services, services_reg, ceb_dest, province_dest));
drop function if exists peut_lire_document(text, text, text, text, text[], uuid, text[], text[], text[]);
