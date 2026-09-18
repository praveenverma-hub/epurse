module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated 4 moved the worklets transform into its own package; this must
    // stay LAST in the plugin list.
    plugins: ['react-native-worklets/plugin'],
  };
};
