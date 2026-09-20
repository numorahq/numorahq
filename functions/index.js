<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Numora Admin Dashboard</title>

<style>
*{
    margin:0;
    padding:0;
    box-sizing:border-box;
    font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text",
    "Segoe UI",sans-serif;
}

body{
    background:#f5f7fb;
    color:#111827;
}

button,input,select{
    font:inherit;
}

button{
    cursor:pointer;
}

.app{
    min-height:100vh;
    display:flex;
}

/* SIDEBAR */
.sidebar{
    width:245px;
    background:#fff;
    border-right:1px solid #e8ebf0;
    padding:24px 16px;
    position:fixed;
    left:0;
    top:0;
    bottom:0;
    z-index:20;
}

.brand{
    display:flex;
    align-items:center;
    gap:10px;
    padding:4px 10px 28px;
}

.brand-mark{
    width:38px;
    height:38px;
    border-radius:12px;
    background:#1769ff;
    color:#fff;
    display:flex;
    align-items:center;
    justify-content:center;
    font-weight:800;
    font-size:18px;
    box-shadow:0 8px 22px rgba(23,105,255,.22);
}

.brand-text{
    font-size:21px;
    font-weight:800;
    letter-spacing:-.5px;
}

.brand-text span{
    color:#1769ff;
}

.nav{
    display:flex;
    flex-direction:column;
    gap:7px;
}

.nav button{
    width:100%;
    border:0;
    background:transparent;
    color:#667085;
    padding:13px 14px;
    border-radius:12px;
    text-align:left;
    font-weight:600;
    transition:.2s;
}

.nav button:hover{
    background:#f3f6fb;
    color:#1769ff;
}

.nav button.active{
    background:#eaf2ff;
    color:#1769ff;
}

.sidebar-footer{
    position:absolute;
    left:16px;
    right:16px;
    bottom:22px;
    font-size:12px;
    color:#98a2b3;
    padding:0 10px;
}

/* MAIN */
.main{
    margin-left:245px;
    width:calc(100% - 245px);
    min-height:100vh;
    padding:28px;
}

.topbar{
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:20px;
    margin-bottom:26px;
}

.page-title{
    font-size:28px;
    font-weight:800;
    letter-spacing:-.8px;
}

.page-subtitle{
    color:#667085;
    margin-top:5px;
    font-size:14px;
}

.top-actions{
    display:flex;
    align-items:center;
    gap:10px;
}

.icon-button{
    width:42px;
    height:42px;
    border:1px solid #e4e7ec;
    background:#fff;
    border-radius:12px;
    color:#475467;
    font-weight:700;
}

.admin-chip{
    display:flex;
    align-items:center;
    gap:9px;
    background:#fff;
    border:1px solid #e4e7ec;
    padding:7px 12px 7px 7px;
    border-radius:14px;
    font-size:13px;
    font-weight:700;
}

.admin-avatar{
    width:31px;
    height:31px;
    border-radius:10px;
    background:#eaf2ff;
    color:#1769ff;
    display:flex;
    align-items:center;
    justify-content:center;
    overflow:hidden;
}

.admin-avatar img{
    width:100%;
    height:100%;
    object-fit:cover;
}

/* CARDS */
.stats{
    display:grid;
    grid-template-columns:repeat(3,1fr);
    gap:16px;
    margin-bottom:22px;
}

.stat-card{
    background:#fff;
    border:1px solid #e8ebf0;
    border-radius:18px;
    padding:20px;
}

.stat-label{
    color:#667085;
    font-size:13px;
    font-weight:600;
    margin-bottom:10px;
}

.stat-value{
    font-size:29px;
    font-weight:800;
    letter-spacing:-.8px;
}

.stat-note{
    margin-top:7px;
    color:#98a2b3;
    font-size:12px;
}

/* PRICING */
.section{
    background:#fff;
    border:1px solid #e8ebf0;
    border-radius:20px;
    overflow:hidden;
}

.section-head{
    padding:20px 20px 16px;
    display:flex;
    justify-content:space-between;
    align-items:center;
    gap:15px;
    border-bottom:1px solid #eef0f3;
}

.section-title{
    font-size:18px;
    font-weight:800;
}

.section-description{
    color:#98a2b3;
    font-size:12px;
    margin-top:4px;
}

.head-actions{
    display:flex;
    align-items:center;
    gap:9px;
}

.primary{
    border:0;
    background:#1769ff;
    color:#fff;
    padding:11px 15px;
    border-radius:11px;
    font-weight:700;
    box-shadow:0 7px 18px rgba(23,105,255,.18);
}

.primary:hover{
    background:#0f5be0;
}

.primary:disabled{
    opacity:.5;
    cursor:not-allowed;
    box-shadow:none;
}

.secondary{
    border:1px solid #dfe3e8;
    background:#fff;
    color:#344054;
    padding:10px 14px;
    border-radius:11px;
    font-weight:700;
}

.secondary:hover{
    background:#f8fafc;
}

.table-wrap{
    overflow-x:auto;
}

table{
    width:100%;
    border-collapse:collapse;
    min-width:820px;
}

