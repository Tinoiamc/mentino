/* =========================================================================
   PEGÁ ACÁ LA CONFIGURACIÓN DE TU PROYECTO DE FIREBASE.
   La encontrás en: consola de Firebase > Configuración del proyecto >
   Tus apps > App web > SDK setup and configuration > Config.

   Reemplazá los valores de ejemplo. No hace falta tocar ningún otro archivo.
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

/* Dominio interno de los usuarios del panel. Al escribir "tino" en la pantalla
   de ingreso, la aplicación entra como "tino@sala.local", que es el usuario que
   creaste en Firebase (Authentication → Users). No recibe correo: es solo un
   identificador. Cambialo únicamente si creaste tus usuarios con otro dominio. */
window.LOGIN_DOMAIN = "sala.local";
