# 🥋 Dev Dojo

App móvil en español para **aprender y practicar programación desde cero hasta nivel avanzado**, con lecciones cortas, ilustraciones animadas, quizzes, repasos espaciados y un **laboratorio donde ejecutas código de verdad** sin instalar nada. Hoy incluye dos cursos independientes:

| Curso | Contenido |
| --- | --- |
| 🐧 **Linux** | 12 zonas · 60 lecciones · ~590 pasos · 233 retos. Una **terminal Linux simulada** completa (bash, ~200 comandos, permisos, procesos, red, cron…). |
| 🐍 **Python** | 12 zonas · 60 lecciones · ~840 pasos · 196 retos. De «Hola mundo» a `asyncio`, con un **intérprete de Python escrito en TypeScript** que corre en el móvil (sin servidor). |

Cada curso tiene su propio progreso, sus colores, su laboratorio y su biblioteca de referencia. La **meta diaria es de 60 minutos por curso** (configurable) y la racha cuenta los días en que cumples la meta.

## Qué hay en la app

- **Roadmap** por zonas y niveles (básico, intermedio, avanzado) con una **misión final** por zona.
- **Lecciones**: explicación → demo animada → ilustración interactiva → quizzes → retos de código con pistas. Tipos de pregunta: opción múltiple, verdadero/falso, rellenar huecos, unir pares, *predecir la salida* (se calcula ejecutando el código en el motor) y escribir código.
- **Práctica**: reto diario, *Blitz* cronometrado, repaso espaciado (Leitner) y examen sorpresa.
- **Laboratorio**: terminal Linux simulada · editor y REPL de Python con salida en vivo, `input()` interactivo y sistema de archivos virtual.
- **Biblioteca**: Linux — todos los comandos del simulador; Python — 261 fichas (funciones, métodos, sentencias y módulos) con 481 ejemplos ejecutables desde la propia ficha.
- **Gamificación**: XP y niveles, estrellas por lección, racha, logros generales y por curso, metas diarias por curso.
- **Alertas de práctica** (notificaciones locales): recordatorios a tus horas, aviso de racha en peligro, exámenes sorpresa y «te echamos de menos», con **botones de acción**, sonidos elegibles y respeto a la ventana horaria que fijes.
- **Tema claro, oscuro o del sistema.**
- **Cuentas en la nube** (correo y contraseña) para sincronizar el progreso entre dispositivos; la app funciona **sin conexión** y sincroniza cuando hay red.
- 48 ilustraciones animadas e interactivas (26 de Linux y 22 de Python).

## Estructura

```
src/
  app/            Pantallas (expo-router): tabs, lección, sesiones, onboarding, ajustes, biblioteca, autenticación
  content/        Contenido y su DSL
    worlds/       Curso de Linux (w1…w12)
    py/           Curso de Python (w1…w12), comprobaciones (pycheck), biblioteca (reference.ts + ref/*)
  engine/         Linux simulado: parser, shell, vfs, comandos, comprobaciones de retos
  pyengine/       Intérprete de Python 3.13 en TypeScript (ver su README)
  game/           XP, racha, SRS, logros, metas, store (Zustand + AsyncStorage)
  cloud/          Cuentas (Neon Auth) y sincronización (Neon Data API)
  illustrations/  Ilustraciones animadas (SVG + Reanimated)
  ui/             Tema y componentes (terminal, editor de Python, quizzes, retos, demos…)
  lib/            Notificaciones, haptics, sonidos, utilidades
scripts/          Generadores de la biblioteca de Python empaquetada y de sonidos
```

## Desarrollo

Requisitos: Node 20+ y npm.

```bash
npm install
npm start            # servidor de desarrollo (Expo Go o development build)
npm run web          # versión web para probar rápido en el navegador
npm run typecheck    # tsc --noEmit
npm run lint         # expo lint
npm test             # jest: motor de Linux, motor de Python (+ golden contra CPython), juego, nube y TODO el contenido
```

