# Territorio — app de campaña

PWA (se instala en el celular) para organizar una campaña:
**Cabezas → Encargados de circuito → Dirigentes → Movilizadores → su gente**.

- Cada uno ve solo lo suyo y lo de su equipo. Las cabezas ven todo.
- Cada uno agrega a los del nivel de abajo (entran con su DNI y una contraseña).
- Cargar persona: se escribe el DNI y se completan nombre, escuela, mesa y orden desde el padrón.
- Un DNI solo puede estar una vez en toda la campaña. Si otro intenta cargarlo, queda bloqueado y registrado; puede reclamar y lo deciden las cabezas.
- Día E: lista por escuela, botón "Ya votó", traslados pendientes, porcentaje en vivo.
- Panel: tablero por circuito y por equipo, conflictos, importar planillas (Excel, CSV, Word) y padrón, exportar Excel.
- Funciona sin señal y sincroniza cuando vuelve.

## Probarla ya (modo demo)

Mientras `js/config.js` tenga `FIREBASE_CONFIG = null`, la app arranca en modo demo con datos inventados
guardados en el navegador. Se entra eligiendo un rol (todas las contraseñas son `1234`).

## Ponerla en marcha con Firebase

1. Entrá a https://console.firebase.google.com y creá un proyecto (plan Spark gratis alcanza para empezar).
2. **Authentication → Sign-in method →** activá **Correo electrónico/contraseña**.
3. **Firestore Database → Crear base de datos** (modo producción, región `southamerica-east1`).
4. **Firestore → Reglas:** pegá todo el contenido de `firestore.rules` y publicá.
5. **Configuración del proyecto → Tus apps → Web (`</>`)**: registrá la app y copiá el objeto `firebaseConfig`.
6. Pegalo en `js/config.js` en lugar de `null`:
   ```js
   export const FIREBASE_CONFIG = { apiKey: '...', authDomain: '...', projectId: '...', storageBucket: '...', messagingSenderId: '...', appId: '...' };
   ```
7. **Authentication → Configuración → Dominios autorizados:** agregá tu dominio de GitHub Pages (ej. `estebandiaz-gif.github.io`).
8. Subí la carpeta a un repo de GitHub y activá **Settings → Pages** (rama `main`, carpeta raíz).
9. Abrí la página → **Crear una campaña nueva** → quedás como cabeza.

Cada vez que publiques cambios, subí el número de `VERSION` en `sw.js` para que los celulares bajen la versión nueva.

## Padrón

El padrón lo recibe el partido o la alianza. Se sube desde **Panel → Padrón oficial** (solo cabezas) en Excel o CSV.
Detecta solas las columnas DNI, nombre, domicilio, circuito, escuela, dirección de la escuela, mesa y orden.
Se guarda en 1000 documentos (por los últimos 3 dígitos del DNI): buscar un DNI cuesta 1 lectura y subir
un padrón entero cuesta como mucho 1000 escrituras, así que entra en el plan gratis.

Conviene borrar el padrón cuando termina la elección y no compartirlo entre campañas.

## Límites del plan gratis (Spark)

50.000 lecturas y 20.000 escrituras por día. Para una campaña de unos miles de personas alcanza.
El día de la elección, con muchos usuarios abiertos a la vez, puede convenir pasar a Blaze (pago por uso, centavos).

## Archivos

| Archivo | Qué hace |
| --- | --- |
| `index.html` | Página de la app |
| `css/app.css` | Diseño (claro y oscuro) |
| `js/config.js` | Nombre de la app, zona y configuración de Firebase |
| `js/roles.js` | Jerarquía, estados y utilidades de DNI y teléfono |
| `js/app.js` | Pantallas: Gente, Cargar, Día E, Equipo, Panel |
| `js/importers.js` | Lectura de Excel, CSV y Word; detección de columnas; exportar Excel |
| `js/store-firebase.js` | Datos reales (Firebase Auth + Firestore, con caché sin señal) |
| `js/store-demo.js` | Modo demo con datos inventados |
| `firestore.rules` | Seguridad: quién ve y edita qué según la jerarquía |
| `sw.js`, `manifest.json`, `icons/` | Instalación como app y uso sin señal |
