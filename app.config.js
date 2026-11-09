module.exports = {
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/images/adaptive-icon.png",
      backgroundColor: "#ffffff"
    },
    package: "com.draftbitbuildservices.newapp",
    versionCode: 9
  },
  assetBundlePatterns: ["**/*"],
  experiments: { typedRoutes: true, tsconfigPaths: true },
  icon: "./assets/images/icon.png",
  ios: { supportsTablet: true, bundleIdentifier: "com.draftbit.newapp", buildNumber: "9" },
  name: "new-app",
  orientation: "portrait",
  plugins: [
  "expo-font",
  "expo-asset",
  "expo-video",
  "expo-web-browser",
  "expo-image",

  [
  "expo-router",
  {


  }]],




  scheme: "new-app",
  slug: "new-app",
  splash: {
    image: "./assets/images/splash.png",
    resizeMode: "contain",
    backgroundColor: "#ffffff"
  },
  userInterfaceStyle: "automatic",
  version: "1.0.8",
  web: { bundler: "metro", output: "single", favicon: "./assets/images/favicon.png" },
  platforms: ["ios", "android", "web"]
};
