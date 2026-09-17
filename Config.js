/**
 * Config.js — bootstrap: spreadsheet/schema, Config sheet, lazy Drive folders.
 * รันครั้งเดียวตอน setup: initializeProject() แล้วไม่ต้องยุ่งอีก (เรียกซ้ำได้ ปลอดภัย/idempotent)
 */

var SHEET_NAMES = {
  CONFIG: 'Setting',
  MEMBERS: 'Members',
  ADMIN_ALLOWLIST: 'AdminAllowlist',
  ADMIN_SESSIONS: 'AdminSessions',
  CHAT_MESSAGES: 'ChatMessages',
  CHAT_THREADS: 'ChatThreads',
  CHAT_STATE: 'ChatState',
  WELFARE_CLAIMS: 'WelfareClaims',
  WELFARE_DOCS: 'WelfareDocs',
  PAYMENT_SLIPS: 'PaymentSlips',
  MISC_UPLOADS: 'MiscUploads',
  AUDIT_LOG: 'AuditLog'
};

var ROLES = {
  ADMIN_FULL: 'ADMIN_FULL',
  CHAT_STAFF: 'CHAT_STAFF'
};

function getSpreadsheetId_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('ยังไม่ได้ตั้งค่า SPREADSHEET_ID — กรุณารัน initializeProject() ก่อน');
  return id;
}

function getSs_() {
  return SpreadsheetApp.openById(getSpreadsheetId_());
}

function getSheet_(name) {
  var sh = getSs_().getSheetByName(name);
  if (!sh) throw new Error('ไม่พบชีต: ' + name + ' — กรุณารัน ensureSchema() ก่อน');
  return sh;
}

/**
 * อ่าน/เขียนค่า config ผ่านชีต "Setting" (Key/Value) — รวมถึง LINE token/secret ตามที่ตกลงไว้
 * (เก็บใน Sheet แทน Script Properties ทั้งหมด ยกเว้น SPREADSHEET_ID เอง ซึ่งต้องอยู่ใน Script Properties
 * เพราะเป็นตัวบอกว่าจะเปิด Sheet ไหน — เก็บไว้ในตัว Sheet เองไม่ได้ เป็น bootstrap constraint)
 * ⚠️ ข้อเสีย: ใครก็ตามที่เปิดดู Sheet นี้ได้ (เช่นแชร์ให้คนอื่นดู) จะเห็น token/secret เป็น plain text —
 * ถ้ากังวลเรื่องนี้ ควรจำกัดสิทธิ์การแชร์ Spreadsheet ตัวนี้ให้เฉพาะแอดมินจริง ๆ เท่านั้น
 */
function getConfig_(key) {
  var cache = CacheService.getScriptCache();
  var ck = 'cfg_' + key;
  var cached = cache.get(ck);
  if (cached !== null) return cached;
  var rows = readSheet_(getSheet_(SHEET_NAMES.CONFIG));
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].Key === key) {
      var v = String(rows[i].Value || '');
      try { cache.put(ck, v, 3600); } catch (e) {}
      return v;
    }
  }
  return '';
}

function setConfig_(key, value) {
  var sh = getSheet_(SHEET_NAMES.CONFIG);
  var rows = readSheet_(sh);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].Key === key) {
      sh.getRange(rows[i].__rowIndex, 2).setValue(value);
      SpreadsheetApp.flush();
      CacheService.getScriptCache().remove('cfg_' + key);
      return;
    }
  }
  appendRowByHeaders_(sh, { Key: key, Value: value });
  SpreadsheetApp.flush();
}

function ensureConfigEntry_(key, valueFn) {
  var existing = getConfig_(key);
  if (existing) return existing;
  var v = valueFn();
  setConfig_(key, v);
  return v;
}

function createDriveFolderIfMissing_(name, parentFolder) {
  var parent = parentFolder || DriveApp.getRootFolder();
  var it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}

/** Sheet ที่ผูกไว้ล่วงหน้า (ให้มาจากผู้ใช้ตอน link project) — ใช้เป็นค่าเริ่มต้นถ้ายังไม่มี SPREADSHEET_ID ใน Script Properties */
var DEFAULT_SPREADSHEET_ID = '1ttouCdixfisEHHUd4Tjr77sllKiMD9VWuPQX9csw9vU';

/**
 * ผูก Spreadsheet (ใช้ตัวที่ผูกไว้แล้ว หรือสร้างใหม่ถ้าไม่ได้ตั้งอะไรไว้เลย) + โครงสร้าง Drive + ชีตทั้งหมด
 * รันครั้งเดียวจาก Apps Script editor ตอน setup (เลือกฟังก์ชันนี้ใน dropdown ▷ Run)
 */
