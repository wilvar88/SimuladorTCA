// CONFIGURACIÓN DE BASE DE DATOS (Recibida vía WebSocket)
let cardProfiles = {};
let rawDbRows = [];

function buildProfilesFromRows(rows) {
    const profiles = {};
    for (let i = 1; i < rows.length; i++) {
        const values = rows[i];
        if (values.length < 6) continue; // Mínimo hasta ATR

        const rawName = values[0] || "";
        const rawCedula = (values[1] || "").trim();
        const rawProfile = (values[2] || "").trim();
        const rawOpId = (values[3] || "").trim();
        const rawSerial = (values[4] || "").trim();
        const rawAtr = (values[5] || "").trim();

        const cleanAtr = rawAtr.replace(/[:\s-]/g, '').toLowerCase();
        const cleanSerial = rawSerial.replace(/[:\s-]/g, '').toLowerCase();
        const cleanOpId = rawOpId.replace(/[:\s-]/g, '').toLowerCase();

        // Estado según columna J ("ESTADO")
        let rawStatus = (values[9] || "").trim();
        if (!rawStatus) {
            rawStatus = rawProfile.toLowerCase() === 'operador' ? 'Activa' : 'Inactiva';
        }

        const profile = {
            name: rawName,
            cedula: rawCedula,
            profile: rawProfile,
            operatorId: rawOpId, // Mantener formato para visualización ("0000 1020")
            cleanOperatorId: cleanOpId,
            serial: cleanSerial,
            rawSerial: rawSerial,
            atr: cleanAtr,
            rawAtr: rawAtr,
            subsidyBalance: parseInt(values[6]) || 0,
            reimbursementBalance: parseInt(values[7]) || 0,
            balance: parseInt(values[8]) || 0,
            initialBalance: parseInt(values[8]) || 0,
            status: rawStatus,
            initialStatus: rawStatus
        };

        // Mapeo exhaustivo para garantizar detección por cualquier campo
        if (cleanAtr) profiles[cleanAtr] = profile;
        if (cleanSerial) profiles[cleanSerial] = profile;
        if (profile.cedula) profiles[profile.cedula.toLowerCase()] = profile;
        if (rawOpId) profiles[rawOpId.toLowerCase()] = profile;
        if (cleanOpId) profiles[cleanOpId] = profile;
    }
    cardProfiles = profiles;
    return profiles;
}

function restoreDatabaseInitialState() {
    if (rawDbRows && rawDbRows.length > 0) {
        console.log("🔄 Restaurando estados y saldos iniciales de tarjetas según Google Sheets...");
        buildProfilesFromRows(rawDbRows);
    }
}

function parseCSVDatabase(csvText) {
    try {
        console.log("📄 Procesando datos CSV recibidos...");
        const rows = csvText.split(/\r?\n/).filter(row => row.trim() !== "").map(row => row.split(',').map(v => v.trim()));
        console.log(`📊 Filas detectadas: ${rows.length}`);
        rawDbRows = rows;
        buildProfilesFromRows(rows);

        console.log("🔍 [DEBUG] Claves indexadas en cardProfiles:", Object.keys(cardProfiles));
        const count = Object.keys(cardProfiles).length;
        console.log("✅ DB Sincronizada:", count, "claves indexadas.");
        const dbStatus = document.getElementById('db-status');
        if (dbStatus) {
            dbStatus.innerText = `DB: OK (${count})`;
            dbStatus.style.color = "#00ff00";
        }
    } catch (e) {
        console.error("❌ Error parseando CSV:", e);
    }
}

// ESTADO GLOBAL
let currentCard = null;
let sessionActive = false;
let sessionStartTime = { date: "----", time: "----" };
let currentOperator = null;
let currentInput = "0";
let currentView = "welcome";
let adminContext = null; // 'subsidy', 'reimbursement', etc.
let ws = null; // Conexión WebSocket global para el bridge

let loginStep = 0; // 0: welcome, 1: op, 2: pass, 3: base
let loginPass = "";
let loginBase = "0";
let loginOpId = "";

let lastRechargeAmount = 0;
let lastRechargeCard = null;
let lastRechargeWasNegative = false;
let receiptCounter = 1;
let closingCashInput = "0";
const GOOGLE_SHEETS_URL = "https://script.google.com/macros/s/AKfycbwPu8mK6_JWWH2ErTgT5TKLQHUM_jcgGi68WZhcPMe0eBgjIoezzePjQoZKEGwB3zQIOg/exec";

// Estadísticas de la sesión (para cierre con 37 campos)
let stats = {
    nRecargas: 0, vRecargas: 0,
    nAnulacRecargas: 0, vAnulacRecargas: 0,
    nDescargaTarjetas: 0, vDescargaTarjetas: 0,
    nVentaTarjetas: 0, vVentaTarjetas: 0,
    nVentaTarjGratis: 0,
    nExcepcionRecargas: 0, vExcepcionRecargas: 0,
    nFallidas: 0, vFallidas: 0,
    nRecargaReembolsos: 0, vRecargaReembolsos: 0,
    nAnulacReembolso: 0, vAnulacReembolso: 0,
    nDevolucionBillete: 0, vDevolucionBillete: 0,
    nSubsidioConvenio: 0, vSubsidioConvenio: 0,
    nAnulacSubsidio: 0, vAnulacSubsidio: 0,
    saldoLsamInicio: 9205350,
    saldoLsamCierre: 9205350
};

function resetSessionStats() {
    stats = {
        nRecargas: 0, vRecargas: 0,
        nAnulacRecargas: 0, vAnulacRecargas: 0,
        nDescargaTarjetas: 0, vDescargaTarjetas: 0,
        nVentaTarjetas: 0, vVentaTarjetas: 0,
        nVentaTarjGratis: 0,
        nExcepcionRecargas: 0, vExcepcionRecargas: 0,
        nFallidas: 0, vFallidas: 0,
        nRecargaReembolsos: 0, vRecargaReembolsos: 0,
        nAnulacReembolso: 0, vAnulacReembolso: 0,
        nDevolucionBillete: 0, vDevolucionBillete: 0,
        nSubsidioConvenio: 0, vSubsidioConvenio: 0,
        nAnulacSubsidio: 0, vAnulacSubsidio: 0,
        saldoLsamInicio: 9205350,
        saldoLsamCierre: 9205350
    };
    lastRechargeAmount = 0;
    lastRechargeCard = null;
    lastRechargeWasNegative = false;
    closingCashInput = "0";
    currentInput = "0";
    console.log("🧹 Estadísticas de sesión reiniciadas a 0.");
}

