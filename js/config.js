// Configuración general de la app.
// Mientras FIREBASE_CONFIG sea null, la app funciona en MODO DEMO (datos de prueba guardados en el celular).
// Para usarla de verdad, pegá acá la configuración de tu proyecto de Firebase (ver README.md).

export const APP_NAME = 'Territorio';

// Se agrega a las direcciones de las escuelas para el botón "Cómo llegar"
export const ZONA = 'Tucumán, Argentina';

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyByhoeuyD4hlV3PsBVNODiEzBk4bn2iz-Y',
  authDomain: 'territorio-5422c.firebaseapp.com',
  projectId: 'territorio-5422c',
  storageBucket: 'territorio-5422c.firebasestorage.app',
  messagingSenderId: '49513190181',
  appId: '1:49513190181:web:cda968c4a22653b30240cc'
};
/* Formato:
export const FIREBASE_CONFIG = {
  apiKey: '...',
  authDomain: 'tu-proyecto.firebaseapp.com',
  projectId: 'tu-proyecto',
  storageBucket: 'tu-proyecto.appspot.com',
  messagingSenderId: '...',
  appId: '...'
};
*/

// Los usuarios entran con DNI + contraseña. Internamente Firebase necesita un email,
// así que se arma como <dni>@<EMAIL_DOMAIN>. No hace falta que el dominio exista.
export const EMAIL_DOMAIN = 'usuarios.territorio.app';

// Blanqueo de contraseñas (plan pago de Firebase). Cuando subas la función de functions/blanquear-clave,
// pegá acá su dirección (termina en .run.app). Mientras esté vacío, el botón "Blanquear contraseña" no aparece.
export const URL_CLAVES = '';
