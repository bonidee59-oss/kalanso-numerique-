# Scanner de documents (version 54)

Menu **Publications → Scanner un document** (disponible du ministère jusqu'aux écoles : école, CEB, DPEPPNF, DREPPNF, ministère, ainsi que les bureaux et services). Aucun SQL à exécuter.

## Utiliser
1. **Document simple** (un document, une ou plusieurs pages) ou **Dossier complet** (plusieurs documents : acte de naissance, certificat… regroupés dans un seul PDF, avec une page de sommaire).
2. Donnez un **titre** (obligatoire), le type de document et, si on vous l'a demandé, la **référence de la demande**.
3. **📷 Photographier** (appareil photo du téléphone) ou **🖼 Importer des images** (galerie). Chaque page peut être **pivotée** (↻), **rognée** (✂), **déplacée** (◀ ▶) ou **supprimée** (✕).
4. **Aspect** : *Document (noir et blanc)* efface les ombres et blanchit le papier comme un vrai scanner (recommandé) ; *Niveaux de gris* ; *Couleur* (tampons, photos).
5. **Qualité / taille** : *Léger* (messagerie), *Standard*, *Haute* (impression).
6. Trois actions : **Aperçu PDF**, **Partager / Enregistrer** (WhatsApp, e-mail, fichiers…), **Envoyer**.

## Envoyer
« Envoyer » ouvre le formulaire habituel des documents publiés, déjà rempli (objet, type, référence, PDF joint) : choisissez les destinataires (les niveaux, bureaux ou services concernés) puis **Publier**.
- La taille d'une pièce jointe est limitée à 1,5 Mo : la qualité baisse automatiquement par paliers pour que tout tienne.
- Un dossier encore trop gros est **découpé en parties** (« partie 1/3 »…), envoyées l'une après l'autre ; les destinataires de la partie 1 sont repris pour les suivantes.
- Après l'envoi, l'application propose de supprimer le brouillon de l'appareil.

## À savoir
- Tout se fait sur l'appareil, **sans internet** jusqu'à l'envoi. Les brouillons (photos comprises) restent dans l'appareil et se retrouvent dans « Brouillons sur cet appareil » ; effacer les données du navigateur les supprime.
- **Application Android (APK)** : la permission « caméra » est ajoutée à la construction (fichier `build.yml` mis à jour : remplacez-le dans GitHub). Sans elle, seul l'import depuis la galerie fonctionne.
- **Windows** : pas de caméra intégrée à l'écran de capture ; le bouton « Photographier » ouvre le sélecteur de fichiers (une photo ou un scan existant).
- Les PDF sont faits d'images : le texte n'est pas sélectionnable (pas de reconnaissance de caractères).
- Pas de redressement automatique de la perspective : cadrez la feuille bien à plat, de face, avec un bon éclairage, puis rognez si besoin.
