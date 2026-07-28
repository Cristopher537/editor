const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { Connection, execSql } = require('idb-pconnector');

const app = express();
const PORT = 10209;

// Ampliamos el límite para soportar archivos de código fuente grandes
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Ruta explícita para /edit
app.get('/edit', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'editor.html'));
});

function parseQsysPath(ifsPath) {
    const s = ifsPath.toUpperCase();
    
    function getVal(key) {
        let idx = s.indexOf(key);
        if (idx === -1) return '';
        let sub = s.substring(0, idx);
        let slash = sub.lastIndexOf('/');
        return slash === -1 ? sub : sub.substring(slash + 1);
    }

    return {
        lib: getVal('.LIB'),
        file: getVal('.FILE'),
        mbr: getVal('.MBR')
    };
}

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
                
                const chunkSize = 10; 
                let seqCounter = 100.00;
                
                for (let i = 0; i < lines.length; i += chunkSize) {
                    const chunk = lines.slice(i, i + chunkSize);
                    const values = chunk.map(line => {
                        let seq = seqCounter.toFixed(2);
                        seqCounter += 1.00;
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
    } catch (err) { 
        console.error("ERROR DETALLADO AL GUARDAR:", err);
        res.status(500).send("Fallo de DB2/IFS al guardar: " + err.message); 
    }
});

app.listen(PORT, () => {
    console.log(`Servidor activo en puerto ${PORT}`);
});
