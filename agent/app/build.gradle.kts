plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Signature de la version publiée : fournie par la CI (secrets GitHub), jamais stockée dans le dépôt
val keystorePath: String? = System.getenv("ATVM_KEYSTORE")
val keystorePassword: String? = System.getenv("ATVM_KEYSTORE_PASSWORD")

android {
    namespace = "io.github.benrlc18.atvmconnect"
    compileSdk = 34

    defaultConfig {
        applicationId = "io.github.benrlc18.atvmconnect"
        minSdk = 26
        targetSdk = 33
        versionCode = (System.getenv("ATVM_VERSION_CODE") ?: "1").toInt()
        versionName = System.getenv("ATVM_VERSION_NAME") ?: "0.1.0"
        // Serveur proposé par défaut (variable de dépôt GitHub ATVM_DEFAULT_SERVER) : les proches n'ont que le code à taper
        val defaultServer = (System.getenv("ATVM_DEFAULT_SERVER") ?: "").replace("\"", "")
        buildConfigField("String", "DEFAULT_SERVER", "\"$defaultServer\"")
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        if (keystorePath != null && keystorePassword != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = keystorePassword
                keyAlias = "atvm"
                keyPassword = keystorePassword
                storeType = "pkcs12"
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources {
            excludes += setOf("META-INF/AL2.0", "META-INF/LGPL2.1", "META-INF/*.kotlin_module", "META-INF/versions/**")
        }
    }
}

dependencies {
    implementation("dev.mobile:dadb:1.2.10")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
