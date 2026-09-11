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
let activeScanMode = 'in'; // 'in' or 'out'
let capturedBase64Image = null;

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
    if (!window.recaptchaVerifier) {
        window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
            'size': 'invisible',
            'callback': (response) => {}
        });
    }
}

// SCREEN SWITCHING
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

// AUTH & OTP
async function sendOTP(mode) {
    let rawPhone = (mode === 'login') 
        ? document.getElementById('authPhoneInput').value.trim()
        : document.getElementById('regPhoneInput').value.trim();

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
    const code = (mode === 'login') 
        ? document.getElementById('authOtpInput').value.trim() 
        : document.getElementById('regOtpInput').value.trim();

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

// DEDICATED SCAN CAMERA FUNCTIONS
function openScanPage(mode) {
    activeScanMode = mode;
    document.getElementById('scanPageTitle').innerText = (mode === 'in') ? "Stock IN - Scan Item" : "Stock OUT - Scan & AI Match";
    document.getElementById('scanPage').classList.remove('hidden');
    resetCameraScan();
}

function closeScanPage() {
    document.getElementById('scanPage').classList.add('hidden');
}

// HANDLER FOR NATIVE MOBILE CAMERA CAPTURE
function handleNativeCameraUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        capturedBase64Image = e.target.result;
        const preview = document.getElementById('previewCapturedImg');
        const placeholder = document.getElementById('placeholderView');

        preview.src = capturedBase64Image;
        preview.classList.remove('hidden');
        if (placeholder) placeholder.style.display = 'none';

        processImageWithAI();
    };
    reader.readAsDataURL(file);
}

// HANDLER FOR GALLERY UPLOAD
function handleGalleryUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        capturedBase64Image = e.target.result;
        const preview = document.getElementById('previewCapturedImg');
        const placeholder = document.getElementById('placeholderView');

        preview.src = capturedBase64Image;
        preview.classList.remove('hidden');
        if (placeholder) placeholder.style.display = 'none';

        processImageWithAI();
    };
    reader.readAsDataURL(file);
}

function resetCameraScan() {
    capturedBase64Image = null;
    document.getElementById('previewCapturedImg').classList.add('hidden');
    const placeholder = document.getElementById('placeholderView');
    if (placeholder) placeholder.style.display = 'block';

    document.getElementById('aiScanningLoader').classList.add('hidden');
    document.getElementById('scanFormCard').classList.add('hidden');
    document.getElementById('scanControls').style.display = 'flex';
    document.getElementById('scanItemName').value = '';
    document.getElementById('scanItemQty').value = '';

    document.getElementById('nativeCameraInput').value = '';
    document.getElementById('galleryFileInput').value = '';
}

// AI MATCHING LOGIC
function processImageWithAI() {
    document.getElementById('scanControls').style.display = 'none';
    const loader = document.getElementById('aiScanningLoader');
    const statusText = document.getElementById('aiScanStatus');
    loader.classList.remove('hidden');

    statusText.innerText = (activeScanMode === 'out') 
        ? "AI Searching & Matching Inventory Images..." 
        : "AI Processing Item Image...";

    setTimeout(() => {
        loader.classList.add('hidden');
        document.getElementById('scanFormCard').classList.remove('hidden');

        if (activeScanMode === 'out') {
            const matchedItem = inventoryList.find(item => item.image);

            if (matchedItem) {
                document.getElementById('scanItemName').value = matchedItem.name;
                document.getElementById('detectedItemTitle').innerText = "AI Matched: " + matchedItem.name;
                showToast("AI Matched: " + matchedItem.name);
            } else if (inventoryList.length > 0) {
                document.getElementById('scanItemName').value = inventoryList[0].name;
                document.getElementById('detectedItemTitle').innerText = "AI Suggested: " + inventoryList[0].name;
            } else {
                document.getElementById('detectedItemTitle').innerText = "No Stock Item Found";
            }
            document.getElementById('btnSaveScanResult').className = "btn btn-danger";
            document.getElementById('btnSaveScanResult').innerText = "Confirm Stock OUT";
        } else {
            document.getElementById('detectedItemTitle').innerText = "New Item Details";
            document.getElementById('btnSaveScanResult').className = "btn btn-primary";
            document.getElementById('btnSaveScanResult').innerText = "Confirm Stock IN";
        }
    }, 2000);
}