th{
    background:#fafbfc;
    color:#667085;
    text-align:left;
    font-size:12px;
    font-weight:700;
    padding:13px 18px;
    border-bottom:1px solid #eef0f3;
    white-space:nowrap;
}

td{
    padding:15px 18px;
    border-bottom:1px solid #f0f2f5;
    font-size:13px;
    vertical-align:middle;
}

tbody tr:last-child td{
    border-bottom:0;
}

.country-cell{
    font-weight:700;
    color:#101828;
}

.service-cell{
    color:#475467;
}

.cost{
    font-weight:700;
}

.price-input{
    width:125px;
    border:1px solid #d9dee7;
    border-radius:9px;
    padding:9px 10px;
    outline:none;
    background:#fff;
}

.price-input:focus{
    border-color:#1769ff;
    box-shadow:0 0 0 3px rgba(23,105,255,.10);
}

.price-input.changed{
    border-color:#1769ff;
    background:#f7faff;
}

.profit{
    font-weight:700;
}

.status{
    display:inline-flex;
    align-items:center;
    gap:6px;
    padding:6px 9px;
    border-radius:999px;
    font-size:11px;
    font-weight:800;
}

.status-dot{
    width:6px;
    height:6px;
    border-radius:50%;
    background:currentColor;
}

.status.available{
    color:#087443;
    background:#eafaf2;
}

.status.unavailable{
    color:#b42318;
    background:#fff0ee;
}

.status.unpriced{
    color:#b54708;
    background:#fff6ed;
}

.empty{
    text-align:center;
    padding:55px 20px;
    color:#98a2b3;
}

.empty strong{
    display:block;
    color:#475467;
    font-size:15px;
    margin-bottom:5px;
}

/* MOBILE NAV */
.mobile-nav{
    display:none;
}

/* LOGIN */
.login-screen{
    position:fixed;
    inset:0;
    background:#f5f7fb;
    display:flex;
    align-items:center;
    justify-content:center;
    z-index:100;
    padding:20px;
}

.login-card{
    width:min(420px,100%);
    background:#fff;
    border:1px solid #e7eaf0;
    border-radius:24px;
    padding:32px;
    text-align:center;
    box-shadow:0 20px 60px rgba(16,24,40,.08);
}

.login-logo{
    width:58px;
    height:58px;
    margin:0 auto 18px;
    border-radius:17px;
    background:#1769ff;
    color:#fff;
    display:flex;
    align-items:center;
    justify-content:center;
    font-weight:800;
    font-size:24px;
}

.login-card h1{
    font-size:25px;
    letter-spacing:-.6px;
}

.login-card p{
    color:#667085;
    font-size:14px;
    line-height:1.55;
    margin:8px 0 24px;
}

.google-btn{
    width:100%;
    border:1px solid #d9dee7;
    background:#fff;
    color:#101828;
    border-radius:12px;
    padding:13px;
    font-weight:700;
}

.google-btn:hover{
    background:#f8fafc;
}

/* MODAL */
.modal-backdrop{
    position:fixed;
    inset:0;
    background:rgba(15,23,42,.46);
    backdrop-filter:blur(5px);
    z-index:70;
    display:none;
    align-items:center;
    justify-content:center;
    padding:18px;
}

.modal-backdrop.show{
    display:flex;
}

.modal{
    width:min(760px,100%);
    max-height:min(88vh,760px);
    background:#fff;
    border-radius:22px;
    overflow:hidden;
    box-shadow:0 25px 80px rgba(0,0,0,.18);
    display:flex;
    flex-direction:column;
}

.modal-head{
    padding:20px;
    border-bottom:1px solid #eef0f3;
    display:flex;
    justify-content:space-between;
    align-items:flex-start;
    gap:15px;
}

.modal-title{
    font-size:20px;
    font-weight:800;
}

.modal-subtitle{
    color:#667085;
    font-size:12px;
    margin-top:5px;
    line-height:1.45;
}

.close{
    width:36px;
    height:36px;
    border:0;
    background:#f2f4f7;
    color:#475467;
    border-radius:10px;
    font-size:20px;
}

.modal-body{
    padding:18px 20px;
    overflow:auto;
}

.form-row{
    display:grid;
    grid-template-columns:1fr 1fr;
    gap:12px;
    margin-bottom:14px;
}

.field label{
    display:block;
    font-size:12px;
    color:#667085;
    font-weight:700;
    margin-bottom:6px;
}

.field select,
.field input{
    width:100%;
    border:1px solid #d9dee7;
    border-radius:10px;
    padding:11px;
    outline:none;
    background:#fff;
}

.field select:focus,
.field input:focus{
    border-color:#1769ff;
    box-shadow:0 0 0 3px rgba(23,105,255,.10);
}

.service-list{
    border:1px solid #e6e9ee;
    border-radius:14px;
    overflow:hidden;
    margin-top:14px;
}

.service-list-head{
    background:#fafbfc;
    padding:11px 13px;
    display:flex;
    align-items:center;
    justify-content:space-between;
    color:#667085;
    font-size:12px;
    font-weight:700;
}

