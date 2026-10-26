# 🥋 Dev Dojo

App móvil en español para **aprender y practicar programación desde cero hasta nivel avanzado**, con lecciones cortas, ilustraciones animadas, quizzes, repasos espaciados y un **laboratorio donde ejecutas código de verdad** sin instalar nada. Hoy incluye cuatro cursos independientes, y **tú eliges cuáles hacer** (en la bienvenida, en Ajustes o en el catálogo de cursos):

| Curso | Contenido |
| --- | --- |
| 🐧 **Linux** | 12 zonas · 60 lecciones · ~590 pasos · 233 retos. Una **terminal Linux simulada** completa (bash, ~200 comandos, permisos, procesos, red, cron…). |
| 🐍 **Python** | 12 zonas · 60 lecciones · ~840 pasos · 196 retos. De «Hola mundo» a `asyncio`, con un **intérprete de Python escrito en TypeScript** que corre en el móvil (sin servidor). |
| 🗃️ **SQL** | 14 zonas · 70 lecciones · ~810 pasos · 217 retos. De tu primer `SELECT` a `JOIN`, subconsultas, ventanas, CTE recursivas, índices (con `EXPLAIN` y «filas leídas»), transacciones, triggers, seguridad e incluso una **entrevista técnica**. Corre sobre un **motor de SQL escrito en TypeScript** (sin servidor) y los retos se corrigen **ejecutando tu consulta** y comparando el resultado o el estado de la base de datos. |
| ☁️ **AWS** | _En construcción por fases_ (plan de 20 zonas hasta la certificación y la arquitectura avanzada en `src/content/aws/CURRICULUM.md`). **Fase A lista: 4 zonas · 20 lecciones · ~190 pasos · 40 retos** — fundamentos de la nube, IAM, cómputo (EC2) y almacenamiento (S3). Se practica sobre una **cuenta de AWS simulada**: la CLI `aws` real (con `--query`, `--output table/text/yaml`, perfiles, credenciales temporales, `assume-role`, `curl` a buckets e instancias…) se ejecuta sobre un motor escrito en TypeScript, sin cuenta ni coste. |

Cada curso tiene su propio progreso, sus colores, su laboratorio y su biblioteca de referencia. La **meta diaria es de 60 minutos por curso** (configurable) y la racha cuenta los días en que cumples la meta.

## Qué hay en la app

- **Roadmap** por zonas y niveles (básico, intermedio, avanzado) con una **misión final** y un **examen** por zona. Para abrir una zona hay que **superar la anterior** (lecciones + misión final + examen), salvo que la saltes con el examen de salto.
- **Lecciones**: explicación → demo animada → ilustración interactiva → quizzes → retos de código con pistas. Tipos de pregunta: opción múltiple, verdadero/falso, rellenar huecos, unir pares, *predecir la salida* (se calcula ejecutando el código en el motor) y escribir código.
- **Práctica**: reto diario, *Blitz* cronometrado, repaso espaciado (Leitner) y examen sorpresa.
- **Laboratorio**: terminal Linux simulada · **consola de AWS** (la terminal con una cuenta de prueba: crea usuarios, buckets y servidores, cámbialos de región, rómpelos y mira los errores reales) · editor y REPL de Python con salida en vivo, `input()` interactivo y sistema de archivos virtual · **laboratorio de SQL** con 10 bases de datos de ejemplo (tienda, cine, escuela, empresa, biblioteca, red social, banco, vuelos, 6.000 ventas y una base vacía), explorador de tablas, historial y 19 ejemplos.
- **Biblioteca**: Linux — todos los comandos del simulador; Python — 261 fichas (funciones, métodos, sentencias y módulos) con 481 ejemplos ejecutables desde la propia ficha; SQL — 98 fichas (cláusulas, funciones, patrones y conceptos) con 145 ejemplos que se ejecutan sobre una base de datos de muestra; AWS — 85 fichas de servicios, conceptos, comandos y buenas prácticas, con «cuándo usarlo y cuándo no», cómo se cobra, límites y 103 ejemplos que se ejecutan en la cuenta simulada.
- **Gamificación**: XP y niveles, estrellas por lección, racha, logros generales y por curso, metas diarias por curso.
- **Pantalla de Niveles**: qué es cada nivel, cuánto XP falta, qué zonas se desbloquean y qué recompensas hay.
- **Examen de salto**: si ya sabes una zona, puedes desbloquear la siguiente (o todo un nivel) aprobando un examen difícil, sin pasar por las lecciones.
- **Avatares y personalización** (`src/game/cosmetics.ts`, pantalla «Mi avatar»): 48 objetos que se compran con monedas —19 avatares, 8 marcos (hasta el arcoíris giratorio), 9 fondos y 12 accesorios— de comunes a legendarios, que se combinan en el perfil. Lo comprado se sincroniza entre dispositivos.
- **Monedas, misiones diarias, combo y tienda**: las monedas se ganan jugando; las misiones del día y el combo de aciertos seguidos dan extras que se gastan en la tienda (escudos de racha, XP doble y pases sin espera para los exámenes de salto).
- **Alertas de práctica** (notificaciones locales): recordatorios a tus horas, aviso de racha en peligro, exámenes sorpresa y «te echamos de menos», con **botones de acción**, sonidos elegibles y respeto a la ventana horaria que fijes.
- **Tema claro, oscuro o del sistema.**
- **Cuentas en la nube** (correo y contraseña) para sincronizar el progreso entre dispositivos; la app funciona **sin conexión** y sincroniza cuando hay red.
- 68 ilustraciones animadas e interactivas (26 de Linux, 22 de Python, 10 de AWS —modelos de servicio, infraestructura global, evaluación de políticas, STS, ciclo de vida de EC2, EBS, compra, clases de S3 y seguridad de S3— y 10 de SQL: orden de ejecución, `GROUP BY`, tipos de `JOIN`, conjuntos, modelo entidad-relación, normalización, ventanas, índices y transacciones).

