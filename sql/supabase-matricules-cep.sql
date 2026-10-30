-- ============================================================
-- VERSION 53 — MATRICULES DES CANDIDATS AU CEP (créés par le ministère)
-- À exécuter UNE FOIS dans Supabase → SQL Editor, APRÈS supabase-listes.sql,
-- supabase-circuit.sql et supabase-personnel.sql, puis relancer supabase-securite.sql.
-- Sans danger si exécuté plusieurs fois.
--
-- Circuit :
--  1. L'école publie ses candidats au CEP à sa CEB ; la CEB les VALIDE.
--  2. Une liste validée « monte » : la DPEPPNF et la DREPPNF de la zone, et le ministère, peuvent la lire.
--  3. Le ministère GÉNÈRE un numéro matricule unique par candidat (même format partout, numéros continus,
--     ordonnés par région → province → CEB → école). Un candidat déjà numéroté (liste corrigée et
--     republiée) GARDE son numéro. Le format est fixé à la première génération de l'année.
--  4. Le ministère PUBLIE : chaque liste, avec ses matricules, redescend vers l'école, la CEB, la DPEPPNF
--     et la DREPPNF concernées (chacun ne voit que sa zone). Rien n'est visible en bas avant la publication.
-- Les numéros ne sont jamais modifiables par un client : seul le ministère, par les fonctions ci-dessous.
-- ============================================================

-- Clé d'identification d'un candidat entre deux versions d'une liste (uuid de l'élève, sinon nom+prénom+naissance)
create or replace function cep_cle_candidat(c jsonb) returns text
language sql stable set search_path = public as $$
  select coalesce(nullif(c ->> 'eleveUuid', ''),
    coalesce(norm_zone(c ->> 'nom'), '') || '|' || coalesce(norm_zone(c ->> 'prenom'), '') || '|' || coalesce(c ->> 'dateNaissance', ''))
$$;

-- Format et compteur de la numérotation, par année (un seul format par année)
create table if not exists cep_matricule_series (
  annee text primary key,
  prefixe text not null check (prefixe ~ '^[A-Za-z0-9-]{0,16}$'),
  largeur int not null check (largeur between 4 and 9),
  prochain bigint not null check (prochain >= 1),
  maj_le timestamptz not null default now()
);

-- Matricules d'une liste : tableau aligné, dans le même ordre, sur la liste des candidats (listes_eleves.data)
create table if not exists cep_matricules (
  liste_id uuid primary key references listes_eleves(id) on delete cascade,
  annee text not null,
  ecole_id uuid not null,
  ecole_nom text not null default '',
  region text not null,
  province text not null,
  ceb text not null,
  nb_candidats int not null,
  nb_nouveaux int not null default 0,
  matricules jsonb not null check (jsonb_typeof(matricules) = 'array'),
  genere_par uuid default auth.uid(),
  genere_nom text,
  genere_le timestamptz not null default now(),
  publie_le timestamptz,
  check (jsonb_array_length(matricules) = nb_candidats)
);
create index if not exists cep_matricules_zone_idx on cep_matricules (annee, region, province, ceb);
create index if not exists cep_matricules_ecole_idx on cep_matricules (ecole_id, annee);

alter table cep_matricule_series enable row level security;
alter table cep_matricules enable row level security;
revoke all on cep_matricule_series from anon, authenticated;
revoke all on cep_matricules from anon;
revoke insert, update, delete, truncate, references, trigger on cep_matricules from authenticated;