.service-list-body{
    max-height:340px;
    overflow:auto;
}

.service-option{
    display:flex;
    align-items:center;
    gap:12px;
    padding:12px 13px;
    border-top:1px solid #f0f2f5;
}

.service-option:hover{
    background:#fafcff;
}

.service-option input{
    width:17px;
    height:17px;
    accent-color:#1769ff;
}

.service-name{
    font-weight:700;
    font-size:13px;
}

.service-meta{
    color:#98a2b3;
    font-size:11px;
    margin-top:2px;
}

.modal-foot{
    padding:15px 20px;
    border-top:1px solid #eef0f3;
    display:flex;
    justify-content:flex-end;
    gap:9px;
}

.loading{
    padding:30px;
    text-align:center;
    color:#667085;
    font-size:13px;
}

.notice{
    padding:11px 13px;
    border-radius:11px;
    font-size:12px;
    line-height:1.45;
    margin-bottom:12px;
    display:none;
}

.notice.show{
    display:block;
}

.notice.error{
    background:#fff1f0;
    color:#b42318;
}

.notice.success{
    background:#ecfdf3;
    color:#087443;
}

.toast{
    position:fixed;
    right:20px;
    bottom:20px;
    background:#101828;
    color:#fff;
    padding:12px 15px;
    border-radius:12px;
    font-size:13px;
    font-weight:600;
    box-shadow:0 15px 35px rgba(0,0,0,.18);
    transform:translateY(20px);
    opacity:0;
    pointer-events:none;
    transition:.25s;
    z-index:120;
}

.toast.show{
    transform:translateY(0);
    opacity:1;
}

.hidden{
    display:none !important;
}

@media(max-width:900px){
    .sidebar{
        display:none;
    }

    .main{
        margin-left:0;
        width:100%;
        padding:20px 16px 90px;
    }

    .stats{
        grid-template-columns:1fr;
    }

    .mobile-nav{
        display:flex;
        position:fixed;
        left:12px;
        right:12px;
        bottom:12px;
        background:rgba(255,255,255,.96);
        border:1px solid #e5e7eb;
        border-radius:17px;
        padding:7px;
        z-index:30;
        box-shadow:0 12px 35px rgba(16,24,40,.12);
    }

    .mobile-nav button{
        flex:1;
        border:0;
        background:transparent;
        color:#667085;
        padding:10px 7px;
        border-radius:11px;
        font-size:12px;
        font-weight:700;
    }

    .mobile-nav button.active{
        background:#eaf2ff;
        color:#1769ff;
    }

    .topbar{
        align-items:flex-start;
    }

    .admin-chip{
        display:none;
    }
}

@media(max-width:600px){
    .topbar{
        margin-bottom:20px;
    }

    .page-title{
        font-size:24px;
    }

    .top-actions{
        gap:6px;
    }

    .section-head{
        align-items:flex-start;
        flex-direction:column;
    }

    .head-actions{
        width:100%;
    }

    .head-actions button{
        flex:1;
    }

    .form-row{
        grid-template-columns:1fr;
    }

    .modal{
        max-height:92vh;
        border-radius:19px;
    }
}
</style>
</head>

<body>

<div id="loginScreen" class="login-screen">
    <div class="login-card">
        <div class="login-logo">N</div>
        <h1>Numora Admin</h1>
        <p>Sign in with the authorized Google account to manage Numora services and pricing.</p>
        <button id="googleLoginBtn" class="google-btn">Continue with Google</button>
    </div>
</div>

<div id="app" class="app hidden">

    <aside class="sidebar">
        <div class="brand">
            <div class="brand-mark">N</div>
            <div class="brand-text">Nu<span>mora</span></div>
        </div>

        <nav class="nav">
            <button id="navDashboard" class="active" onclick="goTo('index.html')">Dashboard</button>
            <button id="navPayments" onclick="goTo('payments.html')">Payments</button>
            <button id="navSettings" onclick="goTo('settings.html')">Settings</button>
        </nav>

        <div class="sidebar-footer">Admin panel</div>
    </aside>

    <main class="main">

        <header class="topbar">
            <div>
                <div class="page-title">Dashboard</div>
                <div class="page-subtitle">Manage Numora services and customer pricing.</div>
            </div>

            <div class="top-actions">
                <button id="refreshBtn" class="icon-button" title="Refresh">↻</button>

                <div class="admin-chip">
                    <div id="adminAvatar" class="admin-avatar">N</div>
                    <span id="adminName">Admin</span>
                </div>
            </div>
        </header>

        <section class="stats">
            <div class="stat-card">
                <div class="stat-label">Total Users</div>
                <div id="totalUsers" class="stat-value">—</div>
                <div class="stat-note">Registered customer accounts</div>
            </div>

            <div class="stat-card">
                <div class="stat-label">Active Numbers</div>
                <div id="activeNumbers" class="stat-value">—</div>
                <div class="stat-note">Currently active verification numbers</div>
            </div>

            <div class="stat-card">
                <div class="stat-label">Total Sales</div>
                <div id="totalSales" class="stat-value">₦0</div>
                <div class="stat-note">Recorded customer payments</div>
            </div>
        </section>

        <section class="section">

            <div class="section-head">
                <div>
                    <div class="section-title">Service Pricing</div>
                    <div class="section-description">
                        5SIM cost and availability are live. Only the Numora customer price is editable here.
                    </div>
                </div>

                <div class="head-actions">
                    <button id="addServiceBtn" class="primary">+ Add Service</button>
                    <button id="saveAllBtn" class="primary" disabled>Save Changes</button>
                </div>
            </div>

            <div id="tableNotice" class="notice"></div>

            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Country</th>
                            <th>Service</th>
                            <th>5SIM Cost</th>
                            <th>Numora Price</th>
                            <th>Profit</th>
                            <th>Status</th>
                        </tr>
                    </thead>

                    <tbody id="pricingBody">
                        <tr>
                            <td colspan="6">
                                <div class="loading">Loading services...</div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

        </section>

    </main>

    <div class="mobile-nav">
        <button class="active" onclick="goTo('index.html')">Dashboard</button>
        <button onclick="goTo('payments.html')">Payments</button>
        <button onclick="goTo('settings.html')">Settings</button>
    </div>
