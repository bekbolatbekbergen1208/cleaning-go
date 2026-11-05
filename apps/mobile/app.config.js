module.exports = ({ config }) => {
  const production = process.env.APP_VARIANT === 'production';
  const api = process.env.EXPO_PUBLIC_LOCAL_API_URL || 'http://127.0.0.1:54321';
  const url = new URL(api);
  if (production && url.protocol !== 'https:')
    throw new Error(
      'Production Android builds require an HTTPS EXPO_PUBLIC_LOCAL_API_URL',
    );
  const privateHost =
    /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
      url.hostname,
    );
  const allowLocalHttp = !production && url.protocol === 'http:' && privateHost;
  return {
    ...config,
    android: {
      ...config.android,
      package: 'kz.cleaninggo.app',
      versionCode: 1,
      permissions: ['android.permission.INTERNET'],
    },
    ios: {
      ...config.ios,
      bundleIdentifier: 'kz.cleaninggo.app',
      infoPlist: {
        ...config.ios?.infoPlist,
        NSLocalNetworkUsageDescription:
          'Подключение к локальному серверу Cleaning Go в вашей сети Wi-Fi.',
      },
    },
    plugins: [
      ...(config.plugins || []),
      [
        'expo-image-picker',
        {
          photosPermission:
            'Разрешите выбрать фото помещения для заказа уборки.',
          cameraPermission:
            'Разрешите сделать фото помещения для заказа уборки.',
          microphonePermission: false,
        },
      ],
      ['./plugins/with-local-network.cjs', { allowLocalHttp }],
    ],
  };
};
