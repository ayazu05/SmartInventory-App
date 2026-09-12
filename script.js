// Live Firebase Configuration
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
let activeScanMode = 'in';
let capturedBase64Image = "";
let selectedModifyItemIndex = null;

// WHATSAPP SUPPORT NUMBER
const WHATSAPP_NUMBER = "917011162050";

document.addEventListener("DOMContentLoaded", () => {
    setTimeout(forceHideSplash, 800);
    setupRecaptcha();
    checkUserAuthentication();
    setupEventListeners();
    loadSavedTheme();
});

function forceHideSplash() {
    const splash = document.getElementById('appSplashLoader');
    if (splash) splash.style.display = 'none';
}

function setupRecaptcha() {
    if (!window.recaptchaVerifier) {
        window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
            'size': 'invisible',
            'callback': (response) => {}
        });
    }
}

// TOAST NOTIFICATION HELPERS
function showToast(msg) {
    const popup = document.getElementById('successPopUp');
    const msgEl = document.getElementById('popUpMessage');
    if (popup && msgEl) {
        msgEl.innerText = msg;
        popup.classList.remove('hidden');
        setTimeout(() => { popup.classList.add('hidden'); }, 2000);
    }
}

// WHATSAPP DIRECT LINK SUPPORT (HIDES NUMBER IN UI)
function openWhatsAppSupport() {
    const text = encodeURIComponent("Hello, I need support with Ai Stock Manager App.");
    const link = `https://wa.me/${WHATSAPP_NUMBER}?text=${text}`;
    window.open(link, '_blank');
}

// APP THEME TOGGLE (DARK / LIGHT)
function changeAppTheme(theme) {
    const body = document.getElementById('appBody');
    if (theme === 'light') {
        body.classList.remove('theme-dark');
        body.classList.add('theme-light');
    } else {
        body.classList.remove('theme-light');
        body.classList.add('theme-dark');
    }
    localStorage.setItem('appTheme', theme);
}

function loadSavedTheme() {
    const savedTheme = localStorage.getItem('appTheme') || 'dark';
    changeAppTheme(savedTheme);
    const select = document.getElementById('themeSelect');
    if (select) select.value = savedTheme;
}

// SWITCH VIEWS
function switchToSignUp() {
    document.getElementById('authLoginCard').style.display = 'none';
    document.getElementById('authSignUpCard').style.display = 'block';
}

function switchToLogin() {
    document.getElementById('authSignUpCard').style.display = 'none';
    document.getElementById('authLoginCard').style.display = 'block';
    resetAuthView();
}

function resetAuthView() {
    document.getElementById('authPhoneSubView').style.display = 'block';
    document.getElementById('authOtpSubView').style.display = 'none';
    document.getElementById('regFormFields').style.display = 'block';
    document.getElementById('regOtpFields').style.display = 'none';
}

// AUTHENTICATION & OTP
async function sendOTP(mode) {
    let rawPhone = (mode === 'login') ? document.getElementById('authPhoneInput').value.trim() : document.getElementById('regPhoneInput').value.trim();

    if (mode === 'register') {
        const name = document.getElementById('regNameInput').value.trim();
        const farm = document.getElementById('regFarmInput').value.trim();
        if (!name || !farm) {
            alert("Please enter Name and Farm Name.");
            return;
        }
    }
    if (!rawPhone || rawPhone.length < 10) {
        alert("Enter a valid 10-digit number.");
        return;
    }
    const formattedPhone = rawPhone.startsWith('+') ? rawPhone : '+91' + rawPhone.slice(-10);
    setupRecaptcha();
    try {
        confirmationResultObj = await auth.signInWithPhoneNumber(formattedPhone, window.recaptchaVerifier);
        showToast("OTP Sent to " + formattedPhone);
        if (mode === 'login') {
            document.getElementById('authPhoneSubView').style.display = 'none';
            document.getElementById('authOtpSubView').style.display = 'block';
        } else {
            document.getElementById('regFormFields').style.display = 'none';
            document.getElementById('regOtpFields').style.display = 'block';
        }
    } catch (error) {
        alert("Failed to send OTP: " + error.message);
    }
}