// IDENTIFICACIÓN MULTI-DISPOSITIVO
const urlParams = new URLSearchParams(window.location.search);
let currentDeviceId = urlParams.get('device') || '0068';
window.currentDeviceId = currentDeviceId;

function updateTerminalDeviceUI() {
    const badge = document.getElementById('header-device-badge');
    const btnLabel = document.getElementById('btn-dev-label');
    const hwTag = document.getElementById('hw-dev-tag');
    if (badge) badge.innerText = `TCA - ${currentDeviceId}`;
    if (btnLabel) btnLabel.innerText = `DEV: ${currentDeviceId}`;
    if (hwTag) hwTag.innerText = `DISP: ${currentDeviceId}`;
    document.title = `Simulador TCA [${currentDeviceId}]`;
}

function switchDeviceModal() {
    const modal = document.getElementById('modal-device-switch');
    if (modal) modal.classList.add('active');
}

function setTerminalDevice(newId) {
    currentDeviceId = newId;
    window.currentDeviceId = newId;
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set('device', newId);
    window.history.replaceState({}, '', newUrl);
    updateTerminalDeviceUI();
    const modal = document.getElementById('modal-device-switch');
    if (modal) modal.classList.remove('active');
    console.log(`🔄 Terminal vinculada al Dispositivo: ${currentDeviceId}`);
}

// INITIALIZATION
window.onload = () => {
    updateTerminalDeviceUI();
    startTime();
    connectBridge();
    document.addEventListener('keydown', handleKeyPress);
    window.focus();
    document.body.addEventListener('click', () => window.focus());
    showView('welcome');
};

// RELOJ Y FECHA
function startTime() {
    const now = new Date();
    const dateStr = now.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.');
    const timeStr = now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

    const dateEl = document.getElementById('header-date');
    const timeEl = document.getElementById('header-time');

    if (dateEl) dateEl.innerText = dateStr;
    if (timeEl) timeEl.innerText = timeStr;

    setTimeout(startTime, 1000);
}

// DETECCIÓN INTELIGENTE DE URL PARA EL BRIDGE (Local y Vercel)
function getWsUrl() {
    let host = window.location.hostname || 'localhost';
    if (host.includes('vercel.app') || (window.location.protocol === 'https:' && host !== 'localhost')) {
        let savedIp = localStorage.getItem('local_pc_ip');
        if (!savedIp) {
            savedIp = prompt(`Ingresa la IP local de la PC con los lectores para la Terminal ${currentDeviceId}:`, "192.168.1.");
            if (savedIp) localStorage.setItem('local_pc_ip', savedIp);
        }
        if (savedIp) return `ws://${savedIp}:8080`;
    }
    return `ws://${host}:8080`;
}

// SISTEMA DE NOTIFICACIONES TOAST (Alerta de lector cruzado y estados)
function showToast(message, type = 'info') {
    let container = document.getElementById('tca-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'tca-toast-container';
        container.style.cssText = "position: fixed; top: 18px; left: 50%; transform: translateX(-50%); z-index: 999999; display: flex; flex-direction: column; gap: 8px; pointer-events: none;";
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    const bgColors = {
        info: '#0284c7',
        warning: '#d97706',
        success: '#16a34a',
        danger: '#dc2626'
    };
    const bg = bgColors[type] || '#222';
    toast.style.cssText = `background: ${bg}; color: white; padding: 12px 24px; border-radius: 8px; font-weight: 700; font-size: 1.05rem; box-shadow: 0 6px 20px rgba(0,0,0,0.5); pointer-events: auto; text-align: center; border: 1px solid rgba(255,255,255,0.2); transition: all 0.3s;`;
    toast.innerHTML = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        setTimeout(() => toast.remove(), 400);
    }, 4500);
}

function showDeviceMismatchNotification(incomingDevId, readerName) {
    const cleanReader = (readerName || '').replace('ACS ACR1251 1S CL Reader ', '');
    showToast(`⚠️ Tarjeta leída en <strong>Lector ${cleanReader} (Terminal ${incomingDevId})</strong><br><span style="font-size:0.85rem;opacity:0.9;font-weight:400;">Esta ventana está configurada para <strong>Terminal ${currentDeviceId}</strong></span>`, 'warning');
}

// BRIDGE CONNECTION (HARDWARE)
function connectBridge() {
    const wsUrl = getWsUrl();
    ws = new WebSocket(wsUrl);
    const dot = document.getElementById('hardware-dot');

    ws.onopen = () => {
        console.log(`✅ WebSocket conectado con el Bridge (${wsUrl}) para Dispositivo ${currentDeviceId}.`);
        dot.classList.add('online');
        ws.send(JSON.stringify({ type: 'REQUEST_DB' }));
    };

    ws.onclose = () => {
        console.warn("❌ WebSocket desconectado. Reintentando...");
        dot.classList.remove('online');
        const dbStatus = document.getElementById('db-status');
        if (dbStatus) {
            dbStatus.innerText = "DB: Desconectado";
            dbStatus.style.color = "#ff0000";
        }
        setTimeout(connectBridge, 3000);
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'CARD_DETECTED') {
                // Notificar si la tarjeta fue leída en otro lector para que el usuario no se confunda
                if (data.deviceId && data.deviceId !== currentDeviceId) {
                    showDeviceMismatchNotification(data.deviceId, data.readerName);
                    return;
                }
                onCardDetected(data.uid, data.atr, data.staticId, data.tagType);
            } else if (data.type === 'CARD_REMOVED') {
                if (data.deviceId && data.deviceId !== currentDeviceId) return;
                onCardRemoved();
            } else if (data.type === 'REMOTE_KEY') {
                if (data.deviceId && data.deviceId !== currentDeviceId) return;
                processFunction(data.key);
            } else if (data.type === 'DB_SYNC') {
                parseCSVDatabase(data.data);
                hideSyncAlert();
            } else if (data.type === 'DB_SYNC_START') {
                showSyncAlert();
            } else if (data.type === 'DB_SYNC_ERROR') {
                showSyncError(data.error || data.status);
            }
        } catch (e) {
            console.error("Error handling bridge message:", e);
        }
    };
}

