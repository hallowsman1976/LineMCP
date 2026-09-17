/**
 * Auth.js — แอดมิน login ด้วย LINE Login (OAuth2, แยก channel จาก Messaging API)
 * + allowlist (Sheet: AdminAllowlist) + session token (Sheet: AdminSessions)
 *
 * ต้องตั้งค่าที่หน้า setup.html ของ frontend (บันทึกลงชีต Setting):
 *   LINE_LOGIN_CHANNEL_ID, LINE_LOGIN_CHANNEL_SECRET, FRONTEND_URL
 * และไปตั้งค่าใน LINE Developers Console > LINE Login channel > Callback URL
 *   = FRONTEND_URL ตรง ๆ (URL ของหน้าแอดมินบน GitHub Pages ห้ามต่อ query string — LINE จะ match ไม่ผ่าน)
 * flow: frontend → LINE Login → LINE redirect กลับมาที่ FRONTEND_URL?code=&state=
 *       → frontend ส่ง code มาที่ API exchangeLoginCode → ได้ session token กลับไปเก็บใน localStorage
 */

var SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 ชั่วโมง

/**
 * ต้องตรงกับ Callback URL ที่ตั้งไว้ใน LINE Developers Console > LINE Login channel เป๊ะ ๆ ทุกตัวอักษร
 * = FRONTEND_URL (หน้าแอดมินบน GitHub Pages) — หน้านั้นอ่าน code/state จาก query string เองแล้วส่งมาแลก token
 * ต้องใช้ค่าเดียวกันทั้งตอนสร้าง login URL และตอนแลก code ไม่งั้น LINE ตอบ 400 Invalid redirect_uri
 */
function getOAuthRedirectUri_() {
  return getConfig_('FRONTEND_URL');
}

function buildLineLoginUrl_(state) {
  var clientId = lineProp_('LINE_LOGIN_CHANNEL_ID');
  var redirectUri = lineProp_('FRONTEND_URL');
  var params = [
    'response_type=code',
    'client_id=' + encodeURIComponent(clientId),
    'redirect_uri=' + encodeURIComponent(redirectUri),
    'state=' + encodeURIComponent(state),
    'scope=' + encodeURIComponent('profile openid'),
  ];
  return 'https://access.line.me/oauth2/v2.1/authorize?' + params.join('&');
}

function exchangeLineLoginCode_(code) {
  var redirectUri = lineProp_('FRONTEND_URL');
  var res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/token', {
    method: 'post',
    payload: {
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri,
      client_id: lineProp_('LINE_LOGIN_CHANNEL_ID'),
      client_secret: lineProp_('LINE_LOGIN_CHANNEL_SECRET')
    },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) {
    Logger.log('[exchangeLineLoginCode_] ' + res.getContentText());
    throw new Error('ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาลองใหม่');
  }
  return JSON.parse(res.getContentText()); // { access_token, id_token, ... }
}

function fetchLineLoginProfile_(accessToken) {
  var res = UrlFetchApp.fetch('https://api.line.me/v2/profile', {
    method: 'get',
    headers: { Authorization: 'Bearer ' + accessToken },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) throw new Error('ดึงโปรไฟล์ LINE ไม่สำเร็จ');
  return JSON.parse(res.getContentText()); // { userId, displayName, pictureUrl }
}

function findAllowlistEntry_(lineUserId) {
  var rows = readSheet_(getSheet_(SHEET_NAMES.ADMIN_ALLOWLIST));
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].LineUserId === lineUserId) return rows[i];
  }
  return null;
}

/** ประมวลผล callback จาก LINE Login: แลก code -> profile -> เช็ค allowlist -> ออก session token */
function handleLineLoginCallback_(code) {
  var tokenRes = exchangeLineLoginCode_(code);
  var profile = fetchLineLoginProfile_(tokenRes.access_token);

  var entry = findAllowlistEntry_(profile.userId);
  if (!entry || String(entry.Active) === 'false' || entry.Active === false) {
    // log ให้ admin คนแรกเอา userId นี้ไปใส่ bootstrapFirstAdmin_() หรือ addAdmin_() ได้
    Logger.log('[handleLineLoginCallback_] rejected — LineUserId=' + profile.userId + ' displayName=' + profile.displayName);
    throw new Error('บัญชี LINE นี้ไม่มีสิทธิ์เข้าระบบแอดมิน (LINE User ID: ' + profile.userId + ') กรุณาติดต่อผู้ดูแลระบบให้เพิ่มชื่อใน allowlist');
  }

  var token = Utilities.getUuid();
  appendRowByHeaders_(getSheet_(SHEET_NAMES.ADMIN_SESSIONS), {
    Token: token,
    LineUserId: profile.userId,
    Role: entry.Role,
    DisplayName: profile.displayName,
    ExpiresAt: String(Date.now() + SESSION_TTL_MS),
    CreatedAt: nowIso_()
  });
  SpreadsheetApp.flush();

  return { token: token, role: entry.Role, displayName: profile.displayName };
}

