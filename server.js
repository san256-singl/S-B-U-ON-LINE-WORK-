const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());
app.use(express.static('public'));
const PORT = process.env.PORT || 3000;
const MOMO_BASE = process.env.MOMO_BASE || "https://sandbox.momodeveloper.mtn.com";
const COLLECTION_KEY = process.env.COLLECTION_KEY;
const DISBURSEMENT_KEY = process.env.DISBURSEMENT_KEY;
const API_USER = process.env.API_USER;
const API_KEY = process.env.API_KEY;
const TARGET_ENV = process.env.TARGET_ENV || "mtnuganda";
const ACTIVATION_FEE = 12000;
const MARZ_LINK = "https://wallet.wearemarz.com/pay/YSc7Qa5";
const FACEBOOK_LINK = "https://www.facebook.com/profile.php?id=61596462727164";
let db = null;
try {
  const saRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (saRaw) {
    const serviceAccount = JSON.parse(saRaw);
    const admin = require('firebase-admin');
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    db = admin.firestore();
    console.log("Firebase Connected");
  }
} catch (e) { console.log("Firebase Error:", e.message); }
function cleanPhoneToLocal(phone) {
  if (!phone) return "";
  let p = phone.toString().replace(/\s/g, "").replace("+", "").trim();
  if (p.startsWith("256") && p.length === 12) p = "0" + p.slice(3);
  return p;
}
function cleanPhoneToIntl(phone) {
  if (!phone) return "";
  let p = phone.toString().replace(/\s/g, "").replace("+", "").trim();
  if (p.startsWith("0") && p.length === 10) p = "256" + p.slice(1);
  return p;
}
async function getToken(type) {
  let key = type === "collection" ? COLLECTION_KEY : DISBURSEMENT_KEY;
  let url = type === "collection" ? "/collection/token/" : "/disbursement/token/";
  let res = await axios.post(MOMO_BASE + url, {}, {
    headers: { 'Ocp-Apim-Subscription-Key': key },
    auth: { username: API_USER, password: API_KEY }
  });
  return res.data.access_token;
}
async function autoActivateUser(phoneLocal, amount, reference, source) {
  if (!db) return { success: false, reason: "DB not connected" };
  phoneLocal = cleanPhoneToLocal(phoneLocal);
  let userRef = db.collection("users").doc(phoneLocal);
  let snap = await userRef.get();
  if (snap.exists) {
    await userRef.update({ activated: true, activationPaid: true, activationAmount: parseInt(amount), activationRef: reference || "", activationSource: source, activationDate: new Date().toISOString() });
    await db.collection("payments").add({ phone: phoneLocal, amount: parseInt(amount), reference: reference || "", source, status: "PAID", date: new Date().toISOString(), fee: ACTIVATION_FEE });
    return { success: true, phone: phoneLocal };
  } else {
    await db.collection("pendingActivations").doc(phoneLocal).set({ phone: phoneLocal, amount: parseInt(amount), reference: reference || "", source, date: new Date().toISOString() });
    await db.collection("payments").add({ phone: phoneLocal, amount: parseInt(amount), reference: reference || "", source, status: "PENDING_USER", date: new Date().toISOString() });
    return { success: true, phone: phoneLocal, pending: true };
  }
}
app.get('/api/health', (req, res) => res.json({ status: "S-B-U Running", activationFee: ACTIVATION_FEE, marzLink: MARZ_LINK, facebook: FACEBOOK_LINK, firebaseConnected: !!db }));
app.get('/api/config', (req, res) => res.json({ activationFee: ACTIVATION_FEE, marzLink: MARZ_LINK, facebook: FACEBOOK_LINK, minWithdraw: 10000 }));
app.post('/api/marz-webhook', async (req, res) => {
  try {
    let body = req.body || {};
    let data = body.data || body.payment || body.transaction || body;
    let phone = body.phone || body.customer_phone || body.payer_phone || body.msisdn || data.phone || data.customer_phone || data.payer_phone || data.msisdn || body.metadata?.phone || data.metadata?.phone;
    let amount = body.amount || body.total || data.amount || data.total || body.payment_amount;
    let status = (body.status || data.status || body.event || body.type || "").toString().toLowerCase();
    let reference = body.reference || body.transaction_id || body.id || body.tx_ref || data.reference || data.transaction_id || data.id || data.tx_ref || uuidv4();
    let method = body.method || body.payment_method || data.method || data.payment
