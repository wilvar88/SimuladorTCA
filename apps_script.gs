function doPost(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    // Intenta usar una hoja llamada 'Logs' o usa la primera disponible
    var sheet = ss.getSheetByName('Logs') || ss.getSheets()[0];
    
    var data = JSON.parse(e.postData.contents);
    
    // Mapeo detallado de los 37 campos requeridos para la trazabilidad
    // Importante: El orden debe coincidir EXACTAMENTE con tus encabezados
    var row = [
      data.serieRecibo,            // Serie de recibo
      data.idCargador,             // ID de cargador
      data.nombreEstacion,         // Nombre de Estacion
      data.idOperador,             // ID de Operador
      data.fechaHoraInic,          // Fecha/Hora Inic Trabajo
      data.fechaHoraCierre,        // Fecha/Hora CierreTrabajo
      data.saldoLsamInicio,        // Saldo LSAM Inicio
      data.saldoLsamCierre,        // Saldo LSAM Cierre
      data.nRecargas,              // Nro. Recargas
      data.vRecargas,              // Valor Recargas
      data.nAnulacRecargas,        // Nro. Anulac. Recargas
      data.vAnulacRecargas,        // Valor Anulac. Recargas
      data.nDescargaTarjetas,      // Nro. Descarga tarjetas
      data.vDescargaTarjetas,      // Valor Descarga tarjetas
      data.nVentaTarjetas,         // Nro. Venta tarjetas
      data.vVentaTarjetas,         // Valor Ventas tarjetas
      data.nVentaTarjGratis,       // Nro. Ventas tarj. gratis
      data.nExcepcionRecargas,     // Nro. Excepción recargas
      data.vExcepcionRecargas,     // Valor Excepción recargas
      data.nFallidas,              // Nro. Fallidas
      data.vFallidas,              // Valor Fallidas
      data.nRecargaReembolsos,     // Nro. Recarga reembolsos
      data.vRecargaReembolsos,     // Valor Recarga reembolsos
      data.nAnulacReembolso,       // Nro. Anulac. Reembolso
      data.vAnulacReembolso,       // Valor Anulac. Reembolso
      data.nDevolucionBillete,     // Nro. Devolución billete
      data.vDevolucionBillete,     // Valor Devolución billete
      data.nSubsidioConvenio,      // Nro. Subsidio/Convenio
      data.vSubsidioConvenio,      // Valor Subsidio/Convenio
      data.nAnulacSubsidio,        // Nro. Anulac. Subsidio
      data.vAnulacSubsidio,        // Valor Anulac. Subsidio
      data.debitadoLsamReal,       // Debitado LSAM real
      data.debitadoLsamReportado,  // Debitado LSAM reportado
      data.totalIngresosEfectivo,  // Total Ingresos efectivo
      data.cajaBaseOperacion,      // Caja base de operación
      data.montoIngresadoSupuesto, // Monto ingresado supuesto
      data.efectivoRealEnCaja      // Efectivo real en caja
    ];
    
    sheet.appendRow(row);
    
    return ContentService.createTextOutput(JSON.stringify({
      "result": "success",
      "row": sheet.getLastRow()
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      "result": "error",
      "message": err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
