# Sala

Nubes de palabras y encuestas en vivo para audiencias. Alternativa mínima a Mentimeter,
con link y QR para que la gente entre, resultados en tiempo real en la pantalla del
presentador, exportación a CSV/JSON, opción de ocultar los resultados hasta que la persona
responda y control de groserías.

Se hospeda gratis en **GitHub Pages** (la parte visible) más **Firebase Realtime Database**
(donde se guardan las respuestas). Ninguna de las dos pide tarjeta de crédito. Preparado para
salas grandes: **cientos de participantes en el plan gratuito**.

---

## Por qué hacen falta dos servicios

GitHub Pages solo entrega archivos: no puede guardar nada ni comunicar a los participantes
entre sí. Para que cuatrocientas personas escriban una palabra y todas aparezcan en la misma
nube hace falta un lugar compartido donde escribir. Eso lo aporta Firebase.

---

## Parte 1 · Publicar el sitio en GitHub Pages

1. Entrá a <https://github.com> y creá una cuenta si no tenés.
2. Arriba a la derecha, **+** → **New repository**.
3. Ponele un nombre, por ejemplo `sala`. Marcá **Public**. Creá el repositorio.
4. En la pantalla que aparece, hacé clic en **uploading an existing file**.
5. Arrastrá los archivos de esta carpeta: `index.html`, `styles.css`, `app.js`, `config.js`,
   `database.rules.json`, `README.md`. Abajo, **Commit changes**.
6. Andá a la pestaña **Settings** del repositorio → menú izquierdo **Pages**.
7. En *Source* elegí **Deploy from a branch**; en *Branch* elegí `main` y la carpeta `/ (root)`.
   **Save**.
8. Esperá uno o dos minutos y recargá esa página: arriba va a aparecer la dirección,
   con el formato `https://TU-USUARIO.github.io/sala/`.

Si entrás ahora vas a ver el cartel "Conectá tu base de datos". Es lo esperado: falta la parte 2.

---

## Parte 2 · Crear la base de datos en Firebase

1. Entrá a <https://console.firebase.google.com> con tu cuenta de Google.
2. **Crear un proyecto**. Ponele un nombre. Podés desactivar Google Analytics.
3. Menú izquierdo: **Compilación → Realtime Database → Crear base de datos**.
   - Ubicación: la más cercana a tu público.
   - Reglas: elegí **modo bloqueado**; las reemplazamos enseguida.
4. En la pestaña **Reglas** de esa misma pantalla, borrá todo y pegá el contenido del archivo
   `database.rules.json` de este repositorio. **Publicar**.
5. Menú izquierdo: **Compilación → Authentication → Comenzar → Correo electrónico/contraseña →
   Habilitar → Guardar**. (Dejá desactivado el "vínculo por correo".)
6. En la pestaña **Users** de esa misma pantalla: **Agregar usuario**.
   - Correo electrónico: `tino@sala.local`
   - Contraseña: `tino123`

   Ese correo no recibe nada, es solo un identificador. En la pantalla de ingreso vos escribís
   `tino` y la aplicación le agrega `@sala.local` sola. Si querés otro dominio, cambialo en
   `config.js` (`window.LOGIN_DOMAIN`). Para sumar más presentadores, agregá más usuarios acá:
   cada uno ve solamente sus propias sesiones.

7. Menú izquierdo: **Configuración del proyecto** (el engranaje) → bajá hasta *Tus apps* →
   ícono **`</>`** (web) → registrá la app con cualquier nombre → **Registrar app**.
8. Copiá el bloque `firebaseConfig` que te muestra.

---

## Parte 3 · Unir las dos partes

1. En tu repositorio de GitHub abrí `config.js` → ícono del lápiz (**Edit this file**).
2. Reemplazá los valores de ejemplo por los tuyos:

```js
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSy...",
  authDomain: "mi-proyecto.firebaseapp.com",
  databaseURL: "https://mi-proyecto-default-rtdb.firebaseio.com",
  projectId: "mi-proyecto",
  storageBucket: "mi-proyecto.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abc123"
};
```

> Si en el bloque que te dio Firebase no aparece `databaseURL`, copiala de
> **Realtime Database**: es la dirección que figura arriba de la tabla de datos.

3. **Commit changes**. Esperá un minuto y recargá tu sitio: ya funciona.

**Sobre la `apiKey`:** es pública por diseño, se ve en el código de cualquier sitio web que use
Firebase. Lo que protege los datos son las reglas de la parte 2, no esa clave.