</div>

<!-- ADD SERVICE MODAL -->
<div id="addServiceModal" class="modal-backdrop">
    <div class="modal">

        <div class="modal-head">
            <div>
                <div class="modal-title">Add Service</div>
                <div class="modal-subtitle">
                    Choose a country, load its services from 5SIM, then select one or more services to add to the pricing table.
                </div>
            </div>
            <button id="closeModalBtn" class="close">×</button>
        </div>

        <div class="modal-body">

            <div id="modalNotice" class="notice"></div>

            <div class="form-row">
                <div class="field">
                    <label for="countrySelect">Country</label>
                    <select id="countrySelect">
                        <option value="">Loading countries...</option>
                    </select>
                </div>

                <div class="field">
                    <label for="serviceSearch">Search service</label>
                    <input id="serviceSearch" type="text" placeholder="e.g. WhatsApp">
                </div>
            </div>

            <div id="serviceList" class="service-list">
                <div class="service-list-head">
                    <span>Available services</span>
                    <span id="serviceCount">0</span>
                </div>

                <div id="serviceListBody" class="service-list-body">
                    <div class="loading">Select a country.</div>
                </div>
            </div>

        </div>

        <div class="modal-foot">
            <button id="cancelModalBtn" class="secondary">Cancel</button>
            <button id="addSelectedBtn" class="primary" disabled>Add Selected</button>
        </div>

    </div>
</div>

<div id="toast" class="toast"></div>

<script type="module">

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
    getFirestore,
    collection,
    doc,
    getDocs,
    getDoc,
    setDoc,
    query,
    where,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


/* =========================================================
   FIREBASE
========================================================= */