-- ---------------- Lecture ----------------
-- Matricules : le ministère toujours ; les autres niveaux seulement APRÈS publication, et chacun pour sa zone.
create or replace function cep_peut_lire_matricules(m_ecole uuid, m_region text, m_province text, m_ceb text, m_publie timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles v where v.id = auth.uid() and (
    v.role = 'ministere'
    or (m_publie is not null and (
         (v.role in ('directeur', 'directeur_adjoint', 'secretaire') and v.ecole_id is not null and v.ecole_id = m_ecole)
      or (v.role = 'ceb' and norm_zone(v.region) = norm_zone(m_region) and norm_zone(v.province) = norm_zone(m_province) and norm_zone(v.ceb) = norm_zone(m_ceb))
      or (v.role = 'dpeppnf' and norm_zone(v.region) = norm_zone(m_region) and norm_zone(v.province) = norm_zone(m_province))
      or (v.role = 'dreppnf' and norm_zone(v.region) = norm_zone(m_region))))
  ))
$$;
drop policy if exists "matricules : lecture" on cep_matricules;
create policy "matricules : lecture" on cep_matricules for select to authenticated
  using (cep_peut_lire_matricules(ecole_id, region, province, ceb, publie_le));

-- Listes de candidats VALIDÉES par la CEB : lisibles aussi par la DPEPPNF (sa province), la DREPPNF (sa région)
-- et le ministère (tout le pays). Une liste non validée reste visible de l'école et de la CEB seulement.
create or replace function cep_peut_lire_liste_haut(l_id uuid, l_type text, l_region text, l_province text)
returns boolean language sql stable security definer set search_path = public as $$
  select l_type = 'cep'
    and exists (select 1 from listes_eleves_suivi s where s.liste_id = l_id and s.statut = 'validee')
    and exists (select 1 from profiles v where v.id = auth.uid() and (
      v.role = 'ministere'
      or (v.role = 'dreppnf' and norm_zone(v.region) = norm_zone(l_region))
      or (v.role = 'dpeppnf' and norm_zone(v.region) = norm_zone(l_region) and norm_zone(v.province) = norm_zone(l_province))))
$$;
drop policy if exists "listes : lecture hiérarchie" on listes_eleves;
create policy "listes : lecture hiérarchie" on listes_eleves for select to authenticated
  using (cep_peut_lire_liste_haut(id, type, region, province));
drop policy if exists "suivi : lecture hiérarchie" on listes_eleves_suivi;
create policy "suivi : lecture hiérarchie" on listes_eleves_suivi for select to authenticated
  using (exists (select 1 from listes_eleves l where l.id = liste_id and cep_peut_lire_liste_haut(l.id, l.type, l.region, l.province)));

-- ---------------- Années disponibles (ministère) ----------------
create or replace function cep_matricules_annees() returns text[]
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'ministere') then raise exception 'Réservé au ministère'; end if;
  return coalesce((select array_agg(a order by a desc) from (select distinct annee as a from listes_eleves where type = 'cep') t), '{}');
end $$;

-- ---------------- État de la remontée (ministère) ----------------
create or replace function cep_matricules_etat(p_annee text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'ministere') then raise exception 'Réservé au ministère'; end if;
  with dern as (
    select distinct on (l.ecole_id) l.id, l.region, l.effectif,
           coalesce((select s.statut from listes_eleves_suivi s where s.liste_id = l.id), 'publiee') as statut,
           (m.liste_id is not null) as numerote, (m.publie_le is not null) as publie
    from listes_eleves l left join cep_matricules m on m.liste_id = l.id
    where l.type = 'cep' and l.annee = p_annee
    order by l.ecole_id, l.version desc),
  rg as (select region from dern union select region from reseau_ecoles where region is not null),
  ec as (select norm_zone(region) as k, count(*) as n from reseau_ecoles group by 1),
  par_region as (
    select rg.region,
      coalesce((select n from ec where k = norm_zone(rg.region)), 0) as ecoles_reseau,
      (select count(*) from dern d where d.region = rg.region) as listes,
      (select count(*) from dern d where d.region = rg.region and d.statut = 'validee') as validees,
      (select count(*) from dern d where d.region = rg.region and d.statut = 'a_corriger') as a_corriger,
      coalesce((select sum(effectif) from dern d where d.region = rg.region), 0) as candidats,
      coalesce((select sum(effectif) from dern d where d.region = rg.region and d.statut = 'validee'), 0) as candidats_valides,
      coalesce((select sum(effectif) from dern d where d.region = rg.region and d.numerote), 0) as numerotes,
      coalesce((select sum(effectif) from dern d where d.region = rg.region and d.publie), 0) as publies
    from rg)
  select jsonb_build_object(
    'annee', p_annee,
    'regions', coalesce((select jsonb_agg(to_jsonb(p) order by p.region) from par_region p), '[]'::jsonb),
    'serie', (select to_jsonb(s) from cep_matricule_series s where s.annee = p_annee))
  into r;
  return r;
