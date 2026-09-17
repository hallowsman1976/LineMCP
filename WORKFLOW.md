# LineMCP — คู่มือติดตั้งระบบ

ระบบ LINE OA สำหรับสหกรณ์ออมทรัพย์สาธารณสุขจังหวัดมุกดาหาร: จัดการข้อมูลสมาชิก, แชทกับสมาชิกผ่าน LINE,
รับคำขอเบิกสวัสดิการ 4 ประเภท, รับสลิปโอนเงิน/เอกสารอื่น ๆ

Apps Script project: https://script.google.com/d/1x9azK9vcW-J8yEc2EO1xhtryehBnkA8v2oJM1puK34Xh8sJWMsHkAcu1/edit
Web app URL (deployment คงที่ — อย่า `clasp deploy` แบบไม่ใส่ `-i` เพราะจะได้ deployment ID ใหม่/URL ใหม่ ให้ใช้ `clasp deploy -i <deploymentId>` เสมอเพื่อคง URL นี้ไว้):
`https://script.google.com/macros/s/AKfycbyYJIpaIasNQCWcdaIjFDZ3j6z3uuSadYW-lkn2oh6RsottDIte_EREbgAC08-gCfCF/exec`
Spreadsheet ที่ผูกไว้: https://docs.google.com/spreadsheets/d/1ttouCdixfisEHHUd4Tjr77sllKiMD9VWuPQX9csw9vU/edit
(ผูกไว้เป็นค่าเริ่มต้นใน `Config.js` แล้ว — ตอนรัน `initializeProject()` ครั้งแรกจะใช้ Sheet นี้เลย ไม่ต้องสร้างใหม่)

## สถาปัตยกรรม

```
GitHub Pages (frontend/)                 Google Apps Script (/exec)            Google Sheets
  index.html  หน้าแอดมิน   ──fetch()──▶   doPost → Api.js (JSON API)   ──▶   ฐานข้อมูล + ชีต Setting
  setup.html  ตั้งค่าระบบ                    doPost → LineWebhook.js  ◀── LINE Messaging API (?wh=secret)
  liff.html   สถานะของฉัน (LIFF)
```

- หน้าเว็บทั้งหมดอยู่ในโฟลเดอร์ `frontend/` โฮสต์บน GitHub Pages — **Apps Script ไม่ serve HTML แล้ว** (เลิกใช้ HtmlService/google.script.run
  เพราะ sandbox iframe ทำให้ LIFF พังบน iOS และ redirect/ลิงก์ต้องแก้ทุกจุด) ไฟล์ HTML เดิมเก็บไว้อ้างอิงที่ `_legacy_htmlservice/` (ไม่ถูก push)
- frontend เรียก API ด้วย `POST` + `Content-Type: text/plain` + body `{"action": "...", ...}` — รายชื่อ action ทั้งหมดอยู่ใน `Api.js` (whitelist)
- URL ของ API ตั้งที่ `frontend/assets/config.js` (`API_URL`)
- หน้า LIFF ส่ง LINE **ID token** ให้ backend ตรวจกับ LINE เอง (ไม่เชื่อ userId ที่ส่งมาจาก client)
- `.claspignore` กำหนดให้ `clasp push` ส่งเฉพาะ `*.js` ที่ root + `appsscript.json`

### Deploy backend (Apps Script)

```bash
clasp push
clasp deploy -i <deploymentId>
```

### Deploy frontend (GitHub Pages)

1. สร้าง GitHub repo แล้ว push โปรเจกต์นี้ขึ้นไป (`.gitignore` กันไฟล์ข้อมูลสมาชิก `Member.xlsx` / `*.csv` ไว้แล้ว — **ห้ามเอาขึ้น GitHub**)
2. repo > Settings > Pages > Source = **GitHub Actions** — workflow `.github/workflows/pages.yml` จะ deploy โฟลเดอร์ `frontend/` ทุกครั้งที่ push เข้า `main`
3. ได้ URL แบบ `https://<username>.github.io/<repo>/` = **FRONTEND_URL** (มี `/` ปิดท้าย)

