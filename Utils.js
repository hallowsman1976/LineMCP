/**
 * Utils.js — sheet I/O, formatting, and small cross-cutting helpers.
 * ทุกฟังก์ชันช่วยเหลือที่ใช้ข้ามไฟล์อื่นให้มารวมที่นี่
 */

/** อ่านทั้งชีตครั้งเดียว คืน array of object ตาม header, แนบ __rowIndex (1-based) ไว้ update ทีหลัง */
function readSheet_(sheet) {
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  var headers = data[0];
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var o = {};
    for (var j = 0; j < headers.length; j++) o[headers[j]] = data[i][j];
    o.__rowIndex = i + 1;
    rows.push(o);
  }
  return rows;
}

/** append row ตามลำดับ header ของชีต — เติม apostrophe ให้ field ที่ต้องกัน leading zero หาย */
var TEXT_SAFE_FIELDS_ = ['MemberNo', 'NationalId', 'Phone', 'PostalCode', 'ClaimId', 'MessageId', 'UploadId', 'SlipId', 'LineUserId'];

function appendRowByHeaders_(sheet, obj) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row = headers.map(function (h) {
    var v = obj[h];
    if (v == null) return '';
    if (TEXT_SAFE_FIELDS_.indexOf(h) !== -1 && /^\d/.test(String(v))) return "'" + String(v);
    return v;
  });
  sheet.appendRow(row);
  return sheet.getLastRow();
}

/** เขียนหลาย field ของแถวเดียวโดยอ้างชื่อ column — เขียนทีละเซลล์กัน merged-cell error */
function updateRowByHeaders_(sheet, rowIndex, patch) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  for (var h in patch) {
    var idx = headers.indexOf(h);
    if (idx === -1) continue;
    var v = patch[h];
    if (TEXT_SAFE_FIELDS_.indexOf(h) !== -1 && v != null && /^\d/.test(String(v))) v = "'" + String(v);
    sheet.getRange(rowIndex, idx + 1).setValue(v);
  }
}

function colIndex_(sheet, headerName) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var idx = headers.indexOf(headerName);
  if (idx < 0) throw new Error('ไม่พบ column: ' + headerName);
  return idx + 1;
}

/** สร้างชีตถ้ายังไม่มี พร้อม header แถวแรก */
function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    return sh;
  }
  // เติม header ที่ขาดต่อท้าย (ไม่ลบของเดิม กัน schema เปลี่ยนพังของเก่า)
  var existing = sh.getLastColumn() > 0 ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
  var missing = headers.filter(function (h) { return existing.indexOf(h) === -1; });
  if (missing.length) {
    sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  }
  return sh;
}

/** บังคับคอลัมน์เป็น Plain text กันเลขนำหน้า 0 หาย (เบอร์โทร, เลขบัตร ปชช., เลขสมาชิก ฯลฯ) */
function ensureTextColumn_(sheet, headerName) {
  var col = colIndex_(sheet, headerName);
  var lastRow = Math.max(sheet.getMaxRows(), 1000);
  sheet.getRange(1, col, lastRow, 1).setNumberFormat('@');
}

function sanitizeForClient_(obj) {
  if (obj == null) return obj;
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) return obj.map(sanitizeForClient_);
  if (typeof obj === 'object') {
    var out = {};
    for (var k in obj) {
      if (k === '__rowIndex') continue;
      out[k] = sanitizeForClient_(obj[k]);
    }
    return out;
  }
  return obj;
}

function toIsoOrEmpty_(v) {
  if (!v) return '';
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString();
  var d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toISOString();
}

/** parse วันที่รูปแบบไทย/สากลที่พบในไฟล์ Excel ของสหกรณ์ (dd/MM/yyyy พ.ศ. หรือ ค.ศ.) */
function parseThaiDate_(input) {
  if (input instanceof Date) return input;
  var s = String(input || '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s);
  var m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (m) {
    var d = parseInt(m[1], 10), mo = parseInt(m[2], 10), y = parseInt(m[3], 10);
    if (y > 2400) y -= 543;
    else if (y < 100) y += 2000;
    return new Date(y, mo - 1, d);
  }
  return null;
}

function formatDate_(date, pattern) {
  if (!date) return '';
  return Utilities.formatDate(date, 'Asia/Bangkok', pattern || 'dd/MM/yyyy');
}

function nowIso_() {
  return new Date().toISOString();
}

/** จำนวนวันเต็มระหว่างสองวัน (ปัดเศษลง) */
function daysBetween_(from, to) {
  var ms = to.getTime() - from.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function newId_(prefix) {
  return prefix + '-' + Utilities.getUuid().split('-')[0].toUpperCase();
}

/** ตรวจรูปแบบเลขบัตรประชาชนไทย (13 หลัก, ตัวเลขล้วน) */
function isValidNationalId_(id) {
  return /^\d{13}$/.test(String(id || '').trim());
}

function isValidThaiPhone_(phone) {
  return /^0\d{8,9}$/.test(String(phone || '').trim());
}

function escapeHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** แปล error message ของ GAS ที่เจอบ่อยให้ user อ่านเข้าใจ */
function translateError_(err) {
  var msg = String((err && err.message) || err);
  if (msg.indexOf('ข้อผิดพลาดของบริการ') !== -1 || msg.indexOf('Service Spreadsheets failed') !== -1) {
    return 'ระบบ Sheet ขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง';
  }
  if (/lock/i.test(msg)) return 'ระบบกำลังประมวลผลคำขออื่น กรุณาลองใหม่ในอีกสักครู่';
  if (/execution time/i.test(msg)) return 'ประมวลผลใช้เวลานานเกินกำหนด กรุณาลองใหม่';
  return msg;
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