/**
 * Envía una actualización al Panel de Información al Usuario (PIU).
 * @param {string} state - El estado visual (IDLE, CARD_DETECTED, SUCCESS).
 * @param {Object} extra - Datos adicionales (balance, amount, previousBalance, total).
 */
function updatePIU(state, extra = {}) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'PIU_UPDATE',
            deviceId: currentDeviceId,
            state: state,
            ...extra
        }));
    }
}

// CORE LOGIC: KEYBOARD ENGINE
function handleKeyPress(e) {
    const key = e.key;
    const code = e.code;

    if (key === 'F1' || key === 'NumLock' || code === 'NumLock') { e.preventDefault(); return setFunction('F1'); }
    if (key === 'F2' || key === '/' || code === 'NumpadDivide') { e.preventDefault(); return setFunction('F2'); }
    if (key === 'F3' || key === '*' || code === 'NumpadMultiply') { e.preventDefault(); return setFunction('F3'); }
    if (key === 'F4' || key === '-' || code === 'NumpadSubtract') { e.preventDefault(); return setFunction('F4'); }
    if (key === 'F5' || key === '+' || code === 'NumpadAdd') { e.preventDefault(); return setFunction('F5'); }

    if (key === 'PageDown' || code === 'PageDown') { e.preventDefault(); return setFunction('MENU'); }
    if (key === 'Enter' || code === 'NumpadEnter') { e.preventDefault(); return setFunction('OK'); }
    if (key === 'Escape' || key.toLowerCase() === 'c') { e.preventDefault(); return setFunction('CANCEL'); }

    // Mapear Backspace y ScrollLock (usualmente la tecla junto a OK con label 'lock' o '<<')
    if (key === 'Backspace' || key === 'ScrollLock' || code === 'ScrollLock' || key === 'Delete' || code === 'NumpadDecimal') {
        e.preventDefault();
        return processFunction('BKSP');
    }

    if ((key >= '0' && key <= '9')) {
        processFunction(key);
    }
}

function processFunction(key) {
    if (key >= '0' && key <= '9') return addDigit(key);
    if (key === 'BKSP') return deleteDigit();
    return setFunction(key);
}

function setFunction(func) {
    if (func === 'F4' && (currentView === 'idle' || currentView === 'admin-menu' || currentView === 'welcome')) {
        adminContext = 'sale';
        showView('sale-waiting');
        updateAdminMenuSelection('F4');
        return;
    }

    if (currentView === 'admin-menu') {
        if (func === 'F1') {
            adminContext = 'subsidy';
            showView('subsidy-waiting');
        } else if (func === 'F2') {
            adminContext = 'reimbursement';
            showView('reimbursement-waiting');
        }
        updateAdminMenuSelection(func);
        return;
    }

    // F2 ahora es prioridad para recarga si hay tarjeta
    if (func === 'F2' && currentView === 'recharge') {
        if (currentInput === "0") currentInput = "10000";
        else {
            const nextVal = currentInput + "0000";
            if (nextVal.replace("$", "").replace(/\./g, "").length <= 9) currentInput = nextVal;
        }
        updateInputDisplay();
        return;
    }

    if (func === 'F2' && (currentView === 'welcome' || currentView === 'idle' || currentView === 'recharge')) {
        showView('gratuitous-login');
        return;
    }

    if (func === 'F5') {
        if (!sessionActive) {
            showView('login-op');
            loginStep = 1;
            loginOpId = "";
            loginPass = "";
            updateLoginDisplay();
        } else {
            startClosing();
        }
        return;
    }

    if (func === 'CANCEL') {
        // Cerrar recibo virtual si está abierto
        const vr = document.getElementById('virtual-receipt');
        if (vr && vr.classList.contains('show')) {
            vr.classList.remove('show');
            showView(sessionActive ? 'idle' : 'welcome');
            return;
        }

        if (loginStep > 0) {
            resetLogin();
            showView('welcome');
            return;
        }

        if (currentView === 'cancel-waiting' || currentView === 'cancel-confirm') {
            showView(sessionActive ? 'idle' : 'welcome');
            return;
        }

        if (currentView === 'sale-waiting' || currentView === 'sale-confirm') {
            showView(sessionActive ? 'idle' : 'welcome');
            return;
        }

        if (sessionActive && (currentView === 'idle' || currentView === 'welcome')) {
            adminContext = 'cancel';
            showView('cancel-waiting');
            return;
        }

        // Volver a la ventana inicial (idle si hay sesión, welcome si no)
        showView(sessionActive ? 'idle' : 'welcome');
        return;
    }

    if (func === 'OK') {
        // Cerrar recibo virtual si está abierto
        const vr = document.getElementById('virtual-receipt');
        if (vr && vr.classList.contains('show')) {
            vr.classList.remove('show');
            showView(sessionActive ? 'idle' : 'welcome');
            return;
        }

        if (currentView === 'sale-confirm' && currentCard) {
            finalizarVenta();
        } else if (currentView === 'cancel-confirm' && currentCard) {
            finalizarAnulacion();
        } else if (currentView === 'closing-pass') {
            if (loginPass === "11111111" || (currentOperator && loginPass === currentOperator.password)) {
                closingCashInput = "0";
                const display = document.getElementById('closing-cash-display');
                if (display) display.innerText = "$ 0";
                showView('closing-cash');
            } else {
                showToast("⚠️ Clave de Cierre Incorrecta", "error");
                loginPass = "";
                const display = document.getElementById('closing-pass-display');
                if (display) display.innerText = "";
            }
        } else if (currentView === 'closing-cash') {
            const montoContado = parseInt(closingCashInput) || 0;
            finishSession(montoContado);
        } else if (currentView === 'login-op') {
            if (!loginOpId) {
                showToast("⚠️ Primero debe colocar la tarjeta de Operador", "warning");
                return;
            }
            if (loginPass.length === 0) {
                showToast("⚠️ Ingrese la contraseña de Operador", "warning");
                return;
            }
            loginStep = 3;
            loginBase = "0";
            showView('login-base');
            updateLoginDisplay();
        } else if (currentView === 'login-base') {
            finishLogin();
        } else if (currentView === 'recharge') {
            processRecharge();
        }
        return;
    }

    if (!sessionActive && (func === 'F1' || func === 'F2' || func === 'F3')) return;

    if (func === 'F1' && currentView === 'recharge') {
        if (currentInput === "0") currentInput = "1000";
        else {
            const nextVal = currentInput + "000";
            if (nextVal.replace("$", "").replace(/\./g, "").length <= 9) currentInput = nextVal;
        }
        updateInputDisplay();
        return;
    }

    if (func === 'F3' && currentView === 'recharge') {
        const nextVal = (parseInt(currentInput) + 3550).toString();
        if (nextVal.replace("$", "").replace(/\./g, "").length <= 9) currentInput = nextVal;
        updateInputDisplay();
        return;
    }

    if (func === 'MENU') {
        showView('menu');
        return;
    }
}

