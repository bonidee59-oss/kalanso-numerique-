-- ============================================================
-- SUIVI DU PERSONNEL DU RÉSEAU (écoles publiques et privées)
-- À exécuter UNE FOIS dans Supabase → SQL Editor, APRÈS supabase-complet.sql
-- (utilise norm_zone, cep_zone_couverte, cep_zone_ceb_exacte). Sans danger si relancé.
--
-- Qui voit quoi : chaque niveau voit SA zone (ministère : tout ; DREPPNF : sa région ;
-- DPEPPNF : sa province ; CEB : sa circonscription).
-- Qui saisit : la CEB crée les écoles et le personnel de sa circonscription.
-- Mutations : un compte réseau ne peut muter un agent que si sa zone couvre l'école de
-- départ ET l'école d'arrivée (CEB : dans sa CEB ; DPEPPNF : dans sa province ;
-- DREPPNF : dans sa région ; ministère : partout). Chaque mutation est journalisée.
-- ============================================================

create table if not exists reseau_ecoles (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  statut text not null default 'Publique' check (statut in ('Publique', 'Privée')),
  region text not null, province text not null, ceb text not null,
  created_at timestamptz not null default now()
);

create table if not exists reseau_personnel (
  id uuid primary key default gen_random_uuid(),
  nom text not null, prenom text, matricule text, fonction text,
  ecole_id uuid not null references reseau_ecoles(id),
  actif boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists reseau_personnel_ecole_idx on reseau_personnel (ecole_id);

-- Remontée automatique depuis l'école : lien avec le compte de l'école, l'enseignant local et sa classe.
alter table reseau_ecoles add column if not exists ecole_ref uuid;
create unique index if not exists reseau_ecoles_ref_idx on reseau_ecoles (ecole_ref) where ecole_ref is not null;
alter table reseau_personnel add column if not exists source_uuid uuid;
alter table reseau_personnel add column if not exists classe text;
create unique index if not exists reseau_personnel_source_idx on reseau_personnel (source_uuid) where source_uuid is not null;

create table if not exists reseau_mouvements (
  id uuid primary key default gen_random_uuid(),
  personnel_id uuid not null references reseau_personnel(id),
  agent text not null,
  date_effet date not null default current_date,
  type text not null check (type in ('ecole', 'ceb', 'province', 'region')),
  de_ecole uuid references reseau_ecoles(id), vers_ecole uuid references reseau_ecoles(id),
  de_nom text, vers_nom text,
  de_region text, de_province text, de_ceb text,
  vers_region text, vers_province text, vers_ceb text,
  motif text, auteur uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create or replace function reseau_ecole_couverte(p_ecole uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from reseau_ecoles e where e.id = p_ecole and cep_zone_couverte(e.region, e.province, e.ceb))
$$;

alter table reseau_ecoles enable row level security;
alter table reseau_personnel enable row level security;
alter table reseau_mouvements enable row level security;

-- La direction d'une école voit SON école, ses agents et les mouvements qui la concernent (jamais les autres écoles).
create or replace function reseau_mon_ecole(p_ecole uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_ecole is not null and exists (
    select 1 from profiles v join reseau_ecoles e on e.ecole_ref = v.ecole_id
    where v.id = auth.uid() and v.role in ('directeur', 'directeur_adjoint', 'secretaire') and e.id = p_ecole)
$$;
revoke execute on function reseau_mon_ecole(uuid) from public, anon;
grant execute on function reseau_mon_ecole(uuid) to authenticated;

drop policy if exists "res_ecoles lecture" on reseau_ecoles;
drop policy if exists "res_ecoles ecriture" on reseau_ecoles;
create policy "res_ecoles lecture" on reseau_ecoles for select using (cep_zone_couverte(region, province, ceb) or reseau_mon_ecole(id));
create policy "res_ecoles ecriture" on reseau_ecoles for all
  using (cep_zone_ceb_exacte(region, province, ceb)) with check (cep_zone_ceb_exacte(region, province, ceb));

drop policy if exists "res_pers lecture" on reseau_personnel;
drop policy if exists "res_pers ecriture" on reseau_personnel;
create policy "res_pers lecture" on reseau_personnel for select using (reseau_ecole_couverte(ecole_id) or reseau_mon_ecole(ecole_id));
-- La CEB gère ses agents ; le changement d'école passe uniquement par reseau_muter().
create policy "res_pers ecriture" on reseau_personnel for all
  using (exists (select 1 from reseau_ecoles e where e.id = ecole_id and cep_zone_ceb_exacte(e.region, e.province, e.ceb)))
  with check (exists (select 1 from reseau_ecoles e where e.id = ecole_id and cep_zone_ceb_exacte(e.region, e.province, e.ceb)));

drop policy if exists "res_mvt lecture" on reseau_mouvements;
create policy "res_mvt lecture" on reseau_mouvements for select
  using (cep_zone_couverte(de_region, de_province, de_ceb) or cep_zone_couverte(vers_region, vers_province, vers_ceb)
         or reseau_mon_ecole(de_ecole) or reseau_mon_ecole(vers_ecole));

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
  if not (cep_zone_couverte(a.region, a.province, a.ceb) and cep_zone_couverte(b.region, b.province, b.ceb)) then
    raise exception 'Mutation refusée : droits insuffisants pour cette zone (row-level security)';
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
grant execute on function reseau_muter(uuid, uuid, date, text) to authenticated;

-- ------------------------------------------------------------
-- REMONTÉE AUTOMATIQUE : la direction de l'école envoie ses enseignants et la classe
-- qu'ils tiennent. L'application l'appelle seule à chaque affectation (rien à faire).
-- p_agents = [{ "uuid": "...", "nom": "...", "prenom": "...", "matricule": "...", "fonction": "...", "classe": "CM1" }]
-- Jamais transmis : téléphone, e-mail, photo, observations.
-- Un agent déjà muté vers une autre école par la hiérarchie n'est PAS ramené dans l'école d'origine.
-- ------------------------------------------------------------
create or replace function reseau_ecole_publier(p_nom text, p_statut text, p_agents jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare me profiles; e reseau_ecoles; a jsonb; cur reseau_personnel; sid uuid;
        ids uuid[] := array[]::uuid[]; n_new int := 0; n_maj int := 0; n_ret int := 0; st text;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null or me.role not in ('directeur', 'directeur_adjoint', 'secretaire') or me.ecole_id is null then
    raise exception 'Réservé à la direction de l''école (refus)';
  end if;
  if norm_zone(me.region) is null or norm_zone(me.province) is null or norm_zone(me.ceb) is null then
    raise exception 'Rattachez d''abord l''école à sa CEB (région, province, CEB du compte)';
  end if;
  if p_agents is null or jsonb_typeof(p_agents) <> 'array' then raise exception 'Liste d''agents invalide'; end if;
  if nullif(btrim(coalesce(p_nom, '')), '') is null then raise exception 'Nom de l''école manquant'; end if;
  st := case when p_statut = 'Privée' then 'Privée' else 'Publique' end;

  select * into e from reseau_ecoles where ecole_ref = me.ecole_id;
  if not found then
    -- l'école a peut-être déjà été créée par la CEB : on la rattache au lieu d'en créer une seconde
    select * into e from reseau_ecoles
      where ecole_ref is null and cep_cle_zone(region, province, ceb) = cep_cle_zone(me.region, me.province, me.ceb)
        and norm_zone(nom) = norm_zone(p_nom) limit 1;
    if found then update reseau_ecoles set ecole_ref = me.ecole_id where id = e.id;
    else insert into reseau_ecoles (nom, statut, region, province, ceb, ecole_ref)
         values (btrim(p_nom), st, me.region, me.province, me.ceb, me.ecole_id) returning * into e;
    end if;
  end if;
  update reseau_ecoles set nom = btrim(p_nom), statut = st, region = me.region, province = me.province, ceb = me.ceb where id = e.id;

  for a in select * from jsonb_array_elements(p_agents) loop
    sid := (a->>'uuid')::uuid;
    continue when sid is null or nullif(btrim(coalesce(a->>'nom', '')), '') is null;
    ids := ids || sid;
    select * into cur from reseau_personnel where source_uuid = sid;
    if not found then
      insert into reseau_personnel (nom, prenom, matricule, fonction, classe, ecole_id, source_uuid)
      values (btrim(a->>'nom'), a->>'prenom', a->>'matricule', a->>'fonction', nullif(a->>'classe', ''), e.id, sid);
      n_new := n_new + 1;
    elsif cur.ecole_id = e.id then
      update reseau_personnel set nom = btrim(a->>'nom'), prenom = a->>'prenom', matricule = a->>'matricule',
        fonction = a->>'fonction', classe = nullif(a->>'classe', ''), actif = true where id = cur.id;
      n_maj := n_maj + 1;
    end if;
  end loop;

  if array_length(ids, 1) > 0 then
    update reseau_personnel set actif = false
      where ecole_id = e.id and source_uuid is not null and actif and not (source_uuid = any(ids));
    get diagnostics n_ret = row_count;
  end if;
  return jsonb_build_object('ecole_id', e.id, 'nouveaux', n_new, 'mis_a_jour', n_maj, 'retires', n_ret);
end $$;
grant execute on function reseau_ecole_publier(text, text, jsonb) to authenticated;
