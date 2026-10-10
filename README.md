# Sala

Nubes de palabras, encuestas y competencias de preguntas en vivo para audiencias.
Alternativa mínima a Mentimeter, con link y QR para que la gente entre, resultados en
tiempo real en la pantalla del presentador, exportación a CSV/JSON, opción de ocultar los
resultados hasta que la persona responda y control de groserías. Las preguntas se escriben
una por una o se cargan de una plantilla de texto.

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
   `quiz.js`, `quiz.css`, `cartera.js`, `cartera.css`, `database.rules.json`, `README.md`. Abajo, **Commit changes**.
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
<link rel="stylesheet" href="styles.css?v=10">
<link rel="stylesheet" href="quiz.css?v=10">
<link rel="stylesheet" href="cartera.css?v=10">
<script src="config.js?v=10"></script>
<script src="quiz.js?v=10"></script>
<script src="cartera.js?v=10"></script>
<script src="app.js?v=10"></script>
```

**Cada vez que subas una versión nueva, cambiá ese número en los siete enlaces** (de `v=10` a `v=11`,
y así). Con eso, todos los dispositivos descargan la copia nueva la primera vez que entran.
El número que muestra la pantalla de ingreso sale de la constante `BUILD`, arriba de `app.js`:
conviene moverla junto con los enlaces.

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
2. Escribí la primera pregunta. Con **+ Nube** y **+ Encuesta** agregás las siguientes, y con
   **Cargar plantilla** subís de una vez una tanda entera escrita en un archivo de texto
   (más abajo, *Cargar las preguntas desde una plantilla*). Las
   preguntas se reordenan **arrastrándolas** en la lista, o con las flechas ↑ ↓ de cada una.

   El enunciado no tiene tope de caracteres: el campo crece mientras escribís y **Enter** hace un
   salto de línea (para guardar sin soltar el teclado, **Ctrl+Enter**). En la pantalla proyectada y
   en el celular del público la tipografía se achica sola hasta que la pregunta entra completa, así
   que una consigna larga se acomoda al espacio en lugar de recortarse. Lo mismo vale para las
   opciones de una encuesta y para el nombre de la sesión.
3. Guardá el link del panel (el que termina en `#/host/ABC123`) en los favoritos: es el único
   modo de volver a entrar, y solo funciona desde el mismo navegador con el que la creaste.

**Durante**

- Proyectá el panel y usá **Presentar** para que ocupe toda la pantalla.
- Al hacer clic en una pregunta de la lista, todos los celulares saltan a esa pregunta en pocos
  segundos.
- **Mostrar los resultados**: el botón debajo del escenario decide cuándo se proyectan. Hasta que
  lo toques, la pantalla muestra la pregunta (y las opciones, si es una encuesta) más el contador
  de respuestas, pero ningún resultado. Así nadie se sesga con lo que ya votaron los demás.
- Las **flechas ← →** del teclado, o las teclas de un presentador inalámbrico, hacen las dos cosas
  en orden: la primera vez revelan los resultados de la pregunta actual, la segunda pasan a la
  siguiente. Hacia atrás, igual pero al revés.
- **Cerrar votación** frena nuevas respuestas sin borrar nada.

### Manejarlo desde el teléfono mientras la computadora proyecta

En la barra lateral del panel, **Control desde el celular → Mostrar el QR de control**. Escaneá
ese QR con tu teléfono (la primera vez te va a pedir tu usuario y contraseña) y te abre una
pantalla chica con: la pregunta actual, *Anterior* y *Siguiente*, **Mostrar los resultados**,
cuántos contestaron, el botón de abrir y cerrar la votación, el listado para saltar a cualquier
pregunta y **los resultados en vivo**.

Esos resultados en el teléfono los ves siempre, estén proyectados o no: podés mirar cómo viene la
votación mientras seguís hablando y recién después decidir mostrarla. Funciona igual con la
computadora en modo *Presentar*: el proyector obedece lo que tocás en el teléfono.

