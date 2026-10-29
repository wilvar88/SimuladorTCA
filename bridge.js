const nfcCard = require('nfc-pcsc'); // Librería para interactuar con lectores NFC/PCSC
const WebSocket = require('ws'); // Librería para servidor WebSocket
const http = require('http'); // Librería para servidor HTTP (servir archivos locales)
const https = require('https'); // Librería para peticiones HTTPS (Google Sheets)
const fs = require('fs'); // Sistema de archivos para leer index.html, css, js
const path = require('path'); // Manejo de rutas de archivos

// Manejo de errores globales para evitar que la aplicación se cierre inesperadamente
process.on('uncaughtException', (err) => {
    console.error('🔥 Error crítico en el bridge:', err.message);
});

// Configuración de puertos
const HTTP_PORT = 3000;
const WS_PORT = 8080;

// Servidor WebSocket
const wss = new WebSocket.Server({ port: WS_PORT });
// Inicialización del subsistema NFC
const nfc = new nfcCard.NFC();

// --- GESTIÓN DE CONFIGURACIÓN DE DISPOSITIVOS ---
const DEVICES_FILE = path.join(__dirname, 'devices.json');
let devicesConfig = {
    devices: {
        "0068": {
            displayId: "0068",
            realSerial: "RR234-016879",
            readerName: "ACS ACR1251 1S CL Reader PICC 0",
            label: "Terminal 0068"
        },
        "0069": {
            displayId: "0069",
            realSerial: "RR234-016991",
            readerName: "ACS ACR1251 1S CL Reader PICC 1",
            label: "Terminal 0069"
        },
        "0071": {
            displayId: "0071",
            realSerial: "RR234-017108",
            readerName: "ACS ACR1251 1S CL Reader PICC 2",
            label: "Terminal 0071"
        }
    }
};

function loadDevicesConfig() {
    try {
        if (fs.existsSync(DEVICES_FILE)) {
            const data = fs.readFileSync(DEVICES_FILE, 'utf8');
            devicesConfig = JSON.parse(data);
            console.log("📋 Configuración de dispositivos cargada desde devices.json");
        } else {
            fs.writeFileSync(DEVICES_FILE, JSON.stringify(devicesConfig, null, 2), 'utf8');
            console.log("📝 Archivo devices.json creado con configuración por defecto.");
        }
    } catch (e) {
        console.error("⚠️ Error leyendo devices.json, usando valores por defecto:", e.message);
    }
}

function saveDevicesConfig() {
    try {
        fs.writeFileSync(DEVICES_FILE, JSON.stringify(devicesConfig, null, 2), 'utf8');
        console.log("💾 devices.json actualizado exitosamente.");
    } catch (e) {
        console.error("❌ Error guardando devices.json:", e.message);
    }
}

loadDevicesConfig();

/**
 * Obtiene el ID a mostrar (ej. 0068, 0069, 0071) dado el nombre del lector PC/SC
 */
function getDeviceInfoByReaderName(readerName) {
    if (!devicesConfig.devices) return null;
    for (const [id, dev] of Object.entries(devicesConfig.devices)) {
        if (dev.readerName && readerName.includes(dev.readerName)) {
            return dev;
        }
    }
    // Si no está explícito en la configuración, intentar mapeo por índice 0, 1, 2
    if (readerName.includes('PICC 0')) return devicesConfig.devices["0068"] || { displayId: "0068", realSerial: "RR234-016879" };
    if (readerName.includes('PICC 1')) return devicesConfig.devices["0069"] || { displayId: "0069", realSerial: "RR234-016991" };
    if (readerName.includes('PICC 2')) return devicesConfig.devices["0071"] || { displayId: "0071", realSerial: "RR234-017108" };
    return null;
}

// Almacena instancias activas de lectores conectados para control directo (Buzzer/LED)
const activeCardReaders = new Map();

/**
 * Hace sonar el buzzer de un lector ACR1251
 * @param {string} readerName - Nombre del lector
 * @param {number} durationUnits - Duración en unidades de 10ms (10 = 100ms)
 */
function triggerBuzzer(readerName, durationUnits = 10) {
    const r = activeCardReaders.get(readerName);
    if (!r) {
        console.warn(`⚠️ No se puede hacer sonar '${readerName}': no está en activeCardReaders`);
        return;
    }
    try {
        const rawReader = r.reader;
        rawReader.connect({ share_mode: rawReader.SCARD_SHARE_DIRECT, protocol: 0 }, (err) => {
            if (err) {
                console.warn(`⚠️ Error conectando directo para buzzer en ${readerName}:`, err.message);
                return;
            }
            const controlCode = rawReader.SCARD_CTL_CODE(3500);
            const cmd = Buffer.from([0xE0, 0x00, 0x00, 0x28, 0x01, Math.min(255, durationUnits)]);
            rawReader.control(cmd, controlCode, 255, (cErr) => {
                if (cErr) console.warn(`⚠️ Error comando buzzer en ${readerName}:`, cErr.message);
                else console.log(`🔔 Buzzer activado en ${readerName}`);
            });
        });
    } catch (e) {
        console.error(`Error activando buzzer en ${readerName}:`, e.message);
    }
}

