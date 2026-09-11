// Live Firebase Configuration Connected
const firebaseConfig = {
    apiKey: "AIzaSyARcXw5tfsu2fo2j7-5tqwdk1uhE3hPKvk",
    authDomain: "smartinventory-app-38080.firebaseapp.com",
    projectId: "smartinventory-app-38080",
    storageBucket: "smartinventory-app-38080.firebasestorage.app",
    messagingSenderId: "649192101754",
    appId: "1:649192101754:web:1844e31928df3f016428c3",
    measurementId: "G-RHFYPD8WKV"
};

// Initialize Firebase SDK
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();

let confirmationResultObj = null;
let inventoryList = [];
let currentUserData = null;

document.addEventListener("DOMContentLoaded", () => {
    setTimeout(forceHideSplash, 800);
    setupRecaptcha();
    checkUserAuthentication();
    setupEventListeners();
});

function forceHideSplash() {
    const splash = document.getElementById('appSplashLoader');
    if (splash) splash.style.display = 'none';
}

function setupRecaptcha() {
    window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
        'size': 'invisible',
        'callback': (response) => {}
    });
}

// 1. Firebase Mobile OTP Auth Flow
async function sendOTP() {
    const rawPhone = document.getElementById('authPhoneInput').value.trim();
    if (!rawPhone || rawPhone.length < 10) {
        alert("Please enter a valid 10-digit mobile number.");
        return;
    }

    const formattedPhone = rawPhone.startsWith('+') ? rawPhone : '+91' + rawPhone.slice(-10);
    const appVerifier = window.recaptchaVerifier;

    try {
        confirmationResultObj = await auth.signInWithPhoneNumber(formattedPhone, appVerifier);
        showToast("OTP Sent to " + formattedPhone);
        document.getElementById('authPhoneView').classList.add('hidden');
        document.getElementById('authOtpView').classList.remove('hidden');
    } catch (error) {
        console.error("OTP Send Error:", error);
        alert("Failed to send OTP: " + error.message);
        if (window.recaptchaVerifier) window.recaptchaVerifier.render().then(widgetId => grecaptcha.reset(widgetId));
    }
}

async function verifyOTP() {
    const code = document.getElementById('authOtpInput').value.trim();
    if (!code || code.length < 6) {
        alert("Please enter the 6-digit OTP code.");
        return;
    }

    try {
        const result = await confirmationResultObj.confirm(code);
        const firebaseUser = result.user;
        const phone = firebaseUser.phoneNumber;

        await syncUserAndLoadData(phone);
    } catch (error) {
        console.error("OTP Verification Error:", error);
        alert("Invalid OTP Code. Please try again.");
    }
}

// 2. Sync User Data & Existing Stocks from Firestore
async function syncUserAndLoadData(phone) {
    let userData = { phone: phone, name: "User " + phone.slice(-4), farm: "My Farm" };

    try {
        const userDoc = await db.collection('users').doc(phone).get();
        if (userDoc.exists) {
            userData = userDoc.data();
        } else {
            const rawDigits = phone.replace('+91', '');
            const fallbackDoc = await db.collection('users').doc(rawDigits).get();
            if (fallbackDoc.exists) {
                userData = fallbackDoc.data();
            } else {
                await db.collection('users').doc(phone).set(userData);
            }
        }
    } catch (e) {
        console.warn("User fetch error:", e);
    }

    currentUserData = userData;
    localStorage.setItem('userPhone', phone);
    localStorage.setItem('userData', JSON.stringify(userData));

    updateUserUI(userData);
    hideAuthModal();
    await loadCloudInventory(phone);
}

async function loadCloudInventory(phone) {
    inventoryList = [];
    try {
        let doc = await db.collection('inventories').doc(phone).get();
        
        if (!doc.exists) {
            const rawDigits = phone.replace('+91', '');
            doc = await db.collection('inventories').doc(rawDigits).get();
        }

        if (doc.exists && doc.data().items) {
            inventoryList = doc.data().items || [];
        }
    } catch (e) {
        console.error("Inventory Fetch Error:", e);
    }

    renderInventoryList();
}

