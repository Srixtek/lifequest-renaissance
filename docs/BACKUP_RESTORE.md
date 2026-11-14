# Sauvegarde / restauration

Format `.lqbackup` = ZIP contenant `manifest.json` + `data.json` (dump tables).

Export : Paramètres → Exporter.
Import : aperçu → export de sécurité automatique → remplacement atomique transactionnel.

Limites v0.1 : pas de chiffrement, pas de fusion (merge), un appareil à la fois.
