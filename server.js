const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { Connection, Statement } = require('idb-pconnector');

const app = express();
const PORT = 10209;
const pub = path.join(__dirname, 'public');

// --- MIDDLEWARES ---
app.use(express.json());

// --- RUTAS DE NAVEGACIÓN ---
// Importante: Definidas antes del static para evitar conflictos
app.get('/', (req, res) => {
    res.sendFile(path.join(pub, 'index.html'));
});

app.get('/edit', (req, res) => {
    const filePath = path.join(pub, 'editor.html');
    res.sendFile(filePath, (err) => {
        if (err) {
            console.error("Error: No se encontró editor.html en " + pub);
            res.status(404).send("Error: El archivo editor.html no existe en la carpeta public.");
        }
    });
});

// --- API EDITOR (Rutas corregidas para coincidir con el cliente) ---

// 1. Listar archivos
app.get('/api/list', async (req, res) => {
    try {
        const f1 = await fs.readdir(__dirname);
        const f2 = await fs.readdir(pub);
        const flt = f => f.endsWith('.js') || f.endsWith('.html') || f.endsWith('.sql');
        res.json({ root: f1.filter(flt), public: f2.filter(flt) });
    } catch (err) { 
        res.status(500).send(err.message); 
    }
});

// 2. Leer contenido de un archivo
app.get('/api/read', async (req, res) => {
    try {
        const filePathParam = req.query.path;
        if (!filePathParam) return res.status(400).send('Falta el parámetro path');

        const p = filePathParam.startsWith('public/')
            ? path.join(pub, filePathParam.replace('public/', '')) 
            : path.join(__dirname, filePathParam);
            
        const content = await fs.readFile(p, 'utf8');
        res.send(content);
    } catch (err) { 
        res.status(500).send(err.message); 
    }
});

// 3. Guardar cambios en un archivo
app.post('/api/save', async (req, res) => {
    try {
        const { fileName, content } = req.body;
        if (!fileName) return res.status(400).send('Falta el nombre del archivo');

        const p = fileName.startsWith('public/')
            ? path.join(pub, fileName.replace('public/', '')) 
            : path.join(__dirname, fileName);
            
        await fs.writeFile(p, content, 'utf8');
        res.send('ok');
    } catch (err) { 
        res.status(500).send(err.message); 
    }
});

// --- API STATUS (Base de Datos) ---
app.get('/api/status', async (req, res) => {
    const cn = new Connection();
    try {
        cn.connect('*LOCAL');
        const st = new Statement(cn);
        const sql = "SELECT A.TCPNOM as name, A.TCPDIP as ip, A.TCPSKT as port, A.TCPDIR as type, " +
            "COALESCE(S.ESTADO_RED, 'UNKNOWN') as state, COALESCE(S.TX_HOY, 0) as txToday, " +
            "COALESCE(S.SALUD, 'CRITICAL') as health FROM A7FRT42DS.AZTCP A " +
            "LEFT JOIN A7FRT42DS.MON_STATUS S ON A.TCPNOM = S.TCPNOM WHERE A.TCPCTR = 'S'";
        res.json(await st.exec(sql));
    } catch (e) { 
        res.status(500).send(e.message);
    } finally { 
        try { cn.disconn(); cn.close(); } catch (err) {} 
    }
});

// --- ARCHIVOS ESTÁTICOS ---
app.use(express.static(pub));

// --- INICIO DEL SERVIDOR ---
app.listen(PORT, '0.0.0.0', () => {
    console.log('====================================');
    console.log('SERVIDOR INICIADO');
    console.log('Puerto: ' + PORT);
    console.log('URL Editor: http://localhost:' + PORT + '/edit');
    console.log('====================================');
});
