-- ============================================================
-- VERSION 51 — FIABILITÉ DE LA SYNCHRONISATION
-- À exécuter UNE FOIS dans Supabase → SQL Editor (sans danger si répété).
--
-- 1) L'horodatage « updated_at » est désormais fixé par le SERVEUR (now()) à chaque
--    écriture, au lieu de l'horloge du téléphone. Un téléphone mal réglé ne peut plus
--    faire « sauter » des mises à jour lors des synchronisations incrémentales.
-- 2) Index pour le téléchargement par pages des données de l'école.
-- 3) Fonction ping() pour le contact quotidien anti-pause (voir bas du fichier).
-- ============================================================

create or replace function public.app_data_horloge() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.app_data_horloge() from public, anon, authenticated;

drop trigger if exists app_data_horloge on public.app_data;
create trigger app_data_horloge before insert or update on public.app_data
  for each row execute function public.app_data_horloge();

create index if not exists app_data_synchro_idx on public.app_data (ecole_id, store, updated_at, uuid);

-- 3) Contact quotidien (GitHub Actions) : une requête minuscule qui prouve l'activité du projet
--    et évite la mise en pause du plan gratuit après 7 jours d'inactivité.
create or replace function public.ping() returns timestamptz
language sql stable set search_path = public as $$ select now() $$;
grant execute on function public.ping() to anon, authenticated;