function updateAdminMenuSelection(func) {
    const items = document.querySelectorAll('.admin-item');
    items.forEach(i => i.classList.remove('active'));
    if (func === 'F1') items[0].classList.add('active');
    if (func === 'F2') items[1].classList.add('active');
    if (func === 'F3') items[2].classList.add('active');
    if (func === 'F4') items[3].classList.add('active');
}

/**
 * Agrega un dígito a la entrada actual según la vista activa.
 * @param {string} digit - El número presionado (0-9 o 00).
 */
function addDigit(digit) {
    // Si estamos en la pantalla de Recarga
    if (currentView === 'recharge') {
        if (currentInput.replace("$", "").replace(/\./g, "").length >= 9) return;
        if (digit === '00') {
            if (currentInput !== "0") currentInput += "00";
        } else {
            if (currentInput === "0") currentInput = digit;
            else currentInput += digit;
        }
        updateInputDisplay();
    }
    // Si estamos en el inicio de sesión del operador (contraseña)
    else if (currentView === 'login-op') {
        if (digit !== '00' && loginPass.length < 8) {
            loginPass += digit;
            updateLoginDisplay();
        }
    }
    // Si estamos ingresando la base inicial de caja
    else if (currentView === 'login-base') {
        if (loginBase.replace("$", "").replace(/\./g, "").length >= 9) return;
        if (digit === '00') {
            if (loginBase !== "0") loginBase += "00";
        } else {
            if (loginBase === "0") loginBase = digit;
            else loginBase += digit;
        }
        updateLoginDisplay();
    }
    // Si estamos en la pantalla de contraseña para el Cierre de Caja (F5)
    else if (currentView === 'closing-pass') {
        if (digit !== '00' && loginPass.length < 8) {
            loginPass += digit;
            const display = document.getElementById('closing-pass-display');
            if (display) display.innerText = "*".repeat(loginPass.length);
        }
    }
    // Si estamos ingresando el efectivo real en el cierre
    else if (currentView === 'closing-cash') {
        if (closingCashInput.replace("$", "").replace(/\./g, "").length >= 9) return;
        if (digit === '00') {
            if (closingCashInput !== "0") closingCashInput += "00";
        } else {
            if (closingCashInput === "0") closingCashInput = digit;
            else closingCashInput += digit;
        }
        const display = document.getElementById('closing-cash-display');
        if (display) display.innerText = "$ " + formatMoney(closingCashInput);
    }
}

/**
 * Elimina el último dígito ingresado (tecla BORRAR/BACKSPACE).
 */
function deleteDigit() {
    // Borrar en pantalla de recarga
    if (currentView === 'recharge') {
        currentInput = currentInput.slice(0, -1);
        if (currentInput === "") currentInput = "0";
        updateInputDisplay();
    }
    // Borrar en contraseña de cierre (F5)
    else if (currentView === 'closing-pass') {
        loginPass = loginPass.slice(0, -1);
        // CORRECCIÓN: Actualiza los asteriscos reflejando el borrado real
        document.getElementById('closing-pass-display').innerText = "*".repeat(loginPass.length);
    }
    // Borrar en entrada de efectivo de cierre
    else if (currentView === 'closing-cash') {
        closingCashInput = closingCashInput.slice(0, -1);
        if (closingCashInput === "") closingCashInput = "0";
        document.getElementById('closing-cash-display').innerText = "$ " + formatMoney(closingCashInput);
    }
}

function showView(viewId) {
    currentView = viewId;
    document.querySelectorAll('.screen').forEach(s => {
        s.classList.remove('active');
        s.style.display = 'none';
    });
    const target = document.getElementById(`screen-${viewId}`);
    if (target) {
        target.classList.add('active');
        target.style.display = 'flex';
    } else if (viewId !== 'welcome') {
        showView('welcome');
    }
}

function updateInputDisplay() {
    document.getElementById('recharge-input').innerText = formatMoney(currentInput);
}

function formatMoney(val) {
    return parseInt(val).toLocaleString('es-CO');
}

