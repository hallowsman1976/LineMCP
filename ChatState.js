/**
 * ChatState.js — บันทึกสถานะการสนทนาต่อ LineUserId (อยู่ระหว่างยืนยันตัวตน/ยื่นสวัสดิการ/ส่งเอกสาร ฯลฯ)
 * เก็บเป็นแถวในชีต ChatState (ไม่ใช้ CacheService เพราะ state ต้องอยู่ได้นาน ไม่ใช่แค่ cache ของ lookup)
 */

var CHAT_MODE = {
  IDLE: 'IDLE',
  AWAIT_WELFARE_TYPE: 'AWAIT_WELFARE_TYPE',
  AWAIT_WELFARE_EVENT_DATE: 'AWAIT_WELFARE_EVENT_DATE',
  AWAIT_WELFARE_DOCS: 'AWAIT_WELFARE_DOCS',
  AWAIT_SLIP: 'AWAIT_SLIP',
  AWAIT_UPLOAD_CATEGORY_CONFIRM: 'AWAIT_UPLOAD_CATEGORY_CONFIRM'
};

function getChatState_(lineUserId) {
  var rows = readSheet_(getSheet_(SHEET_NAMES.CHAT_STATE));
  var row = rows.find(function (r) { return r.LineUserId === lineUserId; });
  if (!row) return { mode: CHAT_MODE.IDLE };
  try {
    return JSON.parse(row.ContextJson || '{}');
  } catch (e) {
    return { mode: CHAT_MODE.IDLE };
  }
}

function setChatState_(lineUserId, state) {
  var sheet = getSheet_(SHEET_NAMES.CHAT_STATE);
  var rows = readSheet_(sheet);
  var row = rows.find(function (r) { return r.LineUserId === lineUserId; });
  var json = JSON.stringify(state || { mode: CHAT_MODE.IDLE });
  if (row) {
    updateRowByHeaders_(sheet, row.__rowIndex, { ContextJson: json, UpdatedAt: nowIso_() });
  } else {
    appendRowByHeaders_(sheet, { LineUserId: lineUserId, ContextJson: json, UpdatedAt: nowIso_() });
  }
}

function resetChatState_(lineUserId) {
  setChatState_(lineUserId, { mode: CHAT_MODE.IDLE });
}
