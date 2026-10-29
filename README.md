# Simulador de Terminal TCA Multi-Dispositivo - Recaudo Bogotá

Sistema de simulación de Terminal de Carga y Atención (TCA) de TransMilenio / Tullave con soporte para **3 lectores NFC USB ACR1251 simultáneos e independientes** en una sola PC con 3 pantallas o monitores.

---

## 🎯 Mapeo de Hardware y Dispositivos

El sistema reconoce los lectores físicos y asigna automáticamente los identificadores simplificados para los operadores:

| Dispositivo Físico (Serial) | ID Mostrado / Sistema | Lector PC/SC Windows | Periféricos Asociados |
| :--- | :---: | :--- | :--- |
| **RR234-016879** | **0068** | ACS ACR1251 1S CL Reader PICC 0 | Terminal 0068, Teclado 0068, PIU 0068 |
| **RR234-016991** | **0069** | ACS ACR1251 1S CL Reader PICC 1 | Terminal 0069, Teclado 0069, PIU 0069 |
| **RR234-017108** | **0071** | ACS ACR1251 1S CL Reader PICC 2 | Terminal 0071, Teclado 0071, PIU 0071 |

Cada terminal cuenta con su propio:
- **Terminal de Carga:** `http://<IP>:3000/?device=0068`
- **Teclado Remoto (Móvil con QR):** `http://<IP>:3000/keyboard.html?device=0068`
- **Pantalla PIU (Información al Usuario con QR):** `http://<IP>:3000/piu.html?device=0068`

---

## 🚀 Inicio Rápido (En la PC)

1. Conecta los 3 lectores ACR1251 a los puertos USB de la PC.
2. Ejecuta el archivo **`INICIADOR.bat`** (como Administrador para autorizar el Firewall de Windows).
3. Se abrirá automáticamente la **Central de Dispositivos (Hub)** en `http://localhost:3000/hub.html`.
4. En el Hub, haz clic en **"Lanzar las 3 Terminales a la Vez"**:
   - Se abrirán 3 ventanas independientes (`0068`, `0069` y `0071`).
   - Arrastra cada ventana a cada una de tus 3 pantallas.
5. Puedes probar el sonido de cada lector físicamente con el botón **"Hacer Sonar Lector (Beep)"** en cada tarjeta del Hub.

---

## 📱 Uso de Periféricos Remotos (Celulares y Tablets)

Cada terminal tiene un botón **TECLADO** y **PIU** en la barra superior:
1. Al hacer clic, se muestra un código QR único con el ID de esa terminal.
2. Escanéalo desde tu teléfono conectado a la misma red Wi-Fi.
3. El teclado o la pantalla PIU del celular quedará inmediatamente emparejada con esa terminal específica sin interferir con las otras dos.

---

## 🌐 Despliegue en GitHub y Vercel (Sin Docker)

Este proyecto está optimizado para funcionar directamente en cualquier navegador moderno sin dependencias de Docker:

### 1. Subir a GitHub
```bash
git init
git add .
git commit -m "feat: soporte multi-dispositivo 3 lectores ACR1251"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPOSITORIO.git
git push -u origin main
```

### 2. Desplegar en Vercel
1. Ingresa a [Vercel](https://vercel.com) e inicia sesión con GitHub.
2. Haz clic en **"Add New Project"** e importa este repositorio.
3. Vercel detectará automáticamente la configuración estática (`vercel.json`).
4. Haz clic en **"Deploy"**.
5. ¡Listo! Cualquier usuario podrá acceder a la interfaz desde la web de Vercel. Para comunicar la web de Vercel con los lectores físicos conectados por USB, solo debe estar ejecutándose `INICIADOR.bat` o `node bridge.js` en la PC local.

---

## ⚙️ Personalización de Mapeo (`devices.json`)

Si en algún momento cambias de puerto USB o de lector, puedes ajustar el mapeo editando directamente el archivo `devices.json`:

```json
{
  "devices": {
    "0068": {
      "displayId": "0068",
      "realSerial": "RR234-016879",
      "readerName": "ACS ACR1251 1S CL Reader PICC 0",
      "label": "Terminal 0068"
    },
    "0069": {
      "displayId": "0069",
      "realSerial": "RR234-016991",
      "readerName": "ACS ACR1251 1S CL Reader PICC 1",
      "label": "Terminal 0069"
    },
    "0071": {
      "displayId": "0071",
      "realSerial": "RR234-017108",
      "readerName": "ACS ACR1251 1S CL Reader PICC 2",
      "label": "Terminal 0071"
    }
  }
}
```

---

## ⚖️ Derechos Reservados y Propiedad Intelectual

> **Aviso Legal:**  
> Sistema creado y desarrollado por **Wilson Varela Muñoz**.  
> **Propiedad Intelectual:** Wilson Varela Muñoz.  
> **Uso Exclusivo:** Desarrollado para la empresa **Recaudo Bogotá S.A.S.** con fines formativos, de capacitación y aprendizaje.  
> Todos los derechos reservados.