Opcional: en **Authentication → Settings → Authorized domains**, dejá solo
`TU-USUARIO.github.io` y `localhost`.

---

## Actualizar el sitio (y que el celular se entere)

Cuando cambies un archivo, GitHub publica la versión nueva en un minuto, pero los navegadores
suelen seguir usando la copia guardada de `app.js`. Por eso los enlaces de `index.html` llevan un
número de versión:

```html
<link rel="stylesheet" href="styles.css?v=5">
<script src="config.js?v=5"></script>
<script src="app.js?v=5"></script>
```

**Cada vez que subas una versión nueva, cambiá ese número en los tres enlaces** (de `v=5` a `v=6`,
y así). Con eso, todos los dispositivos descargan la copia nueva la primera vez que entran.

La pantalla de ingreso muestra abajo la versión que está corriendo. Si el teléfono y la
computadora muestran números distintos, el teléfono quedó con la copia vieja: cerrá la pestaña y
volvé a entrar, o abrila una vez en una ventana privada.

---

## Usarla en todas tus charlas

La portada tiene una lista con **Mis sesiones**: cada una que creás queda ahí, con su código y su
fecha, y desde la lista podés abrir el panel, **duplicarla** o borrarla. Duplicar copia todas las
preguntas en una sesión nueva con otro código: armás una vez tu batería de preguntas y la reusás
en cada exposición, sin rehacerla ni arrastrar las respuestas de la charla anterior.

La lista está atada a tu usuario, no al navegador: entrás con `tino` y `tino123` desde cualquier
computadora **o desde el teléfono**, y ahí están todas tus sesiones anteriores. El panel se adapta
a la pantalla chica: podés cambiar de pregunta y ver los resultados desde el celular mientras la
computadora proyecta.

Como las respuestas no hacen falta para siempre, borrá las sesiones viejas de vez en cuando desde
la lista: el botón elimina la sesión, sus respuestas y su resumen de una sola vez.

### Cambiar la contraseña

Consola de Firebase → **Authentication → Users** → los tres puntos al final de la fila →
*Restablecer contraseña* o *Editar usuario*. La clave nunca está escrita en los archivos del
sitio: la valida Firebase en el servidor. `tino123` es corta; si el sitio va a estar publicado
mucho tiempo, poné una más larga.

### El público sigue siendo anónimo

No hay registro, ni correo, ni cuenta, ni nada que atar a una persona. Escanean el QR, contestan y
listo. Lo único que se guarda por respuesta es un identificador al azar generado en el propio
teléfono, que sirve para que la aplicación sepa que ya contestó y para que puedas exportar las
respuestas agrupadas como P1, P2, P3. Ese identificador no dice nada de quién es. En la
exportación tampoco aparece.

---

## Auditorios: cómo aguanta 400 personas

El plan gratuito de Realtime Database permite **100 conexiones permanentes simultáneas**. Si los
400 celulares abrieran una conexión permanente, del participante 101 en adelante nadie entraría.

La aplicación evita el problema: **los celulares no abren conexión permanente**. Hacen pedidos
HTTP sueltos, que no cuentan para ese límite, contra un nodo diminuto que dice qué pregunta está
activa. Cada teléfono consulta una vez cada 4 a 7 segundos, con una variación al azar para que no
pregunten todos en el mismo instante. La conexión permanente la usa solo el panel del presentador:
una, de las cien disponibles.

Cuentas para una charla de una hora con 400 personas, en modo auditorio:

| | Consumo | Tope gratuito |
|---|---|---|
| Conexiones simultáneas | 1 (tu panel) | 100 |
| Descarga | unos 60 MB | 10 GB por mes |
| Almacenado | menos de 1 MB | 1 GB |

### Ajustes antes de una sala grande

1. **Desactivá "Mostrar los resultados en los celulares"** en la barra lateral del panel. En un
   auditorio la gente mira la pantalla, no el teléfono; con esto cada celular descarga unos 50
   bytes por consulta en lugar de la nube entera. Es lo que baja el consumo de 600 MB a 60 MB.
2. **Abrí el panel en una sola computadora.** Cada panel abierto consume una de las 100
   conexiones. No lo dejes abierto en cinco pestañas.
3. **Probá con dos celulares** conectados a la wifi del lugar el día anterior. El cuello de
   botella más habitual no es Firebase sino la wifi del auditorio: si es mala, pediles a los
   participantes que usen datos móviles.
