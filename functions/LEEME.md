# Blanqueo de contraseñas (requiere plan Blaze)

Esta función le permite a un superior generarle una contraseña nueva a alguien de su equipo.

## Cómo subirla (desde el navegador, sin instalar nada)

1. Entrá a https://console.cloud.google.com y elegí el proyecto **territorio-5422c**.
2. Buscá **Cloud Run** → **Escribir una función** (Write a function).
3. Completá:
   - Nombre del servicio: `blanquear-clave`
   - Región: `us-central1` (o la de tu Firestore)
   - Entorno de ejecución: **Node.js 20**
   - Autenticación: **Permitir invocaciones no autenticadas** (la función verifica sola quién la llama)
4. En el editor:
   - Reemplazá `index.js` y `package.json` por los de esta carpeta.
   - Punto de entrada (Function entry point): `blanquearClave`
5. Tocá **Guardar e implementar**. Tarda 2 o 3 minutos.
6. Copiá la dirección que te da (termina en `.run.app`) y pegala en `js/config.js`:
   `export const URL_CLAVES = 'https://blanquear-clave-xxxx.us-central1.run.app';`
7. Subí `js/config.js` a GitHub. Listo: aparece el botón **"Se olvidó la contraseña: blanquear"** en Equipo → ⋯.

Costo: prácticamente cero (los primeros 2 millones de llamadas por mes son gratis).
