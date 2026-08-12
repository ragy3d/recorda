# Recordá — avisos de exámenes por voz

Grabás un audio diciendo la fecha del examen y los temas, y la app te avisa
cuando se acerca. Todo se guarda en tu propia máquina; no hay servidor ni cuenta.

## Cómo la abro

```bash
python -m http.server 5600 --directory recordatorios
```

Después entrá a **http://localhost:5600** en Chrome o Edge.

> Tiene que ser `localhost` (o https). Si abrís el `index.html` con doble clic,
> el navegador bloquea el micrófono y no funciona el dictado.

La primera vez te va a pedir permiso para el **micrófono** y para las
**notificaciones**: aceptá los dos.

## Cómo la uso

1. Tocá el micrófono y hablá normal. Por ejemplo:

   > «Examen de Historia el 15 de marzo, temas revolución francesa, Napoleón
   > y el imperio. Avisame 5 días antes.»

2. Tocá el micrófono otra vez para terminar.
3. Aparece un formulario con lo que entendió: materia, fecha, hora, temas y
   días de aviso. Corregí lo que haga falta y dale **Guardar**.

### Lo que entiende

| Cosa | Formas que reconoce |
|---|---|
| Fecha | `15 de marzo`, `15 de marzo de 2027`, `3/11`, `20-9`, `mañana`, `pasado mañana`, `el próximo martes`, `en 3 semanas`, `dentro de 10 días`, `el 15` |
| Hora | `a las 14`, `a las 8:30`, `a las 10 de la mañana`, `a las 7 de la tarde` |
| Materia | `examen de X`, `parcial de X`, `prueba de X`, `final de X`, `trabajo práctico de X`, `recuperatorio de X`, `coloquio de X` |
| Temas | después de `temas…`, `los temas son…`, `entra…`, `incluye…`, `sobre…`, `estudiar…` — separados por coma o «y» |
| Aviso | `avisame 5 días antes`, `una semana antes`, `el mismo día` |

Si dice una fecha que ya pasó (por ejemplo «15 de marzo» dicho en agosto),
la interpreta como del año siguiente.

## Pasarlo al calendario del celular

Cada examen tiene un botón **📅** que lo abre en Google Calendar ya cargado, de
un toque. Es lo más rápido, pero ese formato de link no puede mandar
recordatorios propios: el evento queda con el aviso por defecto de tu
calendario, y los días que pediste van escritos en la descripción.

El **📅 de arriba** exporta *todos* los exámenes a un archivo `.ics` con los
días exactos ya cargados como alarmas. Lo importás una vez en Google Calendar
u Outlook y queda todo con sus avisos correctos.

## Cómo me avisa

Por defecto te notifica **7, 3 y 1 día antes, y el mismo día**, a las 09:00.
Podés cambiar los días y la hora por examen (en el formulario) o para todos
(en ⚙️ Ajustes).

Si un día no abriste la app y te perdiste un aviso, la próxima vez que la
abras te lo muestra igual — pero manda **uno solo**, no cuatro seguidos.

### ⚠️ Lo importante sobre las notificaciones

Un navegador **sólo puede notificarte con la app abierta**, aunque sea en una
pestaña de fondo. Si cerrás Chrome, no hay aviso.

Para avisos de verdad (con el celular en el bolsillo, la compu apagada) usá el
botón 📅 de arriba: baja un archivo `examenes.ics` que importás en Google
Calendar, Outlook o el calendario del celular. Ahí quedan los eventos con sus
alarmas y te avisa el sistema operativo.

Recomendación: usá las dos cosas. La app para cargar rápido por voz, el `.ics`
para que suene el aviso.

## Instalarla en el celular

Tiene que estar servida por **https** — desde `localhost` sólo funciona en la
misma computadora, y por la red local (`http://192.168.x.x`) el navegador
bloquea el micrófono, las notificaciones y la instalación.

Con la app publicada en https, entrá desde el celular y:

- **Android (Chrome):** aparece el botón «Instalar» arriba, o menú ⋮ →
  «Instalar aplicación».
- **iPhone (Safari):** botón compartir → «Agregar a pantalla de inicio».
  Ojo: en iPhone las notificaciones web sólo funcionan si la agregás a la
  pantalla de inicio (iOS 16.4 o superior).

Queda con su ícono propio, pantalla completa y funciona sin internet.

## Archivos

```
recordatorios/
├── index.html          estructura de la pantalla
├── manifest.json       para instalarla como app (PWA)
├── sw.js               service worker: notificaciones y modo offline
├── icons/              íconos de la app (192, 512, maskable, iOS)
├── css/style.css       estilos (tema oscuro y claro automáticos)
└── js/
    ├── parser.js       interpreta la frase en español -> fecha, temas, avisos
    ├── db.js           IndexedDB: guarda los audios
    └── app.js          grabación, guardado, avisos, Google Calendar y .ics
```

Los exámenes se guardan en `localStorage` y los audios en IndexedDB, los dos
en tu navegador. Si borrás los datos del sitio, se borra todo.

## Probar sin hablar

Podés escribir en la consola del navegador:

```js
Parser.parse("parcial de Física el 3 de octubre a las 14, entra cinemática y dinámica")
```

`window.Recorda` expone `items`, `cfg`, `buildICS()`, `checkReminders()` y
`dueMilestone(item, diasQueFaltan)` para depurar.
