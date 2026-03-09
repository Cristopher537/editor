const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const util = require('util');
const { Connection, Statement } = require('idb-pconnector');

const execPromise = util.promisify(exec);
const app = express();
const PORT = 10209;
const pub = path.join(__dirname, 'public');

app.use(express.json());

/**
 * Formatea ruta para SQL: /QSYS.LIB/LIB.LIB/FILE.FILE/MBR.MBR -> LIB.FILE(MBR)
 */
function formatForSql(ifsPath) {
    const parts = ifsPath.split('/');
    const lib = parts[2].split('.')[0];
    const file = parts[3].split('.')[0];
    const mbr = parts[4].split('.')[0];
    return `${lib}.${file}`; // Retorna LIB.FILE
}

function getMemberName(ifsPath) {
    return ifsPath.split('/')[4].split('.')[0];
}

// --- 1. API MONITOR ---
app.get('/api/status', async (req, res) => {
    const cn = new Connection();
    try {
        cn.connect('*LOCAL');
        const st = new Statement(cn);
        const sql = `SELECT TRIM(A.TCPNOM) as NAME, TRIM(COALESCE(S.TCPAPL, 'GENERAL')) as APP,
                     TRIM(A.TCPDIP) as IP, A.TCPSKT as PORT, CAST(COALESCE(S.TX_HOY, 0) AS INTEGER) as TRANSACTIONS, 
                     TRIM(COALESCE(S.ESTADO_RED, 'OFFLINE')) as STATE, TRIM(COALESCE(S.SALUD, 'CRITICAL')) as HEALTH,
                     S.ULTIMA_ACT as LASTUPDATE FROM A7FRT42DS.AZTCP A 
                     LEFT JOIN A7FRT42DS.MON_STATUS S ON A.TCPNOM = S.TCPNOM WHERE A.TCPCTR = 'S' ORDER BY APP, NAME`;
        const results = await st.exec(sql);
        res.json(results.map(row => ({ ...row, TRANSACTIONS: parseInt(row.TRANSACTIONS) || 0 })));
    } catch (e) { res.status(500).send(e.message); }
    finally { try { cn.disconn(); cn.close(); } catch (err) {} }
});

// --- 2. API EDITOR (SEGURIDAD REFORZADA PARA MBR) ---

app.get('/api/read', async (req, res) => {
    try {
        const filePath = req.query.path;
        if (filePath.toUpperCase().includes('QSYS.LIB')) {
            // Usamos SQL (db2) para leer el miembro. Esto evita problemas de CPYTOSTMF
            // Seleccionamos solo la columna SRCDTA (el código) ignorando secuencia y fecha
            const libFile = formatForSql(filePath);
            const mbr = getMemberName(filePath);
            
            // Comando que extrae el fuente limpio usando alias temporales de SQL
            const sqlCmd = `alias qtemp.editmbr for ${libFile}(${mbr}); select SRCDTA from qtemp.editmbr;`;
            const { stdout } = await execPromise(`db2 "${sqlCmd}"`);
            
            // db2 devuelve un formato con cabeceras, lo limpiamos
            const lines = stdout.split('\n').slice(3); // Quitamos cabeceras de db2
            res.send(lines.join('\n'));
        } else {
            res.send(await fs.readFile(filePath, 'utf8'));
        }
    } catch (err) { res.status(500).send("Error lectura: " + err.message); }
});

app.post('/api/save', async (req, res) => {
    try {
        const { file, content } = req.body;
        if (file.toUpperCase().includes('QSYS.LIB')) {
            const libFile = formatForSql(file);
            const mbr = getMemberName(file);
            const tempPath = `/tmp/save_${Date.now()}.txt`;
            
            // Escribimos el contenido a un temporal
            await fs.writeFile(tempPath, content, 'utf8');

            // MÉTODO SEGURO: Limpiar miembro y recargar con CPYFRMSTMF pero con parámetros de fuente
            // Usamos CVTDTA(*NONE) para evitar que el SO intente adivinar y rompa el archivo
            const cmd = `system "CPYFRMSTMF FROMSTMF('${tempPath}') TOMBR('/QSYS.LIB/${libFile.replace('.','.LIB/')}.FILE/${mbr}.MBR') MBROPT(*REPLACE) STMFCCSID(1208) DBCCSID(*FILE) CVTDTA(*NONE)"`;
            
            await execPromise(cmd);
            await fs.unlink(tempPath);
            res.send('ok');
        } else {
            await fs.writeFile(file, content, 'utf8');
            res.send('ok');
        }
    } catch (err) { res.status(500).send("Error guardado: " + err.message); }
});

// --- 3. RUTAS NAVEGACIÓN ---
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

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Monitor e IDE Seguro en puerto ${PORT}`));
