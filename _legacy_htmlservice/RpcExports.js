/**
 * RpcExports.js — จุดเรียกเข้า RPC ที่ client เรียกผ่าน google.script.run ได้จริง ๆ เท่านั้น
 *
 * ⚠️ บั๊กที่เจอ: Apps Script ถือว่าฟังก์ชันที่ชื่อลงท้ายด้วย "_" เป็นฟังก์ชัน "private"
 * และจะ**ไม่เอาไปขึ้นให้ client เรียกผ่าน google.script.run เลย** (ตัดออกจาก stub list เงียบ ๆ
 * ไม่ error ตอน deploy ด้วย) — โค้ดทั้งโปรเจกต์นี้ตั้งชื่อฟังก์ชัน server ทุกตัวลงท้าย "_" ตาม
 * convention ของ gas-best-practices (สื่อว่า "เป็น helper ภายใน") แต่ดันเผลอใช้ชื่อเดียวกันกับ
 * ฟังก์ชันที่ต้องให้ client เรียกจริงด้วย ทำให้ google.script.run ไม่เห็นฟังก์ชันเหล่านี้เลย
 * (google.script.run.xxx_ === undefined) — เป็นที่มาของ "TypeError: Cannot read properties of
 * undefined (reading 'apply')" ที่เจอตอนเทส
 *
 * ทางแก้: คงชื่อ implementation เดิม (ลงท้าย "_") ไว้ตามเดิมทั้งหมด แต่เพิ่ม wrapper "สาธารณะ"
 * (ไม่ลงท้าย "_") ไว้ที่นี่ที่เดียว เป็นจุดเดียวที่ client จะเรียกได้จริง — ห้ามเพิ่ม RPC ใหม่โดยไม่มา
 * เพิ่ม wrapper ที่นี่ด้วย ไม่งั้นจะเจอบั๊กเดิมซ้ำ
 */

function getSetupStatus(token) { return getSetupStatus_(token); }
function saveSetupProperties(token, payload) { return saveSetupProperties_(token, payload); }
function getWebhookUrlPreview(token) { return getWebhookUrlPreview_(token); }

function logoutAdmin(token) { return logoutAdmin_(token); }
function listAdmins(token) { return listAdmins_(token); }
function addAdmin(token, lineUserId, displayName, role) { return addAdmin_(token, lineUserId, displayName, role); }
function setAdminActive(token, lineUserId, active) { return setAdminActive_(token, lineUserId, active); }

function listChatThreads(token) { return listChatThreads_(token); }
function getThreadMessages(token, lineUserId, limit) { return getThreadMessages_(token, lineUserId, limit); }
function sendChatReply(token, lineUserId, text) { return sendChatReply_(token, lineUserId, text); }
function markThreadRead(token, lineUserId) { return markThreadRead_(token, lineUserId); }

function listWelfareClaims(token, status) { return listWelfareClaims_(token, status); }
function reviewWelfareClaim(token, claimId, decision, notes) { return reviewWelfareClaim_(token, claimId, decision, notes); }
function markClaimPaid(token, claimId) { return markClaimPaid_(token, claimId); }

function listPaymentSlips(token, status) { return listPaymentSlips_(token, status); }
function markSlipRecorded(token, slipId) { return markSlipRecorded_(token, slipId); }

function listMembers(token, query) { return listMembers_(token, query); }

function getMyMemberProfile(lineUserId) { return getMyMemberProfile_(lineUserId); }
function listMyClaims(lineUserId) { return listMyClaims_(lineUserId); }