Las pruebas **ejecutan las soluciones de referencia de cada reto a través de los motores**, comprueban que el código inicial *no* resuelve el reto, ejecutan cada demo tal cual se muestra, validan la coherencia de todas las preguntas y **ejecutan los ejemplos de la biblioteca**. Añadir contenido roto falla en CI antes de llegar al móvil.

### Añadir contenido

- **Linux**: `src/content/worlds/wN.ts` (DSL: `learn`, `demo`, `illus`, `mc`/`tf`/`fill`/`match`, `practice`, `lesson`, `world`).
- **Python**: `src/content/py/wN.ts` con `pyWorld`, `lesson`, `pyDemo`, `pyOut`, `pyPractice`, `pyCode`… y comprobaciones declarativas de `pycheck.ts` (`variable`, `calls`, `stdout`, `uses`, `cls`, `func`, `file`…). Cada ficha que cite `commands` debe existir en `src/content/py/ref/`. El plan completo está en `src/content/py/CURRICULUM.md`.

Ejecuta `npm test`: el validador te dice qué solución no supera su propia comprobación.

## Intérprete de Python

`src/pyengine` ejecuta Python **sin servidor ni código nativo**: lexer, parser, compilador a cierres, runtime fiel a CPython 3.13 (tracebacks idénticos, MRO, descriptores, generadores, `async`, `except*`, `match`…) y una biblioteca estándar híbrida (módulos de CPython empaquetados + módulos nativos). El reloj es virtual y determinista y `input()` se puede reproducir, de modo que los retos son corregibles automáticamente. Se verifica contra `python3` con una batería de pruebas «golden». Más detalles, límites conocidos y cómo ampliarlo en [`src/pyengine/README.md`](src/pyengine/README.md).

## Cuentas en la nube (Neon)

Se usa **Neon Auth** (registro, inicio de sesión, recuperación de contraseña con código por correo) y la **Neon Data API** para guardar el progreso en una tabla con seguridad por filas:

```sql
create table public.progress (
  user_id    text   not null default auth.user_id(),
  scope      text   not null check (scope ~ '^[a-z0-9_-]{1,32}$'),
  data       jsonb  not null check (pg_column_size(data) < 900000),
  client_ts  bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, scope)
);
alter table public.progress enable row level security;
-- cuatro políticas (select / insert / update / delete) para el rol «authenticated»: auth.user_id() = user_id
```

- Los endpoints no son secretos (el acceso lo protegen la autenticación y las políticas RLS). Están en `src/cloud/config.ts` y se pueden cambiar con `EXPO_PUBLIC_AUTH_URL` y `EXPO_PUBLIC_API_URL` para usar **tu propio proyecto de Neon** (activa Auth y la Data API en el proyecto y crea la tabla anterior).
- **Local primero**: el progreso se guarda siempre en el dispositivo; la nube se fusiona sin perder nada (`src/cloud/merge.ts`), así que dos móviles distintos conviven.
- La sesión se guarda en el almacén seguro del sistema (`expo-secure-store`).

## Notificaciones

Todas son **locales** (no hay servidor de notificaciones): se reprograman a partir del estado (curso activo, meta cumplida, racha, ventana horaria) con `expo-notifications`. En Android 13+ la app pide el permiso al activarlas; los botones de acción («▶️ Empezar», «⏰ En 30 min», «🙈 Hoy no»…) y los sonidos (`assets/sounds`, generados con `scripts/make-sounds.mjs`) requieren un *build* nativo (APK o *development build*): Expo Go tiene limitaciones con `expo-notifications`, así que allí no se pueden probar todas las funciones. La versión web no programa notificaciones.

**Con el móvil bloqueado o en reposo**: los avisos se entregan como una alarma (`delivery: 'alarmClock'`, con los permisos `SCHEDULE_EXACT_ALARM` y `USE_EXACT_ALARM` de `app.json`), así que suenan a su hora exacta aunque la pantalla esté apagada. Se puede desactivar en Ajustes ▸ Recordatorios ▸ «Sonar con el móvil bloqueado». Algunos fabricantes (Xiaomi, Oppo, Huawei, Samsung…) cierran las apps en segundo plano por ahorro de batería: Ajustes tiene un atajo a los ajustes de batería para permitir a Dev Dojo funcionar «sin restricciones». Los canales de Android son inmutables, por eso llevan sufijo de versión (`-v2`) y los antiguos se borran al arrancar.