function requireAdminSession_(token) {
  if (!token) throw new Error('ไม่ได้ login กรุณาเข้าสู่ระบบด้วย LINE');
  var rows = readSheet_(getSheet_(SHEET_NAMES.ADMIN_SESSIONS));
  var session = null;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].Token === token) { session = rows[i]; break; }
  }
  if (!session) throw new Error('session หมดอายุ กรุณา login ใหม่');
  if (Number(session.ExpiresAt) < Date.now()) throw new Error('session หมดอายุ กรุณา login ใหม่');

  // เช็ค allowlist ซ้ำทุกครั้ง เผื่อถูกถอดสิทธิ์ระหว่างที่ session ยังไม่หมดอายุ
  var entry = findAllowlistEntry_(session.LineUserId);
  if (!entry || String(entry.Active) === 'false' || entry.Active === false) {
    throw new Error('บัญชีนี้ถูกถอดสิทธิ์แอดมินแล้ว');
  }
  return { LineUserId: session.LineUserId, Role: entry.Role, DisplayName: session.DisplayName };
}

function requireRole_(admin, allowedRoles) {
  if (!Array.isArray(allowedRoles)) allowedRoles = [allowedRoles];
  if (allowedRoles.indexOf(admin.Role) === -1) throw new Error('คุณไม่มีสิทธิ์ทำรายการนี้');
}

function logoutAdmin_(token) {
  try {
    var sheet = getSheet_(SHEET_NAMES.ADMIN_SESSIONS);
    var rows = readSheet_(sheet);
    var session = rows.find(function (r) { return r.Token === token; });
    if (session) sheet.deleteRow(session.__rowIndex);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: translateError_(err) };
  }
}

/**
 * bootstrap แอดมินเต็มคนแรก (ไม่มี session guard เพราะตอน allowlist ว่าง ไม่มีใคร login ได้เลย)
 * เรียกผ่านหน้า setup.html ของ frontend (API bootstrapFirstAdmin — ปิดตัวเองเมื่อมีแอดมินเต็มแล้ว)
 * วิธีใช้: ให้คนที่จะเป็นแอดมินเต็มคนแรก login ด้วย LINE ที่หน้าแอดมิน 1 ครั้ง (จะถูกปฏิเสธ)
 * หน้าจอจะโชว์ LINE User ID ของเขาให้เห็นตรง ๆ — เอาค่านั้นไปกรอกที่หน้า setup.html
 */
function bootstrapFirstAdmin_(lineUserId, displayName) {
  if (findAllowlistEntry_(lineUserId)) {
    Logger.log('มีอยู่แล้ว: ' + lineUserId);
    return;
  }
  appendRowByHeaders_(getSheet_(SHEET_NAMES.ADMIN_ALLOWLIST), {
    LineUserId: lineUserId, DisplayName: displayName || '', Role: ROLES.ADMIN_FULL,
    Active: true, AddedAt: nowIso_(), AddedBy: 'bootstrap'
  });
  SpreadsheetApp.flush();
  Logger.log('เพิ่มแอดมินเต็มคนแรกสำเร็จ: ' + lineUserId);
}

// ---------- Admin allowlist management (ADMIN_FULL เท่านั้น) ----------

function listAdmins_(token) {
  try {
    var admin = requireAdminSession_(token);
    requireRole_(admin, [ROLES.ADMIN_FULL]);
    var rows = readSheet_(getSheet_(SHEET_NAMES.ADMIN_ALLOWLIST));
    return { ok: true, admins: sanitizeForClient_(rows) };
  } catch (err) {
    return { ok: false, message: translateError_(err) };
  }
}

