const express = require('express');
const path = require('path');
const fs = require('fs').promises;
// Si no usas la DB por ahora, puedes comentar la línea de idb-pconnector
// const { Connection, Statement } = require('idb-pconnector');

const app = express();
const PORT = 10209;
const pub = path.join(__dirname, 'public');

app.use(express.json());

// --- NAVEGACIÓN ---
app.get('/edit', (req, res) => {
    res.sendFile(path.join(pub, 'editor.html'));
});

// --- API ---
app.get('/api/list', async (req, res) => {
    try {
        const f1 = await fs.readdir(__dirname);
        const f2 = await fs.readdir(pub);
        const flt = f => f.endsWith('.js') || f.endsWith('.html') || f.endsWith('.sql');
        res.json({ 
            root: f1.filter(flt), 
            public: f2.filter(flt) 
        });
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/api/read', async (req, res) => {
    try {
        const p = req.query.path.startsWith('public/')
            ? path.join(pub, req.query.path.replace('public/','')) 
            : path.join(__dirname, req.query.path);
        res.send(await fs.readFile(p, 'utf8'));
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/api/save', async (req, res) => {
    try {
        // Cambiado 'fileName' a 'file' para que coincida con tu editor.html
        const { file, content } = req.body; 
        const p = file.startsWith('public/')
            ? path.join(pub, file.replace('public/','')) 
            : path.join(__dirname, file);
        await fs.writeFile(p, content, 'utf8');
        res.send('ok');
    } catch (err) { res.status(500).send(err.message); }
});

// Archivos estáticos
app.use(express.static(pub));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`> IDE Corriendo en http://localhost:${PORT}/edit`);
});