## Estructura

```
src/
  app/            Pantallas (expo-router): tabs, lección, sesiones, onboarding, ajustes, biblioteca, autenticación
  content/        Contenido y su DSL
    worlds/       Curso de Linux (w1…w12)
    py/           Curso de Python (w1…w12), comprobaciones (pycheck), biblioteca (reference.ts + ref/*)
    sql/          Curso de SQL (s1…s14), datasets de ejemplo, biblioteca (reference.ts + ref/*), plan en CURRICULUM.md
    aws/          Curso de AWS (a1…a4 de 20), escenarios de práctica, biblioteca (reference.ts + ref/*), plan en CURRICULUM.md
  engine/         Linux simulado: parser, shell, vfs, comandos, comprobaciones de retos
  pyengine/       Intérprete de Python 3.13 en TypeScript (ver su README)
  sqlengine/      Motor de SQL en TypeScript: lexer, parser, ejecutor, índices, transacciones, triggers y corrector de retos
  awsengine/     AWS simulado: cuenta, IAM/STS, S3 y EC2, CLI `aws` con JMESPath, escenarios y corrector
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
npm test             # jest: motores de Linux, Python, SQL y AWS (+ golden contra CPython), juego, nube y TODO el contenido
```

Las pruebas **ejecutan las soluciones de referencia de cada reto a través de los motores**, comprueban que el código inicial *no* resuelve el reto, ejecutan cada demo tal cual se muestra, validan la coherencia de todas las preguntas y **ejecutan los ejemplos de la biblioteca**. Añadir contenido roto falla en CI antes de llegar al móvil.

### Añadir contenido

- **Linux**: `src/content/worlds/wN.ts` (DSL: `learn`, `demo`, `illus`, `mc`/`tf`/`fill`/`match`, `practice`, `lesson`, `world`).
- **SQL**: `src/content/sql/sN.ts` con `sqlWorld`, `lesson`, `sqlDemo`/`sqlPerf`, `sqlOut` (predecir el resultado), `sqlCode`, `sqlPractice` y comprobaciones (`same`, `ordered`, `state`, `both`, `fails`, con `uses`, `forbids`, `maxRead`, `indexes`, `closed`). Los retos se ejecutan contra bases de datos de `datasets.ts`; cada ficha citada en `commands` debe existir en `src/content/sql/ref/`. Plan completo en `src/content/sql/CURRICULUM.md`.
- **Python**: `src/content/py/wN.ts` con `pyWorld`, `lesson`, `pyDemo`, `pyOut`, `pyPractice`, `pyCode`… y comprobaciones declarativas de `pycheck.ts` (`variable`, `calls`, `stdout`, `uses`, `cls`, `func`, `file`…). Cada ficha que cite `commands` debe existir en `src/content/py/ref/`. El plan completo está en `src/content/py/CURRICULUM.md`.
- **AWS**: `src/content/aws/aN.ts` con `awsWorld`, `lesson`, `demo`, `A('escenario')` (la cuenta de práctica de cada paso), `practice` y comprobaciones sobre el **estado de la cuenta** (`awsIs`, `awsHas`, `awsEmpty`, `awsFails`…, combinables con `all`/`any`). Cada ficha citada en `commands` debe existir en `src/content/aws/ref/` y sus ejemplos se ejecutan en el escenario que declare. Plan completo (20 zonas, fases A–D) en `src/content/aws/CURRICULUM.md`.

Ejecuta `npm test`: el validador te dice qué solución no supera su propia comprobación.

## Intérprete de Python

`src/pyengine` ejecuta Python **sin servidor ni código nativo**: lexer, parser, compilador a cierres, runtime fiel a CPython 3.13 (tracebacks idénticos, MRO, descriptores, generadores, `async`, `except*`, `match`…) y una biblioteca estándar híbrida (módulos de CPython empaquetados + módulos nativos). El reloj es virtual y determinista y `input()` se puede reproducir, de modo que los retos son corregibles automáticamente. Se verifica contra `python3` con una batería de pruebas «golden». Más detalles, límites conocidos y cómo ampliarlo en [`src/pyengine/README.md`](src/pyengine/README.md).