function checkUserAuthentication() {
    const savedPhone = localStorage.getItem('userPhone');
    const savedUserData = localStorage.getItem('userData');

    if (savedPhone && savedUserData) {
        currentUserData = JSON.parse(savedUserData);
        updateUserUI(currentUserData);
        hideAuthModal();
        loadCloudInventory(savedPhone);
    } else {
        showAuthModal();
    }
}

function showAuthModal() {
    document.getElementById('authOverlay').classList.remove('hidden');
    resetAuthView();
}

function hideAuthModal() {
    document.getElementById('authOverlay').classList.add('hidden');
}

function resetAuthView() {
    document.getElementById('authPhoneView').classList.remove('hidden');
    document.getElementById('authOtpView').classList.add('hidden');
}

function logoutUser() {
    if (confirm("Sign out from app?")) {
        auth.signOut();
        localStorage.clear();
        inventoryList = [];
        currentUserData = null;
        renderInventoryList();
        showAuthModal();
        closeMenu();
    }
}

// 3. Add & Delete Stock Items
async function uploadToCloudProcess() {
    const name = document.getElementById('prodName').value.trim();
    const qty = parseInt(document.getElementById('prodQty').value, 10);
    const phone = localStorage.getItem('userPhone');

    if (!name || isNaN(qty) || qty <= 0 || !phone) return;

    requestCancel('modalDetails');

    const index = inventoryList.findIndex(i => i.name.toLowerCase() === name.toLowerCase());
    if (index > -1) {
        inventoryList[index].qty += qty;
    } else {
        inventoryList.push({ name: name, qty: qty, id: 'item_' + Date.now() });
    }

    try {
        await db.collection('inventories').doc(phone).set({
            items: inventoryList,
            lastUpdated: new Date().toISOString()
        }, { merge: true });
        showToast("Saved to Cloud!");
    } catch (e) {
        showToast("Error Saving Data");
    }

    renderInventoryList();
}

function deleteStockItem(index) {
    const phone = localStorage.getItem('userPhone');
    if (!phone) return;

    inventoryList.splice(index, 1);
    db.collection('inventories').doc(phone).set({ items: inventoryList }, { merge: true });
    renderInventoryList();
}

function renderInventoryList() {
    const container = document.getElementById('stockListContainer');
    if (!container) return;
    container.innerHTML = '';
    let totalQty = 0;

    if (inventoryList.length === 0) {
        container.innerHTML = `<p style="text-align:center; padding:20px;">No inventory items found.</p>`;
    } else {
        inventoryList.forEach((item, index) => {
            totalQty += Number(item.qty) || 0;
            container.innerHTML += `
                <div class="stock-card">
                    <div class="stock-info">
                        <h4>${item.name}</h4>
                        <span class="qty-badge">Qty: ${item.qty}</span>
                    </div>
                    <button class="btn-delete" onclick="deleteStockItem(${index})"><i class="fas fa-trash"></i></button>
                </div>`;
        });
    }

    document.getElementById('statTotalItems').innerText = inventoryList.length;
    document.getElementById('statTotalQty').innerText = totalQty;
}

function updateUserUI(userData) {
    if (!userData) return;
    document.getElementById('menuUserName').innerText = userData.name || 'User';
    document.getElementById('menuUserFarm').innerText = userData.farm || 'My Farm';
    document.getElementById('profName').value = userData.name || '';
    document.getElementById('profFarm').value = userData.farm || '';
    document.getElementById('profPhone').value = userData.phone || '';
}

function showToast(msg) {
    const toast = document.getElementById('successPopUp');
    document.getElementById('popUpMessage').innerText = msg;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
}

function requestCancel(id) { document.getElementById(id).classList.add('hidden'); }
function switchTab(tab) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');
}
function handleStockIn() { document.getElementById('modalDetails').classList.remove('hidden'); }
function closeMenu() {
    document.getElementById('menuDrawer').classList.remove('open');
    document.getElementById('drawerBackdrop').classList.remove('open');
}
function setupEventListeners() {
    document.getElementById('btnOpenMenu').onclick = () => {
        document.getElementById('menuDrawer').classList.add('open');
        document.getElementById('drawerBackdrop').classList.add('open');
    };
    document.getElementById('btnCloseMenu').onclick = closeMenu;
}
