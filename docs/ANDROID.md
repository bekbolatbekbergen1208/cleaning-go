# Android іске қосу

База компьютердің `.local-data/db` бумасында қалады. Android жергілікті API-ге
Wi-Fi арқылы қосылады. Компьютер мен телефон бір желіде болуы керек.

## Дайын іске қосу

Жоба түбірінен:

```bash
pnpm mobile:local
```

Команда компьютердің LAN IP-мекенжайын анықтайды, API, веб және Expo-ны іске қосады.
Басқа серверлер 3000, 54321 немесе 8081 порттарын пайдаланып тұрса, алдымен соларды
тоқтатыңыз. Серверді тоқтату: терминалда Ctrl+C.

Осы тексеріс кезіндегі мекенжайлар:

- Телефон браузері: `http://192.168.68.111:3000`.
- Android қолданбасы: `exp://192.168.68.111:8081`.
- API тексеру: `http://192.168.68.111:54321/health`.

Бұл IP желі ауысқанда өзгеруі мүмкін. Қайта іске қосқанда терминалдағы жаңа
мекенжайды қолданыңыз. Қажет болса `LOCAL_MOBILE_HOST` арқылы IPv4 беруге болады.

Қолданба Expo SDK 53 қолданады. Android-қа [SDK 53-ке сәйкес Expo Go](https://expo.dev/go?device=true&platform=android&sdkVersion=53)
орнатып, Expo Go ішінен терминалдағы QR-кодты сканерлеңіз немесе `exp://` мекенжайын енгізіңіз.
SDK нұсқалары сәйкес болуы керек: [Expo нұсқа сәйкестігі](https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/).

QR суретін қайта жасау:

```bash
node --env-file=.env.local local/android-qr.mjs
```

Сурет: `.local-data/android-qr.png`.

## Ненің интеграциясы жасалды

- Нақты телефон үшін `127.0.0.1` орнына LAN серверін таңдау.
- Тіркелу, авторизация, тапсырыстар, камера фотолары, бонус, бағаны растау және дау ашу.
- Android сессиясын SecureStore ішінде сақтау; бұрынғы AsyncStorage сессиясын көшіру.
- Құпиясөзді қалпына келтіруге `cleaninggo://reset-password` сілтемесі.
- Камера мен геолокацияға Android рұқсаттары, фондық GPS қызметі.
- Expo Go-да фондық қызмет қолжетімсіз болса, қолданба ашық тұрғандағы GPS.
- Желінің уақытша үзілуі GPS бақылауын жоймайды.
- Native Android жобасын жасау және Android Hermes JS bundle экспорты тексерілді.

Expo Go фондық геолокация қызметін алмастырмайды. Экран бұғатталған кездегі GPS
үшін жеке Android жинағы және фондық рұқсат қажет: [Expo Location](https://docs.expo.dev/versions/latest/sdk/location/).

## Жеке APK жинау

`apps/mobile/eas.json` ішінде `preview` APK және `production` AAB конфигурациялары бар.
LAN IP `mobile:local`/`mobile:prepare` арқылы preview build айнымалыларына жазылады.
Желі өзгерсе қайта дайындап, APK-ны қайта жинаңыз. Қосымшаның package ID: `kz.cleaninggo.app`. [Expo APK нұсқаулығы](https://docs.expo.dev/build-reference/apk/).

Expo аккаунты бар ортада, `apps/mobile` бумасынан:

```bash
npx eas-cli build --platform android --profile preview
```

EAS жобасын Expo аккаунтымен байланыстыру және Android signing қажет.
Тексеру кезінде бұл компьютерде Java JDK, Android SDK және қосылған телефон болған жоқ;
сондықтан Cleaning Go APK файлы құрастырылмады және телефонға орнатылмады.
Жергілікті native build үшін JDK 17, Android SDK орнатып:

```bash
pnpm --filter @cleaning-go/mobile android
```

Production жинағы `APP_VARIANT=production` кезінде HTTPS API талап етеді.
Жергілікті preview Wi-Fi ішіндегі HTTP серверіне қосыла алады. `.env.local` файлдарындағы
серверлік кілтті Android-тың `EXPO_PUBLIC_*` айнымалыларына қоспаңыз.

## Қайта тексеру

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @cleaning-go/mobile exec expo install --check
node --env-file=.env.local local/check-mobile.mjs
```

`check-mobile` үшін `mobile:local` іске қосылып тұруы керек. Ол LAN API, Android
Expo manifest, bundle мекенжайы және Expo Web CORS ережелерін тексереді.

Банк төлемі, SMS, SMTP және push провайдерлері қосылған жоқ. Қалпына келтіру хаттары
әзірге компьютердің `.local-data/mail` бумасында сақталады. Браузер арқылы GPS/камера
жергілікті HTTP-де шектелуі мүмкін; телефон тексерісі үшін native Expo Go пайдаланыңыз.