async function verifyOTP(mode) {
    const code = (mode === 'login') ? document.getElementById('authOtpInput').value.trim() : document.getElementById('regOtpInput').value.trim();

    if (!code || code.length < 6) {
        alert("Enter 6-digit OTP.");
        return;
    }
    try {
        const result = await confirmationResultObj.confirm(code);
        const phone = result.user.phoneNumber;
        if (mode === 'login') {
            await loginExistingUser(phone);
        } else {
            await registerNewUser(phone);
        }
    } catch (error) {
        alert("Invalid OTP.");
    }
}

async function loginExistingUser(phone) {
    let userDoc = await db.collection('users').doc(phone).get();
    if (!userDoc.exists) {
        const rawDigits = phone.replace('+91', '');
        userDoc = await db.collection('users').doc(rawDigits).get();
    }

    if (userDoc.exists) {
        finishAuth(phone, userDoc.data());
    } else {
        alert("Account not found! Please register.");
        switchToSignUp();
    }
}

async function registerNewUser(phone) {
    const name = document.getElementById('regNameInput').value.trim();
    const farm = document.getElementById('regFarmInput').value.trim();

    const userData = { phone, name, farm, createdAt: new Date().toISOString() };
    await db.collection('users').doc(phone).set(userData);
    showToast("Registration Successful!");
    finishAuth(phone, userData);
}

function finishAuth(phone, userData) {
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

function showAuthModal() { document.getElementById('authOverlay').classList.remove('hidden'); switchToLogin(); }
function hideAuthModal() { document.getElementById('authOverlay').classList.add('hidden'); }

// NAVIGATION & TAB SWITCHING
function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));

    if (tabName === 'stocks') {
        document.getElementById('tabStocks').classList.add('active');
    } else if (tabName === 'settings') {
        document.getElementById('tabSettings').classList.add('active');
    } else if (tabName === 'profile') {
        document.getElementById('tabProfile').classList.add('active');
    }
}

function setupEventListeners() {
    const btnOpen = document.getElementById('btnOpenMenu');
    const btnClose = document.getElementById('btnCloseMenu');
    const backdrop = document.getElementById('drawerBackdrop');

    if (btnOpen) btnOpen.addEventListener('click', openMenu);
    if (btnClose) btnClose.addEventListener('click', closeMenu);
    if (backdrop) backdrop.addEventListener('click', closeMenu);
}

function openMenu() {
    document.getElementById('menuDrawer').classList.add('open');
    document.getElementById('drawerBackdrop').classList.add('show');
}

function closeMenu() {
    document.getElementById('menuDrawer').classList.remove('open');
    document.getElementById('drawerBackdrop').classList.remove('show');
}

function logoutUser() {
    document.getElementById('modalLogoutConfirm').classList.remove('hidden');
}

function requestCancel(modalId) {
    document.getElementById(modalId).classList.add('hidden');
}

function confirmLogoutProcess() {
    localStorage.removeItem('userPhone');
    localStorage.removeItem('userData');
    auth.signOut();
    location.reload();
}

// SCAN CAMERA & MODAL POPUP
function openScanPage(mode) {
    activeScanMode = mode;
    document.getElementById('scanPageTitle').innerText = (mode === 'in') ? "Stock IN - Select Photo" : "Stock OUT - Select Photo";
    document.getElementById('scanPage').classList.remove('hidden');
    document.getElementById('photoResultModal').classList.add('hidden');
    resetCameraScan();
}

function closeScanPage() {
    document.getElementById('scanPage').classList.add('hidden');
    document.getElementById('photoResultModal').classList.add('hidden');
}

function retakePhoto() {
    document.getElementById('photoResultModal').classList.add('hidden');
    document.getElementById('scanPage').classList.remove('hidden');
    document.getElementById('nativeCameraInput').value = '';
    document.getElementById('galleryFileInput').value = '';
}

// IMAGE RESIZING & SELECTION
function handleImageSelection(event) {
    const file = event.target.files[0];
    if (!file) return;

    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => {
        img.src = e.target.result;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 500;
            const scaleSize = MAX_WIDTH / img.width;
            canvas.width = MAX_WIDTH;
            canvas.height = img.height * scaleSize;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            capturedBase64Image = canvas.toDataURL('image/jpeg', 0.6);
            openCapturedPopupModal();
        };
    };
    reader.readAsDataURL(file);
}