> ⚠️ ถ้า repo เป็น public ทุกคนเห็นโค้ด frontend ได้ (ไม่มีความลับในนั้น — token/secret อยู่ในชีต Setting)
> แต่ session token ของแอดมินเก็บใน localStorage ของโดเมน `<username>.github.io` ซึ่งใช้ร่วมกับ GitHub Pages repo อื่นของบัญชีเดียวกัน
> — อย่าโฮสต์หน้าเว็บที่ไม่น่าเชื่อถือไว้ใต้บัญชี GitHub เดียวกัน (หรือใช้ custom domain แยก)

### ย้ายจากระบบเดิม (เคยตั้งค่าครบแล้วตอนใช้ HtmlService)

หน้าตั้งค่าถูกล็อกไว้แล้ว และ LINE Login ยังชี้ไป URL ของ Apps Script อยู่ จึงต้องทำตามลำดับนี้:
1. deploy backend + frontend ตามด้านบน
2. เปิด Google Sheet > ชีต **Setting** > เพิ่มแถว `Key = FRONTEND_URL`, `Value = https://<username>.github.io/<repo>/`
3. LINE Developers Console > LINE Login channel > Callback URL = FRONTEND_URL (ค่าเดียวกันเป๊ะ ๆ)
4. LIFF app > Endpoint URL = `<FRONTEND_URL>liff.html` และเปิด scope `openid` เพิ่ม (นอกจาก `profile`)
5. เปิด FRONTEND_URL แล้ว login ใหม่ (session เดิมใน localStorage อยู่คนละโดเมน ต้อง login ใหม่ 1 ครั้ง)
Webhook URL ของ Messaging API **ไม่ต้องแก้** (ยังเป็น URL เดิมของ Apps Script)

---

ขั้นตอนด้านล่างเป็นสิ่งที่ **ต้องทำเองนอกเครื่องมือของ Claude** (ต้องมีสิทธิ์เข้า LINE Developers Console และ Apps Script editor ของบัญชีจริง)

---

## 1. รัน initializeProject() ครั้งแรก

1. เปิด Apps Script editor (ลิงก์ด้านบน)
2. เลือกฟังก์ชัน `initializeProject` จาก dropdown ด้านบน แล้วกด ▷ Run
3. ครั้งแรกจะมี popup ขอ authorize สิทธิ์ (Sheets, Drive) — กด Allow
4. ดูผลลัพธ์ใน **Execution log** จะได้ URL ของ Google Sheet ที่สร้างขึ้น (เก็บ URL นี้ไว้ — เป็นฐานข้อมูลหลักของระบบ)

ฟังก์ชันนี้รันซ้ำได้ปลอดภัย (idempotent) — ถ้ารันอีกจะไม่สร้างซ้ำ แค่เติมส่วนที่ขาด

## 2. กรอกค่า config ผ่านหน้าตั้งค่าในเว็บ (ไม่ต้องเข้า Apps Script editor)

เปิด `<FRONTEND_URL>setup.html` ในเบราว์เซอร์ — หน้านี้เปิดให้กรอกได้โดยไม่ต้อง login ชั่วคราว
(เพราะ LINE Login เองก็ยังใช้งานไม่ได้จนกว่าจะกรอกค่าพวกนี้ครบ) พอกรอกครบแล้วหน้านี้จะ**ล็อกตัวเองอัตโนมัติ**
ให้แก้ไขได้เฉพาะแอดมินเต็มที่ login แล้วเท่านั้น (ป้องกันคนนอกมาแก้ token ทีหลัง)

กรอกค่าต่อไปนี้ (ทำเครื่องหมาย * คือบังคับ):