## Retomar donde lo dejaste

Al salir a la mitad de una **lección**, un **repaso**, un **examen sorpresa** o un **examen de zona/certificación**, la app guarda el paso exacto (`src/game/resume.ts`, solo en el dispositivo; caduca a los 14 días o si el contenido cambió) y lo retoma al volver: la pantalla Hoy y la Ruta muestran «Retomar donde quedé · Paso 4 de 9». En los retos se conserva además lo escrito (código de Python) o los comandos ya ejecutados (terminal). El reloj de un examen se detiene mientras estás fuera. La prueba rápida (60 s) no se reanuda.

## Generar el APK

La app se compila con **EAS Build** (en la nube de Expo; no necesitas Android Studio). Necesitas una cuenta gratuita en [expo.dev](https://expo.dev) y Node 20+.

**Primer build** (interactivo: EAS genera aquí la clave de firma de la app, así que hazlo desde tu terminal):

```bash
npm install
npx eas-cli login                                # tu cuenta de expo.dev
npx eas-cli init                                 # enlaza el proyecto y escribe `extra.eas.projectId` en app.json (haz commit)
npx eas-cli build -p android --profile preview   # cuando pregunte por la keystore, responde «Yes» (también: npm run build:apk)
```

Al terminar (≈10–20 min) EAS da un enlace y un QR para descargar el **.apk**; ábrelo en el móvil e instálalo (hay que permitir «instalar apps de orígenes desconocidos»). El perfil `preview` de `eas.json` genera un APK instalable directamente (universal, ~110 MB); el perfil `arm64` genera uno **solo para móviles de 64 bits** (casi todos los actuales), mucho más ligero:  `npx eas-cli build -p android --profile arm64`; `production` genera un `.aab` para Google Play (requiere cuenta de desarrollador de Google).

**Builds siguientes sin interacción** (por ejemplo desde CI o desde un asistente): crea un token en *expo.dev → Account settings → Access tokens*, guárdalo como variable de entorno `EXPO_TOKEN` (nunca en el repositorio) y ejecuta `npx eas-cli build -p android --profile preview --non-interactive`.

Datos del paquete: nombre `Dev Dojo`, id `com.devdojo.app` (en `app.json`). **La clave de firma vive en tu cuenta de Expo**: sin ella no podrás publicar actualizaciones que se instalen encima de la versión anterior; descárgala con `npx eas-cli credentials` si quieres una copia de seguridad.

## Actualizaciones por internet (EAS Update)

La app incluye `expo-updates`: el contenido de los cursos, las pantallas y los arreglos de JavaScript se publican **sin generar un APK nuevo** y llegan al móvil la siguiente vez que se abre la app (o desde Ajustes ▸ Actualizaciones ▸ «Buscar actualizaciones»).

```bash
# canal «preview» (los APK del perfil preview/arm64 lo escuchan)
npx eas-cli update --channel preview --message "Qué cambia"
```

- `runtimeVersion` usa la política `appVersion`: una actualización solo llega a las apps con la **misma `version` de `app.json`**. Si cambias algo **nativo** (una librería con código nativo, permisos, plugins, iconos…), sube `version` (p. ej. `2.0.0` → `2.1.0`) y genera un APK nuevo; las apps con la versión anterior seguirán recibiendo solo las actualizaciones de su versión.
- Canales (`eas.json`): `development`, `preview` (también `arm64`) y `production`.
- Solo funciona en la app instalada desde un build de EAS (no en `expo start` ni en web). La primera vez hay que instalar un APK que ya incluya `expo-updates`.

## Privacidad

El progreso vive en el dispositivo y, si inicias sesión, se sincroniza con tu cuenta (solo tus datos de progreso; cada fila está protegida con RLS para que únicamente tú puedas leerla). No hay analítica ni anuncios. Las notificaciones se pueden desactivar en Ajustes.
