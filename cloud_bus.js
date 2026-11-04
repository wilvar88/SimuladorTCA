/**
 * Cloud Bus en Tiempo Real (MQTT sobre WSS sin dependencias externas)
 * Permite que Tablets, Celulares y PCs se comuniquen desde https://simuladortca.vercel.app
 * sin importar si están en diferente red Wi-Fi, datos móviles o con bloqueo de Mixed Content.
 */
(function (root) {
    const BROKERS = [
        'wss://broker.emqx.io:8084/mqtt',
        'wss://broker.hivemq.com:8884/mqtt'
    ];
    const TOPIC = 'tca/recaudo_bogota/wilvar88/bus/v1';

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    function encodeRemainingLength(len) {
        const out = [];
        do {
            let digit = len % 128;
            len = Math.floor(len / 128);
            if (len > 0) digit |= 128;
            out.push(digit);
        } while (len > 0);
        return out;
    }

    function buildConnectPacket(clientId) {
        const idBytes = encoder.encode(clientId);
        const varHeader = [0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, 0x02, 0x00, 0x3c];
        const payload = [(idBytes.length >> 8) & 0xff, idBytes.length & 0xff, ...idBytes];
        const remLen = varHeader.length + payload.length;
        return new Uint8Array([0x10, ...encodeRemainingLength(remLen), ...varHeader, ...payload]);
    }

    function buildSubscribePacket(topic) {
        const tBytes = encoder.encode(topic);
        const body = [0x00, 0x01, (tBytes.length >> 8) & 0xff, tBytes.length & 0xff, ...tBytes, 0x00];
        return new Uint8Array([0x82, ...encodeRemainingLength(body.length), ...body]);
    }

    function buildPublishPacket(topic, jsonStr) {
        const tBytes = encoder.encode(topic);
        const mBytes = encoder.encode(jsonStr);
        const totalBodyLen = 2 + tBytes.length + mBytes.length;
        const remBytes = encodeRemainingLength(totalBodyLen);
        const packet = new Uint8Array(1 + remBytes.length + totalBodyLen);
        let offset = 0;
        packet[offset++] = 0x30; // PUBLISH QoS 0
        for (let i = 0; i < remBytes.length; i++) packet[offset++] = remBytes[i];
        packet[offset++] = (tBytes.length >> 8) & 0xff;
        packet[offset++] = tBytes.length & 0xff;
        packet.set(tBytes, offset);
        offset += tBytes.length;
        packet.set(mBytes, offset);
        return packet;
    }

    function createCloudBus(options = {}) {
        const WebSocketImpl = options.WebSocket || root.WebSocket;
        if (!WebSocketImpl) return null;

        const CLIENT_ID = 'tca_' + Math.random().toString(16).slice(2, 10) + '_' + Math.floor(Math.random() * 100000);
        const seenIds = new Set();
        function markAndCheckId(id) {
            if (!id) return true;
            if (seenIds.has(id)) return false;
            seenIds.add(id);
            if (seenIds.size > 500) {
                const first = seenIds.values().next().value;
                seenIds.delete(first);
            }
            return true;
        }

        let brokerIdx = 0;
        let ws = null;
        let pingTimer = null;
        let isConnected = false;
        const listeners = [];
        const statusListeners = [];
        const pendingQueue = [];

        function notifyStatus(online) {
            isConnected = online;
            statusListeners.forEach(fn => {
                try { fn(online); } catch (e) { }
            });
        }

        function parseIncomingBuffer(u8) {
            let pos = 0;
            while (pos < u8.length) {
                const header = u8[pos];
                const type = header & 0xf0;
                let multiplier = 1;
                let remLen = 0;
                let idx = pos + 1;
                let digit = 0;
                do {
                    if (idx >= u8.length) return;
                    digit = u8[idx++];
                    remLen += (digit & 127) * multiplier;
                    multiplier *= 128;
                } while ((digit & 128) !== 0);

                const packetEnd = idx + remLen;
                if (packetEnd > u8.length) return;

                if (type === 0x20 || type === 0x90) {
                    // CONNACK o SUBACK -> Canal listo y vaciar cola pendiente
                    try {
                        if (!isConnected) notifyStatus(true);
                        while (pendingQueue.length > 0) {
                            const nextMsg = pendingQueue.shift();
                            ws.send(buildPublishPacket(TOPIC, nextMsg));
                        }
                    } catch (e) { }
                } else if (type === 0x30) {
                    // PUBLISH
                    const tLen = (u8[idx] << 8) | u8[idx + 1];
                    const payloadStart = idx + 2 + tLen;
                    if (payloadStart <= packetEnd) {
                        const jsonBytes = u8.subarray(payloadStart, packetEnd);
                        try {
                            const str = decoder.decode(jsonBytes);
                            const data = JSON.parse(str);
                            if (data && data._sender !== CLIENT_ID && markAndCheckId(data._id)) {
                                listeners.forEach(fn => {
                                    try { fn(data); } catch (e) { }
                                });
                            }
                        } catch (e) { }
                    }
                }
                pos = packetEnd;
            }
        }

        function connect() {
            const url = BROKERS[brokerIdx % BROKERS.length];
            try {
                ws = new WebSocketImpl(url, 'mqtt');
                ws.binaryType = 'arraybuffer';

                ws.onopen = () => {
                    try {
                        ws.send(buildConnectPacket(CLIENT_ID));
                        ws.send(buildSubscribePacket(TOPIC));
                        if (pingTimer) clearInterval(pingTimer);
                        pingTimer = setInterval(() => {
                            if (ws && ws.readyState === 1) {
                                try { ws.send(new Uint8Array([0xc0, 0x00])); } catch (e) { }
                            }
                        }, 25000);
                    } catch (e) { }
                };

                ws.onmessage = (evt) => {
                    try {
                        const raw = evt.data !== undefined ? evt.data : evt;
                        let u8;
                        if (raw instanceof ArrayBuffer) {
                            u8 = new Uint8Array(raw);
                        } else if (ArrayBuffer.isView(raw)) {
                            u8 = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
                        } else {
                            return;
                        }
                        parseIncomingBuffer(u8);
                    } catch (e) { }
                };

                ws.onclose = () => {
                    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
                    notifyStatus(false);
                    brokerIdx++;
                    setTimeout(connect, 2000);
                };

                ws.onerror = () => { };
            } catch (e) {
                brokerIdx++;
                setTimeout(connect, 2500);
            }
        }

        connect();

        return {
            clientId: CLIENT_ID,
            markAndCheckId,
            isConnected: () => isConnected,
            publish: (obj) => {
                if (!obj) return null;
                if (!obj._id) {
                    obj._id = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
                }
                obj._sender = CLIENT_ID;
                markAndCheckId(obj._id);
                const str = JSON.stringify(obj);
                if (ws && ws.readyState === 1 && isConnected) {
                    try {
                        ws.send(buildPublishPacket(TOPIC, str));
                    } catch (e) { }
                } else {
                    if (pendingQueue.length < 20) pendingQueue.push(str);
                }
                return obj;
            },
            onMessage: (fn) => listeners.push(fn),
            onStatus: (fn) => statusListeners.push(fn)
        };
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { createCloudBus };
    } else {
        root.TCACloudBus = createCloudBus();
    }
})(typeof window !== 'undefined' ? window : global);
