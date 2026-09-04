/* =========================================================================
   CONFIGURACIÓN DE FIREBASE — proyecto "mentino" (mentino-e299b).
   La encontrás en: consola de Firebase > Configuración del proyecto >
   Tus apps > App web > SDK setup and configuration > Config.

   La apiKey es pública por diseño: se ve en el código de cualquier sitio
   que use Firebase. Lo que protege los datos son las reglas de la base
   (database.rules.json), no esta clave.
   ========================================================================= */

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyAy9Vx4LKhFixntp58hgTjqic6nonlTCI0",
  authDomain: "mentino-e299b.firebaseapp.com",
  databaseURL: "https://mentino-e299b-default-rtdb.firebaseio.com",
  projectId: "mentino-e299b",
  storageBucket: "mentino-e299b.firebasestorage.app",
  messagingSenderId: "1096418689580",
  appId: "1:1096418689580:web:cc8d6855a6c58a5552c789"
};

/* Nombre que aparece en el encabezado. Cambialo si querés. */
window.APP_NAME = "Sala";