function addAdmin_(token, lineUserId, displayName, role) {
  try {
    var admin = requireAdminSession_(token);
    requireRole_(admin, [ROLES.ADMIN_FULL]);
    if (!lineUserId) throw new Error('กรุณาระบุ LINE User ID (ดูได้จาก log ตอนแอดมินคนนั้น login ครั้งแรกแล้วถูกปฏิเสธ)');
    if ([ROLES.ADMIN_FULL, ROLES.CHAT_STAFF].indexOf(role) === -1) throw new Error('role ไม่ถูกต้อง');
    if (findAllowlistEntry_(lineUserId)) throw new Error('มี LINE User ID นี้อยู่แล้ว');
    appendRowByHeaders_(getSheet_(SHEET_NAMES.ADMIN_ALLOWLIST), {
      LineUserId: lineUserId, DisplayName: displayName || '', Role: role,
      Active: true, AddedAt: nowIso_(), AddedBy: admin.DisplayName || admin.LineUserId
    });
    SpreadsheetApp.flush();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: translateError_(err) };
  }
}

function setAdminActive_(token, lineUserId, active) {
  try {
    var admin = requireAdminSession_(token);
    requireRole_(admin, [ROLES.ADMIN_FULL]);
    var sheet = getSheet_(SHEET_NAMES.ADMIN_ALLOWLIST);
    var entry = findAllowlistEntry_(lineUserId);
    if (!entry) throw new Error('ไม่พบรายชื่อนี้');
    if (!active && !otherActiveAdminFullsExist_(lineUserId)) {
      throw new Error('ปิดใช้งานไม่ได้ — นี่คือแอดมินเต็มที่เปิดใช้งานอยู่คนสุดท้าย ระบบจะไม่มีใครเข้าจัดการได้อีก');
    }
    updateRowByHeaders_(sheet, entry.__rowIndex, { Active: !!active });
    SpreadsheetApp.flush();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: translateError_(err) };
  }
}

/** แก้ชื่อที่แสดง/สิทธิ์ของแอดมินที่มีอยู่แล้ว (LINE User ID แก้ไม่ได้ — ลบแล้วเพิ่มใหม่แทนถ้าผูกผิดคน) */
function editAdmin_(token, lineUserId, displayName, role) {
  try {
    var admin = requireAdminSession_(token);
    requireRole_(admin, [ROLES.ADMIN_FULL]);
    if ([ROLES.ADMIN_FULL, ROLES.CHAT_STAFF].indexOf(role) === -1) throw new Error('role ไม่ถูกต้อง');
    var sheet = getSheet_(SHEET_NAMES.ADMIN_ALLOWLIST);
    var entry = findAllowlistEntry_(lineUserId);
    if (!entry) throw new Error('ไม่พบรายชื่อนี้');

    var isActive = String(entry.Active) !== 'false' && entry.Active !== false;
    if (entry.Role === ROLES.ADMIN_FULL && isActive && role !== ROLES.ADMIN_FULL && !otherActiveAdminFullsExist_(lineUserId)) {
      throw new Error('ลดสิทธิ์ไม่ได้ — นี่คือแอดมินเต็มที่เปิดใช้งานอยู่คนสุดท้าย ระบบจะไม่มีใครเข้าจัดการได้อีก');
    }

    updateRowByHeaders_(sheet, entry.__rowIndex, {
      DisplayName: String(displayName || '').replace(/\s+/g, ' ').trim().slice(0, 100),
      Role: role
    });
    SpreadsheetApp.flush();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: translateError_(err) };
  }
}

/** มีแอดมินเต็มที่เปิดใช้งานอยู่คนอื่น (นอกจาก lineUserId ที่กำลังจะถูกปิด/ลดสิทธิ์) หรือไม่ — กันล็อกระบบตัวเองตาย */
function otherActiveAdminFullsExist_(lineUserId) {
  var rows = readSheet_(getSheet_(SHEET_NAMES.ADMIN_ALLOWLIST));
  return rows.some(function (r) {
    return r.LineUserId && r.LineUserId !== lineUserId && r.Role === ROLES.ADMIN_FULL &&
      String(r.Active) !== 'false' && r.Active !== false;
  });
}

/** ล้าง session ที่หมดอายุ — ตั้ง time-driven trigger รายวันให้เรียกฟังก์ชันนี้ (ดู initializeProject) */
function cleanupExpiredSessions_() {
  var sheet = getSheet_(SHEET_NAMES.ADMIN_SESSIONS);
  var rows = readSheet_(sheet);
  var now = Date.now();
  var toDelete = rows.filter(function (r) { return Number(r.ExpiresAt) < now; })
    .map(function (r) { return r.__rowIndex; })
    .sort(function (a, b) { return b - a; }); // ลบจากล่างขึ้นบน กัน index เลื่อน
  toDelete.forEach(function (rowIndex) { sheet.deleteRow(rowIndex); });
  return toDelete.length;
}
