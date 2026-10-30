-- ============================================================
-- VERSION 50 — SERVICES DU SECRÉTARIAT GÉNÉRAL (MINISTÈRE)
-- À exécuter UNE FOIS dans Supabase → SQL Editor, APRÈS supabase-services.sql
-- et supabase-dreppnf.sql, puis relancer supabase-securite.sql.
-- Sans danger si exécuté plusieurs fois.
--
-- Même procédure que la DREPPNF : le compte « ministère » crée un compte par service
-- (rôle « service_min »). Services : BE, SP/SG, SCC, SQE, SAI, SP/SGA.
-- Un service écrit aux services des DREPPNF / DPEPPNF, aux bureaux des CEB, aux écoles
-- (tout le pays ou certaines régions) et aux autres services du Secrétariat général.
-- Corrige aussi liste_cebs() : elle était vide pour les comptes de services.
-- ============================================================

-- ---------- Comptes ----------
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in (
  'directeur', 'directeur_adjoint', 'secretaire',
  'comptable', 'magasinier', 'cantine', 'enseignant', 'parent',
  'ceb', 'dpeppnf', 'dreppnf', 'ministere', 'centre', 'bureau', 'service', 'service_reg', 'service_min'
));
alter table profiles drop constraint if exists profiles_service_check;
alter table profiles add constraint profiles_service_check check (
  (role in ('service', 'service_reg') and service in ('secretariat','sgrfm','sgrh','sep','sepp','senf','sec','speiefg','sempc','sascl','sctic'))
  or (role = 'service_min' and service in ('be','spsg','scc','sqe','sai','spsga'))
  or (role not in ('service', 'service_reg', 'service_min') and service is null)
);
create unique index if not exists profiles_service_min_unique
  on profiles (service) where role = 'service_min';

