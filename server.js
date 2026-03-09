/**
 * IBM i Web IDE - Server Engine (Con Logs de Depuracion)
 * Ubicacion: /home/CRODRIGUEZ/server.js
 */
const express = require('express');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const PORT = 10209;
const pub = path.join(__dirname, 'public');

app.use(express.static(pub));
app.use(express.json());

// Middleware para ver peticiones en tiempo real
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  next();
});

// API: Listar archivos (.js, .html, .txt, .sql)
app.get('/api/list', async (req, res) => {
  console.log('[DEBUG] Solicitud de lista recibida');
  try {
    const f1 = await fs.readdir(__dirname);
    const f2 = await fs.readdir(pub);
    const filter = f => f.endsWith('.js') || f.endsWith('.html') || f.endsWith('.txt') || f.endsWith('.sql');
    
    const response = { root: f1.filter(filter), public: f2.filter(filter) };
    console.log(`[DEBUG] Enviando ${response.root.length + response.public.length} archivos`);
    res.json(response);
  } catch (err) { 
    console.error('[ERROR] Error en readdir:', err.message);
    res.status(500).send(err.message); 
  }
});

// API: Leer archivo
app.get('/api/read', async (req, res) => {
  try {
    const p = req.query.path.startsWith('public/') 
      ? path.join(pub, req.query.path.replace('public/','')) : path.join(__dirname, req.query.path);
    console.log('[DEBUG] Leyendo:', p);
    res.send(await fs.readFile(p, 'utf8'));
  } catch (err) { res.status(500).send(err.message); }
});

// API: Guardar archivo
app.post('/api/save', async (req, res) => {
  try {
    const { file, content } = req.body;
    const p = file.startsWith('public/') 
      ? path.join(pub, file.replace('public/','')) : path.join(__dirname, file);
    await fs.writeFile(p, content, 'utf8');
    console.log('[OK] Guardado exitoso:', file);
    res.send('ok');
  } catch (err) { res.status(500).send(err.message); }
});

// Ruta principal
app.get('/', (req, res) => res.sendFile(path.join(pub, 'index.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log('--------------------------------------');
  console.log(' IDE INICIADO EN PUERTO: ' + PORT);
  console.log(' ESPERANDO CONEXIONES...');
  console.log('--------------------------------------');
});