const firebaseConfig = {
    apiKey: "AIzaSyDZa5HcMxwYS-qVPPAyKSWwjvGdSccWrSg",
    authDomain: "numora-c9a3b.firebaseapp.com",
    projectId: "numora-c9a3b",
    storageBucket: "numora-c9a3b.firebasestorage.app",
    messagingSenderId: "778502274031",
    appId: "1:778502274031:web:4cf57beed3703cbe5dd41a",
    measurementId: "G-6ELM21FDPH"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();


/* =========================================================
   CONFIG
========================================================= */

const BACKEND_URL = "https://numora-backend-cle6.onrender.com";

const ADMIN_EMAIL = "numora.support@gmail.com";


/* =========================================================
   STATE
========================================================= */

let currentUser = null;
let pricingRows = [];
let countries = [];
let countryServices = [];
let pendingChanges = new Map();
let selectedServices = new Set();


/* =========================================================
   DOM
========================================================= */

const loginScreen = document.getElementById("loginScreen");
const appEl = document.getElementById("app");

const googleLoginBtn = document.getElementById("googleLoginBtn");

const pricingBody = document.getElementById("pricingBody");
const saveAllBtn = document.getElementById("saveAllBtn");
const refreshBtn = document.getElementById("refreshBtn");

const addServiceModal = document.getElementById("addServiceModal");
const addServiceBtn = document.getElementById("addServiceBtn");
const closeModalBtn = document.getElementById("closeModalBtn");
const cancelModalBtn = document.getElementById("cancelModalBtn");
const addSelectedBtn = document.getElementById("addSelectedBtn");

const countrySelect = document.getElementById("countrySelect");
const serviceSearch = document.getElementById("serviceSearch");
const serviceListBody = document.getElementById("serviceListBody");
const serviceCount = document.getElementById("serviceCount");

const tableNotice = document.getElementById("tableNotice");
const modalNotice = document.getElementById("modalNotice");

const toast = document.getElementById("toast");


/* =========================================================
   NAVIGATION
========================================================= */

window.goTo = function(page){
    window.location.href = page;
};


/* =========================================================
   HELPERS
========================================================= */

function showToast(message){
    toast.textContent = message;
    toast.classList.add("show");

    setTimeout(() => {
        toast.classList.remove("show");
    }, 2600);
}

function showNotice(element, message, type = "error"){
    element.textContent = message;
    element.className = `notice show ${type}`;
}

function hideNotice(element){
    element.className = "notice";
    element.textContent = "";
}

function formatNaira(value){
    const amount = Number(value || 0);

    return new Intl.NumberFormat("en-NG", {
        style:"currency",
        currency:"NGN",
        maximumFractionDigits:0
    }).format(amount);
}

function formatNumber(value){
    return new Intl.NumberFormat("en-NG").format(Number(value || 0));
}

function normalizeKey(value){
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function serviceDocId(countryCode, serviceCode){
    return `${normalizeKey(countryCode)}_${normalizeKey(serviceCode)}`;
}

function getRowPrice(row){
    if (pendingChanges.has(row.id)){
        return Number(pendingChanges.get(row.id));
    }

    return Number(row.price || 0);
}

function markSaveState(){
    saveAllBtn.disabled = pendingChanges.size === 0;
}

function closeModal(){
    addServiceModal.classList.remove("show");
    selectedServices.clear();
    countrySelect.value = "";
    serviceSearch.value = "";
    countryServices = [];
    serviceListBody.innerHTML = `<div class="loading">Select a country.</div>`;
    serviceCount.textContent = "0";
    addSelectedBtn.disabled = true;
    hideNotice(modalNotice);
}

function openModal(){
    addServiceModal.classList.add("show");
    loadCountries();
}


/* =========================================================
   ADMIN AUTH
========================================================= */

async function verifyAdmin(user){

    if (!user){
        throw new Error("No signed-in user.");
    }

    /*
      Keep the existing admin email check.
      The admins/{uid} document is also checked so the account
      must exist in the Numora admin collection.
    */

    const adminRef = doc(db, "admins", user.uid);
    const adminSnap = await getDoc(adminRef);

    const emailAllowed =
        String(user.email || "").toLowerCase() === ADMIN_EMAIL.toLowerCase();

    if (!emailAllowed && !adminSnap.exists()){
        throw new Error("This Google account is not authorized as a Numora admin.");
    }

    if (!adminSnap.exists() && emailAllowed){
        /*
          Existing projects may already rely only on the authorized email.
          We do not create an admin document from the browser.
        */
        return true;
    }

    return true;
}

googleLoginBtn.addEventListener("click", async () => {

    googleLoginBtn.disabled = true;
    googleLoginBtn.textContent = "Signing in...";

    try{
        await signInWithPopup(auth, provider);
    }catch(error){

        console.error(error);

        showToast(error.message || "Google sign-in failed.");

        googleLoginBtn.disabled = false;
        googleLoginBtn.textContent = "Continue with Google";
    }
});

onAuthStateChanged(auth, async (user) => {

    if (!user){

        currentUser = null;

        appEl.classList.add("hidden");
        loginScreen.classList.remove("hidden");

        return;
    }

    try{

        await verifyAdmin(user);

        currentUser = user;

        loginScreen.classList.add("hidden");
        appEl.classList.remove("hidden");

        document.getElementById("adminName").textContent =
            user.displayName || user.email || "Admin";

        const avatar = document.getElementById("adminAvatar");

        if (user.photoURL){
            avatar.innerHTML = `<img src="${user.photoURL}" alt="">`;
        }else{
            avatar.textContent =
                (user.displayName || "N").charAt(0).toUpperCase();
        }

        await loadDashboard();

    }catch(error){

        console.error(error);

        await signOut(auth);

        showToast(error.message || "Admin access denied.");

        googleLoginBtn.disabled = false;
        googleLoginBtn.textContent = "Continue with Google";
    }
});


/* =========================================================
   DASHBOARD
========================================================= */

async function loadDashboard(){

    pendingChanges.clear();
    markSaveState();

    await Promise.all([
        loadStats(),
        loadPricing()
    ]);
}

async function loadStats(){

    try{

        const usersSnap = await getDocs(collection(db, "users"));

        document.getElementById("totalUsers").textContent =
            formatNumber(usersSnap.size);

    }catch(error){

        console.warn("Users count unavailable:", error);

        document.getElementById("totalUsers").textContent = "—";
    }

    /*
      Active numbers and total sales depend on the collections already
      used by the rest of the Numora backend. We query common collection
      names without making the dashboard dependent on them.
    */

    try{

        const numbersSnap = await getDocs(collection(db, "numbers"));

        let active = 0;

        numbersSnap.forEach(item => {

            const data = item.data();

            if (
                data.active === true ||
                data.status === "active" ||
                data.status === "Active"
            ){
                active++;
            }
        });

        document.getElementById("activeNumbers").textContent =
            formatNumber(active);

    }catch(error){

        document.getElementById("activeNumbers").textContent = "—";
    }

    try{

        const paymentsSnap = await getDocs(collection(db, "payments"));

        let total = 0;

        paymentsSnap.forEach(item => {

            const data = item.data();

            const status = String(data.status || "").toLowerCase();

            if (
                status === "success" ||
                status === "successful" ||
                status === "paid" ||
                status === "completed"
            ){
                total += Number(
                    data.amount ??
                    data.amountNaira ??
                    data.nairaAmount ??
                    0
                );
            }
        });

        document.getElementById("totalSales").textContent =
            formatNaira(total);

    }catch(error){

        document.getElementById("totalSales").textContent = "₦0";
    }
}


/* =========================================================
   FIRESTORE PRICING
========================================================= */

async function loadPricing(){

    pricingBody.innerHTML = `
        <tr>
            <td colspan="6">
                <div class="loading">Loading pricing...</div>
            </td>
        </tr>
    `;

    try{

        const snapshot = await getDocs(collection(db, "servicePricing"));

        pricingRows = snapshot.docs.map(item => ({
            id:item.id,
            ...item.data()
        }));

        /*
          Keep the table predictable:
          country first, then service.
        */
        pricingRows.sort((a,b) => {

            const countryCompare =
                String(a.country || "").localeCompare(String(b.country || ""));

            if (countryCompare !== 0){
                return countryCompare;
            }

            return String(a.service || "").localeCompare(
                String(b.service || "")
            );
        });

        renderPricing();

    }catch(error){

        console.error(error);

        pricingBody.innerHTML = `
            <tr>
                <td colspan="6">
                    <div class="empty">
                        <strong>Could not load pricing</strong>
                        ${error.message || "Please try again."}
                    </div>
                </td>
            </tr>
        `;
    }
}

function renderPricing(){

    if (!pricingRows.length){

        pricingBody.innerHTML = `
            <tr>
                <td colspan="6">
                    <div class="empty">
                        <strong>No services added yet</strong>
                        Click <b>+ Add Service</b> to load services directly from 5SIM.
                    </div>
                </td>
            </tr>
        `;

        return;
    }

    pricingBody.innerHTML = pricingRows.map(row => {

        const price = getRowPrice(row);
        const providerCost = Number(row.providerCost || 0);

        const profit =
            price > 0 && providerCost > 0
                ? price - providerCost
                : 0;

        const available =
            row.available !== false;

        let statusClass = "available";
        let statusText = "Available";

        if (price <= 0){
            statusClass = "unpriced";
            statusText = "Set price";
        }else if (!available){
            statusClass = "unavailable";
            statusText = "Unavailable";
        }

        return `
            <tr data-row-id="${row.id}">

                <td class="country-cell">
                    ${escapeHtml(row.country || "—")}
                </td>

                <td class="service-cell">
                    ${escapeHtml(row.service || "—")}
                </td>

                <td class="cost">
                    ${providerCost > 0 ? formatNaira(providerCost) : "Live cost unavailable"}
                </td>

                <td>
                    <input
                        class="price-input ${pendingChanges.has(row.id) ? "changed" : ""}"
                        type="number"
                        min="1"
                        step="1"
                        value="${price > 0 ? price : ""}"
                        placeholder="Enter price"
                        data-price-id="${row.id}"
                    >
                </td>

                <td class="profit">
                    ${price > 0 && providerCost > 0
                        ? formatNaira(profit)
                        : "—"
                    }
                </td>

                <td>
                    <span class="status ${statusClass}">
                        <span class="status-dot"></span>
                        ${statusText}
                    </span>
                </td>

            </tr>
        `;

    }).join("");

    document.querySelectorAll(".price-input").forEach(input => {

        input.addEventListener("input", () => {

            const id = input.dataset.priceId;
            const value = Number(input.value);

            if (!Number.isFinite(value) || value <= 0){

                pendingChanges.set(id, 0);

            }else{

                const original = pricingRows.find(row => row.id === id);

                if (original && Number(original.price || 0) === value){

                    pendingChanges.delete(id);

                }else{

                    pendingChanges.set(id, value);
                }
            }

            renderPricing();
            markSaveState();
        });

    });
}


/* =========================================================
   LIVE 5SIM DATA
========================================================= */

async function apiGet(path){

    const response = await fetch(`${BACKEND_URL}${path}`, {
        method:"GET",
        headers:{
            "Accept":"application/json"
        }
    });

    let data = null;

    try{
        data = await response.json();
    }catch{
        data = null;
    }

    if (!response.ok){

        throw new Error(
            data?.error ||
            data?.message ||
            `Backend request failed (${response.status}).`
        );
    }

    return data;
}

async function loadCountries(){

    hideNotice(modalNotice);

    countrySelect.innerHTML =
        `<option value="">Loading countries from 5SIM...</option>`;

    try{

        const data = await apiGet("/api/5sim/countries");

        countries = Array.isArray(data?.countries)
            ? data.countries
            : [];

        if (!countries.length){

            countrySelect.innerHTML =
                `<option value="">No countries returned</option>`;

            showNotice(
                modalNotice,
                "5SIM returned no available countries.",
                "error"
            );

            return;
        }

        countrySelect.innerHTML =
            `<option value="">Select country</option>` +
            countries.map(country => `
                <option value="${escapeAttr(country.code)}">
                    ${escapeHtml(country.name)}
                </option>
            `).join("");

    }catch(error){

        console.error(error);

        countrySelect.innerHTML =
            `<option value="">Could not load countries</option>`;

        showNotice(
            modalNotice,
            `Could not connect to 5SIM through Render. ${error.message}`,
            "error"
        );
    }
}

countrySelect.addEventListener("change", async () => {

    selectedServices.clear();
    updateSelectedButton();

    const country = countrySelect.value;

    if (!country){

        countryServices = [];

        serviceListBody.innerHTML =
            `<div class="loading">Select a country.</div>`;

        serviceCount.textContent = "0";

        return;
    }

    await loadCountryServices(country);
});

serviceSearch.addEventListener("input", () => {
    renderServiceOptions();
});

async function loadCountryServices(country){

    serviceListBody.innerHTML =
        `<div class="loading">Loading services from 5SIM...</div>`;

    serviceCount.textContent = "…";

    try{

        const data = await apiGet(
            `/api/5sim/services?country=${encodeURIComponent(country)}`
        );

        countryServices = Array.isArray(data?.services)
            ? data.services
            : [];

        /*
          A service that is already in servicePricing is still displayed,
          but disabled so the admin cannot create a duplicate.
        */
        renderServiceOptions();

    }catch(error){

        console.error(error);

        countryServices = [];

        serviceListBody.innerHTML = `
            <div class="loading">
                Could not load services.<br>
                ${escapeHtml(error.message)}
            </div>
        `;

        serviceCount.textContent = "0";
    }
}

function renderServiceOptions(){

    const search =
        serviceSearch.value.trim().toLowerCase();

    const filtered = countryServices.filter(service => {

        if (!search){
            return true;
        }

        return (
            String(service.name || "").toLowerCase().includes(search) ||
            String(service.code || "").toLowerCase().includes(search)
        );
    });

    serviceCount.textContent = String(filtered.length);

    if (!filtered.length){

        serviceListBody.innerHTML = `
            <div class="loading">
                No matching services found.
            </div>
        `;

        return;
    }

    const countryCode = countrySelect.value;

    serviceListBody.innerHTML = filtered.map(service => {

        const id = serviceDocId(countryCode, service.code);

        const exists = pricingRows.some(row => row.id === id);

        const checked =
            selectedServices.has(service.code)
                ? "checked"
                : "";

        return `
            <label class="service-option">

                <input
                    type="checkbox"
                    value="${escapeAttr(service.code)}"
                    ${checked}
                    ${exists ? "disabled" : ""}
                >

                <div>
                    <div class="service-name">
                        ${escapeHtml(service.name || service.code)}
                        ${exists ? " · Already added" : ""}
                    </div>

                    <div class="service-meta">
                        ${exists
                            ? "This country/service is already in your pricing table."
                            : "5SIM availability and cost will be refreshed after adding."
                        }
                    </div>
                </div>

            </label>
        `;

    }).join("");

    serviceListBody
        .querySelectorAll('input[type="checkbox"]:not(:disabled)')
        .forEach(box => {

            box.addEventListener("change", () => {

                if (box.checked){
                    selectedServices.add(box.value);
                }else{
                    selectedServices.delete(box.value);
                }

                updateSelectedButton();
            });

        });

    updateSelectedButton();
}

function updateSelectedButton(){

    addSelectedBtn.disabled =
        selectedServices.size === 0;
}


/* =========================================================
   ADD SELECTED SERVICES
========================================================= */

addSelectedBtn.addEventListener("click", async () => {

    const countryCode = countrySelect.value;

    if (!countryCode || selectedServices.size === 0){
        return;
    }

    addSelectedBtn.disabled = true;
    addSelectedBtn.textContent = "Adding...";

    try{

        const country =
            countries.find(item => item.code === countryCode);

        const countryName =
            country?.name ||
            countryCode.toUpperCase();

        const selected = countryServices.filter(service =>
            selectedServices.has(service.code)
        );

        for (const service of selected){

            const id = serviceDocId(
                countryCode,
                service.code
            );

            /*
              Fetch the exact current 5SIM price before writing the service.
              This keeps the first provider-cost value live rather than fake.
            */
            let priceData = null;

            try{

                priceData = await apiGet(
                    `/api/5sim/price?country=${encodeURIComponent(countryCode)}&service=${encodeURIComponent(service.code)}`
                );

            }catch(error){

                console.warn(
                    `Could not get exact 5SIM price for ${service.code}:`,
                    error
                );
            }

            const providerCost =
                Number(
                    priceData?.providerCost ??
                    service.providerCost ??
                    0
                );

            const available =
                priceData?.available !== undefined
                    ? Boolean(priceData.available)
                    : Boolean(service.available);

            const existing = pricingRows.find(
                row => row.id === id
            );

            const payload = {

                country: countryName,
                countryCode: countryCode,

                service: service.name || service.code,
                serviceCode: service.code,

                /*
                  New services intentionally start without a customer price.
                  The admin enters Numora's price in the table and saves it.
                */
                price: existing?.price ?? 0,

                providerCost: providerCost,

                available: available,

                enabled: true,

                updatedAt: serverTimestamp()

            };

            if (!existing){
                payload.createdAt = serverTimestamp();
            }

            await setDoc(
                doc(db, "servicePricing", id),
                payload,
                { merge:true }
            );
        }

        closeModal();

        showToast(
            `${selected.length} service${selected.length === 1 ? "" : "s"} added.`
        );

        await loadPricing();

    }catch(error){

        console.error(error);

        showNotice(
            modalNotice,
            error.message || "Could not add the selected service(s).",
            "error"
        );

    }finally{

        addSelectedBtn.disabled = false;
        addSelectedBtn.textContent = "Add Selected";

        updateSelectedButton();
    }
});


/* =========================================================
   SAVE NUMORA PRICES
========================================================= */

saveAllBtn.addEventListener("click", async () => {

    if (!pendingChanges.size){
        return;
    }

    saveAllBtn.disabled = true;
    saveAllBtn.textContent = "Saving...";

    try{

        for (const [id, value] of pendingChanges.entries()){

            if (!Number.isFinite(Number(value)) || Number(value) <= 0){
                throw new Error(
                    "Every Numora price must be greater than ₦0."
                );
            }

            await setDoc(
                doc(db, "servicePricing", id),
                {
                    price:Number(value),
                    enabled:true,
                    updatedAt:serverTimestamp()
                },
                { merge:true }
            );
        }

        pendingChanges.clear();

        showNotice(
            tableNotice,
            "Numora prices saved successfully.",
            "success"
        );

        showToast("Prices saved.");

        await loadPricing();

        setTimeout(() => {
            hideNotice(tableNotice);
        }, 2600);

    }catch(error){

        console.error(error);

        showNotice(
            tableNotice,
            error.message || "Could not save prices.",
            "error"
        );

    }finally{

        saveAllBtn.textContent = "Save Changes";
        markSaveState();
    }
});


/* =========================================================
   REFRESH
========================================================= */

refreshBtn.addEventListener("click", async () => {

    refreshBtn.disabled = true;
    refreshBtn.textContent = "…";

    try{

        /*
          Refresh pricing from Firestore first, then refresh live
          5SIM costs/availability for every configured service.
        */
        await loadPricing();
        await refreshLiveProviderData();
        await loadStats();

        showToast("Dashboard refreshed.");

    }catch(error){

        console.error(error);

        showToast(
            error.message || "Refresh failed."
        );

    }finally{

        refreshBtn.disabled = false;
        refreshBtn.textContent = "↻";
    }
});


/* =========================================================
   REFRESH LIVE PROVIDER COSTS
========================================================= */

async function refreshLiveProviderData(){

    if (!pricingRows.length){
        return;
    }

    let changed = false;

    for (const row of pricingRows){

        if (!row.countryCode || !row.serviceCode){
            continue;
        }

        try{

            const data = await apiGet(
                `/api/5sim/price?country=${encodeURIComponent(row.countryCode)}&service=${encodeURIComponent(row.serviceCode)}`
            );

            const providerCost =
                Number(data?.providerCost || 0);

            const available =
                Boolean(data?.available);

            const oldCost =
                Number(row.providerCost || 0);

            const oldAvailable =
                row.available !== false;

            if (
                providerCost !== oldCost ||
                available !== oldAvailable
            ){

                await setDoc(
                    doc(db, "servicePricing", row.id),
                    {
                        providerCost,
                        available,
                        providerCheckedAt:serverTimestamp(),
                        updatedAt:serverTimestamp()
                    },
                    { merge:true }
                );

                changed = true;
            }

        }catch(error){

            console.warn(
                `Live 5SIM refresh failed for ${row.id}:`,
                error
            );
        }
    }

    if (changed){
        await loadPricing();
    }
}


/* =========================================================
   MODAL EVENTS
========================================================= */

addServiceBtn.addEventListener("click", openModal);

closeModalBtn.addEventListener("click", closeModal);

cancelModalBtn.addEventListener("click", closeModal);

addServiceModal.addEventListener("click", event => {

    if (event.target === addServiceModal){
        closeModal();
    }
});


/* =========================================================
   ESCAPE / HTML HELPERS
========================================================= */

function escapeHtml(value){

    return String(value ?? "")
        .replace(/&/g,"&amp;")
        .replace(/</g,"&lt;")
        .replace(/>/g,"&gt;")
        .replace(/"/g,"&quot;")
        .replace(/'/g,"&#039;");
}

function escapeAttr(value){
    return escapeHtml(value);
}


/* =========================================================
   INITIAL LIVE COST REFRESH
========================================================= */

async function refreshProviderDataAfterLoad(){

    /*
      Give Firestore data a moment to render, then refresh the provider
      values in the background. This avoids blocking the dashboard.
    */
    try{
        await refreshLiveProviderData();
    }catch(error){
        console.warn(error);
    }
}


/*
  The dashboard has already loaded by the time this function runs.
  A small delayed background refresh keeps the first screen responsive.
*/
setTimeout(() => {
    if (currentUser){
        refreshProviderDataAfterLoad();
    }
}, 700);

</script>

</body>
</html>
