function getActiveDeviceId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('device') || (window.currentDeviceId || '0068');
}

function getBasePathUrl(filename, devId) {
    const baseUrl = new URL(filename, window.location.href);
    baseUrl.searchParams.set('device', devId);
    // Si estamos en localhost y el Bridge nos informó la IP de red local, usarla para el QR móvil
    const host = window.location.hostname;
    const savedIp = localStorage.getItem('local_pc_ip');
    if ((host === 'localhost' || host === '127.0.0.1') && savedIp && savedIp !== 'localhost') {
        baseUrl.hostname = savedIp;
        baseUrl.port = '3000';
        baseUrl.protocol = 'http:';
    }
    return baseUrl.toString();
}

function showPeripheral(type) {
    const modal = document.getElementById('modal-peripheral');
    const title = document.getElementById('modal-title');
    const qr = document.getElementById('modal-qr');
    const link = document.getElementById('modal-link');
    const desc = document.getElementById('modal-desc');

    const devId = getActiveDeviceId();
    const path = (type === 'keyboard') ? 'keyboard.html' : 'piu.html';
    const finalUrl = getBasePathUrl(path, devId);

    if (type === 'keyboard') {
        title.innerText = `Teclado Virtual TCA - Dispositivo ${devId}`;
        desc.innerText = `Escanea con tu celular o abre en otra ventana para controlar el Dispositivo ${devId}.`;
    } else {
        title.innerText = `Pantalla PIU - Dispositivo ${devId}`;
        desc.innerText = `Pantalla secundaria de información para el Dispositivo ${devId}.`;
    }

    link.href = `${path}?device=${devId}`;
    link.innerText = `Abrir en esta pantalla (?device=${devId})`;
    qr.src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(finalUrl)}`;

    modal.classList.add('active');
}