create or replace function peut_gerer_profil(p_role text, p_region text, p_province text, p_ceb text, p_ecole uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles me
    where me.id = auth.uid() and (
      (me.role in ('directeur', 'directeur_adjoint')
        and p_role in ('directeur', 'directeur_adjoint', 'secretaire', 'comptable', 'magasinier', 'cantine', 'enseignant', 'parent')
        and me.ecole_id is not null and p_ecole is not distinct from me.ecole_id)
      or (me.role = 'ministere' and p_role in ('dreppnf', 'service_min'))
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

-- ---------- Documents ----------
alter table circuit_documents add column if not exists services_min text[] not null default '{}';
alter table circuit_documents add column if not exists region_dest text[] not null default '{}';
alter table circuit_documents drop constraint if exists circuit_documents_services_min_check;
alter table circuit_documents add constraint circuit_documents_services_min_check check (
  services_min <@ array['be','spsg','scc','sqe','sai','spsga']::text[]
);
alter table circuit_documents drop constraint if exists circuit_documents_services_check;
alter table circuit_documents add constraint circuit_documents_services_check check (
  services <@ array['secretariat','sgrfm','sgrh','sep','sepp','senf','sec','speiefg','sempc','sascl','sctic']::text[]
  and (service_emetteur is null or service_emetteur in ('secretariat','sgrfm','sgrh','sep','sepp','senf','sec','speiefg','sempc','sascl','sctic','be','spsg','scc','sqe','sai','spsga'))
  and not (service_emetteur is not null and bureau_emetteur is not null)
);

create or replace function peut_publier_document(d_niveau text, d_region text, d_province text, d_ceb text, d_emetteur uuid, d_cibles text[], d_bureau text, d_service text)
returns boolean language sql stable security definer set search_path = public as $$
  select d_emetteur = auth.uid() and exists (
    select 1 from profiles v
    where v.id = auth.uid()
      and case
        when v.role = 'bureau' then d_niveau = 'ceb' and d_bureau = v.bureau and d_service is null
             and cardinality(d_cibles) > 0 and d_cibles <@ array['ecole', 'ceb', 'dpeppnf', 'dreppnf', 'ministere']::text[]
             and d_region = v.region and d_province = v.province and d_ceb = v.ceb
        when v.role = 'service' then d_niveau = 'dpeppnf' and d_service = v.service and d_bureau is null
             and cardinality(d_cibles) > 0 and d_cibles <@ array['ecole', 'ceb', 'dpeppnf', 'dreppnf', 'ministere']::text[]
             and d_region = v.region and d_province = v.province and d_ceb is null
        when v.role = 'service_reg' then d_niveau = 'dreppnf' and d_service = v.service and d_bureau is null
             and cardinality(d_cibles) > 0 and d_cibles <@ array['ecole', 'ceb', 'dpeppnf', 'dreppnf', 'ministere']::text[]
             and d_region = v.region and d_province is null and d_ceb is null
        when v.role = 'service_min' then d_niveau = 'ministere' and d_service = v.service and d_bureau is null
             and cardinality(d_cibles) > 0 and d_cibles <@ array['ecole', 'ceb', 'dpeppnf', 'dreppnf', 'ministere']::text[]
             and d_region is null and d_province is null and d_ceb is null
        else niveau_reseau(v.role) = d_niveau and d_bureau is null and d_service is null
             and case when rang_niveau(d_niveau) >= 1 then d_region is not null and d_region = v.region else d_region is null end
             and case when rang_niveau(d_niveau) >= 2 then d_province is not null and d_province = v.province else d_province is null end
             and case when rang_niveau(d_niveau) >= 3 then d_ceb is not null and d_ceb = v.ceb else d_ceb is null end
      end
  )
$$;

create or replace function peut_lire_document(d_niveau text, d_region text, d_province text, d_ceb text, d_cibles text[], d_emetteur uuid, d_bureaux text[], d_services text[], d_services_reg text[], d_services_min text[], d_ceb_dest text[], d_province_dest text[], d_region_dest text[])
returns boolean language sql stable security definer set search_path = public as $$
  select d_emetteur = auth.uid() or exists (
    select 1 from profiles v
    where v.id = auth.uid()
      and (
        case
          when v.role = 'bureau' then
            'ceb' = any (d_cibles)
            and (d_region is null or norm_zone(v.region) = norm_zone(d_region))
            and (d_province is null or norm_zone(v.province) = norm_zone(d_province))
            and (d_ceb is null or norm_zone(v.ceb) = norm_zone(d_ceb))
            and (cardinality(d_ceb_dest) = 0 or exists (select 1 from unnest(d_ceb_dest) z where norm_zone(z) = norm_zone(v.ceb)))
            and (cardinality(d_province_dest) = 0 or exists (select 1 from unnest(d_province_dest) z where norm_zone(z) = norm_zone(v.province)))
            and (cardinality(d_region_dest) = 0 or exists (select 1 from unnest(d_region_dest) z where norm_zone(z) = norm_zone(v.region)))
            and (v.bureau = any (d_bureaux) or (v.bureau = 'scr' and cardinality(d_bureaux) = 0))
          when v.role = 'service' then
            'dpeppnf' = any (d_cibles)
            and (d_region is null or norm_zone(v.region) = norm_zone(d_region))
            and (d_province is null or norm_zone(v.province) = norm_zone(d_province))
            and (cardinality(d_province_dest) = 0 or exists (select 1 from unnest(d_province_dest) z where norm_zone(z) = norm_zone(v.province)))
            and (cardinality(d_region_dest) = 0 or exists (select 1 from unnest(d_region_dest) z where norm_zone(z) = norm_zone(v.region)))
            and (v.service = any (d_services) or (v.service = 'secretariat' and cardinality(d_services) = 0))
          when v.role = 'service_reg' then
            'dreppnf' = any (d_cibles)
            and (d_region is null or norm_zone(v.region) = norm_zone(d_region))
            and (cardinality(d_region_dest) = 0 or exists (select 1 from unnest(d_region_dest) z where norm_zone(z) = norm_zone(v.region)))
            and (v.service = any (d_services_reg) or (v.service = 'secretariat' and cardinality(d_services_reg) = 0))
          when v.role = 'service_min' then
            'ministere' = any (d_cibles)
            and (v.service = any (d_services_min) or (v.service = 'scc' and cardinality(d_services_min) = 0))
          else
            niveau_reseau(v.role) is not null
            and niveau_reseau(v.role) = any (d_cibles)
            and (rang_niveau(niveau_reseau(v.role)) < 1 or d_region is null or norm_zone(v.region) = norm_zone(d_region))
            and (rang_niveau(niveau_reseau(v.role)) < 2 or d_province is null or norm_zone(v.province) = norm_zone(d_province))
            and (rang_niveau(niveau_reseau(v.role)) < 3 or d_ceb is null or norm_zone(v.ceb) = norm_zone(d_ceb))
            and (rang_niveau(niveau_reseau(v.role)) < 1 or cardinality(d_region_dest) = 0
                 or exists (select 1 from unnest(d_region_dest) z where norm_zone(z) = norm_zone(v.region)))
            and (rang_niveau(niveau_reseau(v.role)) < 2 or cardinality(d_province_dest) = 0
                 or exists (select 1 from unnest(d_province_dest) z where norm_zone(z) = norm_zone(v.province)))
            and (rang_niveau(niveau_reseau(v.role)) < 3 or cardinality(d_ceb_dest) = 0
                 or exists (select 1 from unnest(d_ceb_dest) z where norm_zone(z) = norm_zone(v.ceb)))
        end
        or (v.role = 'ceb' and d_niveau = 'ceb' and norm_zone(v.ceb) = norm_zone(d_ceb)
            and norm_zone(v.province) = norm_zone(d_province) and norm_zone(v.region) = norm_zone(d_region))
        or (v.role = 'dpeppnf' and d_niveau = 'dpeppnf'
            and norm_zone(v.province) = norm_zone(d_province) and norm_zone(v.region) = norm_zone(d_region))
        or (v.role = 'dreppnf' and d_niveau = 'dreppnf' and norm_zone(v.region) = norm_zone(d_region))
        or (v.role = 'ministere' and d_niveau = 'ministere')
      )
  )
$$;

drop policy if exists "publications : lecture" on circuit_documents;
create policy "publications : lecture" on circuit_documents for select
  using (peut_lire_document(niveau, region, province, ceb, cibles, emetteur_id, bureaux, services, services_reg, services_min, ceb_dest, province_dest, region_dest));
drop function if exists peut_lire_document(text, text, text, text, text[], uuid, text[], text[], text[], text[], text[]);

-- ---------- Liste des CEB : aussi pour les comptes de services (filtres « CEB / provinces / régions concernées ») ----------
create or replace function liste_cebs()
returns table (ceb text, province text, region text, structure text)
language sql stable security definer set search_path = public as $$
  select p.ceb, p.province, p.region, p.structure
  from profiles p, profiles me
  where p.role = 'ceb' and me.id = auth.uid()
    and (
      me.role in ('directeur', 'directeur_adjoint', 'secretaire', 'comptable', 'magasinier', 'cantine', 'enseignant', 'ministere', 'service_min')
      or (me.role in ('dreppnf', 'service_reg') and norm_zone(p.region) = norm_zone(me.region))
      or (me.role in ('dpeppnf', 'service') and norm_zone(p.region) = norm_zone(me.region) and norm_zone(p.province) = norm_zone(me.province))
    )
  order by p.region, p.province, p.ceb
$$;
