// Blanqueo de contraseñas de Territorio (Cloud Run functions · Node.js 20).
// Un superior le genera una contraseña nueva a alguien de su equipo. La cabeza puede blanquear a cualquiera de su campaña.
const functions = require('@google-cloud/functions-framework');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();

// Desde dónde se puede llamar (la app publicada y pruebas locales)
const ORIGENES = [/^https:\/\/estebandiaz-gif\.github\.io$/i, /^http:\/\/localhost(:\d+)?$/];

functions.http('blanquearClave', async (req, res) => {
  const origen = req.get('origin') || '';
  if (ORIGENES.some((r) => r.test(origen))) { res.set('Access-Control-Allow-Origin', origen); res.set('Vary', 'Origin'); }
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    let yo;
    try { yo = await admin.auth().verifyIdToken(token); } catch { return res.status(401).json({ error: 'Tu sesión venció. Cerrá sesión y volvé a entrar.' }); }

    const uid = String((req.body && req.body.uid) || '');
    if (!uid) return res.status(400).json({ error: 'Falta a quién blanquear.' });
    if (uid === yo.uid) return res.status(400).json({ error: 'Para tu propia contraseña usá Mi cuenta → Cambiar mi contraseña.' });

    const db = admin.firestore();
    const [miCuenta, suCuenta] = await Promise.all([db.doc(`cuentas/${yo.uid}`).get(), db.doc(`cuentas/${uid}`).get()]);
    const cid = miCuenta.exists ? miCuenta.data().cid : null;
    if (!cid || !suCuenta.exists || suCuenta.data().cid !== cid) return res.status(403).json({ error: 'Esa persona no es de tu campaña.' });

    const [miDoc, suDoc] = await Promise.all([
      db.doc(`campanias/${cid}/usuarios/${yo.uid}`).get(),
      db.doc(`campanias/${cid}/usuarios/${uid}`).get()
    ]);
    if (!miDoc.exists || !suDoc.exists) return res.status(403).json({ error: 'Esa persona ya no está en el equipo.' });
    const yoU = miDoc.data(); const el = suDoc.data();
    const esSuperior = yoU.rol === 'cabeza' || (Array.isArray(el.path) && el.path.includes(yo.uid));
    if (!esSuperior || yoU.rol === 'fiscal') return res.status(403).json({ error: 'Solo podés blanquear a gente de tu equipo.' });

    const pass = String(crypto.randomInt(100000, 1000000));
    await admin.auth().updateUser(uid, { password: pass });
    await admin.auth().revokeRefreshTokens(uid);
    await db.collection(`campanias/${cid}/registro`).add({ tipo: 'blanqueo', de: yo.uid, a: uid, at: admin.firestore.FieldValue.serverTimestamp() });
    return res.json({ pass });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo blanquear. Probá de nuevo en un rato.' });
  }
});
