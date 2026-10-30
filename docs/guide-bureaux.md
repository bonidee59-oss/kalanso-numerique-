# Bureaux de la CEB (version 47)

Les 9 bureaux de la CEB ont chacun leur compte, créé par le CCEB :
Secrétariat (Scr), BGRH, BGRFM, BSE, BEC, BASCL, BEPres, BEPrim, BENF.

## Mise en route (une seule fois)
1. Supabase → SQL Editor → coller **supabase-bureaux.sql** → Run
   (après supabase-complet.sql ; sans danger si relancé).
2. Puis relancer **supabase-securite.sql**.
3. Recharger l'application.

## Créer les comptes (CCEB)
Menu **Publications → Comptes des structures** : en bas, la carte
**Bureaux de la CEB** liste les 9 bureaux. « Créer le compte » demande le nom du
responsable et son e-mail ; un mot de passe est proposé. Un seul compte par bureau.
« Retirer l'accès » supprime le compte du bureau.

## Envoyer et recevoir
- **Bureau → écoles** : « Envoyer un document aux écoles » (tableau de bord ou
  Documents publiés). Le document va à toutes les écoles de la CEB ; un bureau
  ne peut pas écrire à un autre niveau. Les écoles accusent réception, le bureau
  voit les accusés.
- **École → bureau** : en publiant vers la CEB, l'école choisit la *nature du
  document* ; le bureau concerné est coché automatiquement (modifiable, plusieurs
  bureaux possibles) :
  courrier → Scr · personnel → BGRH · finances et matériel → BGRFM ·
  statistiques → BSE · examens → BEC · activités sportives/culturelles → BASCL ·
  préscolaire → BEPres · pédagogie → BEPrim · éducation non formelle → BENF.
- Un bureau ne voit que les documents qui lui sont destinés. Le Secrétariat
  reçoit aussi le courrier adressé à la CEB sans bureau précis.
- Le CCEB voit tout : documents reçus par la CEB et documents de ses bureaux.

Avant d'avoir exécuté le SQL, les écoles peuvent toujours publier (sans bureau).