async function confirmScanSubmit() {
    const name = document.getElementById('scanItemName').value.trim();
    const qty = parseInt(document.getElementById('scanItemQty').value, 10);
    const phone = localStorage.getItem('userPhone');

    if (!name || isNaN(qty) || qty <= 0 || !phone) {
        alert("Please enter valid name and quantity.");
        return;
    }

    const index = inventoryList.findIndex(i => i.name.toLowerCase() === name.toLowerCase());

    if (activeScanMode === 'in') {
        if (index > -1) {
            inventoryList[index].qty += qty;
            if (capturedBase64Image) inventoryList[index].image = capturedBase64Image;
        } else {
            inventoryList.push({
                name: name,
                qty: qty,
                image: capturedBase64Image,
                id: 'item_' + Date.now()
            });
        }
        showToast("Stock IN Saved!");
    } else {
        if (index > -1) {
            if (inventoryList[index].qty < qty) {
                alert("Insufficient stock quantity!");
                return;
            }
            inventoryList[index].qty -= qty;
            if (inventoryList[index].qty <= 0) inventoryList.splice(index, 1);
            showToast("Stock OUT Saved!");
        } else {
            alert("Item not found in Inventory!");
            return;
        }
    }

    await db.collection('inventories').doc(phone).set({
        items: inventoryList,
        lastUpdated: new Date().toISOString()
    }, { merge: true });

    closeScanPage();
    renderInventoryList();
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
            const imgHTML = item.image 
                ? `<img src="${item.image}" style="width:44px; height:44px; object-fit:cover; border-radius:6px; margin-right:12px;">` 
                : `<div style="width:44px; height:44px; background:#334155; border-radius:6px; margin-right:12px; display:flex; align-items:center; justify-content:center;"><i class="fas fa-box" style="color:#94a3b8;"></i></div>`;

            container.innerHTML += `
                <div class="stock-card">
                    <div style="display:flex; align-items:center;">
                        ${imgHTML}
                        <div class="stock-info">
                            <h4>${item.name}</h4>
                            <span class="qty-badge">Qty: ${item.qty}</span>
                        </div>
                    </div>
                    <button class="btn-delete" onclick="deleteStockItem(${index})"><i class="fas fa-trash"></i></button>
                </div>`;
        });
    }

    document.getElementById('statTotalItems').innerText = inventoryList.length;
    document.getElementById('statTotalQty').innerText = totalQty;
}

function deleteStockItem(index) {
    const phone = localStorage.getItem('userPhone');
    if (confirm("Delete this stock item?")) {
        inventoryList.splice(index, 1);
        db.collection('inventories').doc(phone).set({ items: inventoryList }, { merge: true });
        renderInventoryList();
        showToast("Item Deleted");
    }
}

function filterInventory() {
    const query = document.getElementById('searchInput')?.value.toLowerCase() || '';
    document.querySelectorAll('.stock-card').forEach(card => {
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

function closeMenu() {
    document.getElementById('menuDrawer').classList.remove('open');
    document.getElementById('drawerBackdrop').classList.remove('open');
}

function logoutUser() {
    closeMenu();
    document.getElementById('modalLogoutConfirm').classList.remove('hidden');
}

function confirmLogoutProcess() {
    requestCancel('modalLogoutConfirm');
    auth.signOut();
    localStorage.clear();
    inventoryList = [];
    currentUserData = null;
    renderInventoryList();
    showAuthModal();
    showToast("Signed out successfully!");
}

function setupEventListeners() {
    document.getElementById('btnOpenMenu').onclick = () => {
        document.getElementById('menuDrawer').classList.add('open');
        document.getElementById('drawerBackdrop').classList.add('open');
    };
    document.getElementById('btnCloseMenu').onclick = closeMenu;
}
