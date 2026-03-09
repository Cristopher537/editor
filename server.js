const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const util = require('util');
const { Connection, Statement } = require('idb-pconnector');

const execPromise = util.promisify(exec);
const app = express(); // <--- Aquí es donde se define 'app'
const PORT = 10209;
const pub = path.join(__dirname, 'public');

app.use(express.json());

// --- 1. API MONITOR (DASHBOARD) ---
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

// --- 2. API EDITOR (CON SOPORTE QSYS.LIB / MBR) ---

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

app.get('/api/read', async (req, res) => {
    try {
        const filePath = req.query.path;
        // Si es un miembro de librería (QSYS.LIB)
        if (filePath.toUpperCase().includes('QSYS.LIB')) {
            const tempPath = `/tmp/edit_temp_${Date.now()}.txt`;
            const cmd = `CPYTOSTMF FROMMBR('${filePath}') TOSTMF('${tempPath}') STMFOPT(*REPLACE) STMFCCSID(1208)`;
            await execPromise(`system "${cmd}"`);
            const content = await fs.readFile(tempPath, 'utf8');
            await fs.unlink(tempPath);
            res.send(content);
        } else {
            res.send(await fs.readFile(filePath, 'utf8'));
        }
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/api/save', async (req, res) => {
    try {
        const { file, content } = req.body;
        if (file.toUpperCase().includes('QSYS.LIB')) {
            const tempPath = `/tmp/save_temp_${Date.now()}.txt`;
            await fs.writeFile(tempPath, content, 'utf8');
            // CPYFRMSTMF convierte de UTF-8 de vuelta al CCSID del fuente
            const cmd = `CPYFRMSTMF FROMSTMF('${tempPath}') TOMBR('${file}') MBROPT(*REPLACE)`;
            await execPromise(`system "${cmd}"`);
            await fs.unlink(tempPath);
            res.send('ok');
        } else {
            await fs.writeFile(file, content, 'utf8');
            res.send('ok');
        }
    } catch (err) { res.status(500).send(err.message); }
});

// --- 3. RUTAS DE NAVEGACIÓN ---
app.get('/edit', (req, res) => res.sendFile(path.join(pub, 'editor.html')));
app.get('/', (req, res) => res.sendFile(path.join(pub, 'index.html')));

app.use(express.static(pub));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n***************************************`);
    console.log(`🚀 Autoriza400: Monitor e IDE activos`);
    console.log(`📍 Puerto: ${PORT}`);
    console.log(`***************************************\n`);
});
