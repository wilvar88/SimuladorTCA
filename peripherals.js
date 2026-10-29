function getActiveDeviceId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('device') || (window.currentDeviceId || '0068');
}

function showPeripheral(type) {
    const modal = document.getElementById('modal-peripheral');
    const title = document.getElementById('modal-title');
    const qr = document.getElementById('modal-qr');
    const link = document.getElementById('modal-link');
    const desc = document.getElementById('modal-desc');

    const devId = getActiveDeviceId();

    // Determinar host y protocolo
    let host = window.location.host;
    let protocol = window.location.protocol;

    // Si estamos en localhost o file:, solicitar la IP para poder usar el móvil en la misma red
    if (host.includes('localhost') || host.includes('127.0.0.1') || protocol === 'file:') {
        let savedIp = localStorage.getItem('local_pc_ip');
        const userIp = prompt(
            `Para conectar tu móvil al Dispositivo ${devId}:\n` +
            `1. Asegúrate de que el móvil esté conectado al mismo Wi-Fi que la PC.\n` +
            `2. Escribe la IP local de tu PC (IPv4 en 'ipconfig'):`,
            savedIp || ""
        );
        if (userIp) {
            localStorage.setItem('local_pc_ip', userIp);
            host = `${userIp}:3000`;
            protocol = 'http:';
        }
    }

    const path = (type === 'keyboard') ? 'keyboard.html' : 'piu.html';
    const finalUrl = `${protocol}//${host}/${path}?device=${devId}`;

    if (type === 'keyboard') {
        title.innerText = `Teclado Virtual TCA - Dispositivo ${devId}`;
        desc.innerText = `Escanea con tu celular para controlar remotamente el Dispositivo ${devId}.`;
    } else {
        title.innerText = `Pantalla PIU - Dispositivo ${devId}`;
        desc.innerText = `Pantalla secundaria de información para el Dispositivo ${devId}.`;
    }

    link.href = finalUrl;
    link.innerText = `Abrir en esta pantalla (?device=${devId})`;
    qr.src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(finalUrl)}`;

    modal.classList.add('active');
}
