/**
 * api.js — ตัวช่วยเรียก backend (Apps Script) ที่ทุกหน้าใช้ร่วมกัน
 *
 * ⚠️ ต้องส่งเป็น Content-Type: text/plain เท่านั้น — application/json จะกระตุ้น CORS preflight (OPTIONS)
 * ซึ่ง Apps Script ตอบไม่ได้ ทำให้ fetch ล้มเหลวทั้งที่ backend ปกติดี (ฝั่ง backend parse JSON เองใน Api.js)
 */
(function () {
  var cfg = window.LMCP_CONFIG || {};

  function api(action, args) {
    if (!cfg.API_URL || cfg.API_URL.indexOf('/exec') === -1) {
      return Promise.reject(new Error('ยังไม่ได้ตั้งค่า API_URL ในไฟล์ assets/config.js'));
    }
    var body = Object.assign({ action: action }, args || {});
    return fetch(cfg.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow'
    }).then(function (r) {
      if (!r.ok) throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ (HTTP ' + r.status + ')');
      return r.text();
    }).then(function (text) {
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error('เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง — ตรวจว่า deploy web app แบบ "Anyone" และ API_URL ถูกต้อง');
      }
    });
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML.replace(/"/g, '&quot;');
  }

  var KEYS = { token: 'lmcp_token', role: 'lmcp_role', name: 'lmcp_name' };
  var session = {
    get: function () {
      var out = {};
      try { for (var k in KEYS) out[k] = localStorage.getItem(KEYS[k]) || ''; } catch (e) { out = { token: '', role: '', name: '' }; }
      return out;
    },
    set: function (s) {
      try { for (var k in KEYS) localStorage.setItem(KEYS[k], s[k] || ''); } catch (e) {}
    },
    clear: function () {
      try { for (var k in KEYS) localStorage.removeItem(KEYS[k]); } catch (e) {}
    }
  };

  /** โฟลเดอร์ของ frontend (มี / ปิดท้าย) เช่น https://user.github.io/linemcp/ — ใช้เป็น FRONTEND_URL / Callback URL */
  function frontendBaseUrl() {
    return location.origin + location.pathname.replace(/[^/]*$/, '');
  }

  window.lmcp = { api: api, esc: esc, session: session, frontendBaseUrl: frontendBaseUrl, config: cfg };
})();
