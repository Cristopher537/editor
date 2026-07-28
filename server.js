const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const multer = require('multer');
const { Connection, Statement } = require('idb-pconnector');

const app = express();
const PORT = 10209;
const pub = path.join(__dirname, 'public');

const storage = multer.diskStorage({
    destination: (req, file, cb) => { cb(null, req.query.path || __dirname); },
    filename: (req, file, cb) => { cb(null, file.originalname); }
});
const upload = multer({ storage });

app.use(express.json());

function parseQsysPath(ifsPath) {
    const parts = ifsPath.toUpperCase().split('/');
    const lib = parts[2].replace('.LIB', '');
    const file = parts[3].replace('.FILE', '');
    const mbr = parts[4].replace('.MBR', '');
    return { lib, file, mbr };
}

async function execSql(cn, sql) {
    const st = new Statement(cn);
    try {
        return await st.exec(sql);
    } finally {
        try { st.close(); } catch (e) {} 
    }
}

// --- 1. API MONITOR (JOIN BLINDADO POR APLICACIÓN) ---
app.get('/api/status', async (req, res) => {
    const cn = new Connection();
    try {
        cn.connect('*LOCAL');
        const sql = `
            SELECT 
                TRIM(A.TCPNOM) as NAME, 
                TRIM(COALESCE(A.TCPAPL, 'GENERAL')) as APP,
                TRIM(A.TCPDIP) as IP, 
                A.TCPSKT as PORT, 
                TRIM(A.TCPTYP) as TYPE,
                TRIM(A.TCPPVT) as ROLE,
                CAST(COALESCE(S.TX_HOY, 0) AS INTEGER) as TRANSACTIONS, 
                TRIM(COALESCE(S.ESTADO_RED, 'OFFLINE')) as STATE, 
                TRIM(COALESCE(S.SALUD, 'CRITICAL')) as HEALTH,
                S.ULTIMA_ACT as LASTUPDATE 
            FROM A7FRT42DS.AZTCP A 
            LEFT JOIN A7FRT42DS.MON_STATUS S 
                ON A.TCPNOM = S.TCPNOM 
               AND COALESCE(A.TCPAPL, 'GENERAL') = S.TCPAPL
            WHERE A.TCPCTR = 'S' 
            ORDER BY 
                A.TCPTYP ASC,
                APP ASC, 
                CASE TRIM(COALESCE(S.SALUD, 'CRITICAL')) 
                    WHEN 'CRITICAL' THEN 1 
                    WHEN 'WARNING' THEN 2 
                    WHEN 'GOOD' THEN 3
                    ELSE 4 
                END ASC,
                A.TCPPVT DESC,
                NAME ASC
        `;
        const results = await execSql(cn, sql);
        res.json(results.map(row => ({ ...row, TRANSACTIONS: parseInt(row.TRANSACTIONS) || 0 })));
    } catch (e) { res.status(500).send(e.message); }
    finally { try { cn.disconn(); cn.close(); } catch (err) {} }
});

// --- 2. API EDITOR ---
app.get('/api/read', async (req, res) => {
    try {
        const filePath = req.query.path;
        if (filePath.toUpperCase().includes('QSYS.LIB')) {
            const { lib, file, mbr } = parseQsysPath(filePath);
            const aliasName = `A${Date.now()}`; 
            const cn = new Connection();
            try {
                cn.connect('*LOCAL');
                await execSql(cn, `CREATE ALIAS QTEMP.${aliasName} FOR ${lib}.${file}(${mbr})`);
                const results = await execSql(cn, `SELECT SRCDTA FROM QTEMP.${aliasName} ORDER BY SRCSEQ`);
                const content = results.map(row => row.SRCDTA.trimEnd()).join('\n');
                res.send(content);
            } finally {
                try { await execSql(cn, `DROP ALIAS QTEMP.${aliasName}`); } catch (e) {}
                try { cn.disconn(); cn.close(); } catch (err) {}
            }
        } else {
            res.send(await fs.readFile(filePath, 'utf8'));
        }
    } catch (err) { res.status(500).send("Error de servidor: " + err.message); }
});

