/**
 * Api.js — JSON API สำหรับ frontend ที่โฮสต์ภายนอก (GitHub Pages) เรียกผ่าน fetch()
 *
 * frontend ส่ง POST มาที่ /exec ด้วย
 *   headers: { 'Content-Type': 'text/plain;charset=utf-8' }   ← ห้ามใช้ application/json (กระตุ้น CORS preflight ที่ GAS ตอบไม่ได้)
 *   body:    JSON.stringify({ action: 'listMembers', token: '...', query: '...' })
 * แล้วได้ JSON กลับเสมอ รูปแบบ { ok: true, ... } หรือ { ok: false, message: '...' }
 *
 * doPost (LineWebhook.js) แยกทางระหว่าง LINE webhook กับ API จาก body.action — ดู isApiRequest_()
 *
 * ⚠️ ทุก action ต้องลงทะเบียนใน API_ACTIONS ที่นี่ที่เดียว (whitelist) — ฟังก์ชันอื่นในโปรเจกต์เรียกจากภายนอกไม่ได้
 * แทนที่ RpcExports.js เดิม (google.script.run ใช้ข้าม origin ไม่ได้ จึงเลิกใช้ทั้งหมด)
 */

var API_ACTIONS = {
  // ---------- สาธารณะ (ไม่ต้อง login) ----------
  getPublicConfig: function (a) { return getPublicConfig_(a.state); },
  exchangeLoginCode: function (a) { return exchangeLoginCodeApi_(a.code); },
  bootstrapFirstAdmin: function (a) { return bootstrapFirstAdminApi_(a.userId, a.name); },

  // ---------- ตั้งค่าระบบ (เปิดโดยไม่ต้อง login จนกว่าจะตั้งค่าครบ — ดู Settings.js) ----------
  getSetupStatus: function (a) { return getSetupStatus_(a.token); },
  saveSetupProperties: function (a) { return saveSetupProperties_(a.token, a.payload); },
  getWebhookUrlPreview: function (a) { return getWebhookUrlPreview_(a.token); },

  // ---------- แอดมิน (ต้องมี session token) ----------
  logoutAdmin: function (a) { return logoutAdmin_(a.token); },
  listAdmins: function (a) { return listAdmins_(a.token); },
  addAdmin: function (a) { return addAdmin_(a.token, a.lineUserId, a.displayName, a.role); },
  editAdmin: function (a) { return editAdmin_(a.token, a.lineUserId, a.displayName, a.role); },
  setAdminActive: function (a) { return setAdminActive_(a.token, a.lineUserId, a.active); },

  listChatThreads: function (a) { return listChatThreads_(a.token); },
  getThreadMessages: function (a) { return getThreadMessages_(a.token, a.lineUserId, a.limit); },
  sendChatReply: function (a) { return sendChatReply_(a.token, a.lineUserId, a.text); },
  markThreadRead: function (a) { return markThreadRead_(a.token, a.lineUserId); },

  listWelfareClaims: function (a) { return listWelfareClaims_(a.token, a.status); },
  reviewWelfareClaim: function (a) { return reviewWelfareClaim_(a.token, a.claimId, a.decision, a.notes); },
  markClaimPaid: function (a) { return markClaimPaid_(a.token, a.claimId); },

  listPaymentSlips: function (a) { return listPaymentSlips_(a.token, a.status); },
  markSlipRecorded: function (a) { return markSlipRecorded_(a.token, a.slipId); },

  listMembers: function (a) { return listMembers_(a.token, a.query, a.page, a.pageSize); },
  importMembers: function (a) { return importMembers_(a.token, a.rows, a.mode); },

  // ---------- สมาชิก (LIFF) — ยืนยันตัวตนด้วย LINE ID token ไม่เชื่อ userId ที่ client ส่งมาเอง ----------
  getMyStatus: function (a) { return getMyStatusApi_(a.idToken); },
  linkMember: function (a) { return linkMemberApi_(a.idToken, a.memberNo, a.nationalId, a.pdpaConsent); }
};

function isApiRequest_(e) {
  if (e && e.parameter && e.parameter.wh != null) return false; // LINE webhook มี ?wh= เสมอ
  var body = parseJsonBody_(e);
  return !!(body && typeof body.action === 'string');
}

function parseJsonBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return null;
  if (e.__parsedBody !== undefined) return e.__parsedBody;
  try { e.__parsedBody = JSON.parse(e.postData.contents); } catch (err) { e.__parsedBody = null; }
  return e.__parsedBody;
}

function handleApiRequest_(e) {
  var body = parseJsonBody_(e) || {};
  var fn = Object.prototype.hasOwnProperty.call(API_ACTIONS, body.action) ? API_ACTIONS[body.action] : null;
  if (!fn) return jsonOutput_({ ok: false, message: 'ไม่รู้จักคำสั่ง: ' + body.action });
  try {
    return jsonOutput_(fn(body) || { ok: true });
  } catch (err) {
    Logger.log('[api:' + body.action + '] ' + (err.stack || err));
    return jsonOutput_({ ok: false, message: translateError_(err) });
  }
}

// ---------- action implementations ที่เป็นของ API โดยเฉพาะ ----------

/**
 * ค่าที่ frontend ต้องใช้ตอนโหลดหน้า — ไม่มีความลับ
 * state = ค่าสุ่มที่ frontend สร้างและเก็บไว้ใน sessionStorage เพื่อตรวจกลับตอน LINE redirect กลับมา (กัน CSRF)
 */