function onCardDetected(uid, atr, staticId, tagType) {
    console.log("💳 Card seen:", { uid, atr, staticId, tagType });

    const cleanAtr = (atr || "").replace(/[:\s-]/g, '').toLowerCase();
    const cleanStaticId = (staticId || "").replace(/[:\s-]/g, '').toLowerCase();
    const cleanUid = (uid || "").replace(/[:\s-]/g, '').toLowerCase();

    // Buscar coincidencia en orden de especificidad: UID > StaticId > ATR
    let profile = null;
    let matchType = "Ninguna";

    if (cleanUid && cardProfiles[cleanUid]) {
        profile = cardProfiles[cleanUid];
        matchType = "UID (" + cleanUid + ")";
    } else if (cleanStaticId && cardProfiles[cleanStaticId]) {
        profile = cardProfiles[cleanStaticId];
        matchType = "StaticId (" + cleanStaticId + ")";
    } else if (cleanAtr && cardProfiles[cleanAtr]) {
        profile = cardProfiles[cleanAtr];
        matchType = "ATR (" + cleanAtr + ")";
    }

    // Probar conversión decimal (común en lectores que convierten UID a decimal)
    if (!profile && cleanUid) {
        try {
            const decId = parseInt(cleanUid, 16).toString();
            if (cardProfiles[decId]) {
                profile = cardProfiles[decId];
                matchType = "Decimal UID (" + decId + ")";
            }
        } catch (e) { }
    }
    if (!profile && cleanStaticId) {
        try {
            const decId = parseInt(cleanStaticId, 16).toString();
            if (cardProfiles[decId]) {
                profile = cardProfiles[decId];
                matchType = "Decimal ID (" + decId + ")";
            }
        } catch (e) { }
    }

    if (!profile) {
        console.warn("⚠️ Tarjeta no registrada en base de datos. Claves probadas:", { cleanUid, cleanStaticId, cleanAtr });
        console.log("🔍 Claves disponibles en DB:", Object.keys(cardProfiles));
        profile = {
            name: 'Tarjeta No Registrada',
            cedula: '0',
            profile: 'Desactivada',
            balance: 0,
            serial: cleanUid || cleanAtr,
            operatorId: '999999',
            subsidyBalance: 0,
            reimbursementBalance: 0,
            status: 'Inactiva'
        };
        const key = cleanUid || cleanAtr;
        if (key) cardProfiles[key] = profile;
    }

    // PUNTO 2: En la pantalla inicial [F5] Inicio Trabajo NO se avanza con ninguna tarjeta.
    // Solo avanza cuando el usuario oprime físicamente o remotamente la tecla F5.
    if (!sessionActive && currentView === 'welcome') {
        console.log("⏸️ Pantalla inicial [F5] Inicio Trabajo activa. Presione F5 para iniciar.");
        return; // No se reconoce, no avanza, no carga nada
    }

    // PUNTO 2: En la pantalla de login [Iniciar Trabajo] SOLO se autoriza la tarjeta Operador.
    // Si se coloca otra tarjeta con otro perfil, es como si no colocara nada.
    if (currentView === 'login-op') {
        if (profile && profile.profile && profile.profile.toLowerCase() === 'operador') {
            console.log("✅ Tarjeta de Operador autorizada detectada:", profile.operatorId);
            loginOpId = profile.operatorId;
            loginPass = "";
            loginStep = 2; // Listo para ingresar contraseña
            updateLoginDisplay();
            showToast(`👤 Tarjeta Operador: <strong>${profile.name}</strong> (${profile.operatorId})`, 'success');
        } else {
            console.log("⛔ Tarjeta ignorada en login (única tarjeta autorizada es Operador)");
        }
        return;
    }

    // Si no hay tarjeta identificada
    if (!profile) return;

    currentCard = profile;

    // LOGIN GRATUIDAD (F2 en menú)
    if (currentView === 'gratuitous-login') {
        if (profile.profile.toLowerCase() === 'operador') {
            currentOperator = profile;
            loginOpId = profile.operatorId;
            showView('admin-menu');
            updateAdminMenuSelection('F1');
        } else {
            showToast("⚠️ Se requiere tarjeta de Operador para gratuidad", "warning");
        }
        return;
    }

    // SUBSIDIO (F1 en menú)
    if (currentView === 'subsidy-waiting') {
        if (profile.profile === 'Discapacidad' && profile.subsidyBalance > 0) processSubsidy(profile);
        else showView('subsidy-error');
        return;
    }

    // REEMBOLSO (F2 en menú)
    if (currentView === 'reimbursement-waiting') {
        if (profile.reimbursementBalance > 0) processReimbursement(profile);
        else showView('subsidy-error');
        return;
    }

    // PUNTO 4: CANCELACIÓN / ANULACIÓN DE RECARGA (Tecla C / CANCEL)
    if (currentView === 'cancel-waiting') {
        if (!lastRechargeCard || lastRechargeAmount <= 0) {
            showToast("⚠️ No hay ninguna recarga previa registrada para anular", "warning");
            return;
        }

        const isMatch = (profile === lastRechargeCard) ||
            (profile.serial && lastRechargeCard.serial && profile.serial === lastRechargeCard.serial) ||
            (profile.atr && lastRechargeCard.atr && profile.atr === lastRechargeCard.atr) ||
            (profile.cleanOperatorId && lastRechargeCard.cleanOperatorId && profile.cleanOperatorId === lastRechargeCard.cleanOperatorId);

        if (!isMatch) {
            showToast("⚠️ Tarjeta incorrecta: Debe colocar la misma tarjeta de la última recarga", "error");
            return;
        }

        currentCard = profile;
        const cancelDisplay = document.getElementById('cancel-amount-display');
        if (cancelDisplay) cancelDisplay.innerText = "$ " + formatMoney(lastRechargeAmount);
        showView('cancel-confirm');
        return;
    }

    // PUNTO 3: VENTA DE TARJETA NUEVA (F4)
    if (currentView === 'sale-waiting') {
        const cardStatus = (profile.status || "Inactiva").trim().toLowerCase();
        if (cardStatus !== 'activa') {
            currentCard = profile;
            showView('sale-confirm');
        } else {
            showToast("⚠️ ESTA TARJETA YA ESTÁ ACTIVA", "warning");
            showView('idle');
        }
        return;
    }

    // PUNTO 3: OPERACIÓN NORMAL DE RECARGA EN PANTALLA BASE (idle)
    if (sessionActive && (currentView === 'idle' || currentView === 'success' || currentView === 'welcome')) {
        // Si colocan la tarjeta de operador durante la sesión normal:
        if (profile.profile && profile.profile.toLowerCase() === 'operador') {
            showToast(`👤 Operador actual: ${profile.name} (${profile.operatorId})`, 'info');
            return;
        }

        const cardStatus = (profile.status || "Inactiva").trim().toLowerCase();
        // Si la tarjeta está INACTIVA, no se permite recarga hasta que sea vendida (F4)
        if (cardStatus !== 'activa') {
            console.warn(`⚠️ Tarjeta ${profile.name} está INACTIVA. Requiere venta con F4.`);
            showToast(`⚠️ Tarjeta INACTIVA (${profile.name}). Debe activarse/venderse primero con [F4]`, 'warning');
            return; // No avanza a recarga
        }

        // Si está ACTIVA: Procede a recarga normal
        showToast(`💳 Tarjeta: <strong>${profile.name}</strong> (${profile.profile})`, 'success');
        showView('recharge');
        currentInput = "0";
        document.getElementById('display-profile').innerText = profile.profile.toUpperCase();
        document.getElementById('display-balance').innerText = "$ " + formatMoney(profile.balance);
        updateInputDisplay();
        updatePIU('CARD_DETECTED', { balance: profile.balance });
        return;
    }
}