| ช่อง | ค่า | หมายเหตุ |
|---|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` * | จาก Messaging API channel | LINE Developers Console > Messaging API > Channel access token (long-lived) > Issue |
| `LINE_CHANNEL_SECRET` * | จาก Messaging API channel | Basic settings > Channel secret |
| `LINE_LOGIN_CHANNEL_ID` * | จาก LINE Login channel (สร้างใหม่ — ดูข้อ 3) | |
| `LINE_LOGIN_CHANNEL_SECRET` * | จาก LINE Login channel | |
| `FRONTEND_URL` * | URL ของ GitHub Pages — กดปุ่ม "ใช้ค่านี้" ได้เลย | ต้องตรงกับ Callback URL ของ LINE Login เป๊ะ ๆ (รวม `/` ปิดท้าย) |
| `WEBAPP_BASE_URL` * | URL ของ Apps Script (ลงท้าย `/exec`) — กดปุ่ม "ใช้ค่านี้" ได้เลย | ใช้ประกอบ Webhook URL |
| `WEBHOOK_SECRET` | เว้นว่างได้ — ระบบสุ่มให้อัตโนมัติถ้าไม่กรอก | ใช้แทนการ verify signature (ดูหมายเหตุด้านล่าง) |
| `ADMIN_LINE_GROUP_ID` | Group ID ของกลุ่ม LINE แอดมิน (ดูวิธีหาในข้อ 5) | ใส่ทีหลังได้ — ถ้าไม่ใส่ระบบจะแค่ log แล้วข้าม ไม่ error |
| `LIFF_ID` | จาก LIFF app ที่สร้าง (ข้อ 3) | สำหรับหน้า "สถานะของฉัน" — ใส่ทีหลังได้ |

กดบันทึก แล้วหน้าเดียวกันจะโชว์ **Webhook URL เต็ม ๆ พร้อม secret ต่อท้าย** ให้ก็อปไปวางใน LINE Developers Console ได้เลย (ดูข้อ 3)

ค่าทั้งหมดถูกเก็บในชีต **"Setting"** ของ Spreadsheet (ไม่ใช่ Script Properties) — จะแก้ผ่านหน้าเว็บนี้ หรือเปิดชีต Setting แล้วแก้ตรง ๆ ก็ได้เหมือนกัน
(⚠️ ใครเปิดดูชีตนี้ได้ก็เห็น token/secret เป็น plain text — จำกัดสิทธิ์แชร์ Spreadsheet ให้เฉพาะแอดมินจริง ๆ)

## 3. ตั้งค่า LINE Developers Console

**Messaging API channel (ใช้ channel เดิมที่สหกรณ์มีอยู่แล้ว):**
- Webhook URL = ก็อปมาจากหน้า `setup.html` (ช่อง "Webhook URL สำหรับ LINE Developers Console" หลังกดบันทึกในข้อ 2)
- เปิด "Use webhook" = ON
- ปิด auto-reply message ของ LINE Official Account เดิม (Response settings) กันชนกับบอทของเรา

**LINE Login channel (สร้างใหม่ ภายใต้ Provider เดียวกับ Messaging API channel เดิม):**
- LINE Developers Console > Create a new channel > LINE Login
- Callback URL = `<FRONTEND_URL>` ตรง ๆ **ห้ามต่อ query string ท้าย URL** (LINE match callback URL แบบเป๊ะ ๆ
  ไม่ตรงจะเจอ `400 Invalid redirect_uri`) — URL ที่ถูกต้องโชว์อยู่บนหน้า login และหน้า setup.html แล้ว ก็อปจากตรงนั้นได้เลย
- เปิด scope: `profile`, `openid`

**LIFF app (สร้างใหม่ ภายใต้ LINE Login channel ข้างบน):**
- LIFF tab > Add
- Endpoint URL = `<FRONTEND_URL>liff.html`
- Size = Full
- Scope: `profile` และ `openid` (**ต้องมี openid** — backend ใช้ ID token ยืนยันตัวสมาชิก)

> ⚠️ **ข้อจำกัดสำคัญที่พบระหว่างพัฒนา**: Google Apps Script web app **อ่าน HTTP header ของ request ไม่ได้เลย**
> (ไม่มี API ให้เข้าถึง headers ใน `doPost(e)`) ทำให้ verify ลายเซ็น `X-Line-Signature` ตามมาตรฐานความปลอดภัยของ LINE
> **ทำไม่ได้จริงบนแพลตฟอร์มนี้** — เป็นข้อจำกัดของ Google Apps Script เอง ไม่ใช่สิ่งที่แก้ในโค้ดได้
> ระบบนี้ใช้ query-string secret (`WEBHOOK_SECRET`) แทนเป็นเกราะป้องกันชั้นหนึ่ง ซึ่งปลอดภัยน้อยกว่า HMAC signature จริง
> — ถ้าต้องการความปลอดภัยระดับ webhook signature จริง ต้องเพิ่ม relay เช่น Cloudflare Worker ไว้หน้า Apps Script
> (นอกขอบเขตของสแตก GAS ที่เลือกไว้ ถ้าต้องการให้แจ้งได้ จะช่วยออกแบบเพิ่ม)

## 4. นำเข้าข้อมูลสมาชิก

### วิธีที่แนะนำ: ฟอร์มนำเข้าในหน้าแอดมิน (เฉพาะแอดมินเต็ม)

1. หน้าแอดมิน > แท็บ **สมาชิก** > ปุ่ม **+ นำเข้าสมาชิก**
2. แท็บ "จากไฟล์ Excel / CSV" > เลือก `Member.xlsx` — ระบบเลือก **Sheet2** และจับคู่คอลัมน์ให้อัตโนมัติ
   (A เลขที่ | B คำนำหน้า | C ชื่อ | D สกุล | E เลขบัตร | F สังกัด | I วันที่เข้า | J วันเกิด) ตรวจ/แก้การจับคู่ได้
3. ดูตัวอย่าง + รายการแถวที่มีปัญหา (เลขซ้ำ, เลขบัตรไม่ครบ 13 หลัก, วันที่อ่านไม่ได้ — แถวเหล่านี้จะถูกข้าม)
4. เลือกโหมด "เพิ่มใหม่ + อัปเดตของเดิม" หรือ "เพิ่มเฉพาะรายการใหม่" > กด **นำเข้า**

- ไฟล์ถูกอ่านในเบราว์เซอร์ ส่งขึ้นระบบเฉพาะคอลัมน์ที่จับคู่ (บัญชีธนาคาร/เงินเดือน/หุ้น ไม่ออกจากเครื่อง)
- ส่งทีละ 250 แถว ถ้าหลุดกลางทาง กดนำเข้าซ้ำได้ (upsert ตามเลขที่สมาชิก)
- ช่องว่างในไฟล์ไม่ลบค่าเดิม และไม่แตะการผูกบัญชี LINE ของสมาชิก
- แท็บ "เพิ่มทีละคน" ใช้เพิ่ม/แก้สมาชิกรายคน · มีลิงก์ดาวน์โหลดไฟล์ CSV ตัวอย่างในฟอร์ม
- วันที่ใช้รูปแบบ วว/ดด/ปปปป (พ.ศ. หรือ ค.ศ. ก็ได้) หรือเซลล์วันที่ของ Excel

### วิธีเดิม: ผ่าน Apps Script editor

1. เปิด Google Sheet ที่สร้างในข้อ 1
2. File > Import > Upload > เลือก `Member.xlsx` > "Insert new sheet(s)" > เลือกเฉพาะ **Sheet2**
3. เปลี่ยนชื่อชีตที่ import เข้ามาเป็น `MemberRawImport` (สำคัญ — ต้องตรงชื่อนี้)
4. กลับไป Apps Script editor เลือกฟังก์ชัน `importMembersFromRawSheet_` แล้ว Run
5. ดู Execution log จะบอกจำนวนที่ import สำเร็จ
6. ลบชีต `MemberRawImport` ทิ้งได้ (ข้อมูลถูกคัดลงชีต `Members` แล้ว เฉพาะคอลัมน์ที่ตกลงกันไว้ — ไม่รวมบัญชีธนาคาร/เบอร์โทร/เงินเดือน/หุ้น)

รันซ้ำได้ปลอดภัย — เป็นการ upsert ตามเลขที่สมาชิก ไม่สร้างซ้ำ

## 5. เพิ่มแอดมินคนแรก

1. เปิด `<FRONTEND_URL>` (หน้าแอดมิน) ในเบราว์เซอร์ของคนที่จะเป็นแอดมินเต็มคนแรก
2. กด "เข้าสู่ระบบด้วย LINE" — ครั้งแรกจะถูกปฏิเสธ แต่**หน้าจอจะโชว์ LINE User ID** พร้อมลิงก์ไปหน้าตั้งค่า
3. กดลิงก์นั้น (LINE User ID ถูกกรอกให้แล้ว) ใส่ชื่อ แล้วกด "เพิ่มเป็นแอดมินเต็ม" — ช่องทางนี้ปิดตัวเองเมื่อมีแอดมินแล้ว
4. กลับไป login ใหม่ที่หน้าเว็บ — เข้าได้แล้ว จากนี้เพิ่มแอดมินคนอื่นผ่านแท็บ "จัดการแอดมิน" ในเว็บได้เลย (ไม่ต้องเข้า editor อีก)

**หา ADMIN_LINE_GROUP_ID:** เชิญ LINE OA บอทเข้ากลุ่มแอดมิน แล้วพิมพ์อะไรก็ได้ในกลุ่ม 1 ครั้ง — เปิด Apps Script > Executions
จะเห็น log ของ `doPost` ที่มี `source.groupId` — เอาค่านั้นไปกรอกที่หน้า `setup.html` ช่อง `ADMIN_LINE_GROUP_ID` (แก้ทีหลังได้ตลอด ไม่ต้อง redeploy)

## 6. ทดสอบ

- เพิ่มเพื่อน LINE OA แล้วพิมพ์ทักไป — ควรได้รับข้อความขอให้ยืนยันตัวตน
- พิมพ์ `<เลขที่สมาชิก> <เลขบัตรประชาชน>` เช่น `<เลขที่สมาชิก> <เลขบัตร 13 หลัก>` (ใช้ข้อมูลจริงจาก Members ที่ import แล้ว — ห้ามเขียนเลขจริงลงในเอกสาร)
  หรือเปิดหน้า "สถานะของฉัน" (`liff.html`) แล้วกรอกฟอร์มเลขที่สมาชิก+เลขบัตรประชาชนแทนก็ได้ — ยืนยันตัวตนได้สองทางคู่ขนานกัน
- พิมพ์ `เบิกสวัสดิการ` → เลือกประเภท → ใส่วันที่ → ส่งรูปเอกสาร → พิมพ์ `ส่งครบแล้ว`
- เปิดหน้าแอดมิน (`<FRONTEND_URL>`) ควรเห็นคำขอใหม่ในแท็บ "คำขอสวัสดิการ"

---

## สิ่งที่ยังไม่ได้ทำ (นอกขอบเขต Phase 1 ตามที่ตกลงไว้)

- ระบบยื่นกู้ฉุกเฉินออนไลน์แบบเต็มรูปแบบ (ไม่เกี่ยวกับ request นี้)
- การออกสัญญา PDF อัตโนมัติ
- อัปเดตยอดบัญชีออมทรัพย์อัตโนมัติจากสลิปโอนเงิน (Phase 1 = เก็บสลิปให้เจ้าหน้าที่บันทึกเอง)
- กรรมการ/ประธาน login เข้าระบบมากดอนุมัติเอง (Phase 1 = เจ้าหน้าที่บันทึกผลหลังอนุมัตินอกระบบ)
- ปีบัญชีของสหกรณ์ที่ใช้จำกัดสิทธิ์ "รักษาพยาบาลไม่เกิน 3 ครั้ง/ปี" สมมติเป็นปีปฏิทิน (ม.ค.-ธ.ค.) ไปก่อน
  — ถ้าปีบัญชีจริงไม่ตรงปฏิทิน แจ้งช่วงเวลาที่ถูกต้องมาปรับที่ `Welfare.js` (`currentFiscalYearRange_`)
