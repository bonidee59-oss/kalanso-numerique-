# Matricules des candidats au CEP (version 53)

## Circuit
1. **École** : publie ses candidats au CEP à sa CEB (déjà existant).
2. **CEB** : récupère et **valide** la liste.
3. **Montée** : une liste validée devient lisible par la **DPEPPNF** (sa province), la **DREPPNF** (sa région) et le **ministère**.
4. **Ministère** : menu *Matricules des candidats* →
   - voit l'avancement (listes publiées / validées, par région) et si **tous les candidats sont remontés** ;
   - **génère** un numéro matricule unique par candidat ;
   - **publie** : les listes avec matricules redescendent vers l'école, la CEB, la DPEPPNF et la DREPPNF. Un message est aussi publié dans « Documents ».
5. **DREPPNF / DPEPPNF / CEB / école** : menu *Matricules des candidats* → consulter, exporter (CSV), imprimer. La CEB peut les reporter sur les candidats de l'Espace Examen, l'école sur ses élèves (« Appliquer… »).

## Règles de numérotation
- Format choisi **une seule fois par année** (préfixe, nombre de chiffres, premier numéro) : par défaut `CEP-2026-000001`. Ensuite il est figé.
- Numéros **continus** et ordonnés région → province → CEB → école (le mieux : générer quand tout est remonté).
- **Un candidat ne change jamais de numéro** : si une école corrige et republie sa liste, ses candidats gardent leur matricule (reconnus par l'identifiant de l'élève, sinon nom + prénom + date de naissance) ; seuls les nouveaux candidats reçoivent de nouveaux numéros.
- On peut numéroter **par étapes** : les listes validées plus tard sont numérotées à la suite (« Numéroter les listes restantes »). Les numéros déjà donnés ne bougent pas.
- Rien n'est visible en bas **avant la publication**. Chaque niveau ne voit que sa zone ; seul le ministère peut générer ou publier (le serveur le vérifie).

## Mise en route
1. Supabase → SQL Editor : exécuter `sql/supabase-matricules-cep.sql` (après `supabase-listes.sql`, `supabase-circuit.sql`, `supabase-personnel.sql`), puis relancer `sql/supabase-securite.sql`.
2. Mettre en ligne la nouvelle version, recharger l'application.

## À savoir
- Le ministère, la DREPPNF et la DPEPPNF voient désormais les listes nominatives de candidats **validées** de leur zone (avant, seules l'école et la CEB y avaient accès).
- Les comptes « service » du ministère n'ont pas accès à cette page (seul le compte Ministère génère et publie).
- Le matricule CEP est enregistré dans le champ `matriculeCEP`, distinct du matricule de l'école.