function onCardRemoved() {
    currentCard = null;
    updatePIU('IDLE');
    // NO resetear en pantallas de espera de proceso (subsidio, reembolso, venta) para permitir el cambio de tarjeta
    const sensitiveViews = ['subsidy-waiting', 'reimbursement-waiting', 'sale-waiting', 'cancel-waiting'];
    const needsReset = ['recharge', 'success', 'subsidy-success', 'subsidy-error', 'reimbursement-success', 'sale-confirm', 'cancel-confirm'];

    if (needsReset.includes(currentView)) {
        showView(sessionActive ? 'idle' : 'welcome');
    }
}

function updateLoginDisplay() {
    const opEl = document.getElementById('login-op-id');
    const passEl = document.getElementById('login-pass');
    const baseEl = document.getElementById('login-base');
    if (opEl) opEl.innerText = loginOpId || "";
    if (passEl) passEl.innerText = "*".repeat(loginPass.length);
    if (baseEl) baseEl.innerText = loginBase === "0" ? "" : formatMoney(loginBase);
}

function finishLogin() {
    sessionActive = true;
    currentOperator = cardProfiles[loginOpId.toLowerCase()] || 
                      cardProfiles[loginOpId.replace(/\s+/g, '').toLowerCase()] || 
                      { operatorId: loginOpId, name: "Operador Externo" };

    // Capturar tiempo de inicio real
    const now = new Date();
    sessionStartTime.date = now.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.');
    sessionStartTime.time = now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

    // Punto 6: Reiniciar contadores de recargas, ventas, etc. en 0 para esta nueva sesión
    resetSessionStats();

    loginStep = 0;
    loginPass = "";

    // Punto 5: La vista base después de iniciar sesión debe quedar en 'idle' ("Coloque la tarjeta / Para recargar")
    showView('idle');
    updatePIU('IDLE');

    generateReceipt('Apertura');
}

function generateReceipt(type, supuesto = 0, real = 0) {
    const r = document.getElementById('virtual-receipt');
    document.getElementById('receipt-type').innerText = `Recibo ${type} Trabajo`;

    const currentSerie = String(receiptCounter++).padStart(3, '0');
    const opDisplayId = currentOperator ? currentOperator.operatorId : (loginOpId || "----");

    // TIEMPO DE INICIO (De la sesión)
    const dateInit = sessionStartTime.date;
    const timeInit = sessionStartTime.time;

    // TIEMPO DE CIERRE (Actual)
    const now = new Date();
    const dateNow = now.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.');
    const timeNow = now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

    const statsContainer = document.getElementById('receipt-stats-container');
    statsContainer.innerHTML = '';

    const totalVentasEfectivo = stats.vRecargas + stats.vVentaTarjetas;

    // BLOQUE 1: IDENTIFICACIÓN BÁSICA
    const block1 = [
        ["Serie de recibo", currentSerie],
        ["ID de cargador", currentDeviceId || "0068"],
        ["Nombre de Estacion", "Héroes"]
    ];

    // BLOQUE 2: OPERADOR Y TIEMPOS
    const block2 = [
        ["ID de Operador", opDisplayId],
        ["Fecha/Hora Inic Trabajo", `${dateInit} ${timeInit}`]
    ];
    if (type === 'Cierre') {
        block2.push(["Fecha/Hora CierreTrabajo", `${dateNow} ${timeNow}`]);
    }

    // BLOQUE 3: ESTADÍSTICAS FINANCIERAS
    const block3 = [
        ["Saldo LSAM Inicio", "$ " + formatMoney(stats.saldoLsamInicio)],
        ["Saldo LSAM Cierre", "$ " + formatMoney(stats.saldoLsamCierre)],
        ["Nro. Recargas", stats.nRecargas],
        ["Valor Recargas", "$ " + formatMoney(stats.vRecargas)],
        ["Nro. Anulac. Recargas", stats.nAnulacRecargas],
        ["Valor Anulac. Recargas", "$ " + formatMoney(stats.vAnulacRecargas)],
        ["Nro. Descarga tarjetas", stats.nDescargaTarjetas],
        ["Valor Descarga tarjetas", "$ " + formatMoney(stats.vDescargaTarjetas)],
        ["Nro. Venta tarjetas", stats.nVentaTarjetas],
        ["Valor Ventas tarjetas", "$ " + formatMoney(stats.vVentaTarjetas)],
        ["Nro. Ventas tarj. gratis", stats.nVentaTarjGratis],
        ["Nro. Excepcion recargas", stats.nExcepcionRecargas],
        ["Valor Excepcion recargas", "$ " + formatMoney(stats.vExcepcionRecargas)],
        ["Nro. Fallidas", stats.nFallidas],
        ["Valor Fallidas", "$ " + formatMoney(stats.vFallidas)],
        ["Nro. Recarga reembolsos", stats.nRecargaReembolsos],
        ["Valor Recarga reembolsos", "$ " + formatMoney(stats.vRecargaReembolsos)],
        ["Nro. Anulac. Reembolso", stats.nAnulacReembolso],
        ["Valor Anulac. Reembolso", "$ " + formatMoney(stats.vAnulacReembolso)],
        ["Nro. Devolucion billete", stats.nDevolucionBillete],
        ["Valor Devolucion billete", "$ " + formatMoney(stats.vDevolucionBillete)],
        ["Nro. Subsidio/Convenio", stats.nSubsidioConvenio],
        ["Valor Subsidio/Convenio", "$ " + formatMoney(stats.vSubsidioConvenio)],
        ["Nro. Anulac. Subsidio", stats.nAnulacSubsidio],
        ["Valor Anulac. Subsidio", "$ " + formatMoney(stats.vAnulacSubsidio)]
    ];

    // BLOQUE 4: TOTALES Y LSAM
    const block4 = [
        ["Debitado LSAM real", "$ " + formatMoney(stats.vRecargas + stats.vSubsidioConvenio + stats.vRecargaReembolsos)],
        ["Debitado LSAM reportado", "$ " + formatMoney(stats.vRecargas + stats.vSubsidioConvenio + stats.vRecargaReembolsos)],
        ["Total Ingresos efectivo", "$ " + formatMoney(totalVentasEfectivo)],
        ["Caja base de operación", "$ " + formatMoney(loginBase)]
    ];

    if (type === 'Cierre') {
        block4.push(["Monto ingresado supuesto", "$ " + formatMoney(supuesto)]);
        block4.push(["Efectivo real en caja", "$ " + formatMoney(real)]);
    }

    const addBlock = (fields) => {
        fields.forEach(line => {
            const div = document.createElement('div');
            div.className = 'receipt-row';
            div.innerHTML = `<span>${line[0]}:</span><span>${line[1]}</span>`;
            statsContainer.appendChild(div);
        });
        const divider = document.createElement('div');
        divider.className = 'receipt-divider';
        divider.innerText = '---------------------------';
        statsContainer.appendChild(divider);
    };

    addBlock(block1);
    addBlock(block2);
    addBlock(block3);
    addBlock(block4);

    if (type === 'Cierre') {
        const diffRow = document.getElementById('receipt-diff-row');
        if (diffRow) diffRow.style.display = 'block';
        const diferencia = supuesto - real;
        const realCashEl = document.getElementById('receipt-real-cash');
        const supposedCashEl = document.getElementById('receipt-supposed-cash');
        if (realCashEl) realCashEl.innerText = "$ " + formatMoney(real);
        if (supposedCashEl) supposedCashEl.innerText = "$ " + formatMoney(supuesto);
        const diffEl = document.getElementById('receipt-diff');
        if (diffEl) {
            diffEl.innerText = "$ " + formatMoney(diferencia);
            diffEl.style.color = diferencia < 0 ? "red" : (diferencia > 0 ? "green" : "black");
        }
    } else {
        const diffRow = document.getElementById('receipt-diff-row');
        if (diffRow) diffRow.style.display = 'none';
    }

    const closeBtn = document.querySelector('#virtual-receipt .close-receipt');
    if (closeBtn) {
        closeBtn.onclick = () => {
            r.classList.remove('show');
            showView(sessionActive ? 'idle' : 'welcome');
        };
    }

    r.classList.add('show');
}