**Editor de Python** (`src/ui/PyEditor.tsx`): números de línea, colores de la paleta *Dark+* de VS Code (`pycolors.ts`, la misma en las cajas de código de las lecciones), sangrado automático, pares `()` `[]` `{}` `""`, atajos (`print()`, `input()`, `for`, `if`, `while`, `def`, `f""`…) y **autocompletado** (`pycomplete.ts`, función pura con tests): propone las variables y funciones que ya escribiste, las funciones de Python, las palabras clave y, tras un punto, los métodos más usados; no sugiere dentro de textos ni comentarios. El texto se dibuja dos veces con la misma tipografía (el campo, con letra transparente, y debajo el texto coloreado), por eso no hay ajuste de línea: las líneas largas se desplazan en horizontal y los números cuadran siempre.
## Simulador de AWS

`src/awsengine` es una **cuenta de AWS simulada** escrita en TypeScript (sin red, sin credenciales reales, sin coste). El comando `aws` está integrado en la terminal de Linux: `|`, `>`, `$(…)`, variables, `file://`, `base64 -d`, `awk`… funcionan con él, y `curl` llega a los buckets y a las instancias del simulador (URLs públicas y prefirmadas, sitios web estáticos, páginas servidas por EC2 respetando los *security groups*).

- **Servicios**: STS, IAM (usuarios, grupos, roles, políticas, claves, MFA, informe de credenciales, `simulate-principal-policy`, `get-account-authorization-details`…), S3 (`s3` y `s3api`: buckets, objetos, versionado, ciclo de vida, políticas, Block Public Access, cifrado, web estática, URLs prefirmadas, replicación…), EC2 (instancias con su ciclo de vida, AMI, claves, *security groups*, volúmenes, *snapshots*, IP elásticas, etiquetas, `wait`, VPC en lectura), Budgets, CloudWatch (alarmas), SNS y SSM (parámetros públicos de AMI).
- **Fidelidad**: la CLI valida parámetros como la real (códigos de salida 252/253/254/255), soporta paginación, `--query` con **JMESPath** completo, `--output json|text|table|yaml`, perfiles, `role_arn`/`source_profile`, credenciales temporales con `ASIA…` y la precedencia real (opción > entorno > perfil). La evaluación de permisos sigue el algoritmo de AWS (Deny explícito > Allow, políticas de identidad y de recurso, condiciones, límites de permisos) y los errores tienen el formato de verdad, incluido `UnauthorizedOperation` con su mensaje codificado y `sts decode-authorization-message`.
- **Tiempo virtual**: un reloj determinista compartido con la terminal; las instancias pasan de `pending` a `running` en segundos y los `wait` lo hacen avanzar. Los IDs y las claves se derivan de una semilla, así que todo es reproducible.
- **Escenarios** (`scenarios.ts`): 14 cuentas de práctica listas (equipo con usuarios y un bucket, varias regiones, root inseguro, políticas de acceso, exceso de permisos, auditoría, servidores EC2, web, buckets de demostración, versionado, fugas públicas, discos huérfanos…).
- **Corrector** (`check.ts`): los retos no comparan texto, ejecutan consultas sobre el **estado final de la cuenta** (en modo «dios», sin permisos) y comparan el JSON resultante.

Pruebas: ~240 tests (JMESPath, evaluación de políticas, IAM/STS, S3, EC2, web, integración con la terminal y render de tablas) más el test de contenido, que ejecuta todos los retos, demos y ejemplos del curso.

## Motor de SQL

`src/sqlengine` es un motor de SQL completo escrito en TypeScript (sin servidor ni SQLite nativo), con dialecto cercano a PostgreSQL y comodidades de SQLite: tipos estáticos, lógica de tres valores, `JOIN` (hash join), subconsultas correlacionadas, funciones de ventana con marcos, CTE (incluidas **recursivas**), `ROLLUP`/`CUBE`/`GROUPING SETS`, `FILTER`, `generate_series`, `INSERT … ON CONFLICT`, `RETURNING`, restricciones (`PRIMARY KEY`, `UNIQUE`, `CHECK`, claves foráneas con `ON DELETE`), vistas, **índices** con `EXPLAIN [ANALYZE]` y contador de «filas leídas», **transacciones** (`BEGIN`/`COMMIT`/`ROLLBACK`, `SAVEPOINT`, niveles de aislamiento, `READ ONLY`, `FOR UPDATE`) y **triggers** (`NEW`/`OLD`/`RAISE`). Los errores explican qué pasó y sugieren cómo arreglarlo. «Hoy» está fijado a 2025-06-15 12:00 para que los resultados sean reproducibles.

El **corrector** (`judge.ts`) no compara texto: ejecuta tu SQL y la solución de referencia sobre dos copias idénticas de la base de datos y compara el resultado (con o sin orden y nombres de columna) y/o el **estado de las tablas** (estructura normalizada, filas e índices), con mensajes concretos («falta la columna…», «te sobra un índice…»). Puede exigir o prohibir construcciones, un tope de filas leídas (para retos de rendimiento) o que no quede una transacción abierta.

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
