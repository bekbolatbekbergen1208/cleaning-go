const { withAndroidManifest } = require('expo/config-plugins');
module.exports = (config, { allowLocalHttp = false } = {}) =>
  withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application?.[0];
    if (app) app.$['android:usesCleartextTraffic'] = String(allowLocalHttp);
    return config;
  });
