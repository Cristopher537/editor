const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { Connection, Statement } = require('idb-pconnector');

const app = express();
const PORT = 10209;
const pub = path.join(__dirname, 'public');

app.use(express.json());

// --- 1. RUTAS DE LA API (Prioridad Máxima) ---

// API MONITOR
app.get('/api/status', async (req, res) => {
    const cn = new Connection();
    try {
        cn.connect('*LOCAL');
        const st = new Statement(cn);
        const sql = `
            SELECT 
                TRIM(A.TCPNOM) as NAME, 
                TRIM(COALESCE(S.TCPAPL, 'GENERAL')) as APP,
                TRIM(A.TCPDIP) as IP, 
                A.TCPSKT as PORT, 
                CAST(COALESCE(S.TX_HOY, 0) AS INTEGER) as TRANSACTIONS, 
                TRIM(COALESCE(S.ESTADO_RED, 'OFFLINE')) as STATE, 
                TRIM(COALESCE(S.SALUD, 'CRITICAL')) as HEALTH,
                S.ULTIMA_ACT as LASTUPDATE
            FROM A7FRT42DS.AZTCP A 
            LEFT JOIN A7FRT42DS.MON_STATUS S ON A.TCPNOM = S.TCPNOM 
            WHERE A.TCPCTR = 'S'
            ORDER BY APP, NAME
        `;
        const results = await st.exec(sql);
        res.json(results.map(row => ({ ...row, TRANSACTIONS: parseInt(row.TRANSACTIONS) || 0 })));
    } catch (e) { res.status(500).send(e.message); }
    finally { try { cn.disconn(); cn.close(); } catch (err) {} }
});

// API EDITOR: Listar
app.get('/api/list', async (req, res) => {
    try {
        const targetDir = req.query.path || __dirname;
        const items = await fs.readdir(targetDir, { withFileTypes: true });
        const files = items.map(item => ({
            name: item.name,
            path: path.join(targetDir, item.name),
            isDir: item.isDirectory(),
            ext: path.extname(item.name).toLowerCase()
        })).sort((a, b) => b.isDir - a.isDir || a.name.localeCompare(b.name));
        res.json({ currentPath: targetDir, files });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// API EDITOR: Leer
app.get('/api/read', async (req, res) => {
    try {
        res.send(await fs.readFile(req.query.path, 'utf8'));
    } catch (err) { res.status(500).send(err.message); }
});

// API EDITOR: Guardar
app.post('/api/save', async (req, res) => {
    try {
        await fs.writeFile(req.body.file, req.body.content, 'utf8');
        res.send('ok');
    } catch (err) { res.status(500).send(err.message); }
});

// --- 2. RUTAS DE NAVEGACIÓN (Páginas) ---

app.get('/edit', (req, res) => {
    res.sendFile(path.join(pub, 'editor.html'));
});

// Dashboard (Raíz)
app.get('/', (req, res) => {
    res.sendFile(path.join(pub, 'index.html'));
});

// --- 3. ARCHIVOS ESTÁTICOS ---
app.use(express.static(pub));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Autoriza400 IDE & Monitor en puerto ${PORT}`);
});