function resetLogin() {
    loginStep = 0; loginPass = ""; loginBase = "0"; loginOpId = "";
}

/**
 * Procesa la operación de recarga después de confirmar el ingreso de dinero.
 */
function processRecharge() {
    const amount = parseInt(currentInput);
    if (amount === 0) return;

    // Guardar saldo antes de la recarga para mostrarlo como "Saldo Inicial" en el PIU
    const previousBalance = currentCard.balance;

    lastRechargeAmount = amount;
    lastRechargeCard = currentCard;
    lastRechargeWasNegative = (currentCard.balance < 0);

    // Actualizar saldo del objeto tarjeta
    currentCard.balance += amount;
    currentCard.sessionModified = true;

    // Actualizar UI del TCA (Éxito)
    document.getElementById('success-amount').innerText = "$ " + formatMoney(amount);
    document.getElementById('success-total').innerText = "$ " + formatMoney(currentCard.balance);
    document.getElementById('success-banner-text').innerText = "Recarga Completa";

    // ACTUALIZACIÓN PIU: Enviamos Saldo Inicial, Valor Recarga y Saldo Final
    updatePIU('SUCCESS', {
        amount: amount,
        previousBalance: previousBalance,
        total: currentCard.balance
    });

    showView('success');
    currentInput = "0";

    // Actualizar estadísticas de la sesión
    stats.nRecargas++;
    stats.vRecargas += amount;
}

function processSubsidy(profile) {
    const amount = profile.subsidyBalance;
    profile.balance += amount;
    stats.nSubsidioConvenio++;
    stats.vSubsidioConvenio += amount;
    document.getElementById('subsidy-amount').innerText = formatMoney(amount);
    document.getElementById('subsidy-balance').innerText = formatMoney(profile.balance);
    updatePIU('SUCCESS', { amount: amount, total: profile.balance });
    showView('subsidy-success');
    profile.subsidyBalance = 0;
}

function processReimbursement(profile) {
    const amount = profile.reimbursementBalance;
    profile.balance += amount;
    stats.nRecargaReembolsos++;
    stats.vRecargaReembolsos += amount;
    document.getElementById('reimbursement-amount').innerText = "$ " + formatMoney(amount);
    document.getElementById('reimbursement-balance').innerText = "$ " + formatMoney(profile.balance);
    updatePIU('SUCCESS', { amount: amount, total: profile.balance });
    showView('reimbursement-success');
    profile.reimbursementBalance = 0;
}

function finalizarVenta() {
    if (!currentCard) return;
    currentCard.status = 'Activa'; // Activada para esta sesión
    currentCard.sessionModified = true;
    const salePrice = 8000;
    stats.nVentaTarjetas++;
    stats.vVentaTarjetas += salePrice;
    lastRechargeCard = null;
    lastRechargeAmount = 0;
    showToast(`✅ Tarjeta activada con éxito (Venta: $8.000). Ya puede ser recargada.`, 'success');
    updatePIU('SUCCESS', { amount: salePrice, total: currentCard.balance });
    showView('idle');
}

