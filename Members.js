/**
 * Members.js — โปรไฟล์สมาชิก: import ครั้งแรกจาก Member.xlsx, ค้นหา, ผูก LINE User ID
 *
 * ขั้นตอน import ครั้งแรก (one-time setup):
 *   1. เปิด Google Sheet ที่ initializeProject() สร้างให้ (ดู Config sheet หรือ Log ของ initializeProject)
 *   2. File > Import > Upload > เลือก Member.xlsx > "Insert new sheet(s)" > import เฉพาะ Sheet2
 *      ตั้งชื่อชีตที่ import เข้ามาว่า "MemberRawImport" (แก้ชื่อชีตถ้า import มาชื่ออื่น)
 *   3. เปิด Apps Script editor เลือกฟังก์ชัน importMembersFromRawSheet_ แล้วกด Run
 *   4. เสร็จแล้วลบชีต MemberRawImport ทิ้งได้ (ข้อมูลถูกคัดลงชีต Members แล้ว เฉพาะคอลัมน์ที่ต้องใช้จริง)
 *
 * คอลัมน์ที่ import จาก Sheet2 (A,B,C,D,E,F,I,J เท่านั้น ตามที่ตกลงไว้ — ไม่เอาบัญชีธนาคาร/เบอร์โทร/เงินเดือน/หุ้น):
 *   A เลขที่สมาชิก | B คำนำหน้า | C ชื่อ | D นามสกุล | E เลขบัตรประชาชน | F สังกัด | I วันที่เข้า | J วันเกิด
 */

var MEMBER_RAW_IMPORT_SHEET = 'MemberRawImport';

function importMembersFromRawSheet_() {
  var ss = getSs_();
  var raw = ss.getSheetByName(MEMBER_RAW_IMPORT_SHEET);
  if (!raw) throw new Error('ไม่พบชีต ' + MEMBER_RAW_IMPORT_SHEET + ' — import Member.xlsx (Sheet2) เข้ามาก่อน แล้วตั้งชื่อชีตนี้');

  var data = raw.getDataRange().getValues();
  // แถวแรกเป็น header ("เลขที่สมาชิก | ชื่อ - สกุล | ... ") ข้ามไป
  var membersSheet = getSheet_(SHEET_NAMES.MEMBERS);
  var existing = readSheet_(membersSheet);
  var byNo = {};
  existing.forEach(function (m) { byNo[String(m.MemberNo)] = m; });

  var nowTs = nowIso_();
  var inserted = 0, updated = 0, skipped = 0;

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var memberNo = normalizeMemberNo_(row[0]);
    if (!memberNo) { skipped++; continue; }

    var patch = {
      MemberNo: memberNo,
      Title: String(row[1] || '').trim(),
      FirstName: String(row[2] || '').trim(),
      LastName: String(row[3] || '').trim(),
      NationalId: String(row[4] || '').trim(),
      Affiliation: String(row[5] || '').trim(),
      JoinDate: toIsoOrEmpty_(parseThaiDate_(row[8])),   // column I (index 8)
      BirthDate: toIsoOrEmpty_(parseThaiDate_(row[9])),  // column J (index 9)
      UpdatedAt: nowTs
    };

    var found = byNo[memberNo];
    if (found) {
      updateRowByHeaders_(membersSheet, found.__rowIndex, patch);
      updated++;
    } else {
      patch.Phone = '';
      patch.LineUserId = '';
      patch.LinkedAt = '';
      patch.CreatedAt = nowTs;
      appendRowByHeaders_(membersSheet, patch);
      inserted++;
    }
  }
  SpreadsheetApp.flush();
  var msg = 'Import เสร็จสิ้น — เพิ่มใหม่ ' + inserted + ' คน, อัปเดต ' + updated + ' คน, ข้าม ' + skipped + ' แถว (ไม่มีเลขสมาชิก)';
  Logger.log(msg);
  return msg;
}

function normalizeMemberNo_(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return '';
  // เลขสมาชิกในไฟล์ต้นทางเป็น 5 หลักนำหน้าด้วย 0 (เช่น "00020") — คง format เดิมไว้เป๊ะ ๆ
  return s;
}

function findMemberByNo_(memberNo) {
  var rows = readSheet_(getSheet_(SHEET_NAMES.MEMBERS));
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].MemberNo) === String(memberNo)) return rows[i];
  }
  return null;
}

function findMemberByLineUserId_(lineUserId) {
  if (!lineUserId) return null;
  var rows = readSheet_(getSheet_(SHEET_NAMES.MEMBERS));
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].LineUserId === lineUserId) return rows[i];
  }
  return null;
}