end $$;

-- ---------------- Génération des matricules (ministère) ----------------
-- À appeler en boucle tant que « reste » > 0 (traitement par paquets de listes, pour rester rapide).
create or replace function cep_matricules_generer(p_annee text, p_prefixe text default null, p_largeur int default 6, p_debut bigint default 1, p_max int default 150)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v profiles; s cep_matricule_series; l record; o record;
  anciens jsonb; sortie jsonb; elem jsonb; k text; mat text;
  nb_listes int := 0; nb_cand int := 0; nb_nouveaux int := 0; nb_l_nouveaux int; reste int; i int; n int;
begin
  select * into v from profiles where id = auth.uid();
  if v.id is null or v.role <> 'ministere' then raise exception 'Réservé au ministère'; end if;
  if p_annee is null or btrim(p_annee) = '' then raise exception 'Année manquante'; end if;
  perform pg_advisory_xact_lock(hashtext('cep_matricules:' || p_annee));

  select * into s from cep_matricule_series where annee = p_annee for update;
  if not found then
    if p_prefixe is null or p_prefixe !~ '^[A-Za-z0-9-]{0,16}$' then raise exception 'Préfixe invalide (lettres, chiffres et tirets, 16 caractères au plus)'; end if;
    if p_largeur is null or p_largeur < 4 or p_largeur > 9 then raise exception 'Le numéro doit avoir entre 4 et 9 chiffres'; end if;
    if p_debut is null or p_debut < 1 then raise exception 'Le premier numéro doit être au moins 1'; end if;
    insert into cep_matricule_series (annee, prefixe, largeur, prochain) values (p_annee, p_prefixe, p_largeur, p_debut) returning * into s;
  end if;

  for l in
    select x.* from (
        select distinct on (li.ecole_id) li.id, li.ecole_id, li.region, li.province, li.ceb, li.ecole_nom, li.version, li.data
        from listes_eleves li where li.type = 'cep' and li.annee = p_annee
        order by li.ecole_id, li.version desc) x
      join listes_eleves_suivi su on su.liste_id = x.id and su.statut = 'validee'
    where not exists (select 1 from cep_matricules m where m.liste_id = x.id)
    order by x.region, x.province, x.ceb, x.ecole_nom, x.id
    limit greatest(1, least(coalesce(p_max, 150), 400))
  loop
    -- numéros déjà attribués à cette école (versions précédentes de sa liste) : un candidat ne change jamais de numéro
    anciens := '{}'::jsonb;
    for o in
      select li2.data as d, m.matricules as mats
      from listes_eleves li2 join cep_matricules m on m.liste_id = li2.id
      where li2.ecole_id = l.ecole_id and li2.annee = p_annee and li2.type = 'cep' and li2.version < l.version
      order by li2.version asc
    loop
      anciens := anciens || coalesce((
        select jsonb_object_agg(cep_cle_candidat(e.value), mm.value)
        from jsonb_array_elements(o.d) with ordinality e(value, n)
        join jsonb_array_elements(o.mats) with ordinality mm(value, n) on mm.n = e.n), '{}'::jsonb);
    end loop;

    sortie := '[]'::jsonb; nb_l_nouveaux := 0; n := jsonb_array_length(l.data);
    for i in 0 .. n - 1 loop
      elem := l.data -> i;
      k := cep_cle_candidat(elem);
      if anciens ? k then
        sortie := sortie || jsonb_build_array(anciens -> k);
      else
        if s.prochain >= power(10, s.largeur)::bigint then raise exception 'Numérotation épuisée : augmentez le nombre de chiffres du matricule.'; end if;
        mat := s.prefixe || lpad(s.prochain::text, s.largeur, '0');
        s.prochain := s.prochain + 1; nb_l_nouveaux := nb_l_nouveaux + 1;
        sortie := sortie || jsonb_build_array(mat);
      end if;
    end loop;

    insert into cep_matricules (liste_id, annee, ecole_id, ecole_nom, region, province, ceb, nb_candidats, nb_nouveaux, matricules, genere_nom)
    values (l.id, p_annee, l.ecole_id, l.ecole_nom, l.region, l.province, l.ceb, n, nb_l_nouveaux, sortie, v.nom);
    nb_listes := nb_listes + 1; nb_cand := nb_cand + n; nb_nouveaux := nb_nouveaux + nb_l_nouveaux;
  end loop;

  update cep_matricule_series set prochain = s.prochain, maj_le = now() where annee = p_annee;

  select count(*) into reste from (
    select distinct on (li.ecole_id) li.id from listes_eleves li where li.type = 'cep' and li.annee = p_annee order by li.ecole_id, li.version desc) x
    join listes_eleves_suivi su on su.liste_id = x.id and su.statut = 'validee'
    where not exists (select 1 from cep_matricules m where m.liste_id = x.id);

  return jsonb_build_object('listes', nb_listes, 'candidats', nb_cand, 'nouveaux', nb_nouveaux, 'reste', reste,
                            'prochain', s.prochain, 'prefixe', s.prefixe, 'largeur', s.largeur);
