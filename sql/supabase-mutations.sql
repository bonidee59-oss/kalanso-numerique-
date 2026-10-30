-- ============================================================
-- VERSION 52 — MUTATIONS VERS UNE AUTRE ZONE (CEB, province, région)
-- À exécuter UNE FOIS dans Supabase → SQL Editor, APRÈS supabase-personnel.sql. Sans danger si relancé.
--
-- Avant : une mutation n'était acceptée que si la zone de celui qui la saisit couvrait l'école de départ
--         ET l'école d'arrivée → impossible d'envoyer un enseignant vers une autre CEB/province/région.
-- Maintenant : la zone de DÉPART décide (CEB : ses agents ; DPEPPNF : sa province ; DREPPNF : sa région ;
--         ministère : tout le pays). L'école d'arrivée peut être n'importe où : l'agent apparaît alors
--         AUTOMATIQUEMENT dans la zone d'arrivée (liste du personnel, arrivées, mouvements), et la
--         mutation est annoncée en temps réel aux comptes concernés.
-- ============================================================

create or replace function reseau_muter(p_personnel uuid, p_vers uuid, p_date date, p_motif text)
returns reseau_mouvements
language plpgsql security definer set search_path = public as $$
declare a reseau_ecoles; b reseau_ecoles; p reseau_personnel; t text; m reseau_mouvements;
begin
  select * into p from reseau_personnel where id = p_personnel for update;
  if not found then raise exception 'Agent introuvable'; end if;
  select * into a from reseau_ecoles where id = p.ecole_id;
  select * into b from reseau_ecoles where id = p_vers;
  if b.id is null then raise exception 'École d''arrivée introuvable'; end if;
  if a.id = b.id then raise exception 'L''agent est déjà dans cette école'; end if;
  -- Seule la zone de DÉPART de l'agent peut décider sa mutation (l'arrivée peut être dans toute zone)
  if not cep_zone_couverte(a.region, a.province, a.ceb) then
    raise exception 'Mutation refusée : l''agent n''est pas dans votre zone (row-level security)';
  end if;
  t := case when norm_zone(a.region) is distinct from norm_zone(b.region) then 'region'
            when norm_zone(a.province) is distinct from norm_zone(b.province) then 'province'
            when norm_zone(a.ceb) is distinct from norm_zone(b.ceb) then 'ceb' else 'ecole' end;
  update reseau_personnel set ecole_id = b.id, classe = null where id = p.id;
  insert into reseau_mouvements (personnel_id, agent, date_effet, type, de_ecole, vers_ecole, de_nom, vers_nom,
    de_region, de_province, de_ceb, vers_region, vers_province, vers_ceb, motif)
  values (p.id, btrim(p.nom || ' ' || coalesce(p.prenom, '')), coalesce(p_date, current_date), t, a.id, b.id, a.nom, b.nom,
    a.region, a.province, a.ceb, b.region, b.province, b.ceb, nullif(btrim(coalesce(p_motif, '')), ''))
  returning * into m;
  return m;
end $$;
revoke execute on function reseau_muter(uuid, uuid, date, text) from public, anon;
grant execute on function reseau_muter(uuid, uuid, date, text) to authenticated;

-- Recherche de l'école d'arrivée dans tout le pays (nom, CEB, province ou région) — comptes du réseau uniquement.
create or replace function reseau_ecoles_recherche(p_q text)
returns table (id uuid, nom text, statut text, region text, province text, ceb text)
language sql stable security definer set search_path = public as $$
  select e.id, e.nom, e.statut, e.region, e.province, e.ceb
  from reseau_ecoles e
  where exists (select 1 from profiles v where v.id = auth.uid() and v.role in ('ceb', 'dpeppnf', 'dreppnf', 'ministere'))
    and (norm_zone(p_q) is null
         or norm_zone(coalesce(e.nom, '') || coalesce(e.ceb, '') || coalesce(e.province, '') || coalesce(e.region, '')) like '%' || norm_zone(p_q) || '%')
  order by e.region, e.province, e.ceb, e.nom
  limit 60
$$;
revoke execute on function reseau_ecoles_recherche(text) from public, anon;
grant execute on function reseau_ecoles_recherche(text) to authenticated;

-- Annonce en temps réel des mouvements aux comptes qui peuvent les lire (zone de départ, zone d'arrivée, école concernée).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reseau_mouvements') then
    alter publication supabase_realtime add table public.reseau_mouvements;
  end if;
end $$;