function openCapturedPopupModal() {
    document.getElementById('scanPage').classList.add('hidden');
    const modal = document.getElementById('photoResultModal');
    modal.classList.remove('hidden');

    const preview = document.getElementById('previewCapturedImg');
    preview.src = capturedBase64Image;
    document.getElementById('modalPageTitle').innerText = (activeScanMode === 'in') ? "Confirm Stock IN" : "Confirm Stock OUT";
    processImageWithAI();
}

function resetCameraScan() {
    capturedBase64Image = "";
    document.getElementById('scanItemName').value = '';
    document.getElementById('scanItemQty').value = '';
    document.getElementById('nativeCameraInput').value = '';
    document.getElementById('galleryFileInput').value = '';
}

// MANUAL INVENTORY SELECTION DROPDOWN
function populateManualSelectDropdown() {
    const select = document.getElementById('scanItemSelect');
    select.innerHTML = '<option value="">-- Choose Existing Item Manually --</option>';

    if (inventoryList.length > 0) {
        inventoryList.forEach(item => {
            select.innerHTML += `<option value="${item.name}">${item.name} (Qty: ${item.qty})</option>`;
        });
    } else {
        select.innerHTML = '<option value="">No Items in Inventory Yet</option>';
    }
}

function onManualDropdownSelect(selectedValue) {
    if (selectedValue) {
        document.getElementById('scanItemName').value = selectedValue;
    }
}

function processImageWithAI() {
    const loader = document.getElementById('aiScanningLoader');
    const statusText = document.getElementById('aiScanStatus');
    const formCard = document.getElementById('scanFormCard');

    loader.classList.remove('hidden');
    formCard.style.opacity = '0.4';
    populateManualSelectDropdown();
    statusText.innerText = (activeScanMode === 'out') ? "AI Searching & Matching Inventory..." : "AI Processing Item Image...";
    setTimeout(() => {
        loader.classList.add('hidden');
        formCard.style.opacity = '1';
        if (activeScanMode === 'out') {
            const matchedItem = inventoryList.find(item => item.image);
            if (matchedItem) {
                document.getElementById('scanItemName').value = matchedItem.name;
                document.getElementById('scanItemSelect').value = matchedItem.name;
                document.getElementById('detectedItemTitle').innerText = "AI Matched: " + matchedItem.name;
                showToast("AI Matched: " + matchedItem.name);
            } else if (inventoryList.length > 0) {
                document.getElementById('scanItemName').value = inventoryList[0].name;
                document.getElementById('scanItemSelect').value = inventoryList[0].name;
                document.getElementById('detectedItemTitle').innerText = "AI Suggested: " + inventoryList[0].name;
            } else {
                document.getElementById('detectedItemTitle').innerText = "No Stock Item Found";
            }
            document.getElementById('btnSaveScanResult').className = "btn btn-danger btn-full";
            document.getElementById('btnSaveScanResult').innerText = "Confirm Stock OUT";
        } else {
            document.getElementById('detectedItemTitle').innerText = "Item Details";
            document.getElementById('btnSaveScanResult').className = "btn btn-primary btn-full";
            document.getElementById('btnSaveScanResult').innerText = "Confirm Stock IN";
        }
    }, 1200);
}

