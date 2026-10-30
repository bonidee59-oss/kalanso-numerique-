-- ============================================================
-- Espace Examen : à exécuter UNE FOIS dans Supabase -> SQL Editor
-- (projet déjà installé). Réservé à la direction et au secrétariat :
-- les enseignants, comptables, etc. ne voient pas les données d'examen.
-- Sans danger si exécuté plusieurs fois.
-- ============================================================
-- Aucun compte du réseau (CEB, DPEPPNF, DREPPNF, ministère) ni parent ne doit
-- lire les données de l'école : seul le personnel de l'école y a accès.
create or replace function est_personnel_ecole() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid()
      and role in ('directeur', 'directeur_adjoint', 'secretaire', 'comptable', 'magasinier', 'cantine', 'enseignant')
  )
$$;

create or replace function peut_acceder(store_name text)
returns boolean
language sql
stable
as $$
  select case
    when store_name = 'cahierBord' then
      exists (select 1 from profiles where id = auth.uid() and role in ('directeur', 'directeur_adjoint'))
    when store_name in ('examSessions', 'examCentres', 'examJurys', 'examCandidats', 'examNotes', 'examRemontees') then
      exists (select 1 from profiles where id = auth.uid() and role in ('directeur', 'directeur_adjoint', 'secretaire'))
    when store_name in ('finances', 'cotisations') then
      exists (select 1 from profiles where id = auth.uid() and role in ('directeur', 'directeur_adjoint', 'comptable'))
    else
      est_personnel_ecole()
  end;
$$;