4. **Proyectá el código además del QR.** Desde la fila 20 un QR chico no se escanea; el código de
   seis caracteres y el link corto sí se pueden tipear.
5. **Cerrá la votación** cuando termines cada pregunta: los celulares dejan de poder escribir.

### Si querés resultados en vivo en los 400 celulares

Dejá la opción activada y pasá el proyecto al plan **Blaze** (pago por uso) en la consola de
Firebase. Una charla así consume unos pocos centavos de dólar; el plan pide tarjeta pero permite
poner una **alerta de presupuesto** en Google Cloud (por ejemplo, aviso al llegar a 1 dólar) para
quedarte tranquilo. Es la única razón para pasar a Blaze: en modo auditorio el plan gratuito
alcanza.

---

## Cómo se usa

**Antes**

1. Entrá a tu sitio y hacé clic en **Crear sesión**.
2. Escribí la primera pregunta. Con **+ Nube** y **+ Encuesta** agregás las siguientes.
3. Guardá el link del panel (el que termina en `#/host/ABC123`) en los favoritos: es el único
   modo de volver a entrar, y solo funciona desde el mismo navegador con el que la creaste.

**Durante**

- Proyectá el panel y usá **Presentar** para que ocupe toda la pantalla.
- Al hacer clic en una pregunta de la lista, todos los celulares saltan a esa pregunta en pocos
  segundos.
- **Cerrar votación** frena nuevas respuestas sin borrar nada.

**Después**

- **Descargar resultados** baja tres archivos: `-resumen.csv` (conteos y porcentajes),
  `-detalle.csv` (una fila por respuesta, con seudónimos P1, P2, P3…) y un `.json` con todo.
  Los CSV abren en Excel con los acentos correctos.

---

## Opciones

| Opción | Dónde | Qué hace |
|---|---|---|
| Palabras por participante | por pregunta | 1 a 5 casilleros por persona en las nubes. |
| Control de groserías | por pregunta | *Rechazar*: no deja enviar. *Censurada*: asteriscos. *Sin control*: pasa tal cual. |
| Ocultar resultados hasta responder | por pregunta | Evita el efecto arrastre. |
| Permitir elegir varias opciones | por pregunta | Encuestas de opción múltiple. |
| Mostrar resultados en los celulares | por sesión | Apagalo en salas grandes. |
| Palabras bloqueadas | por sesión | Lista propia, separada por comas, que se suma al diccionario incluido. |

El filtro compara palabra por palabra ignorando mayúsculas, acentos, letras repetidas
(`miiiierda`), números en lugar de letras (`m13rda`) y letras separadas (`p u t a`). No detecta
insultos armados con ingenio; para eso están la lista propia y el botón de borrar respuestas.

---

## Límites conocidos

- **El envío de respuestas es público.** Para que 400 teléfonos no tengan que crear cuentas
  (Firebase limita las altas por dirección IP, y en una wifi de auditorio todos comparten la
  misma), el nodo de respuestas acepta escrituras sin identificación. Alguien con el código y
  ganas de arruinarlo podría mandar respuestas de más. Sirve para una sala, no para una elección
  con consecuencias.
- **Una respuesta por navegador**, recordada en el propio teléfono. Quien borra sus datos o entra
  desde otro dispositivo puede volver a votar.
- **Ocultar los resultados se aplica en la interfaz.** El celular muestra la nube recién después
  de enviar, pero el resumen viaja por un nodo de lectura pública: alguien con conocimientos
  técnicos y el código de la sesión podría leerlo antes de contestar. Es el precio de que el
  público no tenga que identificarse. Si te importa que nadie lo vea antes de tiempo, apagá
  *Mostrar los resultados en los celulares* y dejalos solo en la pantalla.
- **Los resultados en los celulares dependen del panel abierto**: el resumen que leen los
  teléfonos lo publica el panel del presentador cada segundo y medio. Si cerrás el panel, los
  celulares dejan de actualizarse (las respuestas se siguen guardando igual).
- **Editar opciones con votos ya emitidos** desplaza los conteos. Mejor borrar las respuestas de
  esa pregunta después de editarla.
- Hasta 60 palabras visibles por nube y 10 opciones por encuesta.

## Archivos

```
index.html            estructura de la página
styles.css            estilos
app.js                toda la lógica
config.js             lo único que tenés que editar
database.rules.json   reglas de seguridad para pegar en Firebase
```
