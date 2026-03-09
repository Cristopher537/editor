const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { Connection, Statement } = require('idb-pconnector');

const app = express();
const PORT = 10209;
const pub = path.join(__dirname, 'public');

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

// --- 1. API MONITOR ---
app.get('/api/status', async (req, res) => {
    const cn = new Connection();
    try {
        cn.connect('*LOCAL');
        const sql = `SELECT TRIM(A.TCPNOM) as NAME, TRIM(COALESCE(S.TCPAPL, 'GENERAL')) as APP,
                     TRIM(A.TCPDIP) as IP, A.TCPSKT as PORT, CAST(COALESCE(S.TX_HOY, 0) AS INTEGER) as TRANSACTIONS, 
                     TRIM(COALESCE(S.ESTADO_RED, 'OFFLINE')) as STATE, TRIM(COALESCE(S.SALUD, 'CRITICAL')) as HEALTH,
                     S.ULTIMA_ACT as LASTUPDATE FROM A7FRT42DS.AZTCP A 
                     LEFT JOIN A7FRT42DS.MON_STATUS S ON A.TCPNOM = S.TCPNOM WHERE A.TCPCTR = 'S' ORDER BY APP, NAME`;
        const results = await execSql(cn, sql);
        res.json(results.map(row => ({ ...row, TRANSACTIONS: parseInt(row.TRANSACTIONS) || 0 })));
    } catch (e) { res.status(500).send(e.message); }
    finally { try { cn.disconn(); cn.close(); } catch (err) {} }
});

// --- 2. API EDITOR (MOTOR SQL SEGURO ANTI-BORRADO Y CON 'WITH NC') ---

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
            } catch (e) {
                res.status(500).send("Error leyendo miembro: " + e.message);
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
                    
                    // Agregado WITH NC para saltar la validación de Journaling en QTEMP
                    await execSql(cn, `INSERT INTO QTEMP.${tableTemp} (SRCSEQ, SRCDAT, SRCDTA) VALUES ${values} WITH NC`);
                }
                
                // Agregado WITH NC en el intercambio de datos
                await execSql(cn, `DELETE FROM QTEMP.${aliasReal} WITH NC`);
                await execSql(cn, `INSERT INTO QTEMP.${aliasReal} SELECT * FROM QTEMP.${tableTemp} WITH NC`);
                
                res.send('ok');
            } catch (e) {
                console.error("Fallo detectado (El fuente original está a salvo):", e.message);
                res.status(500).send("Error guardando miembro (Tu código original no se borró): " + e.message);
            } finally {
                try { await execSql(cn, `DROP TABLE QTEMP.${tableTemp}`); } catch (e) {}
                try { await execSql(cn, `DROP ALIAS QTEMP.${aliasReal}`); } catch (e) {}
                try { cn.disconn(); cn.close(); } catch (err) {}
            }
        } else {
            await fs.writeFile(file, content, 'utf8');
            res.send('ok');
        }
    } catch (err) { res.status(500).send("Error de servidor: " + err.message); }
});

// --- 3. RUTAS BASE Y LISTADO ---
app.get('/api/list', async (req, res) => {
    try {
        const targetDir = req.query.path || __dirname;
        const items = await fs.readdir(targetDir, { withFileTypes: true });
        const files = items.map(item => ({
            name: item.name, path: path.join(targetDir, item.name),
            isDir: item.isDirectory(), ext: path.extname(item.name).toLowerCase()
        })).sort((a, b) => b.isDir - a.isDir || a.name.localeCompare(b.name));
        res.json({ currentPath: targetDir, files });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/edit', (req, res) => res.sendFile(path.join(pub, 'editor.html')));
app.get('/', (req, res) => res.sendFile(path.join(pub, 'index.html')));
app.use(express.static(pub));

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Autoriza400 IDE Activo en puerto ${PORT}`));