// --- SERVIDOR WEB INTEGRADO (HTTP) ---
const server = http.createServer((req, res) => {
    // Permitir CORS para consultas desde Vercel o aplicaciones externas
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let pathname = parsedUrl.pathname;

    // API endpoints rápidos
    if (pathname === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'online',
            devices: devicesConfig.devices,
            activeReaders: Array.from(activeCardReaders.keys()),
            clientsCount: clients.size
        }));
        return;
    }

    if (pathname === '/api/beep') {
        const devId = parsedUrl.searchParams.get('device');
        if (devId && devicesConfig.devices[devId]) {
            const rName = devicesConfig.devices[devId].readerName;
            triggerBuzzer(rName, 12);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, device: devId, reader: rName }));
            return;
        }
    }

    // Ruta por defecto index.html
    let filePath = '.' + pathname;
    if (filePath === './') filePath = './index.html';

    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon'
    };

    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Archivo no encontrado');
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Error de servidor: ' + error.code);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(HTTP_PORT, () => {
    console.log(`🌐 Servidor web iniciado en http://localhost:${HTTP_PORT}`);
});

// --- MANEJO DE CLIENTES WEBSOCKET ---
const clients = new Set();

/**
 * Envía un mensaje a todos los clientes WebSocket conectados
 */
function broadcast(data) {
    const msg = JSON.stringify(data);
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    });
}

// --- CONFIGURACIÓN Y SINCRONIZACIÓN DE BASE DE DATOS (Google Sheets) ---
const DB_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ8ihPAX5tJ7UJ-jbKCp-bCvmnVBWrRrbeq_aaWVCI28nZt_xaouhaRrx85MSl_VBMH1cGtMVF9CNeY/pub?output=csv";
let cachedDB = "";

function httpsFetch(url, callback) {
    https.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return httpsFetch(res.headers.location, callback);
        }
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
            callback(null, data, res.statusCode);
        });
    }).on('error', (e) => {
        callback(e);
    });
}

async function syncDatabase() {
    try {
        console.log("📥 Sincronizando Base de Datos desde la nube...");
        broadcast({ type: 'DB_SYNC_START' });

        httpsFetch(DB_URL, (err, data, status) => {
            if (err) {
                console.error("❌ Error sincronizando DB:", err.message);
                broadcast({ type: 'DB_SYNC_ERROR', error: err.message });
                setTimeout(syncDatabase, 10000);
                return;
            }
            if (status === 200) {
                cachedDB = data;
                const lines = data.split(/\r?\n/).length - 1;
                console.log(`✅ Base de Datos sincronizada (${lines} registros, ${data.length} bytes).`);
                broadcast({ type: 'DB_SYNC', data: cachedDB });
            } else {
                console.error("❌ Error sincronizando DB: Status " + status);
                broadcast({ type: 'DB_SYNC_ERROR', status: status });
                setTimeout(syncDatabase, 30000);
            }
        });
    } catch (e) {
        console.error("❌ Error crítico en syncDatabase:", e);
    }
}

setInterval(syncDatabase, 300000);

// --- CONEXIONES WEBSOCKET ---
wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`✅ Cliente conectado al bridge (Total: ${clients.size})`);

    // Enviar DB en caché si está disponible
    if (cachedDB) {
        ws.send(JSON.stringify({ type: 'DB_SYNC', data: cachedDB }));
    }

    // Enviar información de dispositivos conectados
    ws.send(JSON.stringify({
        type: 'DEVICES_INFO',
        devices: devicesConfig.devices,
        activeReaders: Array.from(activeCardReaders.keys())
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'REQUEST_DB') {
                if (cachedDB) {
                    ws.send(JSON.stringify({ type: 'DB_SYNC', data: cachedDB }));
                } else {
                    syncDatabase();
                }
                return;
            }

            if (data.type === 'REQUEST_DEVICES') {
                ws.send(JSON.stringify({
                    type: 'DEVICES_INFO',
                    devices: devicesConfig.devices,
                    activeReaders: Array.from(activeCardReaders.keys())
                }));
                return;
            }

            if (data.type === 'BEEP_DEVICE') {
                const dev = devicesConfig.devices[data.deviceId];
                if (dev && dev.readerName) {
                    triggerBuzzer(dev.readerName, data.duration || 12);
                }
                return;
            }

            if (data.type === 'BEEP_READER') {
                if (data.readerName) {
                    triggerBuzzer(data.readerName, data.duration || 12);
                }
                return;
            }

            if (data.type === 'UPDATE_MAPPING') {
                if (data.devices) {
                    devicesConfig.devices = data.devices;
                    saveDevicesConfig();
                    broadcast({
                        type: 'DEVICES_INFO',
                        devices: devicesConfig.devices,
                        activeReaders: Array.from(activeCardReaders.keys())
                    });
                    console.log("🔄 Mapeo de dispositivos actualizado vía WebSocket");
                }
                return;
            }

            // Reenviar todos los demás mensajes (ej: REMOTE_KEY, PIU_UPDATE) a todos los clientes
            clients.forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(data));
                }
            });
        } catch (e) {
            console.error('Error procesando mensaje WebSocket:', e.message);
        }
    });

    ws.on('close', () => {
        clients.delete(ws);
        console.log(`❌ Cliente desconectado (Total restantes: ${clients.size})`);
    });
});

