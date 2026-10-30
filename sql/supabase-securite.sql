-- ============================================================
-- DURCISSEMENT DE LA SÉCURITÉ (déjà appliqué sur le projet « Kal » le 19/10/2026)
-- À exécuter UNE FOIS sur une installation neuve, APRÈS supabase-complet.sql et
-- supabase-personnel.sql. Sans danger si relancé.
-- 1. Chemin de recherche figé sur toutes les fonctions
-- 2. Fonctions SECURITY DEFINER : plus aucun accès sans être connecté
-- 3. Tables : aucun droit pour les visiteurs non connectés ; plus de TRUNCATE
-- 4. Règles RLS réservées aux comptes connectés
-- 5. Une direction d'école ne peut pas changer la zone (région / province / CEB) ni le centre d'un profil
-- ============================================================
alter function public.peut_acceder(text) set search_path = public;
alter function public.cep_cle_zone(text, text, text) set search_path = public;
alter function public.cep_entier(jsonb, text, integer) set search_path = public;
alter function public.profils_ecole_defaut() set search_path = public;
alter function public.niveau_reseau(text) set search_path = public;
alter function public.rang_niveau(text) set search_path = public;
alter function public.norm_zone(text) set search_path = public;
alter function public.cep_rang_validation(text) set search_path = public;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as f
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef
      and p.proname in ('ceb_peut_traiter_liste','est_direction','est_parent','est_personnel_ecole','lire_suivi_liste','liste_cebs','mon_ecole','peut_gerer_profil','peut_lire_document','peut_lire_liste','peut_publier_document','peut_publier_liste_ecole','reseau_ecole_couverte','reseau_ecole_publier','reseau_muter','zone_liste_conforme')
  loop
    execute format('revoke execute on function %s from public, anon', r.f);
    execute format('grant execute on function %s to authenticated, service_role', r.f);
  end loop;
end $$;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;

do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' and roles = '{public}'::name[]
  loop
    execute format('alter policy %I on %I.%I to authenticated', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

create or replace function public.profils_zone_protegee() returns trigger
language plpgsql security definer set search_path = public as $$
declare me profiles;
begin
  if auth.uid() is null then return new; end if;            -- console SQL / service : pas de restriction
  select * into me from profiles where id = auth.uid();
  if me.id is not null and me.role in ('directeur', 'directeur_adjoint') then
    if tg_op = 'INSERT' then
      new.region := me.region; new.province := me.province; new.ceb := me.ceb; new.centre_id := null;
    else
      new.region := old.region; new.province := old.province; new.ceb := old.ceb; new.centre_id := old.centre_id;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.profils_zone_protegee() from public, anon, authenticated;
drop trigger if exists profils_zone_protegee on public.profiles;
create trigger profils_zone_protegee before insert or update on public.profiles
  for each row execute function public.profils_zone_protegee();
