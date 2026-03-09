const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { Connection, Statement } = require('idb-pconnector');

const app = express();
const PORT = 10209;
const pub = path.join(__dirname, 'public');

app.use(express.static(pub));
app.use(express.json());

// API EDITOR
app.get('/api/editor/list', async (req, res) => {
try {
const f1 = await fs.readdir(__dirname);
const f2 = await fs.readdir(pub);
const flt = f => f.endsWith('.js') || f.endsWith('.html') || f.endsWith('.sql');
res.json({ root: f1.filter(flt), public: f2.filter(flt) });
} catch (err) { res.status(500).send(err.message); }
});

app.get('/api/editor/read', async (req, res) => {
try {
const p = req.query.path.startsWith('public/')
? path.join(pub, req.query.path.replace('public/','')) : path.join(__dirname, req.query.path);
res.send(await fs.readFile(p, 'utf8'));
} catch (err) { res.status(500).send(err.message); }
});

app.post('/api/editor/save', async (req, res) => {
try {
const { fileName, content } = req.body;
const p = fileName.startsWith('public/')
? path.join(pub, fileName.replace('public/','')) : path.join(__dirname, fileName);
await fs.writeFile(p, content, 'utf8');
res.send('ok');
} catch (err) { res.status(500).send(err.message); }
});

// API STATUS
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
} catch (e) { res.status(500).send(e.message);
} finally { try { cn.disconn(); cn.close(); } catch (err) {} }
});

app.get('/', (req, res) => res.sendFile(path.join(pub, 'index.html')));
app.get('/edit', (req, res) => res.sendFile(path.join(pub, 'editor.html')));

app.listen(PORT, '0.0.0.0', () => console.log('Monitor iniciado en puerto ' + PORT));