Lo que hagas ahí se refleja en la pantalla proyectada al instante. Ese QR es solo para vos: quien
lo escanee sin tu contraseña no entra. El del público sigue siendo el otro, el de arriba.

Si además de esto tenés diapositivas de PowerPoint, lo más cómodo es:

1. Dejar el navegador abierto en otra ventana, con el panel en modo **Presentar**.
2. En PowerPoint: *Presentación con diapositivas → Configurar → Examinada por una persona
   (ventana)*. Así la presentación corre en una ventana y podés pasar al navegador con Alt+Tab
   sin cortar nada. Si preferís el modo pantalla completa de siempre, Alt+Tab también funciona:
   la presentación queda esperando atrás.
3. Poné una diapositiva con el QR y el código de la sala justo antes de cada pregunta
   interactiva, para dar tiempo a que entren mientras hablás.
4. En el momento de la pregunta, Alt+Tab al navegador y desde ahí manejá todo con el teléfono.

**Después**

- **Descargar resultados** baja tres archivos: `-resumen.csv` (conteos y porcentajes),
  `-detalle.csv` (una fila por respuesta, con seudónimos P1, P2, P3…) y un `.json` con todo.
  Los CSV abren en Excel con los acentos correctos.

---

## Cargar las preguntas desde una plantilla

El botón **Cargar plantilla**, en la barra lateral del panel, abre un cuadro donde pegás el
texto de tus preguntas o cargás un archivo `.txt`. Las preguntas se **agregan al final** de
las que ya tenés: no se pisa ni se borra nada. El mismo botón está en el panel de encuestas
y en el del modo competitivo.

Antes de agregar nada, el cuadro muestra la lista de lo que entendió. Si algo está mal
escrito, lo dice y no deja continuar. **Pegar el ejemplo** llena el cuadro con una plantilla
de muestra y **Descargar el ejemplo** la baja como archivo, para usarla de molde.

### El formato

Es un archivo de texto común, del Bloc de notas o de Word guardado como texto plano:

```
En una palabra, ¿cómo llegaste hoy?
palabras: 2
filtro: rechazar

¿Cuál de estos temas querés que veamos primero?
- Cómo se forma el precio
- Quién controla el mercado
- Qué pasa si quiebra un agente

ENCUESTA: ¿Habías operado alguna vez?
- Nunca
- Alguna vez
- Opero seguido
ocultar: si
```

Las reglas son cuatro:

- **Una línea suelta es una pregunta.** Si abajo no tiene opciones, queda como nube de palabras.
- **Las líneas que empiezan con `-` son las opciones** de la pregunta de arriba, y eso la
  convierte en encuesta. Un `*` en lugar del guión marca la **opción correcta**: hace falta en
  el modo competitivo y se ignora en las encuestas, así que un mismo archivo sirve para los dos.
- **`clave: valor`, cada uno en su línea, ajusta la pregunta de arriba.** Las claves son
  `palabras` (1 a 5), `filtro` (`rechazar`, `censurar` o `libre`), `multiple` (`si`/`no`),
  `ocultar` (`si`/`no`), `segundos` (5 a 120, modo competitivo) y `correcta` (el número de la
  opción, si preferís no usar asteriscos).
- **Las líneas que empiezan con `#` son comentarios** y no se cargan.

Detalles que suelen aparecer: numerar las preguntas (`1.`, `2)`) no molesta, se saca sola;
escribir `NUBE:` o `ENCUESTA:` delante de una pregunta fuerza el tipo; las líneas en blanco no
hacen falta pero se aceptan; una pregunta con dos puntos en el medio (`Tema del día: ¿qué te
llevás?`) sigue siendo una pregunta, porque solo las claves de la lista cuentan como ajuste.

Los topes son los mismos que cargando a mano: hasta diez opciones por encuesta y hasta seis
por pregunta del modo competitivo, que además exige una correcta marcada en cada una.

---

## Modo competitivo