app.post('/api/save', async (req, res) => {
    try {
        const { file, content } = req.body;
        if (file.toUpperCase().includes('QSYS.LIB')) {
            const { lib, file: srcFile, mbr } = parseQsysPath(file);
            const uid = Date.now();
            const aliasReal = `R${uid}`;
            const tableTemp = `T${uid}`;
            const lines = content.replace(/\r\n/g, '\n').split('\n');
            const cn = new Connection();
            try {
                cn.connect('*LOCAL');
                await execSql(cn, `CREATE ALIAS QTEMP.${aliasReal} FOR ${lib}.${srcFile}(${mbr})`);
                await execSql(cn, `CREATE TABLE QTEMP.${tableTemp} LIKE ${lib}.${srcFile}`);
                
                const chunkSize = 50; 
                let seqCounter = 1;
                
                for (let i = 0; i < lines.length; i += chunkSize) {
                    const chunk = lines.slice(i, i + chunkSize);
                    const values = chunk.map(line => {
                        let seq = (seqCounter++).toFixed(2);
                        if (seqCounter > 9999) seqCounter = 1; 
                        const safeLine = line.replace(/'/g, "''"); 
                        return `(${seq}, 0, '${safeLine}')`;
                    }).join(',');
                    await execSql(cn, `INSERT INTO QTEMP.${tableTemp} (SRCSEQ, SRCDAT, SRCDTA) VALUES ${values} WITH NC`);
                }
                
                await execSql(cn, `DELETE FROM QTEMP.${aliasReal} WITH NC`);
                await execSql(cn, `INSERT INTO QTEMP.${aliasReal} SELECT * FROM QTEMP.${tableTemp} WITH NC`);
                res.send('ok');
            } finally {
                try { await execSql(cn, `DROP TABLE QTEMP.${tableTemp}`); } catch (e) {}
                try { await execSql(cn, `DROP ALIAS QTEMP.${aliasReal}`); } catch (e) {}
                try { cn.disconn(); cn.close(); } catch (err) {}
            }
        } else {
            await fs.writeFile(file, content, 'utf8');
            res.send('ok');
        }
    } catch (err) { res.status(500).send("Fallo de DB2/IFS al guardar: " + err.message); }
});

// --- 3. API TRANSFERENCIA ---
app.get('/api/download', async (req, res) => {
    try {
        const filePath = req.query.path;
        if (filePath.toUpperCase().includes('QSYS.LIB')) {
            const { lib, file, mbr } = parseQsysPath(filePath);
            const aliasName = `D${Date.now()}`; 
            const cn = new Connection();
            try {
                cn.connect('*LOCAL');
                await execSql(cn, `CREATE ALIAS QTEMP.${aliasName} FOR ${lib}.${file}(${mbr})`);
                const results = await execSql(cn, `SELECT SRCDTA FROM QTEMP.${aliasName} ORDER BY SRCSEQ`);
                const content = results.map(row => row.SRCDTA.trimEnd()).join('\n');
                res.setHeader('Content-disposition', `attachment; filename=${mbr}.txt`);
                res.setHeader('Content-type', 'text/plain');
                res.send(content);
            } finally {
                try { await execSql(cn, `DROP ALIAS QTEMP.${aliasName}`); } catch (e) {}
                try { cn.disconn(); cn.close(); } catch (err) {}
            }
        } else {
            res.download(filePath);
        }
    } catch (err) { res.status(500).send("Error en la descarga: " + err.message); }
});

app.post('/api/upload', upload.single('file'), (req, res) => { res.json({ success: true }); });

app.post('/api/create', async (req, res) => {
    try {
        const fullPath = path.join(req.body.folder, req.body.name);
        await fs.writeFile(fullPath, '', 'utf8');
        res.json({ success: true, path: fullPath });
    } catch (err) { res.status(500).send(err.message); }
});

// --- 4. MÓDULO SQL ---
app.post('/api/query', async (req, res) => {
    try {
        let { sql } = req.body;
        if (!sql) return res.status(400).send("Consulta SQL vacía.");

        const upperSql = sql.toUpperCase().trim();

        if (!upperSql.startsWith('SELECT')) {
            return res.status(403).send("Por seguridad, este módulo solo permite consultas SELECT.");
        }
        if (!upperSql.match(/FETCH\s+FIRST/)) {
            sql += ' FETCH FIRST 100 ROWS ONLY';
        }
        if (!upperSql.match(/WITH\s+(UR|NC|CS|RS|RR)/)) {
            sql += ' WITH UR';
        }

        const cn = new Connection();
        try {
            cn.connect('*LOCAL');
            const results = await execSql(cn, sql);
            res.json(results);
        } finally {
            try { cn.disconn(); cn.close(); } catch (err) {}
        }
    } catch (err) { 
        res.status(500).send("Error de SQL: " + err.message); 
    }
});

// --- 5. RUTAS BASE ---
app.get('/api/list', async (req, res) => {
    try {
        const targetDir = req.query.path || __dirname;
        const items = await fs.readdir(targetDir, { withFileTypes: true });
        const files = items.map(item => ({
            name: item.name, path: path.join(targetDir, item.name),
            isDir: item.isDirectory(), ext: path.extname(item.name).toLowerCase()
        })).sort((a, b) => b.isDir - a.isDir || a.name.localeCompare(b.name));
        res.json({ currentPath: targetDir, files });
    } catch (err) { 
        // Se envía un array vacío "files: []" para que el frontend no colapse si falla un directorio
        res.status(500).json({ error: err.message, files: [] }); 
    }
});

app.get('/edit', (req, res) => res.sendFile(path.join(pub, 'editor.html')));
app.get('/sql', (req, res) => res.sendFile(path.join(__dirname, 'sql.html')));
app.get('/', (req, res) => res.sendFile(path.join(pub, 'index.html')));
app.use(express.static(pub));

app.listen(PORT, '0.0.0.0', () => console.log(`activo en puerto ${PORT}`));
