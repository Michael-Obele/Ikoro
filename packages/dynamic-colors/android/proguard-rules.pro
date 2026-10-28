# Nothing to keep: the plugin class is referenced from MainActivity.java, which
# is in the app module, so R8 sees it as live. This file exists because
# build.gradle names it in consumerProguardFiles, and a missing file there is a
# configuration error rather than a warning.
