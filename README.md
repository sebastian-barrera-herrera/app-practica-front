# 🐧 Linux Dojo

App móvil **100 % offline** y en español para aprender y practicar Linux desde cero hasta nivel avanzado, con un enfoque gamificado: lecciones cortas, ilustraciones animadas, quizzes, exámenes, repasos espaciados y una **terminal Linux simulada completa** donde puedes escribir comandos de verdad sin romper nada.

Todo el contenido (roadmap, explicaciones, ilustraciones, preguntas y retos) está escrito dentro del proyecto: no usa fuentes externas ni necesita internet para funcionar.

## Qué incluye

| Área | Detalle |
| --- | --- |
| **Roadmap** | 12 mundos en 3 niveles (básico, intermedio, avanzado), 60 lecciones, ~590 pasos. |
| **Lecciones** | Explicación → demo animada en terminal → ilustración interactiva → quiz → reto práctico en la terminal simulada. |
| **Mundos** | Primeros pasos · Archivos y carpetas · Texto y tuberías · Buscar y encontrar · Permisos y usuarios · Procesos y sistema · Texto como un pro · Redes · Paquetes y archivado · Scripting en bash · Administración de sistemas · Maestría |
| **Tipos de pregunta** | Opción múltiple, selección múltiple, verdadero/falso, escribir el comando, ordenar piezas, unir pares, rellenar huecos y *predecir la salida* (la respuesta se calcula ejecutando el comando en el motor). |
| **Práctica** | Terminal libre persistente, retos guiados con pistas, reto diario, **Blitz** (pruebas rápidas cronometradas), repaso espaciado (Leitner) y **examen sorpresa**. |
| **Exámenes** | Examen por mundo y certificaciones por nivel. |
| **Gamificación** | XP y niveles, estrellas por lección, racha diaria con congeladores, 33 logros, meta diaria, notificaciones locales de examen sorpresa. |
| **Biblioteca** | Referencia de todos los comandos del simulador, con búsqueda, opciones y ejemplos listos para probar en la terminal (`man` y `--help` también funcionan dentro de ella). |
| **Ilustraciones** | 26 ilustraciones animadas e interactivas (SVG + Reanimated): permisos, tuberías, procesos, señales, DNS, SSH, cron, apt, tar, regex, awk… |

## La terminal simulada

El corazón de la app es un Linux simulado escrito en TypeScript (`src/engine`), sin dependencias nativas:

- Intérprete de **bash**: tuberías, redirecciones, heredocs, `&&`/`||`, variables y arrays, funciones, expansiones (`$()`, `$(( ))`, `{a,b}`, globs, `<( )`), `for`/`while`/`case`/`if`, `trap`, historial (`!!`, `!n`).
- **~200 comandos**: archivos, texto (`grep`, `sed`, `awk`, `sort`, `cut`, `tr`…), `find`, permisos y usuarios, procesos y señales, `systemctl`, `journalctl`, `cron`, `apt`/`dpkg`, `tar`/`gzip`, red (`ip`, `ss`, `ping`, `curl`, `ssh`, `ufw`…), editores (`nano`/`vim` simulados) y más.
- Sistema de archivos virtual con **permisos reales**, usuarios, grupos, `sudo`, servicios, paquetes, red, reloj virtual y un mini-internet falso (DNS, sitios web, un servidor SSH remoto).
- Los retos se corrigen con **comprobaciones declarativas** del estado final (archivos, permisos, procesos, salida…), así que hay muchas formas válidas de resolverlos.

## Estructura

```
src/
  app/            Pantallas (expo-router): tabs, lección, sesiones, onboarding, logros, ajustes, biblioteca
  content/        Roadmap y contenido: worlds/w1…w12.ts, DSL (build.ts), tipos
  engine/         Linux simulado: parser, shell, vfs, comandos, comprobaciones de retos
  game/           XP, racha, SRS, logros, exámenes, sesiones, store (Zustand + AsyncStorage)
  illustrations/  Ilustraciones animadas (SVG + Reanimated)
  ui/             Tema y componentes (terminal, quiz, retos, demos…)
  lib/            Utilidades (biblioteca de comandos, haptics, etc.)
```

## Desarrollo

Requisitos: Node 20+ y npm.

```bash
npm install
npm start            # servidor de desarrollo (escanea el QR con Expo Go)
npm run web          # versión web para probar rápido en el navegador
npm run typecheck    # tsc --noEmit
npm run lint         # expo lint
npm test             # jest (motor, juego y validación automática de TODO el contenido)
```

La suite de tests **ejecuta las soluciones de referencia de cada reto a través del motor** y valida la coherencia de todas las preguntas, de modo que añadir contenido roto falla el CI antes de llegar al móvil.

### Añadir contenido

Cada mundo es un archivo en `src/content/worlds/` escrito con un pequeño DSL (`learn`, `demo`, `illus`, `quiz`, `practice`, `lesson`, `world`). Añade una lección, ejecuta `npm test` y el validador te dirá si alguna solución de referencia no pasa su propia comprobación.

## Generar el APK

La app se compila con **EAS Build** (no necesitas Android Studio).

```bash
npm install -g eas-cli
eas login                                  # crea una cuenta gratis en expo.dev si no tienes
eas init                                   # enlaza el proyecto con tu cuenta (una sola vez)
eas build -p android --profile preview     # también: npm run build:apk
```

Al terminar (≈10–20 min) EAS te da un enlace y un QR para descargar el **.apk**; ábrelo en el móvil e instálalo (hay que permitir «instalar apps desconocidas»). El perfil `preview` de `eas.json` genera un APK instalable directamente; `production` genera un `.aab` para Google Play.

Datos del paquete: nombre `Linux Dojo`, id `com.linuxdojo.app` (cámbialo en `app.json` si quieres otro).

## Datos y privacidad

Todo el progreso (XP, racha, repasos, terminal) se guarda **solo en el dispositivo** con AsyncStorage. No hay cuentas, servidores ni analítica. Las únicas notificaciones son locales (avisos de examen sorpresa en horas aleatorias dentro de la ventana que elijas) y se pueden desactivar en Ajustes.