// --- DETECCIÓN DE HARDWARE NFC (Lectores ACR1251) ---
nfc.on('reader', (reader) => {
    const name = reader.reader.name;

    // Ignorar ranuras SAM para evitar conflictos
    if (name.includes('SAM')) return;

    console.log(`📡 Lector detectado: ${name}`);
    activeCardReaders.set(name, reader);

    // Notificar a todos los clientes que hay un lector activo
    broadcast({
        type: 'DEVICES_INFO',
        devices: devicesConfig.devices,
        activeReaders: Array.from(activeCardReaders.keys())
    });

    // Deshabilita el auto-procesamiento para control total de los comandos APDU
    reader.autoProcessing = false;

    async function tryReadStaticId() {
        try {
            const getUid = Buffer.from([0xff, 0xca, 0x00, 0x00, 0x00]);
            const response = await reader.transmit(getUid, 40);
            if (response.slice(-2).toString('hex') === '9000') {
                return response.slice(0, -2).toString('hex');
            }
        } catch (e) { }
        return null;
    }

    reader.on('error', (err) => {
        if (err.message && err.message.includes('AID was not set')) return;
        console.error(`⚠️ Error en lector ${name}:`, err.message);
    });

    // EVENTO: Tarjeta acercada al lector
    reader.on('card', async (card) => {
        let uid = card.uid;
        if (uid && Buffer.isBuffer(uid)) {
            uid = uid.toString('hex');
        } else if (uid && typeof uid === 'object') {
            try {
                uid = Buffer.from(uid).toString('hex');
            } catch (e) { uid = null; }
        }

        const atr = card.atr ? card.atr.toString('hex') : "";

        let manualUid = null;
        try {
            manualUid = await tryReadStaticId();
        } catch (err) { }

        const finalId = manualUid || uid || "";
        const finalAtr = atr || "";

        if (!finalId && !finalAtr) {
            console.log(`⚠️ No se pudo obtener datos de la tarjeta en ${name}`);
            return;
        }

        const devInfo = getDeviceInfoByReaderName(name);
        const deviceId = devInfo ? devInfo.displayId : null;
        const realSerial = devInfo ? devInfo.realSerial : null;

        console.log(`💳 [HW] Tarjeta en Lector '${name}' -> Asignado a Dispositivo: [${deviceId || 'DESCONOCIDO'}] (Serial Real: ${realSerial || 'N/A'})`);
        console.log(`   UID: '${finalId}', ATR: '${finalAtr}'`);

        // Emitir con el ID del dispositivo correspondiente
        broadcast({
            type: 'CARD_DETECTED',
            deviceId: deviceId, // "0068", "0069", "0071"
            readerName: name,
            realSerial: realSerial,
            uid: finalId,
            atr: finalAtr,
            staticId: finalId
        });
    });

    // EVENTO: Tarjeta retirada del lector
    reader.on('card.off', (card) => {
        const devInfo = getDeviceInfoByReaderName(name);
        const deviceId = devInfo ? devInfo.displayId : null;

        console.log(`📤 Tarjeta retirada de ${name} (Dispositivo: ${deviceId || 'N/A'})`);
        broadcast({
            type: 'CARD_REMOVED',
            deviceId: deviceId,
            readerName: name
        });
    });

    reader.on('end', () => {
        console.log(`🔌 Lector ${name} desconectado`);
        activeCardReaders.delete(name);
        broadcast({
            type: 'DEVICES_INFO',
            devices: devicesConfig.devices,
            activeReaders: Array.from(activeCardReaders.keys())
        });
    });
});

nfc.on('error', (err) => {
    console.error('❌ Error general de NFC:', err.message);
});

// Sincronización inicial
syncDatabase();

console.log('==================================================');
console.log('  BRIDGE MULTI-DISPOSITIVO TULLAVE - INICIADO');
console.log('==================================================');
console.log(`Dispositivos configurados:`);
console.log(`  - RR234-016879 -> ID: 0068`);
console.log(`  - RR234-016991 -> ID: 0069`);
console.log(`  - RR234-017108 -> ID: 0071`);
console.log(`Web Local:      http://localhost:${HTTP_PORT}`);
console.log(`WebSocket:      ws://localhost:${WS_PORT}`);
console.log('==================================================');