end $$;

-- ---------------- Publication : les listes avec matricules redescendent (ministère) ----------------
create or replace function cep_matricules_publier(p_annee text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare nb_l int; nb_c bigint; non_num int;
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'ministere') then raise exception 'Réservé au ministère'; end if;
  perform pg_advisory_xact_lock(hashtext('cep_matricules:' || p_annee));
  with maj as (update cep_matricules set publie_le = now() where annee = p_annee and publie_le is null returning nb_candidats)
  select count(*), coalesce(sum(nb_candidats), 0) into nb_l, nb_c from maj;
  select count(*) into non_num from (
    select distinct on (li.ecole_id) li.id from listes_eleves li where li.type = 'cep' and li.annee = p_annee order by li.ecole_id, li.version desc) x
    join listes_eleves_suivi su on su.liste_id = x.id and su.statut = 'validee'
    where not exists (select 1 from cep_matricules m where m.liste_id = x.id);
  return jsonb_build_object('publiees', nb_l, 'candidats', nb_c, 'non_numerotees', non_num);
end $$;

revoke execute on function cep_cle_candidat(jsonb) from public, anon;
revoke execute on function cep_peut_lire_matricules(uuid, text, text, text, timestamptz) from public, anon;
revoke execute on function cep_peut_lire_liste_haut(uuid, text, text, text) from public, anon;
revoke execute on function cep_matricules_annees() from public, anon;
revoke execute on function cep_matricules_etat(text) from public, anon;
revoke execute on function cep_matricules_generer(text, text, int, bigint, int) from public, anon;
revoke execute on function cep_matricules_publier(text) from public, anon;
grant execute on function cep_cle_candidat(jsonb), cep_peut_lire_matricules(uuid, text, text, text, timestamptz),
  cep_peut_lire_liste_haut(uuid, text, text, text), cep_matricules_annees(), cep_matricules_etat(text),
  cep_matricules_generer(text, text, int, bigint, int), cep_matricules_publier(text) to authenticated;