function initializeProject() {
  var props = PropertiesService.getScriptProperties();
  var ssId = props.getProperty('SPREADSHEET_ID') || DEFAULT_SPREADSHEET_ID;
  var ss;
  if (ssId) {
    ss = SpreadsheetApp.openById(ssId);
    props.setProperty('SPREADSHEET_ID', ss.getId());
  } else {
    ss = SpreadsheetApp.create('LineMCP - ข้อมูลระบบ (สหกรณ์ออมทรัพย์สาธารณสุขมุกดาหาร)');
    props.setProperty('SPREADSHEET_ID', ss.getId());
  }

  ensureSchema();

  // โฟลเดอร์รากของระบบใน Drive + subfolder ตามสมาชิก (สร้างแบบ lazy รายบุคคลตอนใช้งานจริงใน Files.js)
  var rootFolder = createDriveFolderIfMissing_('LineMCP_สหกรณ์ออมทรัพย์สาธารณสุขมุกดาหาร');
  ensureConfigEntry_('ROOT_FOLDER_ID', function () { return rootFolder.getId(); });
  var membersRoot = createDriveFolderIfMissing_('สมาชิก', rootFolder);
  ensureConfigEntry_('MEMBERS_FOLDER_ID', function () { return membersRoot.getId(); });

  ensureTriggers_();

  Logger.log('เริ่มระบบสำเร็จ — Spreadsheet: ' + ss.getUrl());
  Logger.log('ขั้นต่อไป: เปิด setup.html ของ frontend (GitHub Pages) แล้วกรอก LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET, ' +
    'LINE_LOGIN_CHANNEL_ID, LINE_LOGIN_CHANNEL_SECRET, ADMIN_LINE_GROUP_ID ผ่านหน้าเว็บได้เลย (บันทึกลงชีต Setting)');
  return ss.getUrl();
}

/** ตั้ง time-driven trigger แบบ idempotent — ลบของเดิมที่ชื่อเดียวกันก่อนสร้างใหม่ กันซ้ำซ้อนทุกครั้งที่รัน initializeProject() */
function ensureTriggers_() {
  var existing = ScriptApp.getProjectTriggers();
  var have = {};
  existing.forEach(function (t) { have[t.getHandlerFunction()] = t; });

  if (!have['checkUnansweredThreads_']) {
    ScriptApp.newTrigger('checkUnansweredThreads_').timeBased().everyMinutes(5).create();
  }
  if (!have['cleanupExpiredSessions_']) {
    ScriptApp.newTrigger('cleanupExpiredSessions_').timeBased().everyDays(1).atHour(3).create();
  }
}

function ensureSchema() {
  var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'));

  ensureSheet_(ss, SHEET_NAMES.CONFIG, ['Key', 'Value']);

  var members = ensureSheet_(ss, SHEET_NAMES.MEMBERS, [
    'MemberNo', 'Title', 'FirstName', 'LastName', 'NationalId', 'Affiliation',
    'JoinDate', 'BirthDate', 'Phone', 'LineUserId', 'LinkedAt', 'PDPAConsentAt', 'CreatedAt', 'UpdatedAt'
  ]);
  ensureTextColumn_(members, 'MemberNo');
  ensureTextColumn_(members, 'NationalId');
  ensureTextColumn_(members, 'Phone');

  ensureSheet_(ss, SHEET_NAMES.ADMIN_ALLOWLIST, [
    'LineUserId', 'DisplayName', 'Role', 'Active', 'AddedAt', 'AddedBy'
  ]);

  ensureSheet_(ss, SHEET_NAMES.ADMIN_SESSIONS, [
    'Token', 'LineUserId', 'Role', 'DisplayName', 'ExpiresAt', 'CreatedAt'
  ]);

  ensureSheet_(ss, SHEET_NAMES.CHAT_MESSAGES, [
    'MessageId', 'LineUserId', 'MemberNo', 'Direction', 'MsgType', 'Text',
    'DriveFileId', 'CreatedAt', 'HandledBy'
  ]);

  ensureSheet_(ss, SHEET_NAMES.CHAT_THREADS, [
    'LineUserId', 'MemberNo', 'MemberName', 'LastMessageAt', 'LastMessageText',
    'LastDirection', 'UnreadCount', 'FirstUnansweredAt', 'AlertedAt', 'Status'
  ]);

  ensureSheet_(ss, SHEET_NAMES.CHAT_STATE, ['LineUserId', 'ContextJson', 'UpdatedAt']);

  ensureSheet_(ss, SHEET_NAMES.WELFARE_CLAIMS, [
    'ClaimId', 'MemberNo', 'LineUserId', 'Type', 'AmountBaht', 'SubmittedAt',
    'DeadlineDate', 'Status', 'DriveFolderId', 'ReviewedBy', 'ReviewedAt', 'PaidAt', 'Notes'
  ]);

  ensureSheet_(ss, SHEET_NAMES.WELFARE_DOCS, [
    'ClaimId', 'DocType', 'DriveFileId', 'FileName', 'UploadedAt'
  ]);

  var slips = ensureSheet_(ss, SHEET_NAMES.PAYMENT_SLIPS, [
    'SlipId', 'MemberNo', 'LineUserId', 'DriveFileId', 'UploadedAt', 'Note', 'Status', 'HandledBy', 'HandledAt'
  ]);

  ensureSheet_(ss, SHEET_NAMES.MISC_UPLOADS, [
    'UploadId', 'MemberNo', 'LineUserId', 'DriveFileId', 'FileName', 'UploadedAt', 'Tag', 'TaggedBy'
  ]);

  ensureSheet_(ss, SHEET_NAMES.AUDIT_LOG, [
    'Timestamp', 'Actor', 'Action', 'Target', 'Detail'
  ]);
}