function getPublicConfig_(state) {
  var out = { ok: true, loginUrl: '', redirectUri: '', liffId: '', setupIncomplete: true };
  try {
    out.redirectUri = getOAuthRedirectUri_();
    out.liffId = getConfig_('LIFF_ID') || '';
  } catch (e) {
    return out; // ยังไม่ได้ initializeProject()
  }
  try {
    out.loginUrl = buildLineLoginUrl_(String(state || Utilities.getUuid()));
    out.setupIncomplete = !out.redirectUri;
  } catch (e2) {
    out.setupIncomplete = true;
  }
  return out;
}

function exchangeLoginCodeApi_(code) {
  if (!code) return { ok: false, message: 'ไม่พบรหัสยืนยันจาก LINE' };
  try {
    var result = handleLineLoginCallback_(String(code));
    return { ok: true, token: result.token, role: result.role, displayName: result.displayName };
  } catch (err) {
    Logger.log('[exchangeLoginCodeApi_] ' + (err.stack || err));
    return { ok: false, message: translateError_(err) };
  }
}

/** เพิ่มแอดมินเต็มคนแรก — ใช้ได้เฉพาะตอนยังไม่มีแอดมินเต็ม active เลยสักคน (ปิดตัวเองอัตโนมัติ) */
function bootstrapFirstAdminApi_(userId, name) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, message: 'ระบบกำลังประมวลผลคำขออื่น กรุณาลองใหม่ในอีกสักครู่' };
  try {
    if (hasActiveAdmin_()) return { ok: false, message: 'มีแอดมินเต็มอยู่แล้ว — ช่องทางนี้ปิดใช้งานแล้ว' };
    userId = String(userId || '').trim();
    if (!/^U[0-9a-f]{32}$/.test(userId)) return { ok: false, message: 'รูปแบบ LINE User ID ไม่ถูกต้อง (ต้องขึ้นต้นด้วย U ตามด้วยอักษร 32 ตัว)' };
    bootstrapFirstAdmin_(userId, String(name || '').trim());
    return { ok: true };
  } catch (err) {
    return { ok: false, message: translateError_(err) };
  } finally {
    lock.releaseLock();
  }
}

/** หน้า "สถานะของฉัน" ของสมาชิก — ข้อมูลสมาชิก + ประวัติคำขอสวัสดิการ ในคำขอเดียว */
function getMyStatusApi_(idToken) {
  try {
    var lineUserId = verifyLineIdToken_(idToken);
    var memberRes = getMyMemberProfile_(lineUserId);
    if (!memberRes.ok) return memberRes;
    var claimsRes = listMyClaims_(lineUserId);
    return { ok: true, member: memberRes.member, claims: claimsRes.ok ? claimsRes.claims : [] };
  } catch (err) {
    return { ok: false, message: translateError_(err) };
  }
}

/** หน้า "สถานะของฉัน" — ฟอร์มยืนยันตัวตนในหน้า LIFF (คู่ขนานกับการพิมพ์ยืนยันในแชท) ต้องผ่านหน้ายินยอม PDPA มาก่อนเสมอ */
function linkMemberApi_(idToken, memberNo, nationalId, pdpaConsent) {
  if (pdpaConsent !== true) return { ok: false, message: 'กรุณายินยอมนโยบายความเป็นส่วนตัว (PDPA) ก่อนยืนยันตัวตน' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, message: 'ระบบกำลังประมวลผลคำขออื่น กรุณาลองใหม่ในอีกสักครู่' };
  try {
    var lineUserId = verifyLineIdToken_(idToken);
    verifyAndLinkMember_(lineUserId, memberNo, nationalId, true);
    var profileRes = getMyMemberProfile_(lineUserId); // sanitize + คำนวณ DisplayName/YearsOfMembership แบบเดียวกับ getMyStatus
    return { ok: true, member: profileRes.member };
  } catch (err) {
    return { ok: false, message: translateError_(err) };
  } finally {
    lock.releaseLock();
  }
}

/**
 * ตรวจ LINE ID token (จาก liff.getIDToken()) กับ LINE แล้วคืน userId (sub)
 * LIFF app อยู่ใต้ LINE Login channel → aud ของ token = LINE_LOGIN_CHANNEL_ID
 * cache ผลไว้สั้น ๆ ตาม hash ของ token กันยิง verify ซ้ำทุกครั้งที่รีเฟรช
 */
function verifyLineIdToken_(idToken) {
  if (!idToken) throw new Error('ไม่พบข้อมูลยืนยันตัวตนจาก LINE กรุณาเปิดหน้านี้ผ่านแอป LINE');
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(idToken));
  var ck = 'idt_' + Utilities.base64EncodeWebSafe(digest);
  var cache = CacheService.getScriptCache();
  var cached = cache.get(ck);
  if (cached) return cached;

  var res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'post',
    payload: { id_token: String(idToken), client_id: lineProp_('LINE_LOGIN_CHANNEL_ID') },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) {
    Logger.log('[verifyLineIdToken_] ' + res.getContentText());
    throw new Error('ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาปิดแล้วเปิดหน้านี้ใหม่');
  }
  var claims = JSON.parse(res.getContentText());
  if (!claims.sub) throw new Error('ยืนยันตัวตนกับ LINE ไม่สำเร็จ');
  var ttl = Math.max(0, Math.min(600, Math.floor((Number(claims.exp) * 1000 - Date.now()) / 1000)));
  if (ttl > 0) { try { cache.put(ck, claims.sub, ttl); } catch (e) {} }
  return claims.sub;
}