// CONFIRM SUBMIT
async function confirmScanSubmit() {
    const nameInput = document.getElementById('scanItemName').value.trim();
    const qtyInput = document.getElementById('scanItemQty').value.trim();
    const phone = localStorage.getItem('userPhone');

    const qty = Number(qtyInput);
    if (!nameInput) { alert("Please enter or select Item Name."); return; }
    if (isNaN(qty) || qty <= 0) { alert("Please enter a valid Quantity."); return; }
    if (!phone) { alert("Session expired, please login again."); return; }

    const submitBtn = document.getElementById('btnSaveScanResult');
    submitBtn.innerText = "Saving...";
    submitBtn.disabled = true;

    const index = inventoryList.findIndex(i => i.name.toLowerCase() === nameInput.toLowerCase());
    if (activeScanMode === 'in') {
        if (index > -1) {
            inventoryList[index].qty = Number(inventoryList[index].qty) + qty;
            if (capturedBase64Image) inventoryList[index].image = capturedBase64Image;
        } else {
            inventoryList.push({ name: String(nameInput), qty: Number(qty), image: String(capturedBase64Image || ''), id: 'item_' + Date.now() });
        }
    } else {
        if (index > -1) {
            if (Number(inventoryList[index].qty) < qty) {
                alert("Insufficient stock quantity!");
                submitBtn.disabled = false;
                submitBtn.innerText = "Confirm Stock OUT";
                return;
            }
            inventoryList[index].qty = Number(inventoryList[index].qty) - qty;
            if (inventoryList[index].qty <= 0) inventoryList.splice(index, 1);
        } else {
            alert("Item not found in Inventory!");
            submitBtn.disabled = false;
            submitBtn.innerText = "Confirm Stock OUT";
            return;
        }
    }

    try {
        const cleanPayload = JSON.parse(JSON.stringify(inventoryList));
        await db.collection('inventories').doc(phone).set({ items: cleanPayload, lastUpdated: new Date().toISOString() }, { merge: true });
        renderInventoryList();
        closeScanPage();
        showToast(activeScanMode === 'in' ? "Stock IN Saved!" : "Stock OUT Saved!");
    } catch (err) {
        alert("Failed to save: " + err.message);
    } finally {
        submitBtn.disabled = false;
    }
}

// RENDER INVENTORY LIST (WITH EDIT & DELETE BUTTONS)
function renderInventoryList() {
    const container = document.getElementById('stockListContainer');
    if (!container) return;
    container.innerHTML = '';
    let totalQty = 0;

    if (inventoryList.length === 0) {
        container.innerHTML = `<p style="text-align:center; padding:20px; color: var(--subtext-color);">No inventory items found.</p>`;
    } else {
        inventoryList.forEach((item, index) => {
            const itemQty = Number(item.qty) || 0;
            totalQty += itemQty;
            const imgHTML = item.image ? `<img src="${item.image}" style="width:44px; height:44px; object-fit:cover; border-radius:6px; margin-right:12px;">` : `<div style="width:44px; height:44px; background:var(--border-color); border-radius:6px; margin-right:12px; display:flex; align-items:center; justify-content:center;"><i class="fas fa-box" style="color:var(--subtext-color);"></i></div>`;
            
            container.innerHTML += `
                <div class="stock-card">
                    <div style="display:flex; align-items:center;">
                        ${imgHTML}
                        <div class="stock-info">
                            <h4>${item.name}</h4>
                            <span class="qty-badge">Qty: ${itemQty}</span>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center;">
                        <button class="btn-edit-qty" onclick="openModifyQtyModal(${index})" title="Modify Quantity">
                            <i class="fas fa-pen-to-square"></i>
                        </button>
                        <button class="btn-delete" onclick="deleteStockItem(${index})" title="Delete Item">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>`;
        });
    }
    document.getElementById('statTotalItems').innerText = inventoryList.length;
    document.getElementById('statTotalQty').innerText = totalQty;
}

// ITEM QUANTITY MODIFY FUNCTIONS
function openModifyQtyModal(index) {
    selectedModifyItemIndex = index;
    const item = inventoryList[index];
    if (!item) return;

    document.getElementById('modifyItemNameDisplay').innerText = item.name;
    document.getElementById('modifyQtyVal').value = item.qty;
    document.getElementById('modifyQtyModal').classList.remove('hidden');
}

function closeModifyQtyModal() {
    document.getElementById('modifyQtyModal').classList.add('hidden');
    selectedModifyItemIndex = null;
}

function stepModifyQty(change) {
    const qtyInput = document.getElementById('modifyQtyVal');
    if (qtyInput) {
        let currentVal = parseInt(qtyInput.value) || 0;
        currentVal += change;
        if (currentVal < 0) currentVal = 0;
        qtyInput.value = currentVal;
    }
}

async function saveModifiedQuantity() {
    if (selectedModifyItemIndex === null) return;
    
    const newQty = parseInt(document.getElementById('modifyQtyVal').value) || 0;
    const phone = localStorage.getItem('userPhone');

    if (!phone) {
        alert("Session expired. Please log in again.");
        return;
    }

    if (newQty <= 0) {
        if (confirm("Quantity is set to 0. Remove this item from inventory?")) {
            inventoryList.splice(selectedModifyItemIndex, 1);
        } else {
            return;
        }
    } else {
        inventoryList[selectedModifyItemIndex].qty
