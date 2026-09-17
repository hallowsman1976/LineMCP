/**
 * Settings.js — หน้าตั้งค่าระบบผ่านเว็บ บันทึกลงชีต "Setting" (ไม่ใช้ Script Properties เลย
 * ยกเว้น SPREADSHEET_ID ซึ่งต้องอยู่ใน Script Properties เพราะเป็นตัวบอกว่าจะเปิด Sheet ไหน — ดูหมายเหตุใน Config.js)
 *
 * กลไกความปลอดภัย (ไม่มี bootstrap secret แยก — ใช้สถานะของระบบเองเป็นตัวล็อก):
 *   - ตอนยังตั้งค่า LINE Login ไม่ครบ (isSetupLocked_() === false) → ไม่มีทางอื่นให้ authenticate อยู่แล้ว
 *     (LINE Login ทำงานไม่ได้จนกว่าจะกรอกค่าพวกนี้) จึงเปิดให้บันทึกได้แบบไม่ต้อง login เป็นการชั่วคราว
 *   - พอกรอกครบครั้งแรกแล้ว (locked) → การแก้ไขค่าต่อจากนี้ต้อง login ด้วย LINE แบบ ADMIN_FULL เท่านั้น
 *     (เหมือนหน้าแอดมินอื่น ๆ) กันคนนอกมาแก้ token ทีหลัง
 *
 * ⚠️ ค่าที่บันทึกในชีต Setting เป็น plain text ใครเปิดดู Sheet ได้ก็เห็น token/secret ได้ —
 * ถ้ากังวลเรื่องนี้ ให้จำกัดสิทธิ์แชร์ Spreadsheet เฉพาะแอดมินจริง ๆ เท่านั้น
 */

var SETUP_REQUIRED_KEYS = ['LINE_CHANNEL_ACCESS_TOKEN', 'LINE_CHANNEL_SECRET', 'LINE_LOGIN_CHANNEL_ID', 'LINE_LOGIN_CHANNEL_SECRET', 'WEBAPP_BASE_URL'];
// FRONTEND_URL จำเป็นสำหรับ LINE Login แต่ไม่นับในเงื่อนไขล็อก — ไม่งั้นระบบที่ตั้งค่าครบแล้ว (ก่อนย้าย frontend)
// จะกลับมา "ปลดล็อก" ให้คนนอกแก้ token ได้ทันทีที่อัปเดตโค้ด ระบบเดิมให้เพิ่มแถว FRONTEND_URL ในชีต Setting เอง (ดู WORKFLOW.md)
var SETUP_OPTIONAL_KEYS = ['FRONTEND_URL', 'ADMIN_LINE_GROUP_ID', 'WEBHOOK_SECRET', 'LIFF_ID'];
var SETUP_ALL_KEYS = SETUP_REQUIRED_KEYS.concat(SETUP_OPTIONAL_KEYS);

