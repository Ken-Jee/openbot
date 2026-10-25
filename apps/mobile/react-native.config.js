// The iOS PDF preview draws the file in a react-native-webview `WebView`, so iOS builds link it.
// On Android only Expo Go uses it, and Expo Go has its own native copy. Android builds keep
// @expo/dom-webview, so they do not link this native code.
module.exports = {
  dependencies: {
    "react-native-webview": { platforms: { android: null } },
  },
};
