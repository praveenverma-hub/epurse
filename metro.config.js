const { getDefaultConfig } = require('@expo/metro-config');

const config = getDefaultConfig(__dirname);

// Allow Metro to bundle .lottie and .webm assets
config.resolver.assetExts.push('lottie', 'webm');

module.exports = config;