/**
 * ยืนยันตัวตนสมาชิกครั้งแรกทาง LINE: เลขที่สมาชิก + เลขบัตรประชาชน ต้องตรงกับฐานข้อมูล
 * สำเร็จ -> ผูก LineUserId เข้ากับ record นั้น (record หนึ่งผูกได้ครั้งเดียว กัน LINE ของคนอื่นมาสวมรอย)
 */
function verifyAndLinkMember_(lineUserId, memberNo, nationalId) {
  memberNo = normalizeMemberNo_(memberNo);
  nationalId = String(nationalId || '').replace(/\D/g, '');

  if (!memberNo) throw new Error('กรุณาระบุเลขที่สมาชิกให้ถูกต้อง');
  if (!isValidNationalId_(nationalId)) throw new Error('เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก');

  var sheet = getSheet_(SHEET_NAMES.MEMBERS);
  var rows = readSheet_(sheet);
  var match = null;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].MemberNo) === memberNo) { match = rows[i]; break; }
  }
  if (!match) throw new Error('ไม่พบเลขที่สมาชิกนี้ในระบบ กรุณาตรวจสอบอีกครั้ง หรือติดต่อเจ้าหน้าที่');
  if (String(match.NationalId).replace(/\D/g, '') !== nationalId) {
    throw new Error('เลขบัตรประชาชนไม่ตรงกับเลขที่สมาชิกนี้ กรุณาตรวจสอบอีกครั้ง');
  }
  if (match.LineUserId && match.LineUserId !== lineUserId) {
    throw new Error('เลขที่สมาชิกนี้ถูกผูกกับบัญชี LINE อื่นไปแล้ว หากเป็นความผิดพลาดกรุณาติดต่อเจ้าหน้าที่');
  }

  var already = findMemberByLineUserId_(lineUserId);
  if (already && String(already.MemberNo) !== memberNo) {
    throw new Error('บัญชี LINE นี้ถูกผูกกับสมาชิกเลขที่ ' + already.MemberNo + ' ไปแล้ว ติดต่อเจ้าหน้าที่หากต้องการแก้ไข');
  }

  updateRowByHeaders_(sheet, match.__rowIndex, {
    LineUserId: lineUserId,
    LinkedAt: nowIso_(),
    UpdatedAt: nowIso_()
  });
  SpreadsheetApp.flush();
  return findMemberByNo_(memberNo);
}

/** อายุการเป็นสมาชิก (ปีเต็ม) นับจาก JoinDate ถึงวันนี้ */
function computeYearsOfMembership_(member) {
  if (!member || !member.JoinDate) return null;
  var join = new Date(member.JoinDate);
  if (isNaN(join.getTime())) return null;
  var now = new Date();
  var years = now.getFullYear() - join.getFullYear();
  var anniversaryPassed = (now.getMonth() > join.getMonth()) ||
    (now.getMonth() === join.getMonth() && now.getDate() >= join.getDate());
  if (!anniversaryPassed) years--;
  return Math.max(0, years);
}

function memberDisplayName_(member) {
  if (!member) return '';
  return [member.Title, member.FirstName, member.LastName].filter(Boolean).join('');
}

// ---------- Admin RPC ----------

function listMembers_(token, query) {
  try {
    var admin = requireAdminSession_(token);
    requireRole_(admin, [ROLES.ADMIN_FULL, ROLES.CHAT_STAFF]);
    var rows = readSheet_(getSheet_(SHEET_NAMES.MEMBERS));
    var q = String(query || '').trim();
    if (q) {
      rows = rows.filter(function (m) {
        return String(m.MemberNo).indexOf(q) !== -1 ||
          memberDisplayName_(m).indexOf(q) !== -1 ||
          String(m.NationalId).indexOf(q) !== -1;
      });
    }
    return { ok: true, members: sanitizeForClient_(rows).slice(0, 200) };
  } catch (err) {
    Logger.log('[listMembers_] ' + (err.stack || err));
    return { ok: false, message: translateError_(err) };
  }
}

function getMyMemberProfile_(lineUserId) {
  try {
    var m = findMemberByLineUserId_(lineUserId);
    if (!m) return { ok: false, message: 'ยังไม่ได้ยืนยันตัวตนสมาชิก' };
    var out = sanitizeForClient_(m);
    out.YearsOfMembership = computeYearsOfMembership_(m);
    out.DisplayName = memberDisplayName_(m);
    return { ok: true, member: out };
  } catch (err) {
    return { ok: false, message: translateError_(err) };
  }
}
