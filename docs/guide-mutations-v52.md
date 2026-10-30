# Mutations vers une autre zone (version 52)

## Le problème
Une mutation n'était acceptée que si la zone de celui qui la saisit couvrait l'école de départ **et** l'école d'arrivée,
et la liste d'arrivée ne montrait que les écoles de sa propre zone. Impossible d'envoyer un enseignant vers une autre
CEB, province ou région ; et la zone d'arrivée n'était pas prévenue.

## Ce qui change
- **La zone de départ décide.** CEB : ses agents · DPEPPNF : sa province · DREPPNF : sa région · ministère : tout le pays.
- **L'école d'arrivée peut être n'importe où** : le formulaire « Muter » (et « Enregistrer un mouvement ») cherche dans tout le pays (nom d'école, CEB, province ou région).
- **L'agent apparaît automatiquement dans la zone d'arrivée** (liste « Personnel », écoles, compteurs, « Mouvements »), avec l'étiquette verte *Arrivé(e) de [école] ([CEB]) · date* pendant 60 jours.
- **Annonce en temps réel** : les comptes concernés reçoivent un message (« Arrivée dans votre zone : … », « Départ de votre zone : … ») et leur liste se met à jour sans rien faire. La direction de l'école d'arrivée est aussi prévenue.
- Chaque mutation reste journalisée (qui, quand, de quelle école vers quelle école).

## Mise en route
1. Supabase → SQL Editor : exécuter `sql/supabase-mutations.sql` (après `supabase-personnel.sql`).
2. Mettre en ligne la nouvelle version, recharger l'application.

## À savoir
- Un compte CEB peut désormais envoyer un de SES agents vers n'importe quelle école du pays : si vous voulez réserver les mutations hors CEB aux DPEPPNF/DREPPNF, dites-le.
- La liste de l'école d'arrivée (côté enseignants locaux de l'école) n'est pas modifiée : l'agent apparaît dans le suivi du personnel du réseau et dans la page « Personnel et mouvements » de la direction de l'école d'arrivée.