Además de las nubes y las encuestas, el mismo sitio tiene una competencia de preguntas contra
reloj: el público entra con un nombre (sin cuenta ni correo), contesta, y gana quien acierta y
es rápido. Se entra desde **Modo competitivo**, arriba a la derecha de la portada, o yendo
directo a `TU-SITIO/#/comp`.

- La respuesta correcta **no viaja al público**: vive en un nodo aparte que solo puede leer el
  anfitrión. El puntaje lo calcula el panel y publica la tabla ya resuelta.
- Acertar da los puntos de la pregunta; contestar sobre el final conserva la mitad; errar o no
  llegar, cero. Los dos valores se cambian en la barra lateral del panel.
- El público entra con el código de seis caracteres por la misma dirección que las encuestas:
  la aplicación se da cuenta sola de si ese código es de una sesión o de una competencia.
- Las preguntas se cargan de a una o con **Cargar plantilla**, marcando la correcta con `*`.

---

## Armá tu cartera (ejercicio guiado)

El ejercicio de `arma-tu-cartera.html`, jugado por toda la sala a la vez y guiado por vos desde el
celular. Se entra desde **Modo competitivo → Armá tu cartera**, o directo a `TU-SITIO/#/cartera`.
El público entra con el mismo código de seis caracteres y la misma dirección que todo lo demás.

**Los diez pasos.** Tres preguntas de perfil, la elección de cartera y seis rondas de decisiones
(años 2 a 10). Cada paso tiene reloj: se abre, se cierra solo al terminar el tiempo (o antes, con
*Cerrar ya*) y la pantalla muestra qué eligió la sala. En las rondas, además, qué pasó, los
rendimientos de esos años y la plata promedio de cada cartera. Después del paso de la cartera, la
pantalla muestra en barras el perfil que sugirió el cuestionario contra la cartera que eligieron.

**El perfil sugiere, cada uno elige.** El celular muestra la cartera sugerida, pero se puede elegir
cualquiera de las tres.

**Cómo se gana.** Hay cuatro rankings: mejor cartera conservadora, moderada, agresiva y de la sala.
Gana la plata final; a igual plata, el que contestó más rápido (se suman los tiempos de la elección
de cartera y de las seis rondas). Quien no contesta una ronda queda como *no hizo nada* y su cartera
sigue andando, pero **no entra al ranking**: para competir hay que elegir cartera y contestar las seis
rondas. Así alguien que dejó la pestaña abierta sin jugar no puede ganar.

**Azar.** Cada sala juega un mercado distinto: los rendimientos de los años 3 a 10 varían un poco
alrededor de los de referencia. Todos en la misma sala viven el mismo mercado, como en la realidad,
así que lo que separa a los jugadores son las decisiones y, a igualdad, la velocidad. Al crear o
reiniciar la sala, el panel descarta los sorteos en los que el mejor resultado posible no queda
en el orden agresiva, moderada, conservadora. Los números que citan los textos (la caída del año 1,
el 26% del año 2 y el −60% de la acción del dato) no cambian.

**Cambios respecto del HTML original.** La compra del año 2 pasó de "la mitad del money market" a
"un 10% de la cartera": con la versión anterior, la conservadora con las mejores decisiones
terminaba arriba de la agresiva. El texto de "qué pasó" en los años 9 y 10 dice ahora "Un año en
rojo y otro bueno", que es lo que muestran esos dos años.

**Durante la charla**

1. Creá la sala y abrí el panel en la computadora que proyecta. **Presentar** lo pone en pantalla
   completa.
2. **Control desde el celular** muestra un QR solo para vos: escanealo y manejás todo desde el teléfono
   (avanzar, volver, cerrar, reabrir y, al final, revelar cada ranking). En el teléfono ves las
   respuestas antes que la sala, y los podios antes de revelarlos.
3. En el panel también funcionan las flechas ← → y la barra espaciadora (cierra la pregunta).
4. Después de la última ronda, *Ir a los rankings*: cada categoría arranca con 3, 2, 1 y el podio se
   revela de abajo hacia arriba. Al terminar, cada celular muestra su puesto y su análisis completo.
