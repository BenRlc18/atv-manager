# ATVM Connect : règles R8 (obfuscation de la version publiée)

# Noms de fichiers sources masqués, numéros de ligne gardés pour lire un plantage avec mapping.txt
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# dadb (client ADB local) : bibliothèque gardée telle quelle
-keep class dadb.** { *; }
-dontwarn dadb.**

# Dépendances optionnelles d'OkHttp, absentes sur Android
-dontwarn org.bouncycastle.**
-dontwarn org.conscrypt.**
-dontwarn org.openjsse.**