/** true ถ้าชีต "Setting" (สร้างโดย initializeProject) พร้อมใช้งานแล้ว */
function isSettingSheetReady_() {
  try {
    getSheet_(SHEET_NAMES.CONFIG); // SHEET_NAMES.CONFIG = 'Setting'
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * ล็อกหน้าตั้งค่าก็ต่อเมื่อ "มีคนเข้าระบบมาแก้ต่อได้จริง" เท่านั้น คือต้องครบทั้ง 2 อย่าง:
 *   1. ค่า config ที่จำเป็นครบแล้ว
 *   2. มีแอดมินเต็มที่ active อยู่ใน allowlist อย่างน้อย 1 คน (ไม่งั้นจะล็อกตัวเองตายโดยไม่มีใครมีกุญแจ
 *      — ตอน LINE Login ยังใช้ไม่ได้/ยังไม่มีใคร bootstrap เป็นแอดมิน จะเข้าหน้าตั้งค่าไม่ได้เลย)
 */
function isSetupLocked_() {
  if (!isSettingSheetReady_()) return false;
  var configComplete = SETUP_REQUIRED_KEYS.every(function (k) { return !!getConfig_(k); });
  if (!configComplete) return false;
  return hasActiveAdmin_();
}

function hasActiveAdmin_() {
  try {
    var rows = readSheet_(getSheet_(SHEET_NAMES.ADMIN_ALLOWLIST));
    return rows.some(function (r) {
      return r.LineUserId && r.Role === ROLES.ADMIN_FULL && String(r.Active) !== 'false' && r.Active !== false;
    });
  } catch (e) {
    return false;
  }
}

function maskSecret_(v) {
  if (!v) return '';
  if (v.length <= 6) return '••••••';
  return v.slice(0, 4) + '••••••' + v.slice(-4);
}

/** คืนสถานะปัจจุบัน — ค่าที่ตั้งแล้วจะ mask ไว้ (ไม่ส่งค่าจริงกลับไปโชว์ซ้ำ) */
function getSetupStatus_(token) {
  try {
    if (!isSettingSheetReady_()) {
      return { ok: false, message: 'ยังไม่พร้อมใช้งาน — กรุณารัน initializeProject() จาก Apps Script editor ก่อน (ครั้งแรกครั้งเดียว)' };
    }
    if (isSetupLocked_()) {
      var admin = requireAdminSession_(token);
      requireRole_(admin, [ROLES.ADMIN_FULL]);
    }
    var values = {};
    SETUP_ALL_KEYS.forEach(function (k) {
      var v = getConfig_(k);
      values[k] = v ? maskSecret_(v) : '';
    });
    return { ok: true, locked: isSetupLocked_(), hasAdmin: hasActiveAdmin_(), values: values, detectedWebAppUrl: ScriptApp.getService().getUrl() || '' };
  } catch (err) {
    return { ok: false, message: translateError_(err) };
  }
}

/**
 * บันทึกค่าลงชีต Setting — payload = { KEY: value, ... } เฉพาะ key ที่รู้จักเท่านั้น (whitelist กัน key แปลกปลอม)
 * ค่าว่าง ('') จะถูกข้าม ไม่ทับของเดิม — ใส่เฉพาะช่องที่ต้องการเปลี่ยนก็พอ
 */
function saveSetupProperties_(token, payload) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, message: 'ระบบกำลังประมวลผลคำขออื่น กรุณาลองใหม่ในอีกสักครู่' };
  try {
    if (!isSettingSheetReady_()) {
      throw new Error('ยังไม่พร้อมใช้งาน — กรุณารัน initializeProject() จาก Apps Script editor ก่อน');
    }
    var wasLocked = isSetupLocked_();
    if (wasLocked) {
      var admin = requireAdminSession_(token);
      requireRole_(admin, [ROLES.ADMIN_FULL]);
    }
    if (!payload || typeof payload !== 'object') throw new Error('ข้อมูลไม่ถูกต้อง');

    var saved = [];
    SETUP_ALL_KEYS.forEach(function (k) {
      var v = payload[k];
      if (v == null) return;
      v = String(v).trim();
      if (!v) return; // ไม่ทับของเดิมด้วยค่าว่าง
      if (v.length > 2000) throw new Error(k + ' ยาวเกินไป');
      if ((k === 'FRONTEND_URL' || k === 'WEBAPP_BASE_URL') && !/^https:\/\/[^\s?#]+$/.test(v)) {
        throw new Error(k + ' ต้องขึ้นต้นด้วย https:// และห้ามมี ? หรือ # ต่อท้าย');
      }
      setConfig_(k, v);
      saved.push(k);
    });

    // ถ้าไม่ได้กรอก WEBAPP_BASE_URL มาเอง ใช้ค่าที่ detect อัตโนมัติจาก deployment ปัจจุบัน
    if (saved.indexOf('WEBAPP_BASE_URL') === -1 && !getConfig_('WEBAPP_BASE_URL')) {
      var detected = ScriptApp.getService().getUrl();
      if (detected) { setConfig_('WEBAPP_BASE_URL', detected); saved.push('WEBAPP_BASE_URL'); }
    }
    // สุ่ม WEBHOOK_SECRET ให้อัตโนมัติถ้ายังไม่เคยตั้ง (ไม่ต้องคิดเอง)
    if (saved.indexOf('WEBHOOK_SECRET') === -1 && !getConfig_('WEBHOOK_SECRET')) {
      setConfig_('WEBHOOK_SECRET', Utilities.getUuid().replace(/-/g, ''));
      saved.push('WEBHOOK_SECRET');
    }

    if (!wasLocked && isSetupLocked_()) {
      Logger.log('[saveSetupProperties_] setup ครบแล้ว ล็อกหน้าตั้งค่าไว้เฉพาะ ADMIN_FULL จากนี้');
    }

    return { ok: true, saved: saved, locked: isSetupLocked_() };
  } catch (err) {
    Logger.log('[saveSetupProperties_] ' + (err.stack || err));
    return { ok: false, message: translateError_(err) };
  } finally {
    lock.releaseLock();
  }
}

/** ให้หน้า setup โชว์ webhook URL เต็ม ๆ พร้อม secret ต่อท้าย ให้ก็อปไปวางใน LINE Developers Console ได้เลย */
function getWebhookUrlPreview_(token) {
  try {
    if (!isSettingSheetReady_()) return { ok: true, url: '' };
    if (isSetupLocked_()) {
      var admin = requireAdminSession_(token);
      requireRole_(admin, [ROLES.ADMIN_FULL]);
    }
    var base = getConfig_('WEBAPP_BASE_URL') || ScriptApp.getService().getUrl() || '';
    var secret = getConfig_('WEBHOOK_SECRET') || '';
    if (!base) return { ok: true, url: '' };
    return { ok: true, url: base + (secret ? '?wh=' + encodeURIComponent(secret) : '') };
  } catch (err) {
    return { ok: false, message: translateError_(err) };
  }
}