5. **CSV** baja una fila por persona: perfil, cartera, cada respuesta, tiempo, plata final y puestos.

**Ajustes** permite cambiar los segundos por pregunta (25 por defecto; la elección de cartera suma
15), reiniciar la sala (borra las respuestas, conserva a los anotados y sortea otro mercado) y
borrarla.

El consumo es el mismo que el del modo competitivo: los textos y las cuentas viven en `cartera.js`,
así que por la base solo viajan el paso activo, unas diez respuestas por persona y la tabla final.

---

## Opciones

| Opción | Dónde | Qué hace |
|---|---|---|
| Palabras por participante | por pregunta | 1 a 5 casilleros por persona en las nubes. |
| Control de groserías | por pregunta | *Rechazar*: no deja enviar. *Censurada*: asteriscos. *Sin control*: pasa tal cual. |
| Ocultar resultados hasta responder | por pregunta | En el celular, cada uno ve los resultados recién después de enviar su respuesta. |
| Mostrar los resultados | botón, por pregunta | Decide cuándo se proyectan y cuándo llegan a los celulares. Arranca siempre oculto. |
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
  de enviar, y mientras no reveles nada el resumen ni siquiera se publica; pero una vez revelado
  viaja por un nodo de lectura pública, así que alguien con conocimientos técnicos y el código
  podría leerlo sin haber contestado. Es el precio de que el
  público no tenga que identificarse. Si te importa que nadie lo vea antes de tiempo, apagá
  *Mostrar los resultados en los celulares* y dejalos solo en la pantalla.
- **Los resultados en los celulares dependen del panel abierto**: el resumen que leen los
  teléfonos lo publica el panel del presentador cada segundo y medio. Si cerrás el panel, los
  celulares dejan de actualizarse (las respuestas se siguen guardando igual).
- **Editar opciones con votos ya emitidos** desplaza los conteos. Mejor borrar las respuestas de
  esa pregunta después de editarla.
- Hasta 60 palabras visibles por nube y 10 opciones por encuesta.
- **Las preguntas y las opciones no tienen tope de largo**, pero conviene la mesura: a partir de
  unos 350 caracteres la tipografía ya llegó a su tamaño mínimo y el texto sigue creciendo hacia
  abajo, así que en el proyector ocupa buena parte de la pantalla. Las respuestas del público
  siguen limitadas a 40 caracteres por palabra, que es lo que validan las reglas de Firebase.
- Si una opción de encuesta supera los 90 caracteres, la respuesta viaja con el número de opción y
  no con su texto; la exportación lo reconstruye igual desde la pregunta.

## Archivos

```
index.html            estructura de la página
styles.css            estilos
app.js                la lógica de las nubes, las encuestas y las plantillas
quiz.js               la lógica del modo competitivo
quiz.css              estilos propios del modo competitivo
cartera.js            Armá tu cartera (ejercicio guiado del modo competitivo)
cartera.css           sus estilos, con la estética de BYMAEDUCA
config.js             lo único que tenés que editar
database.rules.json   reglas de seguridad para pegar en Firebase
```

`quiz.js` no arranca por su cuenta: define `window.QUIZ` y espera a que `app.js` lo llame.
La conexión con Firebase, el ingreso y el ruteo son únicos y viven en `app.js`, que se los
presta por `window.ENC`. Por eso `quiz.js` va **antes** que `app.js` en `index.html`.

> Si ya tenías publicada una versión anterior, volvé a pegar `database.rules.json` en la
> consola de Firebase: ahora incluye los nodos del modo competitivo (`quizzes`, `qsec`,
> `qplayers`, `qa`, `qrank`, `qmine`) y los de Armá tu cartera (`carteras`, `cplayers`, `cans`,
> `crank`, `cmine`). Sin eso, la competencia y el ejercicio no guardan nada.
