// CONFIGURACIÓN DE BASE DE DATOS (Recibida vía WebSocket)
let cardProfiles = {};

function parseCSVDatabase(csvText) {
    try {
        console.log("📄 Procesando datos CSV recibidos...");
        const rows = csvText.split(/\r?\n/).filter(row => row.trim() !== "").map(row => row.split(',').map(v => v.trim()));
        console.log(`📊 Filas detectadas: ${rows.length}`);

        const profiles = {};
        for (let i = 1; i < rows.length; i++) {
            const values = rows[i];
            if (values.length < 9) continue; // Mínimo hasta Saldo

            const profile = {
                name: values[0],
                cedula: values[1],
                profile: (values[2] || "").trim(),
                operatorId: (values[3] || "").trim(),
                serial: (values[4] || "").replace(/\s/g, '').toLowerCase().trim(),
                atr: (values[5] || "").toLowerCase().trim(),
                subsidyBalance: parseInt(values[6]) || 0,
                reimbursementBalance: parseInt(values[7]) || 0,
                balance: parseInt(values[8]) || 0,
                status: values[9] || "Activa"
            };

            // Mapeo por múltiples llaves para asegurar detección
            if (profile.atr) profiles[profile.atr] = profile;
            if (profile.serial) profiles[profile.serial] = profile;
            if (profile.cedula) profiles[profile.cedula.toLowerCase().trim()] = profile;
            if (profile.operatorId) profiles[profile.operatorId.toLowerCase().trim()] = profile;
        }
        cardProfiles = profiles;
        console.log("🔍 [DEBUG] Llaves en cardProfiles:", Object.keys(cardProfiles));
        console.table(Object.values(cardProfiles).slice(0, 5));
        const count = Object.keys(cardProfiles).length;
        console.log("✅ DB Sincronizada:", count, "perfiles detectados.");
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
                // Filtrar por ID de dispositivo: solo atender tarjetas de este lector
                if (data.deviceId && data.deviceId !== currentDeviceId) return;
                onCardDetected(data.uid, data.atr, data.staticId);
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
            updateLoginDisplay();
        } else {
            startClosing();
        }
        return;
    }

    if (func === 'CANCEL') {
        if (loginStep > 0) {
            resetLogin();
            showView('welcome');
        } else if (currentView === 'idle' || currentView === 'welcome') {
            adminContext = 'cancel';
            showView('cancel-waiting');
        } else {
            // Volver a la ventana inicial (idle)
            showView(sessionActive ? 'idle' : 'welcome');
        }
        return;
    }

    if (func === 'OK') {
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
                alert("Clave de Cierre Incorrecta");
                loginPass = "";
                const display = document.getElementById('closing-pass-display');
                if (display) display.innerText = "********";
            }
        } else if (currentView === 'closing-cash') {
            const montoContado = parseInt(closingCashInput);
            finishSession(montoContado);
        } else if (currentView === 'login-op') {
            loginStep = 3;
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
 * @param {string} digit - El número presionado (0-9).
 */
function addDigit(digit) {
    // Si estamos en la pantalla de Recarga
    if (currentView === 'recharge') {
        // Limitar a 9 dígitos para evitar desbordamiento visual
        if (currentInput.replace("$", "").replace(/\./g, "").length >= 9) return;
        // Reemplazar el "0" inicial o concatenar
        if (currentInput === "0") currentInput = digit;
        else currentInput += digit;
        updateInputDisplay(); // Actualiza la interfaz de recarga
    }
    // Si estamos en el inicio de sesión del operador
    else if (currentView === 'login-op') {
        // Limitar contraseña a 8 dígitos
        if (loginPass.length < 8) loginPass += digit;
        updateLoginDisplay(); // Actualiza los asteriscos en la pantalla de login
    }
    // Si estamos ingresando la base inicial de caja
    else if (currentView === 'login-base') {
        if (loginBase.replace("$", "").replace(/\./g, "").length >= 9) return;
        if (loginBase === "0") loginBase = digit;
        else loginBase += digit;
        updateLoginDisplay();
    }
    // Si estamos en la pantalla de contraseña para el Cierre de Caja (F5)
    else if (currentView === 'closing-pass') {
        if (loginPass.length < 8) {
            loginPass += digit; // Agrega el dígito a la variable global
            // CORRECCIÓN: Muestra solo los asteriscos de los dígitos ingresados, sin rellenar hasta 8
            document.getElementById('closing-pass-display').innerText = "*".repeat(loginPass.length);
        }
    }
    // Si estamos ingresando el efectivo real en el cierre
    else if (currentView === 'closing-cash') {
        if (closingCashInput.replace("$", "").replace(/\./g, "").length >= 9) return;
        if (closingCashInput === "0") closingCashInput = digit;
        else closingCashInput += digit;
        // Formatea el número como moneda y lo muestra
        document.getElementById('closing-cash-display').innerText = "$ " + formatMoney(closingCashInput);
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

function onCardDetected(uid, atr, staticId) {
    console.log("💳 Card seen:", { uid, atr, staticId });

    const cleanAtr = (atr || "").toLowerCase();
    const cleanStaticId = (staticId || "").toLowerCase();
    const cleanUid = (uid || "").toLowerCase();
    const cleanUidNoSpaces = (uid || "").replace(/\s/g, '').toLowerCase();

    // Mapping logic
    let profile = cardProfiles[cleanStaticId] || cardProfiles[cleanAtr] || cardProfiles[cleanUid] || cardProfiles[cleanUidNoSpaces];
    let matchType = profile ? "Exact Match" : "None";

    // Try decimal conversion for UID (many systems use decimal ID in DB but hex UID in hardware)
    if (!profile && cleanStaticId) {
        const decId = parseInt(cleanStaticId, 16).toString();
        if (cardProfiles[decId]) {
            console.log("✅ Match found via Decimal ID:", decId);
            profile = cardProfiles[decId];
            matchType = "Decimal ID";
        }
    }
    if (!profile && cleanUidNoSpaces) {
        const decId = parseInt(cleanUidNoSpaces, 16).toString();
        if (cardProfiles[decId]) {
            console.log("✅ Match found via Decimal UID:", decId);
            profile = cardProfiles[decId];
            matchType = "Decimal UID";
        }
    }

    if (!profile) {
        console.warn("⚠️ Unknown card. UIDs tried:", { staticId: cleanStaticId, uidNoSpaces: cleanUidNoSpaces, atr: cleanAtr });
        console.log("🔍 Disponibles en DB:", Object.keys(cardProfiles));
        profile = { name: 'Nuevo', profile: 'Desactivada', balance: 0, serial: uid, operatorId: '999999', subsidyBalance: 0, status: 'Inactiva' };
        const key = (uid || "").replace(/\s/g, '').toLowerCase();
        if (key) cardProfiles[key] = profile;
    } else {
        console.log(`✅ [Discovery] Card identified via ${matchType}. Profile: ${profile.profile}, Name: ${profile.name}`);
    }

    // IMPORTANTE: Asignar la tarjeta actual para que las operaciones (recarga) funcionen
    currentCard = profile;

    // Mostrar perfil y saldo en la pantalla principal TCA
    document.getElementById('display-profile').innerText = profile.profile.toUpperCase();
    document.getElementById('display-balance').innerText = "$ " + formatMoney(profile.balance);

    // Actualizar PIU: Solo muestra Saldo Inicial al detectar
    updatePIU('CARD_DETECTED', { balance: profile.balance });

    // Si la tarjeta es de operador y estamos en bienvenida, ir a login
    if (!sessionActive && profile.profile.toLowerCase() === 'operador' && (currentView === 'welcome' || currentView === 'idle')) {
        console.log("🚀 Operator card detected. Initializing session flow for ID:", profile.operatorId);
        showView('login-op');
        loginStep = 1;
        loginOpId = profile.operatorId;
        updateLoginDisplay();
        return;
    }

    if (profile.status === 'Inactiva' && currentView !== 'sale-waiting') return;

    if (currentView === 'cancel-waiting') {
        const isSameCard = lastRechargeCard && (lastRechargeCard.serial === profile.serial);
        const canRevert = profile.balance >= lastRechargeAmount;
        const validStart = !lastRechargeWasNegative;
        if (isSameCard && canRevert && validStart) {
            document.getElementById('cancel-amount-display').innerText = "$ " + formatMoney(lastRechargeAmount);
            showView('cancel-confirm');
        }
        return;
    }

    const isAdminView = currentView === 'login-op' || currentView === 'gratuitous-login';
    if (isAdminView && profile.profile.toLowerCase() !== 'operador') return;

    // Blocked operator cards on idle/welcome (redundant now with shortcut above but kept for logic safety)
    if (profile.profile.toLowerCase() === 'operador' && (currentView === 'idle' || currentView === 'welcome')) return;

    if (currentView === 'login-op' && !loginOpId) {
        loginOpId = profile.operatorId;
        updateLoginDisplay();
        return;
    }

    if (currentView === 'gratuitous-login') {
        currentOperator = profile;
        loginOpId = profile.operatorId;
        showView('admin-menu');
        updateAdminMenuSelection('F1');
        return;
    }

    if (currentView === 'subsidy-waiting') {
        if (profile.profile === 'Discapacidad' && profile.subsidyBalance > 0) processSubsidy(profile);
        else showView('subsidy-error');
        return;
    }

    if (currentView === 'reimbursement-waiting') {
        if (profile.reimbursementBalance > 0) processReimbursement(profile);
        else showView('subsidy-error');
        return;
    }

    if (currentView === 'sale-waiting') {
        if (profile.status === 'Inactiva') {
            currentCard = profile;
            showView('sale-confirm');
        } else {
            alert("ESTA TARJETA YA ESTÁ ACTIVA");
            showView('admin-menu');
        }
        return;
    }

    if (sessionActive && (currentView === 'idle' || currentView === 'success' || currentView === 'welcome')) {
        showView('recharge');
        currentInput = "0";
        document.getElementById('display-profile').innerText = profile.profile.toUpperCase();
        document.getElementById('display-balance').innerText = "$ " + formatMoney(profile.balance);
        updateInputDisplay();
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
    currentOperator = cardProfiles[loginOpId.toLowerCase()] || { operatorId: loginOpId, name: "Operador Externo" };

    // Capturar tiempo de inicio real
    const now = new Date();
    sessionStartTime.date = now.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.');
    sessionStartTime.time = now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

    loginStep = 0;
    showView('idle');
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
        ["ID de cargador", "0000805592"],
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
    currentCard.status = 'Activa'; currentCard.sessionModified = true;
    const salePrice = 8000;
    stats.nVentaTarjetas++;
    stats.vVentaTarjetas += salePrice;
    lastRechargeCard = null;
    lastRechargeAmount = 0;
    showView('recharge');
    currentInput = "0";
    document.getElementById('display-profile').innerText = currentCard.profile.toUpperCase();
    document.getElementById('display-balance').innerText = "$ " + formatMoney(currentCard.balance);
    updateInputDisplay();
}

function finalizarAnulacion() {
    if (!currentCard || !lastRechargeCard || currentCard.serial !== lastRechargeCard.serial) return;
    currentCard.balance -= lastRechargeAmount;
    stats.nRecargas--;
    stats.vRecargas -= lastRechargeAmount;
    stats.nAnulacRecargas++;
    stats.vAnulacRecargas += lastRechargeAmount;
    showView('idle');
    lastRechargeCard = null;
    lastRechargeAmount = 0;
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
        idCargador: "0000805592",
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
