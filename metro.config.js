const { getDefaultConfig } = require('@expo/metro-config');

const config = getDefaultConfig(__dirname);

// JS bundle minification (Metro's terser transform) is genuinely PLATFORM-LESS:
// one Metro build graph, minified whenever `dev: false`, whichever platform is
// being bundled. There is no `config.transformer.ios.*` vs `.android.*` split
// to get out of sync — unlike native minification, where Android (R8, via
// `expo-build-properties` in app.json) and iOS (Xcode's Release config, which
// strips/optimises native code by default with nothing exposed to toggle) are
// two different toolchains with two different mechanisms. Do not add a
// per-platform branch here for minification; there is nothing for it to branch on.

// Allow Metro to bundle .lottie and .webm assets
config.resolver.assetExts.push('lottie', 'webm');

module.exports = config;
