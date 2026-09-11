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

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();

let confirmationResultObj = null;
let inventoryList = [];
let currentUserData = null;
let tempVerifiedPhone = null;

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

// 1. Firebase Mobile OTP Flow
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
        tempVerifiedPhone = result.user.phoneNumber;

        await checkUserRegistration(tempVerifiedPhone);
    } catch (error) {
        console.error("OTP Verification Error:", error);
        alert("Invalid OTP Code. Please try again.");
    }
}

// 2. Check If User Is Registered Or Needs Registration
async function checkUserRegistration(phone) {
    try {
        let userDoc = await db.collection('users').doc(phone).get();
        
        if (!userDoc.exists) {
            const rawDigits = phone.replace('+91', '');
            userDoc = await db.collection('users').doc(rawDigits).get();
        }

        if (userDoc.exists) {
            // User Exists -> Direct Login
            const userData = userDoc.data();
            finishLoginSuccess(phone, userData);
        } else {
            // New User -> Open Registration Form
            document.getElementById('authOtpView').classList.add('hidden');
            document.getElementById('authRegisterView').classList.remove('hidden');
        }
    } catch (e) {
        console.error("Registration Check Error:", e);
        alert("Server error during login check.");
    }
}

async function completeRegistration() {
    const name = document.getElementById('regNameInput').value.trim();
    const farm = document.getElementById('regFarmInput').value.trim();

    if (!name || !farm) {
        alert("Please enter both Name and Farm/Business name.");
        return;
    }

    const newUserData = {
        phone: tempVerifiedPhone,
        name: name,
        farm: farm,
        createdAt: new Date().toISOString()
    };

    try {
        await db.collection('users').doc(tempVerifiedPhone).set(newUserData);
        showToast("Registration Successful!");
        finishLoginSuccess(tempVerifiedPhone, newUserData);
    } catch (e) {
        alert("Failed to complete registration: " + e.message);
    }
}

function finishLoginSuccess(phone, userData) {
    currentUserData = userData;
    localStorage.setItem('userPhone', phone);
    localStorage.setItem('userData', JSON.stringify(userData));

    updateUserUI(userData);
    hideAuthModal();
    loadCloudInventory(phone);
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
    document.getElementById('authRegisterView').classList.add('hidden');
}

// LOGOUT WITH CONFIRMATION POPUP
function logoutUser() {
    const confirmLogout = window.confirm("Are you sure you want to sign out from your account?");
    
    if (confirmLogout) {
        auth.signOut();
        localStorage.clear();
        inventoryList = [];
        currentUserData = null;
        renderInventoryList();
        showAuthModal();
        closeMenu();
        showToast("Signed out successfully!");
    }
}

// 3. Stock Actions (IN / OUT)
async function uploadToCloudProcess(type = 'in') {
    let nameInput = (type === 'out') ? document.getElementById('outProdName') : document.getElementById('prodName');
    let qtyInput = (type === 'out') ? document.getElementById('outProdQty') : document.getElementById('prodQty');

    const name = nameInput ? nameInput.value.trim() : '';
    const qty = qtyInput ? parseInt(qtyInput.value, 10) : 0;
    const phone = localStorage.getItem('userPhone');

    if (!name || isNaN(qty) || qty <= 0 || !phone) {
        alert("Please enter a valid item name and quantity.");
        return;
    }

    requestCancel(type === 'out' ? 'modalStockOutDetails' : 'modalDetails');

    const index = inventoryList.findIndex(i => i.name.toLowerCase() === name.toLowerCase());

    if (type === 'in') {
        if (index > -1) {
            inventoryList[index].qty += qty;
        } else {
            inventoryList.push({ name: name, qty: qty, id: 'item_' + Date.now() });
        }
        showToast("Stock IN Updated!");
    } else if (type === 'out') {
        if (index > -1) {
            if (inventoryList[index].qty < qty) {
                alert("Insufficient stock quantity!");
                return;
            }
            inventoryList[index].qty -= qty;
            if (inventoryList[index].qty <= 0) {
                inventoryList.splice(index, 1);
            }
            showToast("Stock OUT Updated!");
        } else {
            alert("Item not found in stock!");
            return;
        }
    }

    try {
        await db.collection('inventories').doc(phone).set({
            items: inventoryList,
            lastUpdated: new Date().toISOString()
        }, { merge: true });
    } catch (e) {
        showToast("Error Saving Data");
    }

    if (nameInput) nameInput.value = '';
    if (qtyInput) qtyInput.value = '';

    renderInventoryList();
}

function deleteStockItem(index) {
    const phone = localStorage.getItem('userPhone');
    if (!phone) return;

    if (confirm("Are you sure you want to delete this stock item?")) {
        inventoryList.splice(index, 1);
        db.collection('inventories').doc(phone).set({ items: inventoryList }, { merge: true });
        renderInventoryList();
        showToast("Item Deleted");
    }
}

function renderInventoryList() {
    const container = document.getElementById('stockListContainer');
    if (!container) return;
    container.innerHTML = '';
    let totalQty = 0;

    if (inventoryList.length === 0) {
        container.innerHTML = `<p style="text-align:center; padding:20px; color:#888;">No inventory items found.</p>`;
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

function filterInventory() {
    const query = document.getElementById('searchInput')?.value.toLowerCase() || '';
    const cards = document.querySelectorAll('.stock-card');
    cards.forEach(card => {
        const name = card.querySelector('h4')?.innerText.toLowerCase() || '';
        card.style.display = name.includes(query) ? 'flex' : 'none';
    });
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
function handleStockOut() { document.getElementById('modalStockOutDetails').classList.remove('hidden'); }

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