function finalizarAnulacion() {
    if (!currentCard || !lastRechargeCard) return;
    const anuladoAmount = lastRechargeAmount;
    currentCard.balance -= anuladoAmount;
    stats.nRecargas = Math.max(0, stats.nRecargas - 1);
    stats.vRecargas = Math.max(0, stats.vRecargas - anuladoAmount);
    stats.nAnulacRecargas++;
    stats.vAnulacRecargas += anuladoAmount;

    updatePIU('SUCCESS', {
        amount: -anuladoAmount,
        total: currentCard.balance
    });

    showToast(`✅ Recarga anulada exitosamente: -$ ${formatMoney(anuladoAmount)}`, 'success');
    lastRechargeCard = null;
    lastRechargeAmount = 0;
    showView('idle');
}

function startClosing() {
    loginPass = "";
    const passDisplay = document.getElementById('closing-pass-display');
    if (passDisplay) passDisplay.innerText = "";
    const opDisplay = document.getElementById('closing-op-id-display');
    if (opDisplay) {
        const id = currentOperator ? currentOperator.operatorId : (loginOpId || "0000 0000");
        opDisplay.innerText = id;
    }
    showView('closing-pass');
}

function finishSession(montoSupuesto) {
    const totalEfectivo = stats.vRecargas + stats.vVentaTarjetas;
    const efectivoReal = parseInt(loginBase) + totalEfectivo;

    // Cambiar la vista inmediatamente para evitar que se presione OK otra vez
    currentView = 'finished';

    generateReceipt('Cierre', montoSupuesto, efectivoReal);
    syncToGoogleSheets(montoSupuesto, efectivoReal);

    sessionActive = false;
    currentOperator = null;

    // Punto 3: Restaurar estado inicial de tarjetas según Google Sheets
    restoreDatabaseInitialState();

    // Punto 6: Reiniciar estadísticas para la siguiente sesión
    resetSessionStats();
    loginBase = "0";
    loginOpId = "";
    loginPass = "";

    const closeBtn = document.querySelector('#virtual-receipt .close-receipt');
    if (closeBtn) {
        closeBtn.onclick = () => {
            document.getElementById('virtual-receipt').classList.remove('show');
            showView('welcome');
        };
    }
}

function syncToGoogleSheets(supuesto, real) {
    if (!GOOGLE_SHEETS_URL || GOOGLE_SHEETS_URL.includes("AQUI")) return;

    const now = new Date();
    const serieActual = String(receiptCounter - 1).padStart(3, '0');
    const opId = currentOperator ? currentOperator.operatorId : (loginOpId || "----");

    // USAR EL TIEMPO DE INICIO DE LA SESIÓN, NO EL DEL HEADER
    const dateInit = sessionStartTime.date;
    const timeInit = sessionStartTime.time;

    const payload = {
        serieRecibo: serieActual,
        idCargador: currentDeviceId || "0068",
        nombreEstacion: "Héroes",
        idOperador: opId,
        fechaHoraInic: `${dateInit} ${timeInit}`,
        fechaHoraCierre: now.toLocaleString(),
        saldoLsamInicio: stats.saldoLsamInicio,
        saldoLsamCierre: stats.saldoLsamCierre,
        nRecargas: stats.nRecargas,
        vRecargas: stats.vRecargas,
        nAnulacRecargas: stats.nAnulacRecargas,
        vAnulacRecargas: stats.vAnulacRecargas,
        nDescargaTarjetas: stats.nDescargaTarjetas,
        vDescargaTarjetas: stats.vDescargaTarjetas,
        nVentaTarjetas: stats.nVentaTarjetas,
        vVentaTarjetas: stats.vVentaTarjetas,
        nVentaTarjGratis: stats.nVentaTarjGratis,
        nExcepcionRecargas: stats.nExcepcionRecargas,
        vExcepcionRecargas: stats.vExcepcionRecargas,
        nFallidas: stats.nFallidas,
        vFallidas: stats.vFallidas,
        nRecargaReembolsos: stats.nRecargaReembolsos,
        vRecargaReembolsos: stats.vRecargaReembolsos,
        nAnulacReembolso: stats.nAnulacReembolso,
        vAnulacReembolso: stats.vAnulacReembolso,
        nDevolucionBillete: stats.nDevolucionBillete,
        vDevolucionBillete: stats.vDevolucionBillete,
        nSubsidioConvenio: stats.nSubsidioConvenio,
        vSubsidioConvenio: stats.vSubsidioConvenio,
        nAnulacSubsidio: stats.nAnulacSubsidio,
        vAnulacSubsidio: stats.vAnulacSubsidio,
        debitadoLsamReal: stats.vRecargas + stats.vSubsidioConvenio + stats.vRecargaReembolsos,
        debitadoLsamReportado: stats.vRecargas + stats.vSubsidioConvenio + stats.vRecargaReembolsos,
        totalIngresosEfectivo: stats.vRecargas + stats.vVentaTarjetas,
        cajaBaseOperacion: parseInt(loginBase),
        montoIngresadoSupuesto: supuesto,
        efectivoRealEnCaja: real
    };

    console.log("📤 Enviando datos a Google Sheets:", payload);

    fetch(GOOGLE_SHEETS_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).then(() => console.log("✅ Datos sincronizados con Google Sheets"))
        .catch(err => console.error("❌ Error de sincronización:", err));
}

function showSyncAlert() {
    const dbStatus = document.getElementById('db-status');
    if (dbStatus) {
        dbStatus.innerText = "DB: Sincronizando...";
        dbStatus.style.color = "#ffcc00";
        dbStatus.classList.add('pulse');
    }
}

function hideSyncAlert() {
    const dbStatus = document.getElementById('db-status');
    if (dbStatus) {
        dbStatus.classList.remove('pulse');
    }
}

function showSyncError(err) {
    const dbStatus = document.getElementById('db-status');
    if (dbStatus) {
        dbStatus.innerText = "DB: Error Sync";
        dbStatus.style.color = "#ff0000";
    }
    console.error("Sync Error:", err);
}
