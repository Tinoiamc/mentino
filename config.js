/* =========================================================================
   PEGÁ ACÁ LA CONFIGURACIÓN DE TU PROYECTO DE FIREBASE.
   La encontrás en: consola de Firebase > Configuración del proyecto >
   Tus apps > App web > SDK setup and configuration > Config.

   Reemplazá los valores de ejemplo. No hace falta tocar ningún otro archivo.
   ========================================================================= */

window.FIREBASE_CONFIG = {
  apiKey: "PEGA_TU_API_KEY",
  authDomain: "PEGA_TU_PROYECTO.firebaseapp.com",
  databaseURL: "https://PEGA_TU_PROYECTO-default-rtdb.firebaseio.com",
  projectId: "PEGA_TU_PROYECTO",
  storageBucket: "PEGA_TU_PROYECTO.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:0000000000000000000000"
};

/* Nombre que aparece en el encabezado. Cambialo si querés. */
window.APP_NAME = "Sala";

/* Dominio interno de los usuarios del panel. Al escribir "tino" en la pantalla
   de ingreso, la aplicación entra como "tino@sala.local", que es el usuario que
   creaste en Firebase (Authentication → Users). No recibe correo: es solo un
   identificador. Cambialo únicamente si creaste tus usuarios con otro dominio. */
window.LOGIN_DOMAIN = "sala.local";
